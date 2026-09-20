# StopMotion

A webcam stop-motion studio with onion skin, playback, portable projects and local autosave.

## Run locally

With Node.js and npm installed:

```sh
npm ci
npx playwright install chromium
npm run serve
```

Open http://127.0.0.1:4173 and allow camera access. For port 4174 in PowerShell:

```powershell
$env:PORT='4174'
npm run serve
```

Then open http://127.0.0.1:4174. The server reads `PORT`, not a `--port` argument.
Run the Chromium simulated-camera tests with `npm run test:e2e`.

## Workflow and backups

- Select a camera, Capture frames (Space when not focused on a control), adjust onion
  skin and frame rate, then Play. Capture always reads the live camera, even while a
  selected frame is being previewed; successful capture returns to Live.
- Select a thumbnail to preview it, or use Tab then Arrow keys/Home/End; Enter/Space
  selects without capturing. Live returns to the camera/onion view. Duplicate, Delete,
  Move left/right and Hold edit the selected frame. Hold is an integer exposure count
  (1–120); duration is total exposures divided by FPS. The bar below the camera shows
  elapsed animation time, not position in the equal-width thumbnail strip. Each frame
  cell shows its number and an xN badge when Hold is greater than one. Zoom and Go to
  frame navigate long projects; projects over 120 frames render only the visible window
  of thumbnails and load the rest as you scroll.
- Undo/Redo cover capture and timeline edits, retaining at most 50 edits in memory.
  History/duplicates share immutable PNG frame records and encoding references rather
  than cloning pixels. Fresh edits discard redo. Clear, Open, recovery/reload and completed
  WebM imports reset history; selection returns to Live. History itself is not saved.
- Save Project downloads a `.stopmotion` file containing frames and settings;
  Open Project restores that editable project. New saves use binary v2 (bounded
  JSON metadata followed by unmodified PNG blobs, without base64). Existing
  v1 JSON projects still open. Keep downloaded backups.
- Export Video creates a WebM for viewing/sharing. Import WebM is the legacy video
  importer, not a lossless project backup or a substitute for Open Project.
- Autosave uses browser IndexedDB on this origin. Check the saving/saved/error status;
  retry failed saves or download a project backup. Changing host/port/browser uses
  separate storage; clearing browser data can remove autosaves.
  For long projects, use a normal browser window and download backups before reload.
  In testing, Chromium's private/incognito context rejected a roughly 479 MB
  distinct-Blob snapshot with `QuotaExceededError` despite reporting more than
  3 GiB quota. A fresh persistent context saved and read back 1.0675 GB of distinct blobs.
  Reported origin quota therefore does not guarantee usable Blob capacity, and
  these host-specific observations are not guarantees for other devices. If saving
  fails, Save Project preserves the current in-memory work; the last successful
  autosave remains the recovery point. Open the backup in a normal browser window.
- New / Clear project asks for confirmation and intentionally saves an empty project.
- Editable v1 projects preserve optional per-frame holds; older v1 projects default
  to one exposure per frame. WebM exports repeat exposures; legacy WebM import does
  not reconstruct original editable hold metadata. Use Save Project for that.

## Current limitations

### Capture and export quality

The camera requests **1280×720 (720p)** as an ideal, not a requirement. New projects
use the actual camera dimensions; the Studio heading shows camera and project sizes.
Lower-resolution cameras fall back to their actual size. Once a frame is captured,
project size stays fixed even after undoing to empty. Open/recovered projects retain
their size, including empty ones, until explicit New / Clear. Camera changes do not
upgrade existing 640-pixel originals or recover detail they never captured.

Different camera/project aspects are letterboxed, not stretched. Lower-resolution
camera pixels are centered without upscaling; Live uses the same framing as capture.
Frames are lossless PNG records rather than retained full-resolution canvases.
The decoded cache holds at most **8 images / 16 MiPixels**, closing evicted images.
Capture grabs the frame immediately and queues its PNG compression in the background
(up to 8 shots), so pressing Capture never waits for the previous frame to encode;
each temporary canvas is released after it is compressed.
Recovery validates frames sequentially; export decodes/encodes one image at a time.
Projects allow up to **2,000 frames / 2 GiB compressed media**, not a fixed total
decoded-pixel budget. 700 frames at 720p are supported when their PNGs fit
that budget (about 2.93 MiB per frame). Detailed/noisy scenes may exceed
it sooner. Originals are never silently made lossy. Each frame is limited to 4096
pixels per axis and 16 MiPixels. Browser storage quotas may be lower than these limits.

WebM export uses explicit high-quality **WebP/VP8 quality 0.98**, directly from the
lossless originals. Recovered/Open projects use the same encoder from lossless PNG
originals. Quality 1 can produce VP8L, which this VP8 video muxer cannot use; unsupported
or failed encoders report an export error rather than hanging. PNG project recovery,
Open and Save Project remain available even without a functioning video encoder.

On the deterministic 1280×720 test fixture (texture, gradients, colored edges and text),
native Chromium WebM decoding measured the following RGB absolute error (0–255):

| Setting | Combined MAE | Gray-detail MAE | Color-region MAE | WebM bytes (2 frames) |
| --- | ---: | ---: | ---: | ---: |
| Browser-default WebP | 7.219 | 3.810 | 10.628 | 539,171 |
| Explicit quality 0.98 | 5.384 | 0.784 | 9.985 | 1,113,351 |

This is a fixture-specific improvement, not a universal quality guarantee: colored
edges still lose detail through chroma subsampling, and files are larger. A separate
640×360 downsample at the same 0.98 setting, enlarged to the same 1280×720 comparison
size, measured combined MAE 13.163; this isolates resolution loss rather than reproducing
an old physical-camera recording. Save Project remains the lossless backup.

### VLC short-animation compatibility

Exports split the final exposure into eight identical-image packets with explicit
durations. No pose, timeline FPS, hold or playback time is added. This works around
observed VLC 3.0.23 automatic-decoder-thread failures, including lost tails on longer
clips; it is not a guarantee for every player. Files include up to seven additional
copies of the final compressed frame (about 220KB extra in the tested Test3 clip).
StopMotion validates its export marker, timings and copies on Import WebM, restoring
the original exposure count/rate. Save Project is still the editable lossless backup.
The quality table above predates this container overhead; pixel quality is unchanged.

### Remaining work

Capture and project recovery do not encode WebP until export requests it. A single
recent compressed WebP (maximum 16 MiB) is retained for repeated exposures; thumbnails
reuse cached 96×72 pixels and active DOM nodes. Autosave has only one active write
and one pending latest snapshot, retaining the most recent edit without a backlog.

Compressed PNGs, thumbnails, up to 50 reference-based undo states and export buffers
remain outside the decoded-cache budget. This is not a bound on total browser/process
memory. Projects allow 24,000 exposures and 2 GiB of compressed media, plus at most
1 MiB metadata and a 12-byte binary header. The v2 reader checks all lengths/types,
aggregate size and exact file end before sequential PNG validation. Legacy v1 JSON
and WebM imports remain capped at 512 MiB because those readers load their full input.
Storage quotas and available disk space vary; keep regular backups. Legacy WebM import/timeline
integrity and broader browser coverage remain work in progress. Automated tests use
Chromium simulated cameras; physical cameras and permissions still need testing on
the intended device. Desktop settings scroll internally; narrow screens scroll normally.

## Attribution and license

Based on [Stefan Zager's original project](https://github.com/szager/stop-motion), copyright
2022 Stefan Zager. The 0BSD [LICENSE](LICENSE) permits use, copying, modification and
distribution for any purpose, with or without fee. LICENSE is retained verbatim.
