import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import MicOffRoundedIcon from "@mui/icons-material/MicOffRounded";
import CropFreeRoundedIcon from "@mui/icons-material/CropFreeRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
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

type IssueFocusKey = "all" | "alignment" | "gaps" | "restock";

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
    'When analyzing camera frames, detect only shelf issues: GAP, MISALIGNED, LOW_STOCK, and OUT_OF_PLACE. Include a strict JSON object with this exact shape: {"detections":[{"id":"string","label":"GAP|MISALIGNED|LOW_STOCK|OUT_OF_PLACE","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Use normalized 0..1 coordinates and return valid JSON only when shelf issues are present. Do not return product names or generic objects.';
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

function toIssueFocusLabel(language: string, focus: IssueFocusKey): string {
  const isPortuguese = language.toLowerCase() === "pt-br";
  const labels: Record<IssueFocusKey, string> = isPortuguese
    ? {
        all: "Todos os problemas",
        alignment: "Alinhamento",
        gaps: "Espacos vazios",
        restock: "Reposicao",
      }
    : {
        all: "All shelf issues",
        alignment: "Facing alignment",
        gaps: "Shelf gaps",
        restock: "Restock priority",
      };

  return labels[focus];
}

function toAllowedLabelsForFocus(focus: IssueFocusKey): string {
  if (focus === "alignment") {
    return "MISALIGNED";
  }
  if (focus === "gaps") {
    return "GAP";
  }
  if (focus === "restock") {
    return "GAP|LOW_STOCK";
  }
  return "GAP|MISALIGNED|LOW_STOCK|OUT_OF_PLACE";
}

function toOverlayCommand(language: string, focus: IssueFocusKey): string {
  const allowedLabels = toAllowedLabelsForFocus(focus);
  const focusLabel = toIssueFocusLabel(language, focus);

  if (language.toLowerCase() === "pt-br") {
    return `Foco de deteccao: ${focusLabel}. Analise o quadro mais recente e responda SOMENTE com JSON valido no formato exato: {"detections":[{"id":"string","label":"${allowedLabels}","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Regras estritas: 1) use apenas os labels permitidos, 2) coordenadas normalizadas entre 0 e 1, 3) sem markdown e sem texto extra, 4) se nao houver ocorrencias validas, retorne {"detections":[]}.`;
  }
  return `Detection focus: ${focusLabel}. Analyze the latest frame and reply ONLY with valid JSON in this exact shape: {"detections":[{"id":"string","label":"${allowedLabels}","score":0.0,"box":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}. Strict rules: 1) use only allowed labels, 2) normalized 0..1 coordinates, 3) no markdown and no extra text, 4) if no valid matches exist, return {"detections":[]}.`;
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

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not decode checklist frame."));
    image.src = dataUrl;
  });
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
  focus?: unknown;
  source?: unknown;
}

function normalizeIssueFocus(value: unknown): IssueFocusKey {
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
  controls?: ReactNode;
  frameIntervalMs?: number;
}

const CameraStream = ({
  onFrame,
  overlay,
  controls,
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
        {controls}
      </CardContent>
    </Card>
  );
};

