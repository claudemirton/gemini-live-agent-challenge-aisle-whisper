import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import MicOffRoundedIcon from "@mui/icons-material/MicOffRounded";
import CropFreeRoundedIcon from "@mui/icons-material/CropFreeRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import LocalPrintshopRoundedIcon from "@mui/icons-material/LocalPrintshopRounded";
import {
  frameRateToIntervalMs,
  loadSettingsFromStorage,
  type AppSettings,
} from "./settings";

const BACKEND_WS_URL =
  import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8080/ws/live";
const BACKEND_API_URL =
  import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8080";
const SHOW_OVERLAY_DEBUG_PANEL =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_OVERLAY_DEBUG === "true";
const OVERLAY_PROMPT_INTERVAL_MS = 3500;

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "ready"
  | "disconnected"
  | "error";

function buildBridgeUrl(baseUrl: string, modelKey: string): string {
  const url = new URL(baseUrl, window.location.origin);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.searchParams.set("model", modelKey);
  return url.toString();
}

function toModelKey(streamModel: string): "default" | "deep" {
  return streamModel === "pro" ? "deep" : "default";
}

function toThinkingTemperature(thinkingLevel: string): number {
  if (thinkingLevel === "minimal") {
    return 0.2;
  }
  if (thinkingLevel === "medium") {
    return 0.65;
  }
  return 0.4;
}

function toLanguageInstruction(language: string): string {
  const overlayContract =
    'When analyzing camera frames, include a strict JSON object with this exact shape: {"detections":[{"id":"string","label":"string","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Use normalized 0..1 coordinates and return valid JSON only when detections are present.';
  if (language.toLowerCase() === "pt-br") {
    return `Always respond in Brazilian Portuguese. ${overlayContract}`;
  }
  return `Always respond in English. ${overlayContract}`;
}

function toAudioSessionConfig(thinkingLevel: string): Record<string, unknown> {
  return {
    generationConfig: {
      temperature: toThinkingTemperature(thinkingLevel),
      responseModalities: ["AUDIO"],
    },
  };
}

function toOverlayCommand(language: string): string {
  if (language.toLowerCase() === "pt-br") {
    return `Analise o quadro de video mais recente e responda SOMENTE com JSON valido no formato: {"detections":[{"id":"string","label":"string","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Use coordenadas normalizadas de 0 a 1.`;
  }
  return `Analyze the most recent video frame and reply ONLY with valid JSON in this format: {"detections":[{"id":"string","label":"string","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Use normalized coordinates from 0 to 1.`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode frame payload."));
        return;
      }
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Could not extract base64 frame data."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

export interface OverlayDetection {
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

interface OverlayUpdateMessage {
  type: "overlay-update";
  detections?: unknown;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeOverlayDetections(
  payload: unknown,
): OverlayDetection[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const normalized = payload
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as {
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
            : `det-${index}`,
        label:
          typeof candidate.label === "string" &&
          candidate.label.trim().length > 0
            ? candidate.label
            : "Finding",
        score:
          typeof candidate.score === "number" ? clamp01(candidate.score) : 0.8,
        box: {
          x: clamp01(x),
          y: clamp01(y),
          width: clamp01(width),
          height: clamp01(height),
        },
      };
    })
    .filter((entry): entry is OverlayDetection => Boolean(entry));

  if (!normalized.length) {
    return null;
  }

  return normalized;
}

interface CameraStreamProps {
  onFrame?: (frame: Blob) => void;
  overlay?: ReactNode;
  frameIntervalMs?: number;
}

