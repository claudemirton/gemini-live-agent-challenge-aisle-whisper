# AisleWhisper — Frontend (PWA)

**Real‑time store shelf audit (camera + voice) with overlays, checklist, and print preview.**  
Built with **React + Vite + TypeScript + MUI**.

---

## ✨ Features
- **Live Audit**: camera preview + **wireframe overlays** (GAP / LABEL / Planogram).
- **Voice (optional)**: push‑to‑talk commands; all actions mirrored by buttons.
- **Planogram**: run planogram‑free (heuristics) or upload a simple JSON/CSV.
- **Checklist**: editable restock list with export to JSON.
- **Print Preview**: A4/Letter, portrait/landscape, margins, gutter, tag size, cut marks.

---

## 🧱 Tech stack
- React 18 • Vite • TypeScript  
- MUI v5 (light/dark theme, domain chips)  
- Web APIs: `getUserMedia`, WebSocket, Web Share/Print

---

## ⚙️ Requirements
- Node.js **18+**
- A running **backend** (WebSocket + REST tools). The app uses:
  - **WS**: `ws://<SERVER>/ws` (audio + JPEG frames)
  - **REST**: `/tool/create-checklist`, `/tool/create-shelf-tags` (PDF)

---

## 🚀 Quick start

```bash
# from apps/pwa/
npm install
npm run dev
# open the printed URL (e.g., http://localhost:5173)
``