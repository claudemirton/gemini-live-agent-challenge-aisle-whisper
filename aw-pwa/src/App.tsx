import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import PWABadge from "./PWABadge";
import AuditScreen from "./AuditScreen";
import AuditSummaryScreen from "./AuditSummaryScreen";
import SettingsScreen from "./SettingsScreen.tsx";
import "./App.css";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0E6FFF",
    },
    secondary: {
      main: "#FF7A45",
    },
    background: {
      default: "#f5f7fb",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    subtitle1: {
      fontWeight: 500,
      letterSpacing: "0.01em",
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 999,
          paddingInline: 28,
        },
      },
    },
  },
});

interface HomeScreenProps {
  onStartAudit: () => void;
  onOpenSettings: () => void;
}

const HomeScreen = ({ onStartAudit, onOpenSettings }: HomeScreenProps) => {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        px: { xs: 3, md: 6 },
        py: { xs: 6, md: 10 },
      }}
    >
      <Container
        maxWidth="sm"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          textAlign: "center",
          px: { xs: 0, sm: 2 },
        }}
      >
        <Box
          component="img"
          src="/icons/aisle-whisper-icon-192x192.png"
          alt="Aisle Whisper icon"
          sx={{ width: 96, height: 96, borderRadius: 3 }}
        />

        <Box>
          <Typography
            variant="h3"
            color="text.primary"
            gutterBottom
            align="center"
          >
            Aisle Whisper PWA
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" align="center">
            Real-time store shelf audit &amp; replenishment agent
          </Typography>
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          justifyContent="center"
          alignItems="center"
        >
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<PlayArrowRoundedIcon />}
            onClick={onStartAudit}
          >
            Start Audit
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            size="large"
            startIcon={<SettingsRoundedIcon />}
            onClick={onOpenSettings}
          >
            Settings
          </Button>
        </Stack>

        <Stack spacing={1} alignItems="center">
          <Chip
            label="v1.0"
            color="primary"
            size="small"
            sx={{ fontWeight: 600 }}
          />
          <Typography variant="body2" color="text.secondary" align="center">
            PWA • Works offline • Gemini-powered overlays
          </Typography>
          <PWABadge />
        </Stack>
      </Container>
    </Box>
  );
};

function App() {
  const [view, setView] = useState<"home" | "audit" | "summary" | "settings">(
    "home",
  );

  const handleStartAudit = () => {
    setView("audit");
  };

  const handleAuditShelf = () => {
    setView("summary");
  };

  const handleOpenSettings = () => {
    setView("settings");
  };

  const handleBackToAudit = () => {
    setView("audit");
  };

  const handleCloseSettings = () => {
    setView("home");
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {view === "home" ? (
        <HomeScreen
          onStartAudit={handleStartAudit}
          onOpenSettings={handleOpenSettings}
        />
      ) : view === "audit" ? (
        <Box
          sx={{
            minHeight: "100vh",
            bgcolor: "background.default",
            px: { xs: 3, md: 6 },
            pt: "10px",
            pb: { xs: 4, md: 6 },
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Container maxWidth="lg">
            <AuditScreen
              onBack={() => setView("home")}
              onAuditShelf={handleAuditShelf}
            />
          </Container>
        </Box>
      ) : view === "summary" ? (
        <Box
          sx={{
            minHeight: "100vh",
            bgcolor: "background.default",
            px: { xs: 3, md: 6 },
            pt: "10px",
            pb: { xs: 4, md: 6 },
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Container maxWidth="lg">
            <AuditSummaryScreen onBackToAudit={handleBackToAudit} />
          </Container>
        </Box>
      ) : (
        <Box
          sx={{
            minHeight: "100vh",
            bgcolor: "background.default",
            px: { xs: 3, md: 6 },
            pt: "10px",
            pb: { xs: 4, md: 6 },
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Container maxWidth="md">
            <SettingsScreen onClose={handleCloseSettings} />
          </Container>
        </Box>
      )}
    </ThemeProvider>
  );
}

export default App;