const CameraStream = ({
  onFrame,
  overlay,
  frameIntervalMs = 1000,
}: CameraStreamProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let activeVideo: HTMLVideoElement | null = null;
    const startStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const videoElement = videoRef.current;
        if (videoElement) {
          activeVideo = videoElement;
          videoElement.srcObject = stream;
          await videoElement.play();
        }
      } catch (error) {
        console.error("Unable to access camera", error);
      }
    };

    startStream();

    return () => {
      mounted = false;
      const stream = activeVideo?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      if (activeVideo) {
        activeVideo.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!onFrame) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const frameTimer = window.setInterval(() => {
      if (!video || video.readyState < 2) {
        return;
      }
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        return;
      }
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            onFrame(blob);
          }
        },
        "image/jpeg",
        0.7,
      );
    }, frameIntervalMs);

    return () => window.clearInterval(frameTimer);
  }, [frameIntervalMs, onFrame]);

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardHeader
        avatar={<VideocamRoundedIcon color="primary" />}
        title="Camera"
        subheader="Live store feed + AI overlay"
      />
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box
          sx={{
            position: "relative",
            borderRadius: 2,
            overflow: "hidden",
            aspectRatio: "4 / 3",
            bgcolor: "grey.900",
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {overlay && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
              }}
            >
              {overlay}
            </Box>
          )}
          <canvas ref={canvasRef} hidden />
        </Box>
        <Typography variant="body2" color="text.secondary">
          Frames are sampled every {Math.round(frameIntervalMs / 100) / 10}s and
          streamed to the Gemini Live session.
        </Typography>
      </CardContent>
    </Card>
  );
};

interface VoiceCaptureProps {
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  pushToTalk?: boolean;
  language?: string;
}

const VoiceCapture = ({
  onAudioChunk,
  pushToTalk = true,
  language = "en",
}: VoiceCaptureProps) => {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const stopRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  const startRecorder = useCallback(async () => {
    if (mediaRecorderRef.current) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: 48000,
      });

      recorder.addEventListener("dataavailable", async (event) => {
        if (!event.data.size) return;
        const arrayBuffer = await event.data.arrayBuffer();
        onAudioChunk?.(arrayBuffer);
      });

      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      console.error("Unable to access microphone", error);
    }
  }, [onAudioChunk]);

  useEffect(() => {
    return () => {
      stopRecorder();
    };
  }, [stopRecorder]);

  return (
    <Card variant="outlined">
      <CardHeader
        avatar={<MicRoundedIcon color={recording ? "error" : "primary"} />}
        title="Voice Capture"
        subheader={`${pushToTalk ? "Push-to-talk" : "Tap-to-toggle"} • ${language.toUpperCase()}`}
      />
      <CardContent>
        <Stack spacing={2} alignItems="center">
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Hold to describe planograms or ask for help. Audio chunks are
            streamed while you speak.
          </Typography>
          <Button
            variant={recording ? "contained" : "outlined"}
            color={recording ? "error" : "primary"}
            size="large"
            startIcon={recording ? <MicOffRoundedIcon /> : <MicRoundedIcon />}
            onMouseDown={pushToTalk ? startRecorder : undefined}
            onMouseUp={pushToTalk ? stopRecorder : undefined}
            onMouseLeave={
              pushToTalk ? () => recording && stopRecorder() : undefined
            }
            onTouchStart={pushToTalk ? startRecorder : undefined}
            onTouchEnd={pushToTalk ? stopRecorder : undefined}
            onClick={
              !pushToTalk
                ? () => (recording ? stopRecorder() : startRecorder())
                : undefined
            }
          >
            {pushToTalk
              ? recording
                ? "Release to send"
                : "Hold to talk"
              : recording
                ? "Tap to stop"
                : "Tap to start"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

interface OverlayCanvasProps {
  detections: OverlayDetection[];
}

const OverlayCanvas = ({ detections }: OverlayCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);

    detections.forEach((det) => {
      const boxX = det.box.x * width;
      const boxY = det.box.y * height;
      const boxW = det.box.width * width;
      const boxH = det.box.height * height;

      context.strokeStyle = "rgba(14, 111, 255, 0.9)";
      context.lineWidth = 3;
      context.strokeRect(boxX, boxY, boxW, boxH);

      context.font = "14px Inter, sans-serif";
      context.fillStyle = "rgba(14, 111, 255, 0.85)";
      const label = `${det.label} ${(det.score * 100).toFixed(0)}%`;
      const metrics = context.measureText(label);
      const textPadding = 8;
      const textHeight = 22;
      const labelY = Math.max(boxY - textHeight, 0);

      context.fillRect(
        boxX,
        labelY,
        Math.min(metrics.width + textPadding * 2, width - boxX),
        textHeight,
      );
      context.fillStyle = "#fff";
      context.fillText(label, boxX + textPadding, labelY + textHeight - 6);
    });
  }, [detections]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
};

