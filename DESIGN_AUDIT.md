# StopMotion — Design Audit and UI Consistency Plan

Status: design plan only. No application code was changed for this document.
Scope: the current StopMotion interface, the sibling apps (StickMotion, SketchMotion),
a proposed design-token sheet, an annotated workspace layout, the states still to
design, and responsive/accessibility guardrails.

Sources reviewed:
- `animator.css`, `index.html` (this repository).
- `kiwispin/stick-motion` — `index.html` token block and `UI_UX_AUDIT.md`.
- `kiwispin/motionsketch` — `index.html` token block, `public/manifest.webmanifest`,
  `public/icons/sketchmotion.svg`, and `SKETCHMOTION_PRODUCT_AUDIT.md`.

---

## 1. What exists today

### 1.1 Structure

Top bar (brand + project controls) -> status strip -> two-column grid (stage plus a
270px inspector) -> full-width filmstrip -> footer. Breakpoints at 900px and 650px.
The stage is capped at 580px. Capture, playback and edits are disabled together while
a project lock or import is active.

### 1.2 Current tokens (`animator.css`)

| Token | Value |
| --- | --- |
| `--bg` | `#141414` |
| `--panel` | `#1c1c1c` |
| `--raised` | `#262626` |
| `--border` | `#3f3f3f` |
| `--text` | `#f1f1f1` |
| `--muted` | `#b8b8b8` |
| `--accent` | `#3b82f6` |
| primary button | `#2563eb` (hover `#1d4ed8`) |
| focus ring | `#93c5fd` 3px, offset 3px |
| danger text | `#fca5a5` |
| body font | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, 14px/1.5 |
| radii | 8px controls, 12px panels, 14px dialogs, 5-6px thumbnails |
| control height | `min-height: 40px` |

### 1.3 Strengths to keep

- The animation dominates; chrome is restrained.
- Semantic buttons, `aria-pressed` toggles, native `<dialog>` for confirmations.
- Visible 3px focus ring and a zoomable viewport.
- Keyboard support (Space to capture, Backspace to undo, arrow navigation).
- Timelines use real buttons with accessible names.
- Camera failure already surfaces a message and a single retry action.

### 1.4 Gaps

| Area | Gap |
| --- | --- |
| Save status | A separate muted strip with a single string; no pending, backup or quota states. |
| Capture feedback | No pending state, though capture is now non-blocking (frame compresses in the background). |
| Timeline at scale | Fixed 96x72 DOM thumbnails, horizontal scroll only, no zoom, go-to-frame or virtualization. |
| Mode clarity | Live vs Reviewing is small muted text (`#selectionStatus`); no strong mode indicator. |
| Editing | Hold, Duplicate, Move and Delete share one flat row; no contextual selected-frame panel. |
| Export | Name plus Export only; no resolution, frame rate, duration, quality, progress or device-support state. |
| Empty/first run | Only a hint paragraph; no guided first capture. |
| Theming/offline | Dark only; no manifest/service worker. |
| Touch | 40px targets, keyboard-centric hints, no touch-specific affordances. |

---

## 2. Sibling apps

### 2.1 StickMotion

Tokens: `--bg #141414`, `--bg2 #1c1c1c`, `--bg3 #262626`, `--bg4 #303030`,
`--border #3f3f3f`, `--border2 #595959`, `--text #f1f1f1`, `--text2 #b8b8b8`,
`--text3 #929292`, `--accent #3b82f6`, `--accent2 #2563eb`, `--green #10b981`,
`--red #ef4444`, `--amber #f59e0b`, `--font` system stack, `--mono` for numerals.
Dark only. Its own `UI_UX_AUDIT.md` flags the same themes raised here: truthful save
status, export progress, touch/responsive breakpoints, contrast below AA, semantic
controls, pressed state on toggles, and onboarding. It recommends breakpoints at
1200 / 800, transport order First-Previous-Play-Next-Last, and separating actions
from modes.

### 2.2 SketchMotion

Tokens: `--bg-app #1e1e1e`, `--bg-panel rgba(40,40,40,0.85)`,
`--border-panel rgba(255,255,255,0.1)`, `--accent-blue #0067C0`,
`--accent-hover #007AFF`, `--text-main #ffffff`, `--text-muted #8e8e93`,
`--shadow-elevation 0 12px 40px rgba(0,0,0,0.4)`, `--radius-lg 18px`,
`--radius-sm 8px`; dark and light themes; a web manifest (`theme_color #0a84ff`),
a service worker, and a rounded-square icon (`#111318` with an accent pencil).
It is the more Apple-flavoured branch of the family and is the family's only offline
/ installable app.

