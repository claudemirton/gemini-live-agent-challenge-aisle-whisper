import http from "http";
import { URL } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import WebSocket, { WebSocketServer } from "ws";

dotenv.config();

const app = express();

const genAiSdkModel = process.env.GENAI_SDK_MODEL ?? "gemini-2.5-flash";
const overlayDetectionModel =
  process.env.OVERLAY_DETECTION_MODEL ?? genAiSdkModel;
let genAiSdkClientPromise: Promise<any | null> | null = null;

async function getGenAiSdkClient() {
  if (!process.env.GOOGLE_API_KEY) {
    return null;
  }

  if (!genAiSdkClientPromise) {
    genAiSdkClientPromise = import("@google/genai").then((module) => {
      return new module.GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    });
  }

  return genAiSdkClientPromise;
}

const allowedOrigins = [
  process.env.PWA_ORIGIN ?? "http://localhost:5173",
  process.env.PUBLIC_PWA_URL ?? "",
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json());

// Basic liveness probe for uptime checks.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Explicit Google GenAI SDK usage for compliance and runtime diagnostics.
app.get("/health/genai-sdk", async (_req, res) => {
  const genAiSdkClient = await getGenAiSdkClient();
  if (!genAiSdkClient) {
    res.status(503).json({
      status: "error",
      message: "GOOGLE_API_KEY is not configured for Google GenAI SDK.",
    });
    return;
  }

  try {
    const response = await genAiSdkClient.models.generateContent({
      model: genAiSdkModel,
      contents: "Respond with OK.",
    });
    res.json({
      status: "ok",
      model: genAiSdkModel,
      output: response.text,
      sdk: "@google/genai",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      model: genAiSdkModel,
      sdk: "@google/genai",
      message: (error as Error).message,
    });
  }
});

interface FindingInput {
  label: string;
  count: number;
}

function normalizeFindings(value: unknown): FindingInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as { label?: unknown; count?: unknown };
      if (typeof candidate.label !== "string") {
        return null;
      }

      const count =
        typeof candidate.count === "number" && Number.isFinite(candidate.count)
          ? Math.max(1, Math.round(candidate.count))
          : 1;

      return {
        label: candidate.label,
        count,
      };
    })
    .filter((entry): entry is FindingInput => Boolean(entry));
}

function toChecklistAction(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("gap")) {
    return "Restock facing to fill shelf gap";
  }
  if (normalized.includes("misalign")) {
    return "Realign product fronts to planogram";
  }
  if (normalized.includes("low")) {
    return "Top up shelf to target fill level";
  }
  return "Verify item placement and correct if needed";
}

function toChecklistPriority(label: string): "high" | "medium" | "low" {
  const normalized = label.toLowerCase();
  if (normalized.includes("gap") || normalized.includes("empty")) {
    return "high";
  }
  if (normalized.includes("misalign") || normalized.includes("out")) {
    return "medium";
  }
  return "low";
}

app.post("/tool/create-checklist", (req, res) => {
  const aisle =
    typeof req.body?.aisle === "string" && req.body.aisle.trim().length > 0
      ? req.body.aisle
      : "Aisle 12";
  const findings = normalizeFindings(req.body?.findings);

  const checklist = findings.length
    ? findings.map((finding, index) => ({
        id: `chk-${index + 1}`,
        issue: finding.label,
        observedCount: finding.count,
        action: toChecklistAction(finding.label),
        priority: toChecklistPriority(finding.label),
      }))
    : [
        {
          id: "chk-1",
          issue: "No structured shelf issues detected",
          observedCount: 0,
          action: "Run another pass and confirm shelf condition manually",
          priority: "low",
        },
      ];

  res.json({
    status: "ok",
    aisle,
    generatedAt: new Date().toISOString(),
    checklist,
    totals: {
      uniqueIssues: checklist.length,
      observations: findings.reduce((sum, entry) => sum + entry.count, 0),
    },
    settings: req.body?.settings ?? {},
  });
});

// Example audit summary endpoint; replace with real logic later.
app.post("/api/audits", (req, res) => {
  const { aisle, findings } = req.body ?? {};
  res.json({
    message: "Audit received",
    aisle: aisle ?? "unknown",
    findings: findings ?? [],
    receivedAt: new Date().toISOString(),
  });
});