interface ActionPanelProps {
  onAudit: () => void;
  onGenerateChecklist: () => void;
  onPrintTags: () => void;
  streamModel: string;
  deepChecks: string;
  thinkingLevel: string;
  connectionStatus: ConnectionStatus;
  checklistLoading: boolean;
  printLoading: boolean;
  language: string;
  detailLevel: string;
}

const ActionPanel = ({
  onAudit,
  onGenerateChecklist,
  onPrintTags,
  streamModel,
  deepChecks,
  thinkingLevel,
  connectionStatus,
  checklistLoading,
  printLoading,
  language,
  detailLevel,
}: ActionPanelProps) => {
  return (
    <Card variant="outlined">
      <CardHeader
        title="Actions"
        subheader={`Tools & exports • ${streamModel.toUpperCase()} • ${deepChecks.toUpperCase()} • ${thinkingLevel.toUpperCase()} • ${connectionStatus.toUpperCase()}`}
      />
      <CardContent>
        <Stack spacing={2}>
          <Button
            variant="contained"
            onClick={onAudit}
            startIcon={<CropFreeRoundedIcon />}
          >
            Audit Shelf
          </Button>
          <Button
            variant="outlined"
            onClick={onGenerateChecklist}
            startIcon={<ChecklistRoundedIcon />}
            disabled={checklistLoading}
          >
            {checklistLoading ? "Generating…" : "Generate Checklist"}
          </Button>
          <Button
            variant="outlined"
            onClick={onPrintTags}
            startIcon={<LocalPrintshopRoundedIcon />}
            disabled={printLoading}
          >
            {printLoading ? "Preparing…" : "Print Tags"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Checklist consumes: language ({language.toUpperCase()}), detail mode
            ({detailLevel.toUpperCase()}), deep checks (
            {deepChecks.toUpperCase()}) and thinking level (
            {thinkingLevel.toUpperCase()}).
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Print consumes: language ({language.toUpperCase()}), detail mode (
            {detailLevel.toUpperCase()}) and stream model (
            {streamModel.toUpperCase()}).
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

interface AuditScreenProps {
  onBack?: () => void;
  onAuditShelf: () => void;
  onChecklistGenerated?: (payload: unknown) => void;
  onPrintTagsGenerated?: (payload: unknown) => void;
}

const AuditScreen = ({
  onBack,
  onAuditShelf,
  onChecklistGenerated,
  onPrintTagsGenerated,
}: AuditScreenProps) => {
  const [settings] = useState<AppSettings>(() => loadSettingsFromStorage());
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);
  const [detections, setDetections] = useState<OverlayDetection[]>([]);
  const [lastOverlayUpdateTs, setLastOverlayUpdateTs] = useState<number | null>(
    null,
  );
  const [lastSocketEvent, setLastSocketEvent] = useState("waiting for WS");

  const websocketRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const lastOverlayPromptAtRef = useRef(0);

  useEffect(() => {
    const modelKey = toModelKey(settings.streamModel);
    const wsUrl = buildBridgeUrl(BACKEND_WS_URL, modelKey);
    const websocket = new WebSocket(wsUrl);
    websocketRef.current = websocket;
    sessionReadyRef.current = false;
    lastOverlayPromptAtRef.current = 0;
    setConnectionStatus("connecting");
    setDetections([]);
    setLastOverlayUpdateTs(null);
    setLastSocketEvent(`connecting to ${wsUrl}`);

    websocket.onopen = () => {
      setConnectionStatus("connected");
      setLastSocketEvent("socket open; sending start message");
      websocket.send(
        JSON.stringify({
          type: "start",
          model: modelKey,
          sessionConfig: {
            ...toAudioSessionConfig(settings.thinkingLevel),
            systemInstruction: {
              parts: [{ text: toLanguageInstruction(settings.language) }],
            },
          },
        }),
      );

      // Native-audio live sessions may not emit an explicit setupComplete event.
      // Mark session ready after start is sent so frame + text-command flow can begin.
      sessionReadyRef.current = true;
      setConnectionStatus("ready");
      setLastSocketEvent("start sent; ready for frame analysis");
    };

    websocket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          setupComplete?: unknown;
          setup_complete?: unknown;
          detections?: unknown;
        };

        if (payload.type === "overlay-update") {
          const parsedDetections = normalizeOverlayDetections(
            (payload as OverlayUpdateMessage).detections,
          );
          if (parsedDetections) {
            setDetections(parsedDetections);
            setLastOverlayUpdateTs(Date.now());
            setLastSocketEvent(
              `overlay-update received (${parsedDetections.length} detections)`,
            );
          }
          return;
        }

        if (payload.type === "error") {
          setConnectionStatus("error");
          const message =
            typeof (payload as { message?: unknown }).message === "string"
              ? (payload as { message: string }).message
              : "unknown backend error";
          setLastSocketEvent(`backend error: ${message}`);
          return;
        }

        if (payload.type === "gemini-closed") {
          setConnectionStatus("disconnected");
          sessionReadyRef.current = false;
          const reason =
            typeof (payload as { reason?: unknown }).reason === "string"
              ? (payload as { reason: string }).reason
              : "no reason provided";
          setLastSocketEvent(`gemini-closed: ${reason}`);
          return;
        }

        if (payload.setupComplete || payload.setup_complete) {
          setConnectionStatus("ready");
          sessionReadyRef.current = true;
          setLastSocketEvent("setup complete");
        }
      } catch {
        setConnectionStatus("ready");
        sessionReadyRef.current = true;
        setLastSocketEvent("non-JSON message from backend");
      }
    };

    websocket.onerror = () => {
      setConnectionStatus("error");
      sessionReadyRef.current = false;
      setLastSocketEvent("browser websocket error");
    };

    websocket.onclose = (event) => {
      setConnectionStatus((previous) =>
        previous === "error" ? "error" : "disconnected",
      );
      sessionReadyRef.current = false;
      setDetections([]);
      setLastOverlayUpdateTs(null);
      lastOverlayPromptAtRef.current = 0;
      const reason = event.reason || "no reason";
      setLastSocketEvent(`socket closed (${event.code}): ${reason}`);
    };

    return () => {
      sessionReadyRef.current = false;
      websocket.close();
      if (websocketRef.current === websocket) {
        websocketRef.current = null;
      }
      setDetections([]);
      setLastOverlayUpdateTs(null);
      lastOverlayPromptAtRef.current = 0;
      setLastSocketEvent("cleanup complete");
    };
  }, [settings.language, settings.streamModel, settings.thinkingLevel]);

  const findingsSummary = useCallback(() => {
    const byLabel = detections.reduce<Record<string, number>>(
      (acc, detection) => {
        acc[detection.label] = (acc[detection.label] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return Object.entries(byLabel).map(([label, count]) => ({ label, count }));
  }, [detections]);

  const handleGenerateChecklist = useCallback(async () => {
    setChecklistLoading(true);
    try {
      const response = await fetch(`${BACKEND_API_URL}/tool/create-checklist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          aisle: "Aisle 12 (Bay 12A)",
          findings: findingsSummary(),
          settings: {
            language: settings.language,
            detailLevel: settings.detailLevel,
            deepChecks: settings.deepChecks,
            thinkingLevel: settings.thinkingLevel,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Checklist request failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      console.info("Checklist generated", payload);
      onChecklistGenerated?.(payload);
      setActionNotice({
        severity: "success",
        message: "Checklist generated successfully.",
      });
    } catch (error) {
      setActionNotice({
        severity: "error",
        message: (error as Error).message,
      });
    } finally {
      setChecklistLoading(false);
    }
  }, [
    findingsSummary,
    onChecklistGenerated,
    settings.deepChecks,
    settings.detailLevel,
    settings.language,
    settings.thinkingLevel,
  ]);

  const handlePrintTags = useCallback(async () => {
    setPrintLoading(true);
    try {
      const response = await fetch(
        `${BACKEND_API_URL}/tool/create-shelf-tags`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            aisle: "Aisle 12 (Bay 12A)",
            findings: findingsSummary(),
            settings: {
              language: settings.language,
              detailLevel: settings.detailLevel,
              streamModel: settings.streamModel,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Print tags request failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      console.info("Print tags created", payload);
      onPrintTagsGenerated?.(payload);
      setActionNotice({
        severity: "success",
        message: "Tag print payload created successfully.",
      });
    } catch (error) {
      setActionNotice({
        severity: "error",
        message: (error as Error).message,
      });
    } finally {
      setPrintLoading(false);
    }
  }, [
    findingsSummary,
    onPrintTagsGenerated,
    settings.detailLevel,
    settings.language,
    settings.streamModel,
  ]);

  const handleFrame = useCallback(
    async (frame: Blob) => {
      const ws = websocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReadyRef.current) {
        return;
      }

      const data = await blobToBase64(frame);
      ws.send(
        JSON.stringify({
          type: "video-frame",
          mimeType: "image/jpeg",
          data,
        }),
      );

      const now = Date.now();
      if (now - lastOverlayPromptAtRef.current >= OVERLAY_PROMPT_INTERVAL_MS) {
        ws.send(
          JSON.stringify({
            type: "text-command",
            text: toOverlayCommand(settings.language),
          }),
        );
        lastOverlayPromptAtRef.current = now;
      }

      console.debug("JPEG frame", {
        size: frame.size,
        frameRate: settings.frameRate,
        detailLevel: settings.detailLevel,
      });
    },
    [settings.detailLevel, settings.frameRate, settings.language],
  );

  const handleAudioChunk = useCallback(
    (chunk: ArrayBuffer) => {
      const ws = websocketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && sessionReadyRef.current) {
        ws.send(
          JSON.stringify({
            type: "audio-chunk",
            mimeType: "audio/webm;codecs=opus",
            data: arrayBufferToBase64(chunk),
          }),
        );
      }

      console.debug("Audio chunk", {
        bytes: chunk.byteLength,
        language: settings.language,
        pushToTalk: settings.pushToTalk,
      });
    },
    [settings.language, settings.pushToTalk],
  );

  return (
    <Stack spacing={4} sx={{ width: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h4" color="text.primary">
          Shelf Audit
        </Typography>
        {onBack && (
          <Button variant="text" onClick={onBack}>
            Back to Home
          </Button>
        )}
      </Stack>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={4}
        alignItems="flex-start"
      >
        <Stack spacing={3} flex={{ xs: 1, md: 1.5 }}>
          <CameraStream
            onFrame={handleFrame}
            overlay={<OverlayCanvas detections={detections} />}
            frameIntervalMs={frameRateToIntervalMs(settings.frameRate)}
          />
          {SHOW_OVERLAY_DEBUG_PANEL && (
            <Card variant="outlined">
              <CardHeader title="Overlay Debug" subheader="Development only" />
              <CardContent>
                <Stack spacing={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    WS status: {connectionStatus}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ wordBreak: "break-word" }}
                  >
                    WS target:{" "}
                    {buildBridgeUrl(
                      BACKEND_WS_URL,
                      toModelKey(settings.streamModel),
                    )}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ wordBreak: "break-word" }}
                  >
                    Last socket event: {lastSocketEvent}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active detections: {detections.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Last overlay update:{" "}
                    {lastOverlayUpdateTs
                      ? new Date(lastOverlayUpdateTs).toLocaleTimeString()
                      : "no overlay messages yet"}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
        <Stack spacing={3} flex={{ xs: 1, md: 1 }}>
          <VoiceCapture
            onAudioChunk={handleAudioChunk}
            pushToTalk={settings.pushToTalk}
            language={settings.language}
          />
          <Divider />
          <ActionPanel
            onAudit={onAuditShelf}
            onGenerateChecklist={handleGenerateChecklist}
            onPrintTags={handlePrintTags}
            streamModel={settings.streamModel}
            deepChecks={settings.deepChecks}
            thinkingLevel={settings.thinkingLevel}
            connectionStatus={connectionStatus}
            checklistLoading={checklistLoading}
            printLoading={printLoading}
            language={settings.language}
            detailLevel={settings.detailLevel}
          />
        </Stack>
      </Stack>

      <Snackbar
        open={Boolean(actionNotice)}
        autoHideDuration={3000}
        onClose={(_, reason) => {
          if (reason === "clickaway") {
            return;
          }
          setActionNotice(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={actionNotice?.severity ?? "success"} variant="filled">
          {actionNotice?.message ?? "Done"}
        </Alert>
      </Snackbar>
    </Stack>
  );
};

export default AuditScreen;
export { CameraStream, VoiceCapture, OverlayCanvas, ActionPanel };
