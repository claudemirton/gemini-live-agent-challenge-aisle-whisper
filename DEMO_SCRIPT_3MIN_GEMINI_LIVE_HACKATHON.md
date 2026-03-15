# Aisle Whisper - Up to 4 Minute Demo Script (Gemini Live Hackathon)

## Goal

Deliver a clear 4-minute-max video that shows:

- Real user problem
- Gemini-powered live analysis value
- Working end-to-end product (PWA + backend + checklist result)
- Why this is useful in real retail operations

Rule alignment:

- The hackathon rules allow demo videos up to 4 minutes.
- Keep the final cut between 3:40 and 3:55 for safe buffer.

---

## Recording Setup (MacBook Air M4 + iPhone 13)

## Devices and apps

- MacBook Air M4:
  - Chrome or Safari (for backend health page, optional dashboard)
  - QuickTime Player for screen recording (or iPhone camera if needed)
  - TextEdit/VS Code to quickly edit script if needed
- iPhone 13:
  - Installed Aisle Whisper PWA
  - Screen Recording enabled in Control Center

## Camera and audio plan (simple and reliable)

- Primary visual: iPhone screen recording (captures real mobile UX)
- Optional secondary visual: MacBook screen capture for architecture/health endpoint
- Narration: recorded in one take from MacBook mic or voiceover after capture

## Pre-flight checklist (do this before recording)

- Backend deployed and healthy
- Frontend deployed and updated
- iPhone PWA refreshed (or reopened after hard refresh)
- Shelf scene ready with obvious conditions (gaps/misalignment/low stock)
- Overlay Debug visible for credibility (optional but recommended)

---

## Time-Coded Script (Target: 3:45)

## 0:00-0:20 - Hook and problem

Narration:
"Store teams lose time scanning shelves manually for gaps, misalignment, and low-stock spots. Aisle Whisper gives a mobile-first shelf audit workflow with live AI overlays and a checklist in seconds."

On screen:

- Show iPhone home screen, open Aisle Whisper PWA
- Briefly show live camera feed in the app

## 0:20-0:45 - What the app is

Narration:
"This is a full-stack app: a PWA on iPhone, a backend relay on Cloud Run, and Gemini-powered analysis. The associate points the camera to the shelf and the system highlights issues directly on screen."

On screen:

- Show Detection focus selector
- Show overlay boxes appearing over shelf issues

## 0:45-1:35 - Focused detection modes

Narration:
"To reduce noise, we can focus detection by intent. For example, Shelf gaps for empty facings, Facing alignment for planogram-facing drift, or Restock priority for replenishment decisions."

On screen:

- Switch focus from All shelf issues -> Shelf gaps
- Wait for overlays to refresh
- Switch to Facing alignment and show different filtered output
- Switch to Restock priority to show GAP/LOW_STOCK filter behavior
- Keep movement slow for readability

## 1:35-2:20 - Checklist flow (core business output)

Narration:
"When the shelf state looks right, we tap Generate Checklist to freeze the capture context and create an actionable checklist. Then we tap Audit Shelf to review the summarized findings."

On screen:

- Tap Generate Checklist
- Wait for success toast/message
- Tap Audit Shelf
- Show summary with checklist JSON + snapshot

## 2:20-2:55 - Technical credibility (Gemini usage)

Narration:
"Under the hood, we use Gemini live session handling for realtime stream context, and strict backend prompt enforcement with focus-based filtering to stabilize labels. We also expose a runtime SDK health endpoint for explicit Google GenAI SDK verification."

On screen (Option A: iPhone only):

- Show Overlay Debug panel:
  - WS ready
  - prompts sent
  - focus filter
  - active detections

On screen (Option B: quick Mac cut):

- Open backend health endpoint `/health/genai-sdk`

## 2:55-3:25 - Why this matters

Narration:
"For retail teams, this reduces aisle walk time, standardizes issue detection, and makes handoff easier through a checklist artifact. The experience is mobile-native and works with real shelf footage, not static mockups."

On screen:

- Return to live view and slowly pan shelf
- Keep overlay boxes visible
- Briefly show checklist result once more

## 3:25-3:45 - Close

Narration:
"Aisle Whisper turns shelf monitoring into a fast guided flow: detect, focus, freeze, and act. This is our MVP, ready to expand with store integrations and workflow automation."

On screen:

- End on app screen with overlays + focus selector visible
- Fade out

## 3:45-3:55 - Buffer (optional)

Narration (optional):
"All core flows shown are running live on Google Cloud with Gemini-powered multimodal analysis."

On screen:

- Brief flash of architecture diagram OR Cloud Run service page
- Cut to end card

---

## Short Voiceover Version (single paragraph)

Use this if you want a simpler one-take recording:

"Aisle Whisper is a mobile-first shelf audit app built for retail operations. The user points the phone camera at a shelf and Gemini-powered analysis returns live issue overlays such as gaps, misalignment, low stock, and out-of-place products. We added a strict focus selector so teams can target only the issues they care about, like Shelf gaps or Facing alignment. After detecting issues, the user taps Generate Checklist to freeze the capture context and create a structured task list, then taps Audit Shelf to view the summarized result. On the backend, we enforce strict prompt and label filtering for stability and expose a runtime health endpoint confirming Google GenAI SDK usage. The result is a practical MVP that reduces manual shelf checks and makes replenishment actions faster and more consistent."

---

## Editing Guide (Mac + iPhone friendly)

## If you prefer no video editor

- Record iPhone screen in one take
- Trim start/end directly in Photos on iPhone
- AirDrop to Mac and submit

## If you want light polishing on Mac

- Use iMovie (free) for:
  - quick cuts
  - title card (project name + 1-line value prop)
  - voiceover replacement if needed

## Recommended export

- Resolution: 1080p
- Frame rate: 30 fps
- Max length target: 3:40-3:55
- Hard cap: 4:00 (only first 4 minutes may be judged)

---

## Backup Plan (if live overlay is unstable during recording)

- Keep 10-15 seconds of pre-recorded successful iPhone footage ready
- During narration, cut to that segment for the focused detection and checklist parts
- Continue live for intro and closing so the demo still feels authentic

---

## Optional Submission Assets

- Architecture diagram: `software-architecture.svg`
- Root README with reduced scope summary
- Frontend and backend READMEs with current behavior