### 2.3 Comparison

| | StopMotion | StickMotion | SketchMotion |
| --- | --- | --- | --- |
| Background | `#141414` | `#141414` | `#1e1e1e` (manifest `#0f1115`) |
| Panels | `#1c1c1c` / `#262626` | `#1c1c1c` / `#262626` | translucent `rgba(40,40,40,.85)` |
| Accent | `#3b82f6` | `#3b82f6` | `#007AFF` / `#0067C0` |
| Status colours | danger only | green / red / amber | (n/a) |
| Radii | 8 / 12 / 14 | 6 / 8 / 12 | 8 / 18 |
| Font | system stack | system stack + mono | `-apple-system` stack |
| Theme | dark only | dark only | dark + light |
| Offline / PWA | none | none | manifest + service worker |
| Icon | text glyph | none | rounded-square SVG |

Conclusion: StopMotion already shares StickMotion's exact palette and typography, so it
is a sibling today. SketchMotion is the Apple-blue, translucent, offline branch.
The proposed mock's move to a green accent is the one real divergence, and it collides
with StickMotion's meaning of green (success).

### 2.4 What to inherit

- Keep the shared dark base tokens as-is; do not fork them.
- Adopt `--success`, `--warning`, `--danger` as explicit semantic tokens.
- Adopt SketchMotion's elevation shadow for overlays and dialogs.
- Add a manifest and service worker for classroom offline use.
- Introduce a real StopMotion icon (rounded square with a frame/pencil motif).

---

## 3. Proposed StopMotion token sheet

### 3.1 Colour

Base (unchanged, shared): `--bg #141414`, `--bg2 #1c1c1c`, `--bg3 #262626`,
`--bg4 #303030`, `--border #3f3f3f`, `--border2 #595959`, `--text #f1f1f1`,
`--text2 #b8b8b8`, `--text3 #8f8f95`.

Semantic: `--success #10b981`, `--warning #f59e0b`, `--danger #ef4444`
(aligning with StickMotion).

Accent decision (pending owner approval):

- Option A — Family blue: `--accent #3b82f6`, `--accent-strong #2563eb`.
  Maximum consistency; StopMotion distinguished by icon and wordmark only.
- Option B — Distinct brand accent (recommended): teal/aqua
  `--accent #2dd4bf`, `--accent-strong #14b8a6`. Friendly and in-family, and it keeps
  green reserved for success, so "Capture" and "Saved" are never the same colour.

### 3.2 Type

Scale: 11 (keyboard/meta) / 12 (hint) / 13 (heading or label) / 14 (body) /
16 (large button) / 20 (page heading). Font: keep the system stack to match the
siblings. Use `--mono` (or `font-variant-numeric: tabular-nums`) for frame numbers,
duration and progress.

### 3.3 Spacing, radii, elevation

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.
Radii: 8 (controls), 10 (chips), 12 (panels), 16-18 (dialogs and sheets).
Elevation: `0 12px 40px rgba(0,0,0,0.4)` for overlays.

### 3.4 Interaction tokens

- Focus: 3px ring in `--accent` (or `#93c5fd`), offset 3px. Do not remove.
- Touch target: minimum 44x44 on touch; 40px acceptable on pointer-only desktop.
- Motion: 120-180ms ease-out for state changes; capture acknowledgement is a 140ms
  border pulse only; honour `prefers-reduced-motion`.
- Disabled: retain 0.5 opacity, but use `not-allowed`, not `wait`, unless a genuine
  operation is in progress.

### 3.5 Component inventory

Panels, buttons (primary / secondary / ghost / danger), icon buttons, sliders,
toggles, chips, status pill, filmstrip cell, dialogs, bottom sheet, toast, empty state.
Each must map to the tokens above so the family stays consistent.

---

## 4. Annotated workspace layout

Top bar

1. Wordmark uses the new StopMotion icon (rounded square), not a text glyph.
2. Project title with a menu: Rename, New project, Open project, Download backup.
   New / Open / Clear / backup belong here.
