import { Button, Card, Divider, Stack, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import PlaylistAddCheckRoundedIcon from "@mui/icons-material/PlaylistAddCheckRounded";
import PrintRoundedIcon from "@mui/icons-material/PrintRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";

interface AuditSummaryScreenProps {
  onBackToAudit: () => void;
}

const mockSummary = {
  aisle: "Aisle 12 (Bay 12A)",
  framesReviewed: 14,
  findings: [
    { label: "GAP", count: 3 },
    { label: "LABEL", count: 2 },
    { label: "POG", count: 1 },
  ],
  rows: [
    {
      id: "R1",
      summary: "GAP x2 - LABEL x1 (missing price)",
    },
    {
      id: "R2",
      summary: "POG mismatch (Brand Z vs Y)",
    },
  ],
};

const AuditSummaryScreen = ({ onBackToAudit }: AuditSummaryScreenProps) => {
  return (
    <Stack spacing={4} sx={{ width: "100%", maxWidth: 720, mx: "auto" }}>
      <Button
        variant="text"
        startIcon={<ArrowBackRoundedIcon />}
        onClick={onBackToAudit}
        sx={{ alignSelf: "flex-start" }}
      >
        Back to live audit
      </Button>

      <Card
        variant="outlined"
        sx={{
          px: { xs: 3, sm: 4 },
          py: { xs: 3, sm: 4 },
          borderRadius: 3,
        }}
      >
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h5" color="text.primary">
              Audit summary - {mockSummary.aisle}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleRoundedIcon color="success" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Scan complete ({mockSummary.framesReviewed} frames)
              </Typography>
            </Stack>
            <Typography variant="body1" color="text.primary">
              Findings:{" "}
              {mockSummary.findings
                .map((f) => `${f.label} ${f.count}`)
                .join(" ")}
            </Typography>
          </Stack>

          <Divider flexItem />

          <Stack spacing={1.5}>
            {mockSummary.rows.map((row) => (
              <Stack
                key={row.id}
                direction="row"
                spacing={2}
                alignItems="flex-start"
              >
                <Typography
                  variant="subtitle2"
                  color="text.primary"
                  sx={{ minWidth: 64 }}
                >
                  Row {row.id}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.summary}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Divider flexItem />

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            useFlexGap
            flexWrap="wrap"
            justifyContent="flex-start"
            alignItems="flex-start"
          >
            <Button
              variant="contained"
              startIcon={<PlaylistAddCheckRoundedIcon />}
              onClick={() => console.info("Checklist generation requested")}
            >
              Generate Checklist
            </Button>
            <Button
              variant="outlined"
              startIcon={<PrintRoundedIcon />}
              onClick={() => console.info("Print tags requested")}
            >
              Print Tags
            </Button>
            <Button
              variant="outlined"
              startIcon={<RestartAltRoundedIcon />}
              onClick={onBackToAudit}
            >
              Rescan
            </Button>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
};

export default AuditSummaryScreen;