interface VoiceCaptureProps {
  onAudioChunk?: (chunk: ArrayBuffer, mimeType: string) => void;
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
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const floatToPcm16 = (input: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);

    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      const encoded = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(index * 2, encoded, true);
    }

    return buffer;
  };

  const stopRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;

    if (recorder) {
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }

    setRecording(false);
  }, []);

  const startRecorder = useCallback(async () => {
    if (
      mediaRecorderRef.current ||
      (audioContextRef.current && processorRef.current)
    ) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (event) => {
          const channelData = event.inputBuffer.getChannelData(0);
          if (!channelData || channelData.length === 0) {
            return;
          }

          const pcmBuffer = floatToPcm16(channelData);
          onAudioChunk?.(
            pcmBuffer,
            `audio/pcm;rate=${audioContext.sampleRate}`,
          );
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        mediaSourceRef.current = source;
        processorRef.current = processor;
      } else {
        const supportedMimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
        ];
        const selectedMimeType = supportedMimeCandidates.find((mimeType) =>
          typeof MediaRecorder.isTypeSupported === "function"
            ? MediaRecorder.isTypeSupported(mimeType)
            : false,
        );

        const recorder = selectedMimeType
          ? new MediaRecorder(stream, {
              mimeType: selectedMimeType,
              audioBitsPerSecond: 48000,
            })
          : new MediaRecorder(stream);

        recorder.addEventListener("dataavailable", async (event) => {
          if (!event.data.size) return;
          const arrayBuffer = await event.data.arrayBuffer();
          onAudioChunk?.(
            arrayBuffer,
            event.data.type || recorder.mimeType || "audio/webm",
          );
        });

        recorder.start(500);
        mediaRecorderRef.current = recorder;
      }

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

  useEffect(() => {
    if (!pushToTalk || !recording) {
      return;
    }

    const forceStop = () => {
      stopRecorder();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopRecorder();
      }
    };

    window.addEventListener("pointerup", forceStop);
    window.addEventListener("pointercancel", forceStop);
    window.addEventListener("blur", forceStop);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointerup", forceStop);
      window.removeEventListener("pointercancel", forceStop);
      window.removeEventListener("blur", forceStop);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pushToTalk, recording, stopRecorder]);

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
            onPointerDown={pushToTalk ? startRecorder : undefined}
            onPointerUp={pushToTalk ? stopRecorder : undefined}
            onPointerCancel={pushToTalk ? stopRecorder : undefined}
            onPointerLeave={
              pushToTalk ? () => recording && stopRecorder() : undefined
            }
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

function getOverlayStyleByLabel(label: string): {
  stroke: string;
  fill: string;
} {
  const normalized = label.toUpperCase();

  if (normalized.includes("GAP")) {
    return {
      stroke: "rgba(211, 47, 47, 0.95)",
      fill: "rgba(211, 47, 47, 0.9)",
    };
  }

  if (normalized.includes("MISALIGNED")) {
    return {
      stroke: "rgba(245, 124, 0, 0.95)",
      fill: "rgba(245, 124, 0, 0.9)",
    };
  }

  if (normalized.includes("LOW_STOCK")) {
    return {
      stroke: "rgba(2, 136, 209, 0.95)",
      fill: "rgba(2, 136, 209, 0.9)",
    };
  }

  if (normalized.includes("OUT_OF_PLACE")) {
    return {
      stroke: "rgba(123, 31, 162, 0.95)",
      fill: "rgba(123, 31, 162, 0.9)",
    };
  }

  return {
    stroke: "rgba(14, 111, 255, 0.9)",
    fill: "rgba(14, 111, 255, 0.85)",
  };
}

