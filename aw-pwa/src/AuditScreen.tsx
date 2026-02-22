import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import MicOffRoundedIcon from "@mui/icons-material/MicOffRounded";
import CropFreeRoundedIcon from "@mui/icons-material/CropFreeRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import LocalPrintshopRoundedIcon from "@mui/icons-material/LocalPrintshopRounded";

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

interface CameraStreamProps {
  onFrame?: (frame: Blob) => void;
  overlay?: ReactNode;
}

const CameraStream = ({ onFrame, overlay }: CameraStreamProps) => {
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
    }, 1000);

    return () => window.clearInterval(frameTimer);
  }, [onFrame]);

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
          Frames are sampled every second and streamed to the Gemini Live
          session.
        </Typography>
      </CardContent>
    </Card>
  );
};

interface VoiceCaptureProps {
  onAudioChunk?: (chunk: ArrayBuffer) => void;
}

const VoiceCapture = ({ onAudioChunk }: VoiceCaptureProps) => {
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
        subheader="Push-to-talk voice control"
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
            onMouseDown={startRecorder}
            onMouseUp={stopRecorder}
            onMouseLeave={() => recording && stopRecorder()}
            onTouchStart={startRecorder}
            onTouchEnd={stopRecorder}
          >
            {recording ? "Release to send" : "Hold to talk"}
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
}

const ActionPanel = ({
  onAudit,
  onGenerateChecklist,
  onPrintTags,
}: ActionPanelProps) => {
  return (
    <Card variant="outlined">
      <CardHeader title="Actions" subheader="Tools & exports" />
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
          >
            Generate Checklist
          </Button>
          <Button
            variant="outlined"
            onClick={onPrintTags}
            startIcon={<LocalPrintshopRoundedIcon />}
          >
            Print Tags
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

interface AuditScreenProps {
  onBack?: () => void;
  onAuditShelf: () => void;
}

const AuditScreen = ({ onBack, onAuditShelf }: AuditScreenProps) => {
  const [detections, setDetections] = useState<OverlayDetection[]>(() => [
    {
      id: "gondola-1",
      label: "GAP",
      score: 0.94,
      box: { x: 0.05, y: 0.12, width: 0.25, height: 0.55 },
    },
    {
      id: "label-3",
      label: "Label mismatch",
      score: 0.87,
      box: { x: 0.55, y: 0.3, width: 0.18, height: 0.2 },
    },
  ]);

  const handleFrame = useCallback((frame: Blob) => {
    console.debug("JPEG frame", frame);
  }, []);

  const handleAudioChunk = useCallback((chunk: ArrayBuffer) => {
    console.debug("Audio chunk", chunk.byteLength);
  }, []);

  const cycleMockOverlay = useCallback(() => {
    setDetections((prev) =>
      prev.map((det) => ({
        ...det,
        score: Math.max(
          0.5,
          Math.min(0.99, det.score + (Math.random() - 0.5) * 0.1),
        ),
      })),
    );
  }, []);

  useEffect(() => {
    const timer = window.setInterval(cycleMockOverlay, 4000);
    return () => window.clearInterval(timer);
  }, [cycleMockOverlay]);

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
          />
        </Stack>
        <Stack spacing={3} flex={{ xs: 1, md: 1 }}>
          <VoiceCapture onAudioChunk={handleAudioChunk} />
          <Divider />
          <ActionPanel
            onAudit={onAuditShelf}
            onGenerateChecklist={() => console.info("Checklist requested")}
            onPrintTags={() => console.info("Print requested")}
          />
        </Stack>
      </Stack>
    </Stack>
  );
};

export default AuditScreen;
export { CameraStream, VoiceCapture, OverlayCanvas, ActionPanel };
