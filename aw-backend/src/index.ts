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
  | { type: "stop" }
  | { type: "ping" };

const MODEL_MAP: Record<string, string> = {
  default: process.env.GEMINI_MODEL ?? "gemini-3-flash",
  deep:
    process.env.GEMINI_MODEL_DEEP ?? process.env.GEMINI_MODEL ?? "gemini-3-pro",
};

const REALTIME_BASE =
  process.env.GEMINI_REALTIME_WS_BASE ??
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const VIDEO_THROTTLE_MS = 1000;

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
    console.log(`Backend listening on http://localhost:${port}`);
    console.log(
      `WebSocket bridge ready at ${process.env.GEMINI_LIVE_PATH ?? "/ws/live"}`,
    );
  });
}