async function buildChecklistSnapshotDataUrl(input: {
  frameDataUrl: string;
  detections: OverlayDetection[];
}): Promise<string> {
  const image = await loadImageFromDataUrl(input.frameDataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = width;
  fullCanvas.height = height;
  const fullContext = fullCanvas.getContext("2d");
  if (!fullContext) {
    return input.frameDataUrl;
  }

  fullContext.drawImage(image, 0, 0, width, height);

  input.detections.forEach((det) => {
    const boxX = det.box.x * width;
    const boxY = det.box.y * height;
    const boxW = det.box.width * width;
    const boxH = det.box.height * height;
    const style = getOverlayStyleByLabel(det.label);

    fullContext.strokeStyle = style.stroke;
    fullContext.lineWidth = Math.max(2, Math.round(width * 0.004));
    fullContext.strokeRect(boxX, boxY, boxW, boxH);

    fullContext.font = `${Math.max(14, Math.round(width * 0.028))}px Inter, sans-serif`;
    fullContext.fillStyle = style.fill;
    const label = `${det.label} ${(det.score * 100).toFixed(0)}%`;
    const metrics = fullContext.measureText(label);
    const textPadding = 8;
    const textHeight = Math.max(22, Math.round(width * 0.045));
    const labelY = Math.max(boxY - textHeight, 0);

    fullContext.fillRect(
      boxX,
      labelY,
      Math.min(metrics.width + textPadding * 2, width - boxX),
      textHeight,
    );

    fullContext.fillStyle = "#fff";
    fullContext.fillText(label, boxX + textPadding, labelY + textHeight - 6);
  });

  if (!input.detections.length) {
    return fullCanvas.toDataURL("image/jpeg", 0.88);
  }

  const minX = Math.min(...input.detections.map((det) => det.box.x));
  const minY = Math.min(...input.detections.map((det) => det.box.y));
  const maxX = Math.max(
    ...input.detections.map((det) => det.box.x + det.box.width),
  );
  const maxY = Math.max(
    ...input.detections.map((det) => det.box.y + det.box.height),
  );

  const padX = 0.08;
  const padY = 0.1;
  const cropXNorm = clamp01(minX - padX);
  const cropYNorm = clamp01(minY - padY);
  const cropMaxXNorm = clamp01(maxX + padX);
  const cropMaxYNorm = clamp01(maxY + padY);

  const cropX = Math.floor(cropXNorm * width);
  const cropY = Math.floor(cropYNorm * height);
  const cropW = Math.max(1, Math.floor((cropMaxXNorm - cropXNorm) * width));
  const cropH = Math.max(1, Math.floor((cropMaxYNorm - cropYNorm) * height));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropContext = cropCanvas.getContext("2d");
  if (!cropContext) {
    return fullCanvas.toDataURL("image/jpeg", 0.88);
  }

  cropContext.drawImage(
    fullCanvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH,
  );
  return cropCanvas.toDataURL("image/jpeg", 0.9);
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

      const style = getOverlayStyleByLabel(det.label);

      context.strokeStyle = style.stroke;
      context.lineWidth = 3;
      context.strokeRect(boxX, boxY, boxW, boxH);

      context.font = "14px Inter, sans-serif";
      context.fillStyle = style.fill;
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
  streamModel: string;
  deepChecks: string;
  thinkingLevel: string;
  connectionStatus: ConnectionStatus;
  checklistLoading: boolean;
  language: string;
  detailLevel: string;
}

export interface AuditSummarySnapshot {
  aisle: string;
  framesReviewed: number;
  findings: Array<{ label: string; count: number }>;
  rows: Array<{ id: string; summary: string }>;
}

const ActionPanel = ({
  onAudit,
  onGenerateChecklist,
  streamModel,
  deepChecks,
  thinkingLevel,
  connectionStatus,
  checklistLoading,
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
            variant="outlined"
            onClick={onGenerateChecklist}
            startIcon={<ChecklistRoundedIcon />}
            disabled={checklistLoading}
          >
            {checklistLoading ? "Generating…" : "Generate Checklist"}
          </Button>
          <Button
            variant="contained"
            onClick={onAudit}
            startIcon={<CropFreeRoundedIcon />}
          >
            Audit Shelf
          </Button>
          <Typography variant="caption" color="text.secondary">
            Recommended flow: tap Generate Checklist first to freeze the current
            capture, then tap Audit Shelf to view the result summary.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Checklist consumes: language ({language.toUpperCase()}), detail mode
            ({detailLevel.toUpperCase()}), deep checks (
            {deepChecks.toUpperCase()}) and thinking level (
            {thinkingLevel.toUpperCase()}).
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

interface AuditScreenProps {
  onBack?: () => void;
  onAuditShelf: (snapshot: AuditSummarySnapshot) => void;
  onChecklistGenerated?: (payload: unknown) => void;
  onChecklistSnapshotCaptured?: (imageDataUrl: string) => void;
}

const AuditScreen = ({
  onBack,
  onAuditShelf,
  onChecklistGenerated,
  onChecklistSnapshotCaptured,
}: AuditScreenProps) => {
  const [settings] = useState<AppSettings>(() => loadSettingsFromStorage());
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    severity: "success" | "error";
    message: string;
  } | null>(null);
  const [detections, setDetections] = useState<OverlayDetection[]>([]);
  const [lastOverlayUpdateTs, setLastOverlayUpdateTs] = useState<number | null>(
    null,
  );
  const [lastSocketEvent, setLastSocketEvent] = useState("waiting for WS");
  const [framesStreamed, setFramesStreamed] = useState(0);
  const [overlayPromptsSent, setOverlayPromptsSent] = useState(0);
  const [lastFrameSentAt, setLastFrameSentAt] = useState<number | null>(null);
  const [lastFrameError, setLastFrameError] = useState<string | null>(null);
  const [issueFocus, setIssueFocus] = useState<IssueFocusKey>("all");

  const websocketRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const lastOverlayPromptAtRef = useRef(0);
  const reviewedFramesRef = useRef(0);
  const latestChecklistFrameRef = useRef<string | null>(null);
  const issueFocusRef = useRef<IssueFocusKey>("all");

  useEffect(() => {
    issueFocusRef.current = issueFocus;
    setDetections([]);
    setLastOverlayUpdateTs(null);
    lastOverlayPromptAtRef.current = 0;
    setLastSocketEvent(
      `focus changed: ${toIssueFocusLabel(settings.language, issueFocus)}`,
    );
  }, [issueFocus, settings.language]);

  useEffect(() => {
    const modelKey = toModelKey(settings.streamModel);
    const wsUrl = buildBridgeUrl(BACKEND_WS_URL, modelKey);
    const websocket = new WebSocket(wsUrl);
    websocketRef.current = websocket;
    sessionReadyRef.current = false;
    lastOverlayPromptAtRef.current = 0;
    reviewedFramesRef.current = 0;
    latestChecklistFrameRef.current = null;
    setConnectionStatus("connecting");
    setDetections([]);
    setLastOverlayUpdateTs(null);
    setLastSocketEvent(`connecting to ${wsUrl}`);
    setFramesStreamed(0);
    setOverlayPromptsSent(0);
    setLastFrameSentAt(null);
    setLastFrameError(null);

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
          message?: unknown;
        };

        if (payload.type === "overlay-update") {
          const messageFocus = normalizeIssueFocus(
            (payload as OverlayUpdateMessage).focus,
          );
          if (messageFocus !== issueFocusRef.current) {
            return;
          }

          const parsedDetections = normalizeOverlayDetections(
            (payload as OverlayUpdateMessage).detections,
          );
          if (parsedDetections) {
            setDetections(parsedDetections);
            setLastOverlayUpdateTs(Date.now());
            setLastSocketEvent(
              `overlay-update received (${parsedDetections.length} detections, ${messageFocus})`,
            );
          } else {
            setDetections([]);
            setLastOverlayUpdateTs(Date.now());
            setLastSocketEvent(
              `overlay-update received (0 detections, ${messageFocus})`,
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

        if (payload.type === "audio-ignored") {
          const message =
            typeof payload.message === "string"
              ? payload.message
              : "audio chunk ignored by backend";
          setLastSocketEvent(`voice ignored: ${message}`);
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
      latestChecklistFrameRef.current = null;
      setFramesStreamed(0);
      setOverlayPromptsSent(0);
      setLastFrameSentAt(null);
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
      latestChecklistFrameRef.current = null;
      setFramesStreamed(0);
      setOverlayPromptsSent(0);
      setLastFrameSentAt(null);
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

  const handleAuditShelfClick = useCallback(() => {
    const findings = findingsSummary();
    const summaryRows =
      findings.length > 0
        ? findings.slice(0, 2).map((entry, index) => ({
            id: `${index + 1}`,
            summary: `${entry.label} x${entry.count}`,
          }))
        : [
            {
              id: "1",
              summary: "No structured findings returned yet.",
            },
          ];

    onAuditShelf({
      aisle: "Aisle 12 (Bay 12A)",
      framesReviewed: reviewedFramesRef.current,
      findings,
      rows: summaryRows,
    });
  }, [findingsSummary, onAuditShelf]);

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
      if (latestChecklistFrameRef.current) {
        const snapshotDataUrl = await buildChecklistSnapshotDataUrl({
          frameDataUrl: latestChecklistFrameRef.current,
          detections,
        });
        onChecklistSnapshotCaptured?.(snapshotDataUrl);
      }
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
    detections,
    onChecklistGenerated,
    onChecklistSnapshotCaptured,
    settings.deepChecks,
    settings.detailLevel,
    settings.language,
    settings.thinkingLevel,
  ]);

  const handleFrame = useCallback(
    async (frame: Blob) => {
      const ws = websocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReadyRef.current) {
        return;
      }

      try {
        const data = await blobToBase64(frame);
        latestChecklistFrameRef.current = `data:image/jpeg;base64,${data}`;
        ws.send(
          JSON.stringify({
            type: "video-frame",
            mimeType: "image/jpeg",
            data,
          }),
        );

        reviewedFramesRef.current += 1;
        setFramesStreamed(reviewedFramesRef.current);
        setLastFrameSentAt(Date.now());
        setLastFrameError(null);

        const now = Date.now();
        if (
          now - lastOverlayPromptAtRef.current >=
          OVERLAY_PROMPT_INTERVAL_MS
        ) {
          ws.send(
            JSON.stringify({
              type: "text-command",
              focus: issueFocus,
              text: toOverlayCommand(settings.language, issueFocus),
            }),
          );
          lastOverlayPromptAtRef.current = now;
          setOverlayPromptsSent((current) => current + 1);
        }

        console.debug("JPEG frame", {
          size: frame.size,
          frameRate: settings.frameRate,
          detailLevel: settings.detailLevel,
        });
      } catch (error) {
        const message = (error as Error).message;
        setLastFrameError(message);
        setLastSocketEvent(`frame send error: ${message}`);
      }
    },
    [issueFocus, settings.detailLevel, settings.frameRate, settings.language],
  );

  // Voice capture is temporarily bypassed in the UI.
  // Keep this callback ready for quick re-enable in a future iteration.
  // const handleAudioChunk = useCallback(
  //   (chunk: ArrayBuffer, mimeType: string) => {
  //     const ws = websocketRef.current;
  //     if (ws && ws.readyState === WebSocket.OPEN && sessionReadyRef.current) {
  //       ws.send(
  //         JSON.stringify({
  //           type: "audio-chunk",
  //           mimeType,
  //           data: arrayBufferToBase64(chunk),
  //         }),
  //       );
  //     }

  //     console.debug("Audio chunk", {
  //       bytes: chunk.byteLength,
  //       mimeType,
  //       language: settings.language,
  //       pushToTalk: settings.pushToTalk,
  //     });
  //   },
  //   [settings.language, settings.pushToTalk],
  // );

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
            controls={
              <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Detection focus
                  </Typography>
                  <FormControl
                    size="small"
                    sx={{ minWidth: 168, maxWidth: 220 }}
                  >
                    <Select
                      value={issueFocus}
                      onChange={(event) =>
                        setIssueFocus(event.target.value as IssueFocusKey)
                      }
                      inputProps={{ "aria-label": "Detection focus" }}
                    >
                      <MenuItem value="all">
                        {toIssueFocusLabel(settings.language, "all")}
                      </MenuItem>
                      <MenuItem value="alignment">
                        {toIssueFocusLabel(settings.language, "alignment")}
                      </MenuItem>
                      <MenuItem value="gaps">
                        {toIssueFocusLabel(settings.language, "gaps")}
                      </MenuItem>
                      <MenuItem value="restock">
                        {toIssueFocusLabel(settings.language, "restock")}
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {issueFocus === "all"
                    ? "Shows all supported shelf issue overlays."
                    : `Shows only ${toIssueFocusLabel(settings.language, issueFocus).toLowerCase()} overlays; other labels are filtered out.`}
                </Typography>
              </Stack>
            }
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
                    Frames streamed: {framesStreamed}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Overlay prompts sent: {overlayPromptsSent}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Focus filter:{" "}
                    {toIssueFocusLabel(settings.language, issueFocus)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Last frame sent:{" "}
                    {lastFrameSentAt
                      ? new Date(lastFrameSentAt).toLocaleTimeString()
                      : "none yet"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Last frame error: {lastFrameError ?? "none"}
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
          {/*
          <VoiceCapture
            onAudioChunk={handleAudioChunk}
            pushToTalk={settings.pushToTalk}
            language={settings.language}
          />
          <Divider />
          */}
          <ActionPanel
            onAudit={handleAuditShelfClick}
            onGenerateChecklist={handleGenerateChecklist}
            streamModel={settings.streamModel}
            deepChecks={settings.deepChecks}
            thinkingLevel={settings.thinkingLevel}
            connectionStatus={connectionStatus}
            checklistLoading={checklistLoading}
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
