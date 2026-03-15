# AisleWhisper Frontend (PWA)

Real-time shelf audit PWA built with React, Vite, TypeScript, and MUI.

## Features

- Camera preview with live overlay boxes.
- Strict issue-focus selector for detection scope:
  - All shelf issues
  - Facing alignment
  - Shelf gaps
  - Restock priority
- Checklist generation and summary view.
- Snapshot capture when generating checklist.

Supported overlay labels:

- `GAP`
- `MISALIGNED`
- `LOW_STOCK`
- `OUT_OF_PLACE`

## Scope Notes

- Voice capture UI is currently disabled in the audit screen.
- Print tags / print-preview flow is not part of this reduced-scope build.

## Requirements

- Node.js 18+
- Backend service running (WebSocket + REST)

Endpoints used by the app:

- WebSocket: `/ws/live`
- REST: `/tool/create-checklist`

## Quick Start

From `aw-pwa/`:

```bash
npm install
npm run dev
```

## Environment Variables

Set in `aw-pwa/.env.local` for local dev:

```bash
VITE_BACKEND_WS_URL=ws://localhost:8080/ws/live
VITE_BACKEND_API_URL=http://localhost:8080
```

For production builds:

```bash
VITE_BACKEND_WS_URL=wss://your-backend-domain/ws/live \
VITE_BACKEND_API_URL=https://your-backend-domain \
npm run build
```

Deploy `aw-pwa/dist` to hosting.
