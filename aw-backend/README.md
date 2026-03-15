# AisleWhisper Backend (Node/Express)

Realtime relay and checklist tooling for the AisleWhisper PWA.

## What This Service Does

- Accepts websocket traffic from the PWA on `/ws/live`.
- Streams frame/audio inputs to Gemini Live session handling.
- Runs strict frame-based overlay detection through Google GenAI SDK sidecar calls.
- Enforces focus filtering for overlay labels.
- Exposes checklist generation endpoint:
  - `/tool/create-checklist`
- Exposes health endpoints:
  - `/health`
  - `/health/genai-sdk`

## Current Detection Scope

Supported labels:

- `GAP`
- `MISALIGNED`
- `LOW_STOCK`
- `OUT_OF_PLACE`

Focus keys accepted in `text-command` flow:

- `all`
- `alignment`
- `gaps`
- `restock`

The backend normalizes invalid/missing focus to `all` and filters returned detections accordingly.

## Scope Notes

- Voice command UX is currently bypassed in frontend UI.
- Print tags endpoint flow is removed from current reduced scope.

## Requirements

- Node.js 18+
- `@google/genai`
- `GOOGLE_API_KEY` configured (or equivalent Gemini auth setup)

## SDK Compliance Check

```bash
curl http://localhost:8080/health/genai-sdk
```

Expected response includes:

- `status: "ok"`
- `sdk: "@google/genai"`
- selected model and sample output
