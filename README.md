# Aisle Whisper

Real-time shelf audit MVP with camera overlays and checklist generation.

This monorepo contains:

- `aw-pwa/` (frontend PWA, React + Vite + TypeScript)
- `aw-backend/` (backend relay/tools, Node + Express + WebSocket)

## Current Scope (Reduced)

- Detect shelf issues from camera frames with overlay boxes.
- Supported issue labels: `GAP`, `MISALIGNED`, `LOW_STOCK`, `OUT_OF_PLACE`.
- Generate a structured checklist (`/tool/create-checklist`) from observed findings.
- Use a mobile-friendly focus selector to constrain overlay detection:
  - All shelf issues
  - Facing alignment
  - Shelf gaps
  - Restock priority

## Out of Scope (Current Build)

- Voice-command workflow in the UI is temporarily bypassed.
- Printable shelf tags / print-preview tool flow is removed.

## Notes

- Overlay detection is enforced with strict backend focus filtering to reduce label drift.
- Frontend and backend are deployed independently (Firebase Hosting + Cloud Run).