type ClientMessage =
  | {
      type: "start";
      model?: string;
      sessionConfig?: Record<string, unknown>;
    }
  | {
      type: "switch-model";
      model: string;
      sessionConfig?: Record<string, unknown>;
    }
  | {
      type: "video-frame";
      data: string;
      mimeType?: string;
    }
  | {
      type: "audio-chunk";
      data: string;
      mimeType?: string;
    }
  | {
      type: "text-command";
      text: string;
      focus?: "all" | "alignment" | "gaps" | "restock";
    }
  | { type: "stop" }
  | { type: "ping" };

type OverlayFocusKey = "all" | "alignment" | "gaps" | "restock";

interface OverlayDetection {
  id: string;
  label: string;
  score: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const OVERLAY_ALLOWED_LABELS: Record<OverlayFocusKey, string[]> = {
  all: ["GAP", "MISALIGNED", "LOW_STOCK", "OUT_OF_PLACE"],
  alignment: ["MISALIGNED"],
  gaps: ["GAP"],
  restock: ["GAP", "LOW_STOCK"],
};

function normalizeOverlayFocus(value: unknown): OverlayFocusKey {
  if (value === "alignment") {
    return "alignment";
  }
  if (value === "gaps") {
    return "gaps";
  }
  if (value === "restock") {
    return "restock";
  }
  return "all";
}

function normalizeOverlayLabel(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .trim();
}

function buildStrictOverlayPrompt(focus: OverlayFocusKey): string {
  const labels = OVERLAY_ALLOWED_LABELS[focus].join("|");
  return [
    "Analyze the latest shelf frame and return a single JSON object only.",
    `Allowed labels for this request: ${labels}.`,
    'Output shape must be exactly: {"detections":[{"id":"string","label":"' +
      labels +
      '","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}',
    'Rules: no markdown, no prose, normalized 0..1 coordinates, and return {"detections":[]} when no valid issues are present.',
  ].join(" ");
}

function filterDetectionsByFocus(
  detections: OverlayDetection[],
  focus: OverlayFocusKey,
): OverlayDetection[] {
  const allowed = new Set(OVERLAY_ALLOWED_LABELS[focus]);

  return detections.filter((detection) => {
    const normalizedLabel = normalizeOverlayLabel(detection.label);
    return allowed.has(normalizedLabel);
  });
}

const MODEL_MAP: Record<string, string> = {
  default: process.env.GEMINI_MODEL ?? "gemini-3-flash",
  deep:
    process.env.GEMINI_MODEL_DEEP ?? process.env.GEMINI_MODEL ?? "gemini-3-pro",
};

const REALTIME_BASE =
  process.env.GEMINI_REALTIME_WS_BASE ??
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const VIDEO_THROTTLE_MS = 1000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeOverlayDetection(value: unknown): OverlayDetection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    id?: unknown;
    label?: unknown;
    score?: unknown;
    box?: {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
  };

  const box = candidate.box;
  if (!box || typeof box !== "object") {
    return null;
  }

  const x = typeof box.x === "number" ? box.x : NaN;
  const y = typeof box.y === "number" ? box.y : NaN;
  const width = typeof box.width === "number" ? box.width : NaN;
  const height = typeof box.height === "number" ? box.height : NaN;

  if (
    Number.isNaN(x) ||
    Number.isNaN(y) ||
    Number.isNaN(width) ||
    Number.isNaN(height)
  ) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id
        : `det-${Math.random().toString(36).slice(2, 10)}`,
    label:
      typeof candidate.label === "string" && candidate.label.trim().length > 0
        ? candidate.label
        : "Finding",
    score:
      typeof candidate.score === "number"
        ? clamp01(candidate.score)
        : clamp01(0.8),
    box: {
      x: clamp01(x),
      y: clamp01(y),
      width: clamp01(width),
      height: clamp01(height),
    },
  };
}

function toOverlayDetections(value: unknown): OverlayDetection[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map((entry) => normalizeOverlayDetection(entry))
    .filter((entry): entry is OverlayDetection => Boolean(entry));

  if (!normalized.length) {
    return null;
  }

  return normalized;
}

function parseJsonText(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractCodeFenceJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    return null;
  }
  return parseJsonText(fenced[1].trim());
}