3. Save status as a compact, tappable pill. States: `Saving… (N)`,
   `Saved in this browser`, `Backup downloaded`, `Storage full - get a backup`.
   Wording must never imply that a portable backup exists.
4. Actions: Export movie is a secondary / outline button here; Capture frame is the
   only filled accent control on this screen.

Stage

5. Keep the `LIVE CAMERA` chip; when a frame is selected it becomes `REVIEWING 124`
   (warning-coloured outline, not accent). Keep the `1280 x 720` chip.
6. Capture feedback: a 140ms border pulse, plus the new filmstrip cell appears
   immediately in a dimmed "saving" state and settles when compression completes.

Right panel (contextual)

7. Live mode: camera selector, onion-skin toggle and opacity, flip, Capture frame
   (accent, with the shortcut chip hidden on touch), and "Next frame: N".
   Review mode: selected-frame details, Hold minus/plus (prominent), Duplicate
   (secondary), Move left/right, Delete, and Back to Live camera.
8. Rename "Flip camera" to "Flip 180 degrees" to avoid reading as switch-camera.

Transport

9. Order First, Previous, Play, Next, Last (per StickMotion's audit). Label whether
   preview plays the whole animation or from the selection. Right side: frame-rate
   picker plus `124 frames - 10.3 sec` in tabular numerals.

Timeline

10. Header: Live camera (the action), Undo / Redo, Zoom minus/slider/plus,
    Go to frame [N].
11. Strip: numbered cells, xN hold badge, accent border for selection, a playhead
    line during playback, and virtualization beyond roughly 60 cells.
12. Footer hint is contextual: Live shows "Capture to add frames."; a selected frame
    shows "Hold extends this pose; Duplicate adds a new editable frame."

Missing from the current mock and still to be designed: empty/zero-frame state,
camera-unavailable state, storage-full, the export flow, export-unsupported (iPad),
and the pending-capture treatment.

---

## 5. States to design

Empty project; Saving (with pending count); Saved in browser; Backup downloaded;
Storage full; Autosave failed; Camera denied / in use / none; Capture pending;
Export flow (resolution, frame rate, duration, plain quality label, time note,
honest "Encoding frame N of M" then "Finishing"); Export unsupported on this device;
Download complete with playback guidance; Import or recovery protected.

---

## 6. Responsive breakpoints

- At 1200px and above: three regions as mocked (stage, inspector, filmstrip).
- 800-1199px: inspector narrows to about 240px, transport compacts, keyboard chips hide.
- Below 800px (portrait iPad): stack camera, transport and filmstrip; the inspector
  becomes a bottom sheet or drawer; top-bar actions collapse into an overflow menu.
  Touch targets are 44px. Treat portrait iPad as a first-class case, not an afterthought.

---

## 7. Consistency rules and terminology

- One filled accent action per screen.
- Icons always paired with text labels for unfamiliar actions.
- Numbers use mono or tabular numerals.
- Selection and focus share the accent; success, warning and error use their own colours.
- Terminology: Capture frame, Live camera, Reviewing frame N, Hold (duration),
  Duplicate (new frame), Move, Delete, Save project, Export movie, Open project,
  Download backup, Go to frame.

---

## 8. Accessibility guardrails

- Minimum 44x44 touch targets.
- Visible focus retained; dialogs trap and restore focus.
- `aria-pressed` on toggles; labels on camera and frame-rate selectors.
- Never rely on colour alone (pair the xN badge with the number; pair status colour
  with an icon and text).
- Honour `prefers-reduced-motion`.
- Do not disable browser zoom (StopMotion already permits it).
- Re-check contrast after any accent change; keep body and muted text at or above
  4.5:1 on the dark panels.

---

## 9. Open decisions and next steps

Open decisions:

1. Accent: family blue (A) or teal brand accent (B, recommended).
2. Landscape-first, or portrait iPad equally first-class.
3. Timeline scrubbing in v1, or play plus Go to frame only.

Next deliverables, in order:

1. This audit and token sheet (this document).
2. One workspace layout specification with its interaction decisions
   (Live, Reviewing, Timeline, Export).
3. A clickable prototype covering capture, editing, recovery and export.
4. A short student/teacher usability check.
5. An approved, prioritised implementation specification.

Success standard: a first-time student can capture a short sequence, find and extend a
pose, undo a mistake, return to the live camera, save a backup, export a movie, and
explain where their work is saved - without coaching.
