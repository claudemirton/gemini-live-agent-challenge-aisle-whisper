# AisleWhisper — Backend (Node/Express)

**Low‑latency relay + tools** for the AisleWhisper PWA.  
Handles **WebSocket streaming** (audio + JPEG frames) to a **Gemini Live** session and exposes **REST tools** to generate the **restock checklist (JSON)** and **shelf/price tags (PDF/print)**.

> Frontend repo: `apps/pwa` (in the monorepo)  
> Backend repo: `apps/server` (this folder)

---

## ✨ What this service does

- Maintains a **WebSocket** for real‑time **voice + frame** streaming from the PWA.
- Holds the **model session** (Gemini Live for streaming + Gemini standard for “planning/outputs”).
- Emits **overlay** messages back to the client with boxes/tags (GAP / LABEL / Planogram).
- Provides **tool endpoints**:
  - `/tool/create-checklist` → restock checklist (JSON)
  - `/tool/create-shelf-tags` → tag sheet (PDF) for printing
- Exposes `/healthz` and structured logs for uptime checks.

---

## 🗺️ High‑level flow

```
PWA (mic + camera)
  │   WebSocket: audio chunks + JPEG frames (~1 FPS)
  ▼
Node/Express (this service)
  │   forwards to Gemini Live + invokes tools
  ▼
Overlay JSON + audio_out  ─────────► back to PWA
Checklist JSON / PDF ──────────────► via REST
```

---

## 🔧 Requirements

- Node.js **18+**
- An auth method for Gemini:
  - **Developer API key** (simple) – `GOOGLE_API_KEY`
  - **Vertex AI service account** (recommended for prod) – `GOOGLE_APPLICATION_CREDENTIALS` / ADC

---