function extractJsonObjectOrArray(text: string): unknown | null {
  const fromFence = extractCodeFenceJson(text);
  if (fromFence) {
    return fromFence;
  }

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const startCandidates = [firstBrace, firstBracket].filter((idx) => idx >= 0);
  if (!startCandidates.length) {
    return null;
  }

  const start = Math.min(...startCandidates);
  const maybeJson = text.slice(start).trim();
  return parseJsonText(maybeJson);
}

function extractTextCandidatesFromPayload(
  value: unknown,
  bag: string[] = [],
): string[] {
  if (!value) {
    return bag;
  }

  if (typeof value === "string") {
    bag.push(value);
    return bag;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => extractTextCandidatesFromPayload(item, bag));
    return bag;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entry) => {
      extractTextCandidatesFromPayload(entry, bag);
    });
  }

  return bag;
}

function parseOverlayDetectionsFromGeminiMessage(
  raw: WebSocket.RawData,
): OverlayDetection[] | null {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString("utf8");
  } else if (Array.isArray(raw)) {
    text = Buffer.concat(raw).toString("utf8");
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString("utf8");
  } else {
    return null;
  }

  const parsed = parseJsonText(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const direct = parsed as { type?: unknown; detections?: unknown };
  if (direct.type === "overlay-update") {
    return toOverlayDetections(direct.detections);
  }

  const directDetections = toOverlayDetections(
    (parsed as { detections?: unknown }).detections,
  );
  if (directDetections) {
    return directDetections;
  }

  const textCandidates = extractTextCandidatesFromPayload(parsed);
  for (const text of textCandidates) {
    const nested = extractJsonObjectOrArray(text);
    if (!nested || typeof nested !== "object") {
      continue;
    }

    const nestedDetections = toOverlayDetections(
      (nested as { detections?: unknown }).detections,
    );
    if (nestedDetections) {
      return nestedDetections;
    }

    const asArray = toOverlayDetections(nested);
    if (asArray) {
      return asArray;
    }
  }

  return null;
}

function parseOverlayDetectionsFromText(
  text: string,
): OverlayDetection[] | null {
  const nested = extractJsonObjectOrArray(text);
  if (!nested || typeof nested !== "object") {
    return null;
  }

  const nestedDetections = toOverlayDetections(
    (nested as { detections?: unknown }).detections,
  );
  if (nestedDetections) {
    return nestedDetections;
  }

  return toOverlayDetections(nested);
}

async function detectOverlayFromFrame(input: {
  prompt: string;
  frameData: string;
  mimeType: string;
}): Promise<OverlayDetection[] | null> {
  const client = await getGenAiSdkClient();
  if (!client) {
    return null;
  }

  const response = await client.models.generateContent({
    model: overlayDetectionModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: input.prompt,
          },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.frameData,
            },
          },
        ],
      },
    ],
  });

  if (!response?.text) {
    return null;
  }

  return parseOverlayDetectionsFromText(response.text);
}

function resolveModel(key?: string) {
  if (!key) {
    return MODEL_MAP.default;
  }
  const normalized = key.toLowerCase();
  return MODEL_MAP[normalized] ?? normalized;
}

function normalizeSessionConfigForModel(
  model: string,
  sessionConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...(sessionConfig ?? {}),
  };

  const generationConfigSource =
    normalized.generationConfig &&
    typeof normalized.generationConfig === "object"
      ? (normalized.generationConfig as Record<string, unknown>)
      : {};
  const generationConfig: Record<string, unknown> = {
    ...generationConfigSource,
  };

  // Native-audio models require audio response modality in setup.
  if (model.includes("native-audio")) {
    generationConfig.responseModalities = ["AUDIO"];
  }

  normalized.generationConfig = generationConfig;
  return normalized;
}

function buildRealtimeUrl() {
  const url = new URL(REALTIME_BASE);
  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }
  return url.toString();
}

async function connectToGemini(): Promise<WebSocket> {
  const url = buildRealtimeUrl();
  const headers: Record<string, string> = {
    "User-Agent": "aisle-whisper-backend/1.0",
  };
  if (!process.env.GOOGLE_API_KEY) {
    const bearer = process.env.GEMINI_ACCESS_TOKEN;
    if (!bearer) {
      throw new Error(
        "GOOGLE_API_KEY or GEMINI_ACCESS_TOKEN must be set to reach Gemini Live.",
      );
    }
    headers.Authorization = `Bearer ${bearer}`;
  }

  return await new Promise<WebSocket>((resolve, reject) => {
    const realtimeSocket = new WebSocket(url, { headers });

    const handleError = (error: Error) => {
      realtimeSocket.removeAllListeners();
      reject(error);
    };

    realtimeSocket.once("open", () => {
      realtimeSocket.off("error", handleError);
      resolve(realtimeSocket);
    });
    realtimeSocket.once("error", handleError);
  });
}

