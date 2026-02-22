import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";

interface SettingsScreenProps {
  onClose: () => void;
}

const SettingsScreen = ({ onClose }: SettingsScreenProps) => {
  const [pushToTalk, setPushToTalk] = useState(true);
  const [language, setLanguage] = useState("en");
  const [frameRate, setFrameRate] = useState("auto");
  const [detailLevel, setDetailLevel] = useState("auto");
  const [streamModel, setStreamModel] = useState("flash");
  const [deepChecks, setDeepChecks] = useState("pro");
  const [thinkingLevel, setThinkingLevel] = useState("low");

  return (
    <Stack spacing={4} sx={{ width: "100%", pt: "10px", pb: { xs: 4, md: 6 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack spacing={0.5}>
          <Typography variant="h4" color="text.primary">
            Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tailor voice capture, vision, and cost preferences for the audit
            session.
          </Typography>
        </Stack>
        <Button
          variant="text"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={onClose}
        >
          Close
        </Button>
      </Stack>

      <Card variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 3 }}>
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <VolumeUpRoundedIcon color="primary" />
              <Typography variant="h6" color="text.primary">
                Voice
              </Typography>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={pushToTalk}
                  onChange={(_, checked) => setPushToTalk(checked)}
                  color="primary"
                />
              }
              label="Push-to-talk"
            />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Language
              </Typography>
              <ToggleButtonGroup
                value={language}
                exclusive
                onChange={(_, value) => {
                  if (value) {
                    setLanguage(value);
                  }
                }}
                size="small"
                sx={{ mt: 0.5 }}
              >
                <ToggleButton value="en">EN</ToggleButton>
                <ToggleButton value="pt-br">PT-BR</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>

          <Divider flexItem />

          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <VideocamRoundedIcon color="primary" />
              <Typography variant="h6" color="text.primary">
                Camera and vision
              </Typography>
            </Stack>
            <FormControl size="small" sx={{ maxWidth: 240 }}>
              <InputLabel id="frame-rate-label">Frame rate</InputLabel>
              <Select
                labelId="frame-rate-label"
                value={frameRate}
                label="Frame rate"
                onChange={(event) => setFrameRate(event.target.value)}
              >
                <MenuItem value="auto">Auto (1 FPS)</MenuItem>
                <MenuItem value="2fps">2 FPS</MenuItem>
                <MenuItem value="5fps">5 FPS</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ maxWidth: 240 }}>
              <InputLabel id="detail-level-label">Detail mode</InputLabel>
              <Select
                labelId="detail-level-label"
                value={detailLevel}
                label="Detail mode"
                onChange={(event) => setDetailLevel(event.target.value)}
              >
                <MenuItem value="auto">Auto</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Divider flexItem />

          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <SpeedRoundedIcon color="primary" />
              <Typography variant="h6" color="text.primary">
                Cost and latency
              </Typography>
            </Stack>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
              <InputLabel id="stream-model-label">Stream model</InputLabel>
              <Select
                labelId="stream-model-label"
                value={streamModel}
                label="Stream model"
                onChange={(event) => setStreamModel(event.target.value)}
              >
                <MenuItem value="flash">Gemini 3 Flash</MenuItem>
                <MenuItem value="pro">Gemini 3 Pro</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
              <InputLabel id="deep-checks-label">Deep checks</InputLabel>
              <Select
                labelId="deep-checks-label"
                value={deepChecks}
                label="Deep checks"
                onChange={(event) => setDeepChecks(event.target.value)}
              >
                <MenuItem value="pro">Escalate to 3 Pro</MenuItem>
                <MenuItem value="flash">Stay on Flash</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Thinking level
              </Typography>
              <ToggleButtonGroup
                value={thinkingLevel}
                exclusive
                onChange={(_, value) => {
                  if (value) {
                    setThinkingLevel(value);
                  }
                }}
                size="small"
                sx={{ mt: 0.5 }}
              >
                <ToggleButton value="minimal">Minimal</ToggleButton>
                <ToggleButton value="low">Low</ToggleButton>
                <ToggleButton value="medium">Medium</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>

          <Divider flexItem />

          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <InfoRoundedIcon color="primary" />
              <Typography variant="h6" color="text.primary">
                About
              </Typography>
            </Stack>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              useFlexGap
              flexWrap="wrap"
              alignItems="flex-start"
            >
              <Typography variant="body2" color="text.secondary">
                Version: 1.0.0
              </Typography>
              <Typography variant="body2" color="text.secondary">
                License: MIT
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
};

export default SettingsScreen;
