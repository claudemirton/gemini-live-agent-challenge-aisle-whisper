
# 🛒 Aisle Whisper
**Real‑time store shelf audit & replenishment agent — camera + voice + planogram**

> Monorepo for the **entire project** (frontend PWA + backend relay/tools).  
> Built to demo a practical, agentic workflow: *see the shelf, speak the command, get overlays, a restock checklist, and printable tags*.

---

- Detects **GAPs** (empty facings), **LABEL** issues (missing/mismatched/crooked), and **PLANOGRAM** mismatches.
- Shows **wireframe overlays** in real time (bounding boxes + tags).
- Generates a **structured restock checklist (JSON)** and **printable tags (PDF/print preview)**.
- Works **planogram‑free** (heuristics) or with a **planogram JSON** for precise checks.

---

**Key points**

- The frontend streams **audio** and **JPEG frames** (~1 FPS) to the backend over **WebSocket**.  
- The backend holds the **Live session** (voice/video) and calls tools for **Checklist** and **Tag PDF/Print**.  
- **Planogram** (if provided) improves precision; otherwise we run heuristic checks.