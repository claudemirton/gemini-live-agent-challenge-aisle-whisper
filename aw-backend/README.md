# AisleWhisper — Backend (Node/Express)

**Low‑latency relay + tools** for the AisleWhisper PWA.  
Handles **WebSocket streaming** (audio + JPEG frames) to a **Gemini Live** session and exposes a **REST tool** to generate the **restock checklist (JSON)**.

> Frontend repo: `apps/pwa` (in the monorepo)  
> Backend repo: `apps/server` (this folder)

---

## ✨ What this service does

- Maintains a **WebSocket** for real‑time **voice + frame** streaming from the PWA.
- Holds the **model session** (Gemini Live for streaming + Gemini standard for “planning/outputs”).
- Includes explicit **Google GenAI SDK** usage (`@google/genai`) via a diagnostics endpoint.
- Emits **overlay** messages back to the client with boxes/tags (GAP / LABEL / Planogram).
- Provides **tool endpoint**:
  - `/tool/create-checklist` → restock checklist (JSON)
- Exposes `/health`, `/health/genai-sdk`, and structured logs for uptime checks.

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
Checklist JSON ────────────────────► via REST
```

---

## 🔧 Requirements

- Node.js **18+**
- Google GenAI SDK dependency: **`@google/genai`**
- An auth method for Gemini:
  - **Developer API key** (simple) – `GOOGLE_API_KEY`
  - **Vertex AI service account** (recommended for prod) – `GOOGLE_APPLICATION_CREDENTIALS` / ADC

---

## ✅ SDK Compliance Check

To verify explicit Google GenAI SDK integration in runtime:

```bash
curl http://localhost:8080/health/genai-sdk
```

Expected response includes:

- `status: "ok"`
- `sdk: "@google/genai"`
- model output text

---