function setupRealtimeBridge(server: http.Server) {
  const livePath = process.env.GEMINI_LIVE_PATH ?? "/ws/live";
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const requestUrl = request.url
        ? new URL(request.url, `http://${request.headers.host}`)
        : null;
      if (!requestUrl || requestUrl.pathname !== livePath) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (client, request) => {
    const requestUrl = request.url
      ? new URL(request.url, `http://${request.headers.host}`)
      : null;
    const defaultModelKey = requestUrl?.searchParams.get("model") ?? "default";

    let geminiSocket: WebSocket | null = null;
    let currentModel = resolveModel(defaultModelKey);
    let currentOverlayFocus: OverlayFocusKey = "all";
    let lastVideoSent = 0;
    let hasSentSetup = false;
    let latestVideoFrame: {
      data: string;
      mimeType: string;
      capturedAt: number;
    } | null = null;

    const teardown = (code = 1000, reason?: string) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code, reason);
      }
      if (geminiSocket && geminiSocket.readyState === WebSocket.OPEN) {
        geminiSocket.close(code, reason);
      }
    };

    const relayToClient = (payload: WebSocket.RawData, isBinary: boolean) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, { binary: isBinary });
      }
    };

    const ensureGeminiSocket = async (modelKey?: string) => {
      const model = resolveModel(modelKey ?? currentModel);
      if (
        geminiSocket &&
        geminiSocket.readyState === WebSocket.OPEN &&
        model === currentModel
      ) {
        return geminiSocket;
      }

      if (geminiSocket) {
        geminiSocket.removeAllListeners();
        geminiSocket.close(1000, "switching-model");
      }

      const realtimeSocket = await connectToGemini();
      currentModel = model;

      realtimeSocket.on("message", (data, isBinary) => {
        relayToClient(data, isBinary);

        const overlayDetections = parseOverlayDetectionsFromGeminiMessage(data);
        if (!overlayDetections || client.readyState !== WebSocket.OPEN) {
          return;
        }

        const filteredDetections = filterDetectionsByFocus(
          overlayDetections,
          currentOverlayFocus,
        );

        client.send(
          JSON.stringify({
            type: "overlay-update",
            detections: filteredDetections,
            source: "gemini",
            focus: currentOverlayFocus,
            ts: Date.now(),
          }),
        );
      });

      realtimeSocket.on("close", (code, reason) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "gemini-closed",
              code,
              reason: reason.toString(),
            }),
          );
        }
        teardown(code, reason.toString());
      });

      realtimeSocket.on("error", (error) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({ type: "error", message: error.message }),
          );
        }
      });

      geminiSocket = realtimeSocket;
      return realtimeSocket;
    };

    client.on("message", async (raw, isBinary) => {
      if (isBinary) {
        if (!geminiSocket || geminiSocket.readyState !== WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "error",
              message: "Gemini connection not established for binary payload.",
            }),
          );
          return;
        }

        geminiSocket.send(raw, { binary: true });
        return;
      }

      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch (error) {
        client.send(
          JSON.stringify({
            type: "error",
            message: `Invalid message payload: ${(error as Error).message}`,
          }),
        );
        return;
      }

      try {
        switch (message.type) {
          case "start": {
            const socket = await ensureGeminiSocket(message.model);
            const sessionConfig = normalizeSessionConfigForModel(
              currentModel,
              message.sessionConfig,
            );
            const setupPayload = {
              setup: {
                model: `models/${currentModel}`,
                ...sessionConfig,
              },
            };
            socket.send(JSON.stringify(setupPayload));
            hasSentSetup = true;
            break;
          }
          case "switch-model": {
            hasSentSetup = false;
            const socket = await ensureGeminiSocket(message.model);
            const sessionConfig = normalizeSessionConfigForModel(
              currentModel,
              message.sessionConfig,
            );
            const setupPayload = {
              setup: {
                model: `models/${currentModel}`,
                ...sessionConfig,
              },
            };
            socket.send(JSON.stringify(setupPayload));
            hasSentSetup = true;
            break;
          }
          case "video-frame": {
            if (!hasSentSetup) {
              client.send(
                JSON.stringify({
                  type: "error",
                  message: "Session not started. Send a 'start' message first.",
                }),
              );
              break;
            }

            latestVideoFrame = {
              data: message.data,
              mimeType: message.mimeType ?? "image/jpeg",
              capturedAt: Date.now(),
            };

            const now = Date.now();
            if (now - lastVideoSent < VIDEO_THROTTLE_MS) {
              break;
            }
            lastVideoSent = now;
            const socket = await ensureGeminiSocket();
            socket.send(
              JSON.stringify({
                realtimeInput: {
                  video: {
                    mimeType: latestVideoFrame.mimeType,
                    data: message.data,
                  },
                },
              }),
            );
            break;
          }
          case "audio-chunk": {
            if (!hasSentSetup) {
              client.send(
                JSON.stringify({
                  type: "error",
                  message: "Session not started. Send a 'start' message first.",
                }),
              );
              break;
            }

            const chunkMimeType = message.mimeType ?? "audio/webm;codecs=opus";
            if (!chunkMimeType.toLowerCase().startsWith("audio/pcm")) {
              client.send(
                JSON.stringify({
                  type: "audio-ignored",
                  message: `Unsupported live audio mime type '${chunkMimeType}'. Supported: audio/pcm or audio/pcm;rate=xxxxx.`,
                }),
              );
              break;
            }

            const socket = await ensureGeminiSocket();
            socket.send(
              JSON.stringify({
                realtimeInput: {
                  audio: {
                    mimeType: chunkMimeType,
                    data: message.data,
                  },
                },
              }),
            );
            break;
          }
          case "text-command": {
            if (!hasSentSetup) {
              client.send(
                JSON.stringify({
                  type: "error",
                  message: "Session not started. Send a 'start' message first.",
                }),
              );
              break;
            }

            if (!latestVideoFrame) {
              client.send(
                JSON.stringify({
                  type: "error",
                  message: "No video frame received yet for overlay detection.",
                }),
              );
              break;
            }

            currentOverlayFocus = normalizeOverlayFocus(message.focus);
            const strictPrompt = buildStrictOverlayPrompt(currentOverlayFocus);
            const detections = await detectOverlayFromFrame({
              prompt: strictPrompt,
              frameData: latestVideoFrame.data,
              mimeType: latestVideoFrame.mimeType,
            });

            if (detections && client.readyState === WebSocket.OPEN) {
              const filteredDetections = filterDetectionsByFocus(
                detections,
                currentOverlayFocus,
              );
              client.send(
                JSON.stringify({
                  type: "overlay-update",
                  detections: filteredDetections,
                  source: "overlay-sdk",
                  model: overlayDetectionModel,
                  focus: currentOverlayFocus,
                  ts: Date.now(),
                }),
              );
            }
            break;
          }
          case "stop": {
            if (geminiSocket && geminiSocket.readyState === WebSocket.OPEN) {
              geminiSocket.send(
                JSON.stringify({
                  realtimeInput: { audioStreamEnd: true },
                }),
              );
            }
            break;
          }
          case "ping": {
            client.send(JSON.stringify({ type: "pong", ts: Date.now() }));
            break;
          }
        }
      } catch (error) {
        client.send(
          JSON.stringify({
            type: "error",
            message: (error as Error).message,
          }),
        );
      }
    });

    client.on("close", () => {
      if (geminiSocket && geminiSocket.readyState === WebSocket.OPEN) {
        geminiSocket.close(1000, "client-disconnected");
      }
    });

    client.on("error", () => {
      if (geminiSocket && geminiSocket.readyState === WebSocket.OPEN) {
        geminiSocket.close(1011, "client-error");
      }
    });
  });
}

export default app;

if (require.main === module) {
  const port = Number(process.env.PORT) || 4000;
  const server = http.createServer(app);
  setupRealtimeBridge(server);

  server.listen(port, () => {
    console.log(
      `Resolved models: default=${MODEL_MAP.default}, deep=${MODEL_MAP.deep}`,
    );
    console.log(`Backend listening on http://localhost:${port}`);
    console.log(
      `WebSocket bridge ready at ${process.env.GEMINI_LIVE_PATH ?? "/ws/live"}`,
    );
  });
}
