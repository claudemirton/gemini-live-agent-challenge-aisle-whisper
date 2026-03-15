import { Box, Button, Card, Divider, Stack, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import type { AuditSummarySnapshot } from "./AuditScreen";

interface AuditSummaryScreenProps {
  onBackToAudit: () => void;
  summarySnapshot?: AuditSummarySnapshot | null;
  checklistResult?: unknown;
  checklistSnapshotImage?: string | null;
}

const fallbackSummary: AuditSummarySnapshot = {
  aisle: "Aisle 12 (Bay 12A)",
  framesReviewed: 14,
  findings: [
    { label: "GAP", count: 3 },
    { label: "LABEL", count: 2 },
    { label: "POG", count: 1 },
  ],
  rows: [
    {
      id: "1",
      summary: "GAP x2 - LABEL x1 (missing price)",
    },
    {
      id: "2",
      summary: "POG mismatch (Brand Z vs Y)",
    },
  ],
};

const AuditSummaryScreen = ({
  onBackToAudit,
  summarySnapshot,
  checklistResult,
  checklistSnapshotImage,
}: AuditSummaryScreenProps) => {
  const summary = summarySnapshot ?? fallbackSummary;
  const checklistPreview = checklistResult
    ? JSON.stringify(checklistResult, null, 2)
    : null;

  return (
    <Stack
      spacing={{ xs: 2.5, sm: 4 }}
      sx={{
        width: "100%",
        maxWidth: { xs: "100%", sm: 720 },
        mx: { xs: 0, sm: "auto" },
      }}
    >
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
          px: { xs: 2, sm: 4 },
          py: { xs: 2.5, sm: 4 },
          borderRadius: 3,
        }}
      >
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h5" color="text.primary">
              Audit summary - {summary.aisle}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleRoundedIcon color="success" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Scan complete ({summary.framesReviewed} frames)
              </Typography>
            </Stack>
            <Typography variant="body1" color="text.primary">
              Findings:{" "}
              {summary.findings.length > 0
                ? summary.findings.map((f) => `${f.label} ${f.count}`).join(" ")
                : "No findings yet"}
            </Typography>
          </Stack>

          <Divider flexItem />

          <Stack spacing={1.5}>
            {summary.rows.map((row) => (
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
                  Row R{row.id}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.summary}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Divider flexItem />

          <Stack spacing={2}>
            <Typography variant="h6" color="text.primary">
              Generated Artifacts
            </Typography>

            <Card variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2" color="text.primary">
                  Checklist snapshot
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Captured locally when Generate Checklist was clicked.
                </Typography>
                {checklistSnapshotImage ? (
                  <Box
                    component="img"
                    src={checklistSnapshotImage}
                    alt="Checklist snapshot"
                    sx={{
                      width: "100%",
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No checklist snapshot captured yet.
                  </Typography>
                )}
              </Stack>
            </Card>

            <Card variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2" color="text.primary">
                  Checklist response
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Source: POST /tool/create-checklist
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: "grey.100",
                    overflowX: "auto",
                    fontSize: "0.75rem",
                    lineHeight: 1.4,
                  }}
                >
                  {checklistPreview ?? "No checklist generated yet."}
                </Box>
              </Stack>
            </Card>
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
