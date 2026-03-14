import http from "http";
import { URL } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import WebSocket, { WebSocketServer } from "ws";

dotenv.config();

const app = express();

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
    }
  | { type: "stop" }
  | { type: "ping" };

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
  if (typeof raw !== "string") {
    return null;
  }

  const parsed = parseJsonText(raw);
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

function resolveModel(key?: string) {
  if (!key) {
    return MODEL_MAP.default;
  }
  const normalized = key.toLowerCase();
  return MODEL_MAP[normalized] ?? normalized;
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
    let lastVideoSent = 0;
    let hasSentSetup = false;

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

        client.send(
          JSON.stringify({
            type: "overlay-update",
            detections: overlayDetections,
            source: "gemini",
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
            const setupPayload = {
              setup: {
                model: `models/${currentModel}`,
                ...(message.sessionConfig ?? {}),
              },
            };
            socket.send(JSON.stringify(setupPayload));
            hasSentSetup = true;
            break;
          }
          case "switch-model": {
            hasSentSetup = false;
            const socket = await ensureGeminiSocket(message.model);
            const setupPayload = {
              setup: {
                model: `models/${currentModel}`,
                ...(message.sessionConfig ?? {}),
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
                    mimeType: message.mimeType ?? "image/jpeg",
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
            const socket = await ensureGeminiSocket();
            socket.send(
              JSON.stringify({
                realtimeInput: {
                  audio: {
                    mimeType: message.mimeType ?? "audio/webm;codecs=opus",
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
            const socket = await ensureGeminiSocket();
            socket.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: message.text }],
                    },
                  ],
                  turnComplete: true,
                },
              }),
            );
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
