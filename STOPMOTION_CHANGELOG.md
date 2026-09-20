# StopMotion Stage 1 Change Log

This log records the bounded Stage 1 camera and capture reliability work. Surviving code
and automated-test revisions are marked `ACCEPTED (code/automated review)` only after
parent review; physical hardware remains a separate user-test gate. A refused change is
not repeated unchanged; revisions reference the refused ID and state the changed behaviour.

## Baseline

- Repository: `https://github.com/szager/stop-motion`
- Baseline commit: `6eae625cdaa2e5f1685b95495f4b82f504f8ef49`
- Baseline branch: `master`, tracking `origin/master`
- Baseline worktree: clean before Stage 1 edits
- Baseline tracked files: 23 (measured with `git ls-files | Measure-Object`)
- Baseline tracked source files: 6 (`index.html`, `animator.css`, and 4 files under
  `js/`); baseline tracked image assets: 15. Thus 23 total = 6 source + 15 images +
  `README.md` + `LICENSE`.
- Baseline automated test files: 0
- Baseline package manifests: 0
- Baseline camera constraint shape: 5 top-level entries (`audio`, `frameRate`, `width`,
  `height`, `video`); `frameRate`, `width`, and `height` were outside `video`.
- Baseline device-selection syntax: 1 legacy `video.optional[0].sourceId` path.
- Baseline detach cleanup: 1 `getVideoTracks()[0].stop()` call; only the first video
  track was stopped and pending requests were not invalidated.
- Baseline capture guards: 1 `streamOn` check; no playback guard, load guard, ready-state
  check, video-dimension check, or video-track `readyState` check.
- Baseline thumbnail synchronization: 1 thumbnail was appended after every capture click,
  regardless of whether `capture()` produced a frame.
- Baseline permission recovery controls: 0 retry controls.
- Baseline page lifecycle cleanup: 0 `pagehide` listeners.
- Baseline portable flip path: 5 CSS Typed OM references (`attributeStyleMap`,
  `CSSTransformValue`, `CSSRotate`, `CSS.deg`, and `style.set`).
- Baseline verification: no local test command was available in this repository.

## Changes

### SM-001 — Baseline and test harness

- Purpose: establish reproducible browser tests without importing sibling project files.
- Files: `STOPMOTION_CHANGELOG.md`, `.gitignore`, `package.json`,
  `playwright.config.js`, `tests/server.mjs`, `tests/e2e/camera-capture.spec.js`.
- Before: 0 local test files, 0 package manifests, and no localhost serve command.
- After: 1 Playwright spec file, 1 local package manifest, 1 local static server, and
  `npm run test:e2e` configured to serve `http://127.0.0.1:4173`.
- Tests/conditions: local Playwright 1.63.0 installation, lockfile generation, and the
  later independent 10-test run are recorded below.
- Decision: `ACCEPTED (code/automated review)`.
- Refusal/revision links: none.

### SM-002-A — Initial camera request and stream lifecycle patch

- Purpose: modernize camera constraints, guard stale requests, clean all tracks, and add
  permission feedback/retry.
- Files: `js/animator.js`, `js/main.js`, `index.html`, `animator.css`.
- Before: legacy constraint shape, no request generation, first-track-only detach, and
  no retry control.
- After (initial attempt): modern constraint objects, request IDs, all-track cleanup, a
  retry button, and pagehide cleanup were added.
- Static review result: retry control had no stacking layer above the snapshot canvas,
  whose z-index was 2; reliable pointer activation was therefore unverified.
- Tests/conditions: no automated result recorded before review.
- Decision: `REFUSED` by parent review; superseded by `SM-002-B`.
- Refusal/revision links: revision `SM-002-B`.

### SM-002-B — Retry layering and idempotent lifecycle revision

- Purpose: make retry pointer activation reliable and ensure pagehide/audio cleanup is
  idempotent, including late microphone permission resolution.
- Files: `animator.css`, `js/main.js`, `tests/e2e/camera-capture.spec.js`.
- Before: retry button had 0 explicit stacking/pointer rules; pagehide invalidated 0
  microphone requests; recording completion used 1 unconditional audio-track access.
- After: retry is placed at z-index 4 above the message layer at z-index 3, cleanup is
  idempotent, and late microphone streams are stopped using an incremented request
  generation.
- Tests/conditions: the no-force Playwright retry click and late-audio pagehide test both
  passed in the parent run recorded in `SM-012`.
- Decision: `ACCEPTED (code/automated review)`; hardware gate `PENDING USER TEST`.
- Refusal/revision links: revises refused `SM-002-A` and `SM-004-A`.

### SM-003-A — Initial device enumeration patch

- Purpose: select cameras using `deviceId.exact` and labels from `enumerateDevices()`.
- Files: `js/main.js`, `js/animator.js`.
- Before: camera options stored only IDs; initial setup made 1 enumeration call before
  permission and had 0 post-permission refreshes.
- After (initial attempt): options use device objects and modern exact device constraints,
  but enumeration remained a one-time operation.
- Static review result: browsers may expose only a default camera before permission, so
  the initial list could omit usable cameras.
- Tests/conditions: initial constraints test was added; post-permission enumeration was
  not covered by the initial attempt.
- Decision: `REFUSED` by parent review; superseded by `SM-003-B`.
- Refusal/revision links: revision `SM-003-B`.

### SM-003-B — Post-permission camera-list refresh revision

- Purpose: refresh labels and available devices after successful attach/retry without
  recursively attaching or changing the active selection.
- Files: `js/main.js`, `tests/e2e/camera-capture.spec.js`.
- Before: 0 post-attach enumeration calls and 0 tests for cameras revealed after access.
- After: option refresh runs after successful attach/retry, preserves the active
  `deviceId`, and does not call `attachStream` while rebuilding the list.
- Tests/conditions: the stubbed initial single-camera list followed by a two-camera list
  passed with 1 request before refresh, 2 options after refresh, active `camera-a`, and
  a subsequent exact `camera-b` request; parent run recorded in `SM-012`.
- Decision: `ACCEPTED (code/automated review)`; hardware gate `PENDING USER TEST`.
- Refusal/revision links: revises refused `SM-003-A`.

### SM-004-A — Initial pagehide audio cleanup

- Purpose: stop media tracks when the page is hidden.
- Files: `js/main.js`.
- Before: 0 pagehide listeners.
- After (initial attempt): pagehide stopped camera tracks and set `audioStream` to null.
- Static review result: 1 later recording-completion callback still called
  `audioStream.getAudioTracks()` unconditionally, so pagehide could leave a TypeError.
- Tests/conditions: no late microphone permission test in the initial attempt.
- Decision: `REFUSED` by parent review; superseded by `SM-002-B`.
- Refusal/revision links: revision `SM-002-B`.

### SM-005-A — Initial import capture guard

- Purpose: prevent capture while an animation import is still decoding.
- Files: `js/animator.js`.
- Before: 0 import-state guards.
- After (initial attempt): 1 `loadInProgress` guard and 1 success-path reset were added;
  the load-end handler still decoded after error, abort was not handled, and decode
  exceptions/zero-frame results were not terminally reset.
- Static review result: malformed or empty input could leave capture disabled forever.
- Tests/conditions: terminal import paths were not covered by the initial attempt.
- Decision: `REFUSED` by parent review; superseded by `SM-005-B`.
- Refusal/revision links: revision `SM-005-B`.

### SM-005-B — Terminal import guard revision

- Purpose: clear the load guard on successful image completion, zero decoded frames,
  FileReader error/abort, and decoder exceptions; decode only on successful read.
- Files: `js/animator.js`, `tests/e2e/camera-capture.spec.js`.
- Before: 1 load-end decode path, 1 error listener, 0 abort listeners, and 0 decode
  exception handling paths.
- After: implementation uses the successful `load` event, explicit `error` and `abort`
  paths, a decoder try/catch, and a zero-frame terminal check.
- Tests/conditions: synthetic throw, zero-frame, error, abort, and successful completion
  guard cases passed; all five paths left `loadInProgress === false`.
- Decision: `ACCEPTED (code/automated review)`.
- Refusal/revision links: revises refused `SM-005-A`.

### SM-006-A — Initial capture readiness guard

- Purpose: avoid frame and thumbnail mutation when capture is unsafe.
- Files: `js/animator.js`, `js/main.js`.
- Before: 1 `streamOn` check and unconditional thumbnail append.
- After (initial attempt): playback/load/readiness/dimensions were checked and the main
  handler appended a thumbnail only for a returned frame; stream validation used
  `MediaStream.active` but 0 video-track liveness checks.
- Static review result: a stream can remain active while its video track is ended.
- Tests/conditions: no ended-track test in the initial attempt.
- Decision: `REFUSED` by parent review; superseded by `SM-006-B`.
- Refusal/revision links: revision `SM-006-B`.

### SM-006-B — Video-track capture revision

- Purpose: reject capture when every available video track is absent or not `live`.
- Files: `js/animator.js`, `tests/e2e/camera-capture.spec.js`.
- Before: 0 capture-time video-track `readyState` checks.
- After: implementation requires at least 1 video track and rejects any track whose
  `readyState` is not `live`, while retaining the `active`, media-ready, dimension,
  playback, and import guards.
- Tests/conditions: ended-track stream with `active === true`; no frame or thumbnail may
  be added. Physical browser readiness/playback remains a user hardware check.
- Decision: `ACCEPTED (code/automated review)`; hardware gate `PENDING USER TEST`.
- Refusal/revision links: revises refused `SM-006-A`.

### SM-007-A — Initial mocked-stream test harness

- Purpose: exercise pending camera promises without hardware.
- Files: `tests/e2e/camera-capture.spec.js`.
- Before: 0 camera tests.
- After (initial attempt): 1 stubbed `getUserMedia` path returned plain objects that were
  assigned to the native `video.srcObject` property; this is not a valid browser
  `MediaStream` assignment and provided 0 positive native capture frames.
- Static review result: the negative tests could fail from an unrelated `TypeError`, and
  there was no real Chromium fake-device smoke path.
- Tests/conditions: initial stub suite was refused before its results were treated as
  behavioural evidence.
- Decision: `REFUSED` by parent review; superseded by `SM-007-B`.
- Refusal/revision links: revision `SM-007-B`.

### SM-007-B — Browser-valid test harness and smoke revision

- Purpose: keep negative tests deterministic with an explicit test-only `srcObject`
  accessor while adding a native Chromium fake-camera path for positive capture/export.
- Files: `tests/e2e/camera-capture.spec.js`, `playwright.config.js`.
- Before: 0 native positive captures, 0 WebM smoke assertions, and 0 pageerror/unhandled
  rejection assertions.
- After: implementation uses a valid test-only media accessor for mocked streams, Chromium
  fake-device flags for the positive path, and per-test pageerror, console-error, and
  unhandled-rejection checks.
- Tests/conditions: 3 native captures, 3 matching thumbnails, WebM decode dimensions/frame
  count/frame rate, playback state, and zero browser errors are required.
- Decision: `ACCEPTED (code/automated review)`.
- Refusal/revision links: revises refused `SM-007-A`.

### SM-008 — Portable CSS flip compatibility

- Purpose: remove the unsupported CSS Typed OM dependency from the camera flip control.
- Files: `js/main.js`, `animator.css`.
- Before: 5 CSS Typed OM references in the flip handler; browser support was not
  guaranteed.
- After: 1 class toggle in JavaScript and 1 ordinary CSS transform rule; captured pixels
  continue to use the existing Animator flip flag.
- Tests/conditions: static compatibility change passed automated review; actual webcam
  flip behaviour remains part of the user hardware gate.
- Decision: `ACCEPTED (code/automated review)`; hardware gate `PENDING USER TEST`.
- Refusal/revision links: none.

### SM-009 — First local test execution environment

- Purpose: execute the project-local Playwright suite.
- Files: none.
- Before: Chromium executable was not installed for the new local Playwright dependency.
- Measured result: `npm run test:e2e` discovered 10 tests and reported 10 browser-launch
  failures before any test body ran; behavioural pass count was 0 and behavioural failure
  count was 0.
- Action: installed the project-required Chromium 153.0.8010.12 / Playwright build 1243.
- Decision: `RECORDED` as environment setup; no implementation result inferred.
- Refusal/revision links: enables `SM-010`.

### SM-010-A — First behavioural suite execution

- Purpose: measure the camera patch and test harness in Chromium.
- Files: no source changes during execution.
- Measured result: 10 tests ran; 8 passed and 2 failed. The pageerror, console-error, and
  unhandled-rejection checks produced 0 reported browser failures in the executed tests.
  The two failures were test assertion defects: four synthetic load callbacks intentionally
  resolved without a value, and the recording UI contains 2 hidden `.recording` elements.
- Decision: `REFUSED` as an executable test revision because its assertions did not match
  the intended measured conditions; superseded by `SM-010-B`.
- Refusal/revision links: revision `SM-010-B`.

### SM-010-B — Corrected behavioural assertions

- Purpose: assert callback completion as `true` and inspect both recording indicators.
- Files: `tests/e2e/camera-capture.spec.js`.
- Before: 4 expected callback values were `true` while the test recorded `undefined`, and
  1 expected recording indicator was compared with 2 actual indicators.
- After: the test compares 4 `true` completion values and 2 `none` display values.
- Tests/conditions: full rerun recorded as `SM-011`.
- Decision: `ACCEPTED (code/automated review)`.
- Refusal/revision links: revises refused `SM-010-A`.

### SM-011 — Reproducible green browser run

- Purpose: verify the completed Stage 1 patch and corrected test contracts.
- Files: `package-lock.json` plus the files listed in the preceding revision entries.
- Dependency measurement: `@playwright/test@1.63.0` resolved from the declared `^1.57.0`
  range and recorded in `package-lock.json`.
- Measured result (implementation run): `npm run test:e2e` ran 10 tests with 1 worker;
  10 passed and 0 failed in 16.6 seconds. This is suite wall time, not a performance
  benchmark. The suite's pageerror, console-error, and unhandled-rejection
  assertions recorded 0 failures. The fake-camera smoke measured 3 captured frames,
  3 thumbnails, a non-empty `video/webm` export, 640x480 decoded dimensions, at least 3
  decoded frames, a positive decoded frame rate, and active playback before stop.
- Decision: `ACCEPTED (code/automated review)`.
- Refusal/revision links: closes the verification loop for `SM-002-B`, `SM-003-B`,
  `SM-005-B`, `SM-006-B`, `SM-007-B`, and `SM-010-B`.

### SM-012 — Independent parent verification and review gate

- Purpose: record the independent parent run separately from the implementation run.
- Files changed by parent: none.
- Measured result (independent parent run): `npm run test:e2e` exited 0 with 10 passed and
  0 failed in 40.3 seconds. This is suite wall time, not a performance benchmark.
  `node --check js/main.js` and `node --check js/animator.js` both exited 0. `git diff
  --check` exited 0; only line-ending warnings were reported.
- Decision: surviving Stage 1 code and automated-test revisions are
  `ACCEPTED (code/automated review)`; no source changes were made by the parent.

### SM-013 — Post-freeze camera refresh generation guard

- Purpose: prevent an older asynchronous device-list refresh from overwriting a newer
  camera selection.
- Files: `js/main.js`.
- Before: 0 generation checks guarded asynchronous camera-list refresh results.
- After: 1 `cameraRefreshGeneration` guard invalidates older refresh results when a newer
  attach, toggle, or refresh begins.
- Timing: this source addition occurred after the parent green run recorded in `SM-012`.
- Tests/conditions: parent assessed the generation guard statically and ran the existing
  regression suite. `npm run test:e2e` exited 0 with 10 passed and 0 failed in 21.8
  seconds; `git diff --check` exited 0. No dedicated delayed-enumeration test was added.
- Decision: `ACCEPTED (parent code review and regression verification)`.
- Refusal/revision links: extends `SM-003-B`; no refused approach was repeated.

## Stage 1 hardware gate

- Status: `USER ACCEPTED` based on the report “Yes, everything works so far.” No specific
  device, browser, frame-count, or timing measurements were supplied with that report.
- Parent test server: `$env:PORT='4174'; node tests/server.mjs`; parent confirmed HTTP 200
  on `http://127.0.0.1:4174` in session `40157`.
- User checks: confirm actual webcam readiness; camera Off/On; two-camera switching if
  available; capture 5–10 real frames with matching preview thumbnails; Save WebM and play
  it back physically; verify Flip changes the live view and captured orientation; close or
  navigate away and confirm the camera indicator/light stops.

## Deferred later-stage issues

Stage 2 persistence is now authorized and in progress; suite UI redesign has not started.
Existing later-stage issues remain open:

- project saving is still memory-only/video-based, without durable recovery or a portable
  editable project format;
- full import and timeline integrity still needs coverage for extension, frame ordering,
  malformed media, and longer sequences;
- broader browser coverage and audio-device/recording coverage remain pending.

These items are recorded as unsolved follow-up work, not as Stage 1 acceptance criteria.

### SM-014 — Stage 2 persistence modules (in progress)

- Scope: versioned portable projects, transactional validation, IndexedDB blobs/metadata,
  serialized autosave, recovery, minimal controls, and regression tests.
- Baseline: 0 durable project stores and 0 portable editable project controls.
- Files: js/project.js, js/storage.js, js/main.js, js/animator.js, index.html and tests.
- Decision: REFUSED initial attempt by parent review; revised by SM-016 below.
- Memory scope: canvases remain in memory; bounded-cache migration is explicitly deferred
  to the next module refactor. Persistence does not establish memory scalability.

### SM-015 — Persistence wiring and first regression run

- Files: js/project.js, js/storage.js, js/animator.js, js/main.js, index.html,
  tests/e2e/project.spec.js.
- Implementation: lossless PNG project snapshots; version 1 portable JSON container;
  IndexedDB blob snapshots in a single transaction; serialized writes; startup/import lock;
  capture/undo/clear/fps/flip/audio/load hooks; Save Project/Open Project alongside explicitly
  labelled Export Video/Import WebM. No Eagle source used.
- Limits: 256 MiB portable input, 2,000 frames, 4,096px per axis, 128 Mi decoded pixels,
  fps 1–120. These are validation bounds, not measured memory-performance guarantees.
- Tests added: 5 browser workflows, with three captured frames and exact PNG pixel/order
  equality across reload and portable roundtrip; malformed input preservation, empty clear,
  and quota-failure portable-save fallback.
- Decision: PENDING REVIEW. First run results recorded below after completion.

### SM-016 — Review revision of SM-014

- Initial measured run: 15 passed, 0 failed, exit 0, 10.1s suite wall time, not a benchmark.
- SM-014 initial approach REFUSED: failed recovery could be overwritten by first edit;
  portable output limits differed from input limits; stale recording callbacks could alter
  replacement projects; action messages concealed persistence errors.
- Revision: protect unreadable recovery until explicit Clear/Open replacement; validate
  portable output and final size before download; cancel recording/countdown on project
  locks, reject replacement during WebM load and guard late file-picker callbacks;
  preserve persistence error/Retry independently of action feedback.
- Files: js/project.js, js/main.js, js/animator.js, tests/e2e/project.spec.js.
- Decision: PENDING REVIEW. Targeted tests and revised full-run evidence follow.

### SM-017 — Targeted review verification

- Revised run: 20 passed, 0 failed, exit 0, 13.2s suite wall time (not a benchmark).
- Measured: recovery sentinel preserved across capture; explicit Clear stored 0 frames;
  delayed writes committed fps values [4,11] in order with final fps 11; invalid export
  produced 0 downloads; invalid Open retained Retry and autosave error; 2 frames and
  3 audio blob bytes survived reload. Audio bytes test is storage coverage, not codec validation.
- Added final guard test: delayed image validation blocks capture/Space, and a pending
  microphone result is stopped after opening a project. Final full run follows.
- Decision: PENDING REVIEW; no parent acceptance claimed.

### SM-018 — Stage 2 review handoff

- Final implementation run: `npm run test:e2e` exit 0; 21 passed, 0 failed, 16.4s suite
  wall time (not a performance benchmark). Includes unchanged 10 Stage 1 tests plus
  11 persistence tests; no pageerror assertion failures.
- `node --check` passed for project.js, storage.js, main.js, animator.js. `git diff
  --check` exit 0 with line-ending warnings only.
- Last guard test: 3 frames remained unchanged during locked validation; Space/capture
  blocked; 1 late microphone track stopped; replacement project retained null audio.
- Stage 2 files: js/project.js, js/storage.js, js/main.js, js/animator.js, index.html,
  tests/e2e/project.spec.js, STOPMOTION_CHANGELOG.md. No dependency changes for Stage 2.
- Decision: PENDING PARENT REVIEW; source/tests frozen at handoff until feedback.
- Limits: in-memory canvases and queued PNG snapshots remain unbounded by a cache;
  bounded-cache migration deferred. IndexedDB is per origin (different localhost ports
  have separate storage). Portable project import is transactional; legacy WebM import
  retains its existing decoder and needs broader malformed-media/timeline integrity work.
  Audio persistence tests cover blob bytes, not codec/physical recording compatibility.
  Cross-tab concurrent editing arbitration and broader browser coverage remain deferred.
- Storage/UI redesign beyond the minimal project buttons is not included. No commits/push.

### SM-019 — Second persistence review revision

- SM-018 handoff REFUSED by parent review: durable snapshots could exceed recovery limits;
  portable export redundantly decoded/re-encoded all frames; Clear emitted intermediate and
  duplicate writes and did not cancel pending/active microphone work.
- Revision: shared shape/media-budget validation before durable writes and portable export;
  source canvas dimension checks; portable final-size check without extra image decoding;
  Clear cancels audio activity, suppresses intermediate audio notification, and emits one reset.
- Existing Clear UI already permits zero frames; retain and test protected empty recovery reset.
- Files: js/project.js, js/animator.js, tests/e2e/project.spec.js, this log.
- Decision: PENDING REVIEW; measurements follow the revised test run.

### SM-020 — Second revision measured handoff

- Full suite: 24 passed, 0 failed, exit 0, 16.0s wall time (not a performance benchmark).
- Four invalid local snapshot conditions (2,001 frames, decoded-pixel budget, 201-character
  name, unsupported audio MIME) each preserved the last stored 3-frame/9fps project.
- Empty protected recovery Clear produced exactly 1 durable snapshot with 0 frames/null
  audio; reload succeeded. Pending microphone after Clear stopped 1 track. Portable export
  invoked createImageBitmap 0 times; existing actual download/upload roundtrip still passed.
- Range-input fill worked in the installed Playwright 1.63.0 run; no test workaround needed.
- Syntax checks for project.js/animator.js and git diff --check passed (line-ending warnings
  only). Stage 1 tests unchanged. No performance or bounded-memory claim is made.
- Decision: PENDING PARENT REVIEW. Source/tests frozen again at this handoff.

### SM-021 — Stage 2 acceptance and Stage 3 interface

- Parent accepted Stage 2 scope: independent suite exit 0, 24 passed/0 failed, 14.9s
  wall time; git diff --check exit 0. SM-016/019 revisions ACCEPTED; refusals retained.
- Stage 3 files: index.html, animator.css, main.js, animator.js, project.js and UI tests.
- Read sibling index CSS: charcoal panels, blue accent, system fonts and compact controls.
- New responsive studio/transport/filmstrip/settings/topbar; accessible labels/dialogs;
  optional backward-compatible onionOpacity (default 50); frame/duration summaries;
  focused-control shortcut protection; actual isPlaying() transport state.
- Decision: PENDING REVIEW; screenshot and browser results follow. No external dependencies.
- Stage 4 frame editing/reorder/redo/holds/cache remain deferred; Stage 2 limitations retained.

### SM-022 — Interface review revision and first measurements

- Initial run: 29 passed/1 failed, 20.4s wall time. Focus test incorrectly expected
  keyboard focus styling after pointer-mode programmatic focus; revised to real Tab navigation.
- Parent flagged mutation locks after moved controls and CSS maintainability. Broad top-container
  lock was already present; added explicit Play/Undo/onion assertions during delayed import,
  late export-submit guard/lock and programmatic onion/transport busy guards.
- Initial compressed CSS approach REFUSED; formatted to normal readable rule/property lines.
- Decision: PENDING REVIEW. Actual screenshots inspected at desktop/tablet/narrow widths.

### SM-023 — Stage 3 measured handoff

- Final suite: 30 passed, 0 failed, exit 0, 18.4s wall time (not a benchmark); all prior
  24 regressions retained. Syntax checks for main/animator/project and git diff --check passed.
- Four viewports: 1440x900, 1024x768, 768x1024, 390x844; document scrollWidth <= viewport
  width in all four; six key controls verified reachable within horizontal bounds.
- UI tests: 3-frame screenshot states; 25% opacity survives reload; 2 frames at 4fps show
  0.50s then undo shows 0.25s; native dialog text entry, transport pressed state, Tab focus,
  global Space/Backspace and focused-input protection. Accessible names checked for buttons.
- Screenshots (full-page images at requested viewports) visually inspected:
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-1440.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-768.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-390.png
- Desktop stage/settings spacing compacted after first visual inspection; narrow settings
  align to the top. CSS formatted with Prettier; no new runtime/package dependency.
- Decision: PENDING PARENT REVIEW; ALL source/test files frozen at handoff.
- Scope limitation: browser accessibility checks are targeted, not a full assistive-technology
  audit; physical hardware is not re-certified by simulated-camera layout tests.

### SM-024 — Desktop vertical sizing revision

- SM-023 desktop vertical sizing REFUSED by parent: 1440x900 full-page image was 964px
  tall; complete filmstrip was not visible without page scrolling. Earlier assertions
  measured horizontal fit/reachability only, not simultaneous vertical visibility.
- Revision: desktop viewport-height flex/grid composition, height-aware camera sizing,
  internally scrollable settings without removing controls. Narrow layouts retain normal scroll.
- Files: animator.css, tests/e2e/ui.spec.js, this log. Added preview/transport/complete
  thumbnail-row bounding assertions before reachability scrolling, desktop document-height
  assertions, and the missing 1024x768 screenshot.
- Decision: ACCEPTED by final parent Stage 3 browser/visual review (SM-027).
  Refused initial SM-023 sizing remains recorded above.

### SM-025 — Current workflow documentation

- README now covers install/browser/test/server commands, PowerShell PORT=4174,
  project versus video workflows, origin-local autosave/downloaded backups,
  current limitations, original author and 0BSD. Removed non-commercial wording;
  LICENSE unchanged. Commands checked against package.json and tests/server.mjs.
- First sizing run: 30 passed/0 failed, exit 0, 18.4s suite wall time;
  git diff --check exit 0 (line-ending warnings only). Desktop full-page screenshots
  now 1440x900 and 1024x768; preview/transport/thumbnail bounds passed before scrolling.
- Screenshot setup now resets internal sidebar scrolling after reachability checks.
- Initial documentation patch rejected by patch tool for duplicate target operations;
  no changes applied in that attempt; revised to a single README update.
- Decision: ACCEPTED by final parent Stage 3 review (SM-027).
  Final implementation rerun is recorded in SM-026. No new dependencies/features.

### SM-026 — Final revised Stage 3 handoff

- Sidebar scrollTop reset to 0 before screenshots; all four final images inspected.
- Final npm run test:e2e: exit 0, 30 passed/0 failed, 17.4s suite wall time (not
  a performance benchmark). All 24 original regressions retained. git diff --check
  exit 0 with line-ending warnings only; git diff -- LICENSE empty.
- Desktop preview, transport and complete first thumbnail row fit without page scroll
  at 1440x900 and 1024x768. Parent visual review accepts revised desktop vertical fit;
  final independent suite/review still pending. Narrow-screen scrolling preserved.
- Final screenshot paths:
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-1440.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-1024.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-768.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/studio-390.png
- README workflow/commands/license correction complete. ALL source/test files frozen
  at this handoff pending explicit reviewer feedback. No commits/push or new features.

### SM-027 — Stage 3 accepted; user checkpoint pending

- Parent ACCEPTED final Stage 3 UI, SM-024 sizing revision, documentation and test
  revisions for browser/visual scope. Historical refusals and earlier run results
  remain intact; this acceptance supersedes prior pending-review handoff statuses.
- Independent parent npm run test:e2e: exit 0, 30 passed/0 failed, 17.5s suite wall
  time (not a performance benchmark), separate from implementation run of 17.4s.
- Parent node --check main.js/animator.js/project.js/storage.js: all exit 0;
  git diff --check exit 0; LICENSE unchanged; localhost port 4174 HTTP 200.
- Parent visually reviewed final 1440 desktop/1024 laptop and prior 768 tablet/390
  narrow screenshots. Acceptance covers browser/visual fit, not new hardware claims.
- USER UX/real-project saving checkpoint: PENDING. Try revised layout, adjust onion
  opacity, capture a few frames, wait for Saved and reload; then Save Project,
  Clear, Open Project and verify restoration; also export a video and check playback.
- Stage 4 must not start until this checkpoint. Advanced frame editing, reorder,
  redo, holds and bounded image cache remain NOT DONE. Cross-browser/audio coverage
  and legacy WebM import/timeline limitations remain unresolved.
- This update changes ONLY STOPMOTION_CHANGELOG.md; source/tests remain frozen.

### SM-028 — Stage 3 user acceptance; Stage 4A start

- USER ACCEPTED Stage 3 checkpoint: "Everything is working fine so far, yes".
  No new device/browser measurements inferred from this report.
- Stage 4A: selected-frame/Live preview, accessible timeline edits, holds and bounded
  shared-reference undo/redo, persistence and hold-aware playback/export. Stage 4B
  bounded base-frame caching remains deferred. Implementation/tests PENDING REVIEW.

### SM-029 — Timeline, persistence and timing implementation

- Added js/timeline.js: selected preview/Live, keyboard selection, duplicate/delete/move,
  hold edits and 50-edit undo/redo. History and duplicates share original canvases and
  encoding promises; no full-size pixel clones per history step. New edits discard redo.
- Holds are optional v1 metadata (missing defaults to 1), validated for aligned count,
  integers 1–120 and at most 24,000 total exposures before durable/import replacement.
  Capture/duplicate respect existing frame/pixel limits. Clear/Open/recovery reset history.
- Removed 1,000ms playback tail; export expands only encoding references and rounds
  absolute WebM timestamps, not each interval. Elapsed-time progress is separately labelled
  under camera stage and resets with playback cancellation; not a thumbnail-position marker.
- Files: timeline/animator/main/project/webm JS, index.html, animator.css, timeline/UI tests.
- First regression run: 29 passed/1 failed, exit 1, 35.8s wall time. Old post-recovery
  Undo assertion conflicts with requested history reset. Revised that test to assert disabled
  Undo after reload, explicit deletion, then Undo/Redo and existing summary/opacity checks.
- Combined source patches failed repeated-context matching; revised to targeted patches
  after checking actual files. Decision: PENDING REVIEW; no acceptance claimed.

### SM-030 — Timeline test revision and environment-only parent attempt

- Expanded run: 36 passed/2 failed, exit 1, 31.7s. Playback test clock was advancing
  between assertions; revised to pause virtual time before controlled increments.
  Autosave-order test reported missing Playwright trace artifacts on context close,
  not an application assertion failure. Re-run required; no application fix inferred.
- Parent attempted interim suite while port 4173 was occupied: no parent tests executed,
  no processes stopped; environment-only attempt. Independent testing deferred to freeze.
- Native metadata measured 30s at 12fps and 15s at 24fps for 360 exposures. Parent correctly
  noted metadata alone cannot establish block timing. Added independent EBML SimpleBlock
  timestamp checks and native color seeks, plus unequal-hold progress/cancellation checks.
- README now documents timeline workflow/history policy, exposure limits, legacy v1
  migration and loss of editable holds through WebM. Files: README, timeline tests, log.
- Decision: PENDING REVIEW; final revised measurements follow, not benchmark claims.

### SM-031 — Independent timestamp-reader revision

- Revised run: 37 passed/1 failed, exit 1, 32.2s. Existing autosave-order test passed.
  Independent test reader rejected EBML's zero-length unsigned zero (cluster timecode),
  before timestamp/color assertions; revised reader handles that representation explicitly.
- Actual unequal-hold playback/progress and cancellation checks now pass with paused clock.
  Reviewed six-color desktop/narrow screenshots; desktop first row fits at 1024x768.
- Small lifecycle hardening: FPS change cancels active playback/recording; stale microphone
  result stops its tracks without resetting newer recording UI; project reset clears timeline
  feedback. Files: timeline tests, animator/main/timeline JS, this log. PENDING REVIEW.

### SM-032 — Timing evidence and final lifecycle coverage

- Targeted independent timing test: 1 passed/0 failed, exit 0, 7.9s wall time.
  Native 360-exposure videos: 30.000s at 12fps, 15.000s at 24fps; 360 independently
  parsed block timestamps each, maximum absolute timing error 0.333333ms at both rates.
  Native seeking produced RGB [255,0,1], [0,255,2], [0,0,253] across red/green/blue holds
  (lossy WebP/WebM tolerance 5/channel; editable project tests use lossless SHA-256 hashes).
- Added timeline-specific delayed-invalid-import lock/selection/history, ordered hold
  autosave snapshots and undo/delete recovery, pending/active microphone cancellation tests.
- Parent notes overlapping Playwright invocation may have cleared trace artifacts in
  SM-030; cause unproven. Remains environment-only evidence, not an application defect.
- Decision: PENDING REVIEW; full final suite and final screenshots to follow.

### SM-033 — Stage 4A measured handoff and freeze

- Final npm run test:e2e: exit 0, 41 passed/0 failed, 35.5s suite wall time, not a
  performance benchmark. The 30 prior regression cases remain, with the documented
  post-recovery Undo contract adaptation; 11 new timeline cases pass.
- Timing rerun confirmed 360 encoded blocks at each 12/24fps, maximum cumulative
  block error 0.333333ms, native durations 30s/15s and expected native decoded hold colors.
- Lossless frame hashes verify reorder/duplicate/delete/Undo/Redo branching and portable/
  autosave restoration. Duplicate canvas and WebP promise identity checks pass. A 52-edit
  hold sequence permits exactly 50 Undos; history cannot cross Clear/Open/reload boundaries.
- Unequal holds [3,2,1] at 12fps draw expected colors on controlled browser time, finish
  without the former 1s tail and restore selected preview; elapsed-time progress resets
  on completion/mutation cancellation. Pending and active microphone cancellation pass.
- Delayed invalid import disables editing controls and preserves 3 frames, holds, selected
  frame and history. Invalid hold count/type/range/total-exposure imports preserve current
  project; invalid autosave retains last durable snapshot. Hold snapshots preserve write order.
- node --check timeline/main/animator/project/webm JS: exit 0. git diff --check exit 0
  (line-ending warnings only); LICENSE unchanged. No dependencies, commits or pushes added.
- Final screenshots visually inspected after six distinguishable canvas-stream captures:
  C:/Users/master/Documents/Codex/StopMotion/test-results/timeline-1024.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/timeline-390.png
  Desktop preview/transport/complete thumbnail row fit in 1024x768; narrow controls remain
  reachable without horizontal page overflow. Sidebar scroll reset before screenshots.
- Stage 4A files: js/timeline.js (new), js/animator.js, js/main.js, js/project.js,
  js/webm.js, index.html, animator.css, tests/e2e/timeline.spec.js (new),
  tests/e2e/ui.spec.js, README.md and this log. Prior-stage uncommitted files preserved.
- Decision: PENDING PARENT REVIEW. ALL source/test files FROZEN at handoff. Stage 4B
  bounded base-frame cache not started; current in-memory canvases/history references,
  broader browser/audio and legacy WebM integrity limitations remain. No hardware claims.

### SM-034 — Stage 4A parent acceptance; user editing checkpoint pending

- Parent ACCEPTED Stage 4A browser/code/visual scope. Independent npm run test:e2e:
  41 passed/0 failed, exit 0, 32.4s suite wall time (not a performance benchmark),
  separate from the implementation run of 35.5s. Earlier attempt history retained.
- Independent native export measurements: 360 exposures at 12fps = 30s, at 24fps = 15s;
  maximum block timestamp error 0.333333ms at both rates. Decoded RGB samples:
  [[255,0,1],[0,255,2],[0,0,253]].
- Parent node --check timeline/animator/main/project/webm: all passed.
  git diff --check exit 0, line-ending warnings only.
- Parent viewed freshly regenerated 1024/390 screenshots: desktop camera, transport
  and complete thumbnail row fit; narrow controls remain reachable. An earlier failed
  screenshot read during the independent run occurred before artifact regeneration;
  this was an artifact-availability issue, not a code issue.
- USER EDITING CHECKPOINT: PENDING before architectural Stage 4B. With a real camera,
  try selected-frame preview, return Live and capture; exercise edits, Undo/Redo and
  holds; export and check the resulting video. Editing interaction acceptance is needed.
- Stage 4B remains NOT STARTED and deferred until this checkpoint. No bounded-memory
  claim: base-frame canvases remain in memory; prior browser/audio/WebM limits remain.
- This acceptance update changes ONLY this log. All source/test files remain frozen.

### SM-035 — User accepts timeline; HD/export quality scope starts

- USER ACCEPTED timeline checkpoint: "All seems to work fine, yes". No device
  measurements inferred. User reported WebM quality concerns and authorized prioritizing
  actual camera-supported HD and explicit high-quality export. Stage 4B still deferred.
- Inspected current source: ideal camera constraints 640x480, fixed capture canvas size,
  default-quality WebP in both capture and project restoration, muxer rejection path that
  logs rather than settles export. These are static findings, not image-quality measurements.
- Planned bounded revision: ideal 1280x720 with actual metadata, stable existing project
  dimensions, aspect-preserving capture, shared explicit VP8 quality encoder, measurable
  native video quality comparisons and encoder-failure feedback. PENDING REVIEW.

### SM-036 — Actual-resolution capture and shared explicit VP8 encoder

- Added js/media.js shared quality-0.98 encoder, VP8 chunk validation, rejection handling
  and aspect-preserving drawing. Fresh capture and export use immutable canvas originals;
  PNG backups remain lossless. VP8L is rejected, never mislabelled VP8 by the muxer.
- Camera asks ideal 1280x720; actual metadata sizes fresh projects and both stage canvases.
  First capture locks dimensions (including after Undo-to-empty); Open/recovery lock even
  empty projects. Explicit Clear unlocks to current camera. Capture never upscales pixels.
- UI reports actual camera/project sizes and unchanged 128 MiPixel frame cap. Stage aspect
  follows project; thumbnails letterbox. Live preview framing matches no-upscale capture.
- Parent REFUSED optional WebP encoding blocking valid PNG recovery: revised prepare to
  retain handled encoding promises without awaiting them; PNG validation remains mandatory.
- Scoped muxer rejection paths now settle export promises; visible export error leaves
  portable project saving available. New regression/quality/race/layout tests pending run.
- Files: media/animator/main/project/timeline/webm JS, index.html, animator.css, camera
  tests and new quality.spec.js, log. No additional dependencies. PENDING REVIEW.

### SM-037 — First HD regression evidence and test-helper revision

- Existing suite: 41 passed/0 failed, exit 0, 41.3s wall time, before final recovery/
  preview-framing revisions. Camera-constraint expectation now explicitly ideal 1280x720;
  smoke export dimensions compared with actual project dimensions, not a fixed 640x480.
- Initial targeted HD run stopped after 3 helper timeouts and 1 passing recovery/race
  test (exit 1; incomplete run, no full-suite claim). Helper awaited another presented frame
  from an unchanged static canvas after play() had already presented it. Revised helper
  uses fulfilled play() for initial-frame readiness; no application timing workaround.
- Added valid PNG recovery/Open test with unavailable WebP encoder, lossless backup check,
  and live/capture framing-ratio assertion. Revisions PENDING REVIEW; measurements follow.

### SM-038 — Native decoded-quality fixture revisions

- Targeted run: 8 passed/1 failed, exit 1, 13.5s. Initial loadeddata-only native draw
  yielded identical black-frame errors (MAE 120.648 for both). REFUSED as quality evidence;
  revised harness seeks to 0.05s and waits seeked before reading actual decoded pixels.
- Parent requested color evidence: fixture now combines grayscale detail/texture on left,
  colored gradients/fine edges and text on right. Also compare a 640x360 high-quality
  downsample rendered at the same 1280x720 output to isolate resolution loss, not claim
  an exact reproduction of the old camera pipeline.
- Combined-color PSNR improvement is smaller than grayscale, as expected with chroma
  subsampling. Keep improvement threshold on measured grayscale ROI; separately report
  combined RGB and color ROI error, and require combined error improvement.
- Quality-1 Chromium output observed VP8L; fixed 0.98 stays VP8. No claim all browsers
  encode identically. Final runs/measurements follow. PENDING REVIEW.

### SM-039 — Mixed-color evidence and documentation

- Second targeted run: 8 passed/1 failed, exit 1, 14.9s. Native seeking fixed the
  black-frame harness issue. Combined PSNR gain was 0.598549dB, below the initial 1dB
  assumption; no encoder change or universal claim used to obscure the color tradeoff.
  Revised criterion retains >1dB improvement on grayscale ROI plus lower combined MAE.
- Mixed 1280x720 fixture measured default/new: RGB MAE 7.218981/5.384376, grayscale
  MAE 3.809969/0.783600, color-region MAE 10.627993/9.985152; combined PSNR
  26.125347/26.723896dB. WebP bytes 269926/557016; 2-frame WebM bytes 539171/1113351.
- Separate 640x360 high-quality downsample rendered at 1280x720: RGB MAE 13.162830,
  PSNR 22.014241dB, WebP 120800 bytes, WebM 240919 bytes. This is a resolution
  comparison, not a recreated physical 640x480 capture. New camera source resolution
  measured 1280x720; no hardware claims or universal quality guarantee.
- README documents HD fallback/dimension locking, matching no-upscale live framing,
  145/64-frame 720p/1080p pixel-budget limits, explicit VP8 quality, lossless PNG backup,
  measured color/file-size tradeoffs and deferred Stage 4B. PENDING REVIEW.

### SM-040 — Full-run evidence and bounded verification revisions

- First expanded full run: 49 passed/1 failed, exit 1, 42.6s. Quality/PNG recovery/
  failure tests passed; existing 1024 UI case timed out waiting 5s for fake-camera
  readyState (still 0, no reported camera error). No resolution/quality assertion failed.
- Quality roundtrip test transferred/compared three ~557KB byte arrays and took 27.4s;
  replaced those transfers with in-browser SHA-256 encoded-byte hashes, retaining exact
  encoded-output equality while avoiding unnecessary test transport overhead.
- Added capture rejection while track dimensions disagree with stale video metadata.
  Delayed metadata after Clear may persist the new empty resolution; Clear/capture suppress
  intermediate notifications so each action still emits one coherent project snapshot.
- Grayscale PSNR default/new measured 34.529985/47.352009dB; mixed-color figures in
  SM-039 reproduced exactly. Final suite rerun required. PENDING REVIEW.

### SM-041 — HD test concurrency and final race assertions

- Repeat full run: 49 passed/1 failed, exit 1, 42.5s. The prior 1024 layout passed;
  768 layout instead timed out at fake-camera readyState 0 after 5s. Quality byte-hash
  test completed in 4.1s and retained exact fresh/recovered/Open encoding equality.
- Capped Playwright at 3 workers for the local HD/native-video workload, rather than
  5 concurrent files. This is test resource management, not an application correctness
  fix or a proven diagnosis of browser initialization delays; assertions remain intact.
- Added explicit stale track/video dimension mismatch rejection and durable empty-project
  resolution update after Clear/new camera metadata. No extra app features.
- Files: playwright.config.js, quality.spec.js, log. Revised run PENDING; all source
  acceptance remains with parent. Quality-threshold change was a fixture-assumption
  correction, not source acceptance. User HD/export checkpoint still pending.

### SM-042 — HD/quality final measured handoff and freeze

- Final npm run test:e2e: 50 passed/0 failed, exit 0, 40.8s suite wall time with
  3 workers (not a performance benchmark). All 41 prior regression cases plus 9 new
  HD/quality cases pass. Earlier failures/refused assumptions remain recorded above.
- Native mixed-fixture measurements reproduced SM-039/040 exactly. Fresh capture,
  PNG recovery and Open Project encodings have identical SHA-256 byte hashes.
  Quality 1 yielded VP8L; chosen 0.98 output validated as VP8 and natively decoded.
- Tests cover actual 720p, 640x480 fallback, 1080p actual metadata, consistent canvases,
  letterboxing/no-upscale pixel boundaries and matching live framing, empty restored
  resolution locks, explicit Clear, delayed recovery/stale streams, stale metadata
  capture rejection, durable empty resolution changes and pre-allocation HD frame cap.
- Null/unsupported/VP8L and rejected frame promises settle with errors; export can retry.
  Valid PNG recovery/Open and lossless Save Project survive unavailable WebP encoding.
- Prior holds timing still passes: native 360 exposures = 30s/15s at 12/24fps,
  maximum block timing error 0.333333ms. No cache/memory-scaling guarantee introduced.
- Final node --check media/animator/main/project/timeline/webm JS and Playwright config:
  exit 0; git diff --check exit 0 (line-ending warnings only); LICENSE unchanged.
- Final 3-frame HD screenshots inspected: desktop stage/transport/full row fit and
  narrow controls remain reachable, correct 16:9 stage and letterboxed thumbnails:
  C:/Users/master/Documents/Codex/StopMotion/test-results/hd-1024.png
  C:/Users/master/Documents/Codex/StopMotion/test-results/hd-390.png
- Changed this scope: js/media.js (new), js/animator.js, js/main.js, js/project.js,
  js/timeline.js, js/webm.js, index.html, animator.css, tests/e2e/quality.spec.js (new),
  tests/e2e/camera-capture.spec.js, playwright.config.js, README.md and this log.
- Decision: PENDING PARENT REVIEW. ALL source/test files FROZEN at handoff; no
  dependencies, commits or pushes added. Stage 4B remains deferred/not started.
- USER HD/EXPORT CHECKPOINT: PENDING after review. Save a project backup first, then
  Clear/new, check actual camera/project resolution, capture fresh frames and compare
  exported video. Existing 640-pixel projects do not regain missing detail. No physical
  camera validation or universal image-quality improvement claimed.

### SM-043 — Independent failed run and trace-first camera diagnosis

- Parent run: 49 passed/1 failed, exit 1, 45.5s. Quota case failed in beforeEach:
  readyState stayed 0 past 5s; NO quota assertions ran. Parent reproduced exact quality
  numbers; syntax/diff/LICENSE/visual checks passed. Not an accepted full-suite pass.
- Inspected original trace before any tests: 10 resources HTTP 200, recovery completed;
  8 readyState polls returned 0, no console/page error recorded. Trace lacks native
  enumerate/getUserMedia lifecycle state, so it cannot establish a media-request cause.
- Preserved parent trace outside Playwright output cleanup:
  C:/Users/master/AppData/Local/Temp/stopmotion-camera-edb2a11c1e2a41d1b5c593229ae6e3f9/parent-quota-trace.zip
- Test-only fixtures.js now observes native camera calls/video events and attaches final
  stream/paused/request state on failures; no retry/play/resume or readiness weakening.
  Existing five spec files import this fixture. App source remains FROZEN/unchanged.
- Next controlled comparison: full suite with --workers=1; three-worker cap was NOT a
  proven repair. Diagnostic/review outcome pending; no blind retry or false app-pass claim.

### SM-044 — Single-worker comparison and bounded diagnostic outcome

- Controlled npm run test:e2e -- --workers=1: 46 passed/4 failed, exit 1, reported
  wall time 3.4m. Lower concurrency is NOT a startup repair. Original quota case passed,
  but another project case failed in startup before its assertions.
- New evidence: native enumeration resolved and getUserMedia returned a live/unmuted
  1280x720 track by 327ms; visible document, pending=false, streamOn=true. Video emitted
  loadstart then remained paused, readyState=0, intrinsic dimensions=0 with no media error.
  This narrows failure to media startup after stream attachment, not pending permission,
  project recovery or quota logic. Root cause (browser/fake-device/autoplay) remains unproven.
- Bounded follow-up: 8 isolated startup probes against localhost4174 all became ready;
  no stalled sample reached the planned explicit play() probe. No production play/retry
  change justified by this result. Probe exit 0; NOT a full-suite/application acceptance.
- Other three failures: native transport's single exposure lasted 143ms, shorter than
  slow-host assertion; audio test attempted Delete about 568ms after starting a 571ms
  recording, allowing normal completion first; 52 hold edits/50 Undos exceeded 15s.
- Test-only repair: use 120-exposure hold for transport/active-recording observation;
  allow 30s for the long history test while retaining every edit/Undo/boundary assertion.
  These changes do not bypass camera readiness or change app timing. App source unchanged.
- Native startup remains a known unresolved automated-test risk, not proven physical
  camera behavior. Stop investigation after one targeted timing-test verification;
  primary HD image-quality evidence remains valid, no new all-green claim.

### SM-045 — Bounded diagnostic handoff; unresolved startup risk

- Targeted timing verification: 3 passed/0 failed, exit 0, 39.3s wall time. Active
  recording cancellation 2.2s; 52 edits/50 Undos history test 28.9s; native-control
  transport/shortcut test 4.4s. All assertions retained. This is NOT a full-suite pass.
- Test fixture/timeline/UI syntax checks and git diff --check passed (line-ending
  warnings only). No app source changes made during diagnosis. Diagnostics fixture
  retained to capture camera state if a later run stalls; five specs import it.
- Original parent trace preserved at SM-043 path. Single-worker failure artifacts remain
  in test-results; targeted verification used a separate temporary output directory:
  C:/Users/master/AppData/Local/Temp/stopmotion-camera-edb2a11c1e2a41d1b5c593229ae6e3f9/timing-verification
- Final status: startup flakiness is NOT solved and full-suite reproducibility is NOT
  established. Worker reduction disproved as sufficient repair. A live native fake-camera
  stream occasionally produces no metadata/frames; cause remains unproven. No production
  retries/playback change or physical-camera defect inferred from these observations.
- PENDING PARENT REVIEW of test-only diagnostics/timing revisions. All source/tests
  FROZEN again; bounded investigation stopped as requested. HD measured-quality results
  remain valid, but no false all-green claim supersedes the independent failed runs.

### SM-046 — Qualified HD/export acceptance; user checkpoint pending

- Parent independent focused run: 12 tests, 11 passed/1 failed, exit 1, 55.3s suite
  wall time. ALL 9 quality.spec.js HD/export cases passed and exact SM-039 quality
  measurements reproduced. Native transport and microphone-mutation cases passed.
- History case exceeded its 30,000ms timeout during hold fill at line 348; reported
  test duration 35.4s. The SM-044 timeout revision is NOT sufficient or proven
  reproducible. No further timeout increase or investigation authorized this turn.
- Parent ACCEPTED HD/export CODE/VISUAL scope for the user checkpoint, qualified by
  NO all-green full-suite claim. Diagnostics retained; test-timing changes are not
  accepted as a reproducibility fix. Prior failed runs/refusals remain intact.
- Parent syntax checks for six app modules and git diff --check passed; LICENSE
  unchanged. Parent reviewed 1024/390 screenshots and confirmed correct presentation.
- Known unresolved risks: intermittent native fake-camera startup and history-test
  runtime. These observations do not establish a physical-camera/application defect.
- USER HD/EXPORT CHECKPOINT: PENDING. Save Project backup first; refresh, Clear/new,
  verify actual camera/project resolution, capture fresh frames and compare the export.
  Existing lower-resolution originals cannot regain missing detail.
- Stage 4B remains NOT STARTED. This update changes ONLY STOPMOTION_CHANGELOG.md.
  All source/tests remain FROZEN; stop work pending the user checkpoint/reviewer direction.

### SM-047 — Short-animation VLC compatibility investigation authorized

- User requests an export-side repair without changing project frames, holds, fps,
  visible sequence, duration or audio sync. Stage 4B remains deferred. Original
  C:/Users/master/Videos/Test3.webm is read-only; diagnostic media go to test-results.
- Prior read-only evidence: Test3 is 192263 bytes, six VP8 keyframes, 640x480,
  7fps, duration 0.857142s; FFmpeg decodes without warnings. Test/Test2 have 9/21
  encoded frames and durations 1.287s/3s. No missing-frame explanation established.
- Parent controlled VLC 3.0.23 ARM runs: automatic six decoder threads report
  buffer deadlock prevented; identical unmodified file with 1, 2 or 4 threads
  reports no such error. User confirmed all six visibly play with one thread.
  File caching 0/100/300/1000 did not repair it; do not repeat those failed changes.
- Plan: compare conforming duration metadata and same-payload remux variants,
  measuring VLC decoded/displayed output as well as FFmpeg content/timestamps.
  Exit 0 or first-picture logging alone is not success. No player-settings
  workaround, false fps, blank/tail extension or dependency/format change accepted.
- Diagnostic harness/results PENDING. No app repair claimed or accepted yet.

### SM-048 — Diagnostic measurement harness (pending review)

- Added tests/diagnostics/short-webm.mjs: independent EBML variants keep identical
  VP8 packets, FFmpeg decoded hashes, VLC HTTP decoded/displayed counters and
  scene-filter PNG output. Unique ignored artifact directory per run. No app edits.
- Tooling attempts: installed x64 Python cannot load ARM libvlc (WinError 193);
  VLC does not support rc-fake-tty, and rc stdin did not provide playback/counters.
  Refused these harness approaches; localhost-only HTTP stats works. Original
  Test3 measured decoded=1/displayed=0 with six threads and the known deadlock.
- First variant run stopped before VLC: diagnostic parser incorrectly rejected
  the original zero-length integer Timecode. Revised to interpret it as zero.
  This was a harness assumption failure, not an app defect or compatibility fix.
- Duration/remux comparisons and scene-output measurements pending.

### SM-049 — Metadata/remux refused as repair; hidden-packet candidate incomplete

- Test3 same-payload variants: DefaultDuration, BlockDuration, both, minimal
  remux and FFmpeg copy remux all retain the VLC automatic-thread deadlock.
  Refused as standalone repair. Artifact folders: test-results/vlc-short-rhX80Y
  and test-results/vlc-short-TIc7j4. No production muxer changes.
- Six diagnostic non-display copies of the last VP8 packet (show_frame=0,
  Matroska Invisible=1, same last timestamp) remove the deadlock for Test3.
  FFmpeg still decodes exactly six frames, identical ordered frame hashes,
  timestamps 0/143/286/429/571/714ms, Segment Duration 857.142857ms. File grows
  from 192263 to 380933 bytes. This is NOT an accepted fix.
- Scene callbacks repeat images; 8 scene files do not mean 8 source frames.
  VLC counters (13/19 decoded) also do not establish visible-frame completeness.
  Revised harness: tests/diagnostics/vlc-render.ps1 uses installed ARM64
  PowerShell and libvlc display callbacks, saving hashes and optional BGRA data.
  No new runtime dependency. Default automatic decoding retained.
- Direct display output contains source images 1-5, NOT image 6, for both
  Test3 one-thread control and hidden candidate. Pixel matching against FFmpeg
  gives correct-source RGB MAE 0.683-0.707 vs other-source errors >6, confirming
  identity despite decoder colour-conversion differences. This is diagnostic
  evidence, not a contradiction of what the user perceived in manual playback.
- Additional observation after Ended (500ms before releasing player) does not
  recover image 6. Neither 7/12 hidden packets, codec-only visibility signalling,
  timestamps within the last exposure near its end, nor both duration metadata
  fields repair this missing final display in this probe. Preserve these refusals.
- Callback artifacts: test-results/vlc-native-x1ua5T, vlc-drain-cCKJ8E,
  vlc-pixels-JbWxGT. Standards inspected: RFC6386 section9.1 show_frame and
  Matroska visibility/duration definitions. No copied player code in app.

### SM-050 — Bounded diagnostic matrix and encoder controls (not accepted)

- Same-packet diagnostic clips from Test.webm, six hidden packets plus both
  duration fields, default VLC3.0.23 ARM decoding; distinct display image counts:
  7fps: 1/2/5/8 for 1/2/6/9 source frames; 12fps: 1/2/5/8;
  24fps: 1/2/6/9. One-frame cases still report deadlock at all three rates;
  the other nine cases do not. No complete cross-matrix pass claimed.
  Artifacts: test-results/vlc-matrix-jtHjfK/summary.json.
- Independent FFmpeg re-encode controls (new files only): native libvpx VP8
  and lossless VP9, six frames, 857ms VLC duration, both select six decoder
  threads and reproduce deadlock with one distinct displayed picture.
  Artifacts: test-results/vlc-codec-hiY2lI. A codec change is not justified by
  these results; no app format/dependency change made.
- Next bounded verification: app-generated distinct-colour clips, browser
  tail/order checks and longer control. Hidden candidate must not ship on
  no-deadlock logs alone. If adopted later, legacy import must skip non-display
  packets and seek cues must not target them. These app changes are NOT made.

### SM-051 — Reviewer-requested final-exposure subdivision diagnostic

- Hidden-only approach REFUSED for shipping (SM-049/050 incomplete output).
  Parent authorized a bounded alternative: split the final existing exposure
  into eight identical visible VP8 packets, increasing timestamps strictly
  within that exposure, explicit BlockDuration, no false fps metadata or tail.
- Test3: six distinct native VLC display images now observed, no deadlock,
  same 857.142857ms Segment duration. 13 coded packets at 0/143/286/429/571/
  714/732/750/768/786/803/821/839ms. Size 412476 bytes vs original 192263.
- Test2: all seven distinct poses observed (21 original exposures, 28 packets),
  duration 3000ms, size 263381 vs 196342 bytes. Original default VLC probe
  rendered only three distinct poses; longer exports also need investigation.
- One-source-frame clips at 7fps and 24fps: one distinct image rendered each,
  no deadlock, native playback ended; Segment durations 142.857143/41.666667ms
  (VLC length integer 142/41ms). Eight packets each; no new visual pose.
  Artifacts: test-results/vlc-subdivide-fFfQrp. Diagnostic only, NOT accepted.
- Added short-webm-browser.mjs to exercise the actual app encoder with unique
  colour/text canvases, browser seeks/tail, FFmpeg hashes and native VLC output.
  Initial hidden controls: six/21-pose and HD-held examples recover full pose
  counts, but Test3 failure and one-frame deadlock remain; not a hidden repair.
- First subdivision browser matrix stopped on an incorrect baseline assumption:
  one old ONE-frame WebM seek returned black in Chromium; the revised file shows its
  actual red original (255,1,1), same 0.142857s duration. Refused equality to a
  unverified rendered baseline. Revised assertion uses FFmpeg-decoded original
  pixels, original duration/onsets and exact hashes; adds native callback RGB
  order checks. Does not weaken source-content or time preservation criteria.
- App implementation still unchanged. Full candidate matrix/audio pending.

### SM-052 — Subdivision matrix progress and retained browser-check failure

- Actual app encoder, distinct colour/text sources: 12/12 candidate cases passed
  for 1/2/6/9 source poses at each of 7/12/24fps. Assertions check default VLC
  rendered RGB pose order and natural Ended, no deadlock; Chromium pose pixels,
  tail and unchanged duration; exact FFmpeg original hashes plus seven copies
  of ONLY the final image; all original exposure onset timestamps unchanged.
- Combined diagnostic run then exited 1 on a browser source-pixel assertion
  in the 21-pose case; HD case not reached. Not an all-green run. Initial
  harness did not preserve candidate pixel values before assertion failure;
  revised to persist them first. Artifacts: test-results/vlc-app-H7Aomb.
- Read-only replay of the SAME saved 21-pose candidate in a new Chromium page
  showed all 21 correct RGB samples, readyState4, before AND after two render
  ticks. Cause of prior pixel failure remains unproven, not an app fix claim.
  One-frame baseline black was also not reproduced on the next run; do not
  present it as an established export defect.
- Bounded follow-up only for remaining 21-pose/HD cases; explicitly wait two
  rendering ticks after seek for canvas inspection, no retry-until-match.
  This is a measurement precaution, not a proven flakiness repair. Existing
  camera/history test issues unchanged. Audio validation still pending.

### SM-053 — Concrete subdivision proposal; qualified 14-case evidence

- The remaining 21-pose follow-up passed: default VLC renders all 21 poses,
  28 coded packets, Chromium pose/tail samples correct, duration 3s, original
  timestamps and decoded pixel hashes unchanged. Original default VLC had
  rendered only 16 of these 21 app-generated distinct poses.
- HD with holds [1,2,1,3,2,1] at 12fps: six poses/10 original exposures,
  17 coded packets, 0.833333s browser duration; default VLC renders all six
  ordered poses without deadlock and naturally ends. Bytes 29571 -> 53200.
- HD initially failed the cross-decoder <=4 RGB assertion: Chromium original
  AND candidate show identical pixels (e.g. red 255,26,1), whereas FFmpeg shows
  254,0,0. This existing HD colour interpretation difference is NOT a new
  subdivision pixel change. Refused the cross-decoder-equality assumption;
  revised HD check requires exact same-browser old/new pixels plus exact
  FFmpeg frame hashes, onsets, and VLC source-pose identity. No RGB tolerance
  relaxation. Saved-data reanalysis PASSED all these assertions, exit0.
- Evidence totals: 12 short combinations (1/2/6/9 poses x 7/12/24fps) passed
  the original diagnostic assertions; 21-pose follow-up passed; HD saved-data
  reanalysis passed the corrected colour contract. These are 14 verified
  cases across runs/reanalysis, NOT a single clean all-green suite. Both
  prior assertion failures remain recorded. No production e2e run claimed.
  Latest artifacts: test-results/vlc-app-H7Aomb and vlc-app-2j2hdX.
- Two diagnostic JS syntax checks and git diff --check exit0; line-ending
  warnings only. Original Test3 SHA256 unchanged from initial read:
  eb102ae8db8bb1103a7300d3fee95fcf63dea81985f98c872c938a4c5f7a198d.
- PROPOSAL PENDING PARENT APPROVAL: subdivide the final exposure into eight
  identical-image packets inside its original time interval, explicit VFR
  BlockDuration, original pose onsets/total duration/project FPS unchanged.
  Add at most seven last-frame payload copies per export, including longer
  clips because measured tail loss is not confined to <=6 exposures.
  Test3 cost: +220213 bytes (192263 -> 412476) in the minimal diagnostic mux.
- Proposed production gates: preserve audio packets/timestamps and sync;
  app metadata records original exposure count/rate so Import WebM can
  validate and remove transport subdivisions instead of creating extra
  editing frames; correct BlockGroup parsing and valid seek cues; browser
  tail and boundary/hold tests; no hidden packets, new codec or dependency.
  Audio is NOT yet validated. Production source, existing e2e tests and
  README remain unchanged this turn. Diagnostic files/log only changed.
- Stop diagnostic expansion and hand off the proposal. Stage4B not started;
  no shipping fix/acceptance or universal player guarantee claimed.

### SM-054 — Approved bounded candidate integration (pending code review)

- Parent APPROVED the eight-subdivision candidate for minimum-scope integration;
  this accepts the diagnostic strategy with SM-053 qualifications, not a universal
  player guarantee or an all-green suite. Hidden-packet refusals remain intact.
- js/webm.js now writes explicit BlockGroup durations and seven final-image
  copies strictly inside the last original exposure. Segment duration uses the
  original exposure count; existing audio interleaving/path unchanged. Cues target
  original exposures only, with one-based block numbers. No false fps metadata.
- Track Name carries a versioned StopMotion marker (count, interval, eight pieces).
  Import supports BlockGroup and SimpleBlock, checks count, all timestamps/durations
  and exact repeated VP8 bytes BEFORE frame callbacks, then returns only original
  exposures and rate. Corrupt own markers reject rather than inflate the timeline.
  One-frame own imports also receive an explicit rate. No project-format change.
- README documents overhead and pre-compatibility quality table byte measurements.
  Existing timeline timestamp reader now handles BlockGroup, explicitly checks
  360 original onsets plus seven within-exposure transport onsets (367 packets).
- Added one focused export-compat.spec.js test: one/six exposures, native browser
  duration, marker tampering rejection, copy bytes/timestamps and real FFmpeg
  generated Opus audio packet/time preservation. No full suite/matrix authorized.
- Targeted execution/results pending at this entry; no acceptance claimed.

### SM-055 — Focused failure; scoped parent acceptance for silent-video checkpoint

- Focused export-compat.spec.js run: 0 passed, 1 failed, exit 1;
  reported test duration 8.8s (not a performance benchmark). Assertion failed
  at line 79: copiesMatch && audioPreserved && rejected.
- Parent trace review isolated the failure: copiesMatch=true and rejected=true
  for BOTH one- and six-frame cases; audioPreserved=false ONLY for the six-frame
  audio case. Audio compatibility is NOT verified; this failure remains OPEN.
- Parent suspects the existing getAudioBlocks SimpleBlock-only reader ignores
  FFmpeg's final audio BlockGroup. This is a likely pre-existing limitation,
  not a confirmed root cause or repaired behavior. No audio-fix expansion authorized.
- Parent ACCEPTED timing/import source review for a scoped NO-AUDIO user
  checkpoint. This is not acceptance of audio compatibility, a passing focused
  test, a full-suite pass, or a universal player guarantee. User checkpoint pending.
- Failure trace retained at test-results/export-compat-short-export-3572f-own-import-and-Opus-packets/trace.zip.
  Parent plans separate brief silent-case verification; no result claimed here.
- This update changes ONLY this log. App/test files remain FROZEN; no further
  tests or implementation performed. Stage4B remains deferred.

### SM-056 — User accepted short-video checkpoint; scoped audio repair

- User confirmed the short VLC export fix works. USER ACCEPTED for that reported
  checkpoint only; no additional device measurements inferred. SM-055 audio
  failure remains the baseline: 0 passed/1 failed, 8.8s test duration.
- Stage A authorized: getAudioBlocks previously visited only SimpleBlock, dropping
  FFmpeg's final audio BlockGroup. Now retain whole audio groups (including
  DiscardPadding/BlockDuration), track codec metadata, and signed relative times.
  Renumber/update an owned copy, never the input audio buffer. SimpleBlock remains
  supported; no codec/dependency change. js/webm.js only production module changed.
- Focused test will separately assert copies, rejection, packet/group attributes,
  CodecDelay and input immutability, plus actual decoded PCM duration/content.
  One run and at most one correction authorized; results PENDING REVIEW.
- Stage B assessment only for now: full canvas use is synchronous across preview,
  playback, capture, project restore and export; bounded decoded records require
  coordinated async changes. Do not raise the 128MiPixel guard or claim bounded
  memory from a smaller optimization. Scope proposal follows Stage A handoff.

### SM-057 — Audio repair focused evidence and memory scope handoff

- First focused run reports the single export-compat test PASSED, test duration
  9.9s. No correction/retry, broad suite, new VLC matrix or dependency installation.
  Runner final exit is recorded separately below when available.
- Measured six-frame audio result: 16 packets retained, one DiscardPadding group;
  14400 decoded mono float32 samples at 48000Hz = 0.300000 seconds. Source/export
  PCM is bit-identical; SHA256 a9f30ee5375156d07b17a8c281bda307ec9027b3291c1e63cda2a7172b8d809f.
- Separate assertions passed for packet payloads/timestamps/group attributes,
  CodecDelay/codec metadata, unchanged source recording bytes, one/six-frame
  import counts/rates, durations, subdivision copies and invalid-marker rejection.
  Prior SM-055 failure remains as refused initial behavior, now revised in SM-056.
- js/webm.js and export-compat.spec.js syntax checks exit0; git diff --check
  exit0 (line-ending warnings only). README records scoped audio behavior.
  PENDING PARENT REVIEW; not a broad audio/browser/device guarantee.
- Stage B NOT implemented. Existing PNG blob cache already avoids repeated PNG
  encoding, but active frames/history still retain full canvases. Replacing them
  with PNG records plus a bounded decoded cache requires coordinated asynchronous
  preview, playback, export and restore changes across animator/project/timeline.
- Recommended smaller first step: defer eager WebP encoding until export and
  reuse thumbnail canvases across timeline metadata edits. Measure encoding/draw
  call counts and verify export/undo/restore. This reduces redundant work and
  compressed-media allocation, NOT full-size decoded-frame residency; keep the
  128MiPixel guard and do not claim longer maximum animations/cache solved.
- Stage A changes this turn: js/webm.js, tests/e2e/export-compat.spec.js,
  README.md and this log. Freeze source/tests at handoff for parent review.
- Final runner result: 1 passed, 0 failed, exit0; reported suite wall time 1.2m
  (test itself 9.9s). Wall time is not a performance benchmark. Runner finished;
  no concurrent test remains. All source/tests now FROZEN pending review.

### SM-058 — Independent audio acceptance; minimal memory increment authorized

- Parent independent Stage A test PASSED, 12.7s test time: 16 packets, one padding
  group, 14400 samples/0.3s; PCM SHA256 matches SM-057. Parent ACCEPTED audio source
  review. Runner teardown/port release pending at report; no concurrent tests run.
- Stage B scope: replace eager capture/restore encodings with lazy thenable handles
  so existing history/duplicate arrays retain compatibility but not encoded blobs.
  Export consumes handles sequentially from immutable canvases. Legacy import also
  retains a lazy handle instead of an extra compressed source copy.
- Reduced the initial multi-entry cache draft before testing to a single-entry
  compressed cache capped at 16MiB; no cache framework or dependency. In-flight
  requests for the same canvas share work. Identity keys do not retain canvases.
  This bounds only retained compressed cache, not export output/in-flight buffers.
- Timeline caches 96x72 thumbnail pixels per immutable frame and reuses active
  DOM nodes; duplicate positions get distinct nodes, handlers/labels are refreshed.
- Full-size frames/history remain canvas-backed; PNG save and all resolution/pixel
  limits unchanged. No claim of longer maximum animations or bounded decoded memory.
  Two focused tests pending; wait for parent port release. Stage A source/test frozen.

### SM-059 — Minimal memory increment focused results (pending review)

- Parent Stage A runner completed: 1 passed, exit0, suite1.7m; test12.7s.
  Port4173 explicitly released before the Stage B run. No concurrent suite.
- Parent caught promise-name shadowing in the early multi-entry draft. That draft
  was replaced before testing by the single-entry implementation using `result`;
  no TDZ path remains. Refused draft retained in this history; no failed test rerun.
- Two Stage B cases PASSED on first run: lazy capture/recovery/export 13.5s;
  thumbnail duplicate/edit/undo 13.2s. Runner final exit recorded separately below.
- Measured capture of three frames and reload recovery: ZERO WebP encode calls
  before export. Export: exactly 3 calls, all three VP8 payload SHA256 hashes match
  independent re-encoding of recovered immutable originals. Cache afterward:
  1 entry, 570 bytes, 16777216-byte cap, zero in-flight work. This test does not
  stress oversized blobs; the size cap is also statically enforced before retention.
- Thumbnail evidence: 3 initial full-frame-to-thumbnail draws; duplicate/move/
  hold-edit/three Undos add ZERO such draws, only 1 new canvas for the duplicate
  DOM position, correct RGB order throughout, distinct duplicate nodes and shared
  lazy history handles. WebP encode calls remain ZERO during these editing actions.
- Before-change behavior (static, not a timing measurement): capture/restore
  eagerly called the WebP encoder per frame; each render allocated and redrew
  every thumbnail. After-change call/allocation counts above are measured.
- Syntax: media/animator/project/timeline and new memory-increment.spec.js exit0;
  git diff --check exit0 (line-ending warnings only). No broad suite run.
- Stage B files: js/media.js, js/animator.js, js/project.js, js/timeline.js,
  tests/e2e/memory-increment.spec.js, README.md, this log. Accepted Stage A
  js/webm.js/export-compat.spec.js unchanged during B.
- Full-size canvases, PNG originals and history remain resident; export buffers
  can still grow. NOT a bounded decoded cache, not a lift of 128MiPixels/145
  720p-frame limit. Larger architectural Stage4B remains deferred.
- PENDING PARENT REVIEW. Freeze source/tests at handoff; no further expansion.
- Final Stage B runner: 2 passed, 0 failed, exit0, reported suite wall time1.2m
  (not a speed benchmark). Runner ended; port available. Source/tests now FROZEN.

### SM-060 — Parent accepted small memory increment; user checkpoint pending

- Parent ACCEPTED code review and independent focused cases: both passed,
  test durations 12.2s and 12.6s. Parent runner teardown remains PENDING;
  no independent final exit code or suite wall time claimed yet.
- Independent measurements: 0 pre-export WebP encodes, 3 export encodes,
  all 3 original frame payloads match; compressed cache 570 bytes, 1 entry,
  16MiB cap. Thumbnails: 3 unique source draws, 0 edit full-source draws,
  1 additional duplicate DOM node, 0 WebP encodes during editing.
- Parent syntax checks for five modules and git diff --check passed.
  Full-resolution memory/frame limits remain unchanged; larger PNG-backed
  frame store and bounded decoded cache are DEFERRED, not implemented.
- USER CHECKPOINT PENDING: record audio and export; verify normal capture,
  timeline editing and reload recovery. No physical-device result inferred.
- Log-only update. All source/test files remain FROZEN; no extra work performed.
- Parent runner subsequently completed: 2 passed, 0 failed, exit0; reported
  suite wall time 1.3m (not a performance benchmark). Teardown is complete.
  User checkpoint remains pending; source/tests remain frozen. Stop work.

### SM-061 — User accepted audio/memory increment; 700-frame migration in progress

- User confirmed the prior audio and memory increment works. USER ACCEPTED;
  no device measurements inferred. New implementation explicitly authorized.
- Before (static): 720p capture retained full-size canvases and stopped at 145
  frames under the 128 MiPixel total guard. Initial frame-store patch failed
  atomically on script-tag context; no source changes from that attempt.
- Implementing immutable PNG records, eight-image/16 MiPixel decoded cache,
  sequential capture/recovery/export and one-active/one-latest autosave. Retain
  2,000 frames, 24,000 exposures, axis/per-frame limits; compressed/file limit
  becomes 512 MiB. Quotas/export output/portable serialization remain separate.
- PENDING REVIEW and focused 700-frame measurements; no claimed result yet.

### SM-062 — PNG records, asynchronous consumers and bounded autosave (pending review)

- Added js/frame-store.js: immutable PNG/96x72-thumbnail records, serial decoded
  leases, LRU maximum eight images/16 MiPixels, close on eviction/replacement.
  Sequential PNG recovery validation temporarily decodes one image outside that
  cache; cache metrics are NOT whole-browser memory measurements.
- Capture compresses one image in flight, refuses concurrent capture, checks
  compressed bytes before allocation and again before committing the PNG, releases
  its temporary canvas in finally. Duplicate checks prospective compressed bytes.
- Animator draw generations prevent stale per-context selection/clear paints;
  playback and export observe cancellation. Export remains sequential and rejects
  cancelled leases explicitly. Legacy import converts images sequentially into PNG
  records. Timeline/history share records and retain distinct duplicate DOM nodes.
- Autosave snapshots immutable blobs/settings synchronously and coalesces to one
  active transaction plus one latest pending snapshot; recovery protection retained.
- Media, animator, project, timeline, main, index and README updated. Focused tests
  added for 700 distinct textured HD captures/recovery/export plus cancellation,
  duplicate/undo/redo, portable save/open, budget guards and autosave coalescing.
  Existing canvas-inspection test helpers migrate to explicit PNG decoding.
- 512 MiB is a compressed-media/file guard, NOT a guarantee of 700 arbitrary noisy
  frames. Full-resolution capture/encoder temporaries, PNGs, thumbnails, history,
  recovery validation and output serialization have separate memory costs.
- Tests/results pending below. No VLC/audio muxer changes or dependency changes.

### SM-063 — First focused batch refused: fixture setup race; one correction

- First batch: 0 passed / 2 failed, exit1. The 700-frame case failed before capture
  with play() AbortError: late initial enumerateDevices detached its canvas stream.
  Safety case reached edit/coalescing/portable work but later capture was refused
  after the same late detach; its delayed-PNG release callback was never installed.
  This is fixture setup evidence, NOT a successful 700-frame measurement.
- Correction: fixture supplies immediate deterministic empty enumeration as well
  as its controlled canvas stream. No fake-camera retries or timeout increases.
- Six production modules plus new focused test passed node --check; git diff
  --check exit0, line-ending warnings only. Correction run will use a separate
  output directory to retain first-run diagnostic traces and final artifacts.

### SM-064 — Correction run: safety passed; 700-frame fixture exceeds byte budget

- Corrected focused batch completed: 1 passed / 1 failed, exit1; reported suite
  wall time 1.4m (not a performance benchmark). No full suite/VLC matrix run.
- The textured/noise/gradient canvas-video fixture successfully committed 352
  distinct capture attempts at 1280x720, then rejected index352 (frame353):
  `Capture failed: 512 MiB compressed media limit reached. No frame added.`
  Hash uniqueness across 700, 700-frame recovery/export/tail/cache peak metrics
  were NOT reached. No claim of verified 700-frame operation. Approximate 1.5MiB
  per PNG is inferred from the budget/stop point, not an exact byte measurement.
- Safety case PASSED: duplicate and undo/redo preserve shared record identity;
  117 successive FPS changes write only [4,120], with active1/pending1; portable
  Save/Clear/Open restores two frames and FPS120. Delayed decode followed by Clear
  leaves transparent [0,0,0,0] pixels; delayed capture rejects the second request,
  disables Capture and appends zero frames after Clear; busy resets false.
  Simulated over-budget duplicate and capture both refused.
- First-run failures and corrected artifacts retained in separate directories.
  Success-path test writes RESULT.json, exported WebM and exact timings/PNG byte
  averages, but those outputs cannot be claimed because this fixture failed early.
- Requested one correction allowance exhausted. Source/tests FROZEN for review;
  no further runs or changes. Remaining verification blocker: a moderate-complexity
  distinct HD fixture that fits 512MiB (and portable base64 overhead), or explicit
  review of a changed product budget. No silent lossy encoding or guard increase.

### SM-065 — Parent rejects 352-frame result; authorizes binary v2 / 2 GiB completion

- Parent REFUSED 352 frames as completion. Same textured fixture MUST remain;
  simplification is not accepted. Parent explicitly authorized 2 GiB compressed
  media and a minimal binary v2 portable container, retaining v1 JSON loading.
- Added STOPMOT2 magic + uint32 little-endian metadata byte length + bounded JSON
  (maximum 1 MiB) with PNG/audio size/type descriptors + concatenated Blob parts.
  No base64 conversion or giant JSON payload on v2 Save/Open; no dependencies.
- Reader validates safe positive integer sizes, MIME, count/settings/holds,
  aggregate <=2 GiB and exact end BEFORE any PNG validation. Blob.slice retains
  individual payloads; PNG validation remains sequential. IndexedDB schema remains
  compatible. Legacy JSON guard stays 512 MiB; legacy WebM whole-buffer import
  separately stays 512 MiB. Displayed capture/project/duplicate guards updated.
- Unchanged 700-frame texture/capture loop will run ONCE, plus small safety case
  with actual playback completion and binary malformed/v1 migration case.
  Large portable round-trip uses download path/upload path, NOT Node readFile.
  Phased RESULT.json captures measured evidence even if a later stage fails.
- Existing small download tests now use an independent test-only binary reader;
  timeline pending-write expectation matches coalescing first/latest snapshots.
  PENDING results and parent review. No broad suite or VLC matrix authorized/run.

### SM-066 — Binary v2 batch: 700 captures verified; large autosave/recovery FAILED

- Authorized single batch finished: 2 passed / 1 failed, exit1, reported suite
  wall time 4.7m (not a performance benchmark). Source/tests FROZEN; no rerun.
- SAME textured 1280x720 fixture captured 700 unique PNG SHA256 values; zero
  retained full-size canvas frames and zero pre-export WebP encodes. PNG total
  1,067,355,713 bytes; average 1,524,793.8757142858 bytes/frame. Capture plus final
  autosave settlement: 97,473.5ms. This is measured on this host, not a device guarantee.
- Decoded cache peak: 8 images / 7,372,800 pixels; 692 evictions closed after
  capture. Limit: 8 images / 16,777,216 pixels. These are cache counters, NOT total
  process memory measurements; PNGs, thumbnails, browser storage and temporaries
  are separate. The 700-frame fixture fits the new 2 GiB compressed budget.
- FAILED recovery: reload returned 355 frames, not 700. Existing trace confirms
  pre-reload status `Autosave failed:  Last saved project retained. Save Project
  or Retry autosave after resolving the error.` Error.message was empty; error
  name/storage quota was not captured, so cause is NOT proven. No quota diagnosis
  or successful large autosave claimed. Last stored snapshot was retained.
- 700-frame portable round-trip/export/ffprobe/tail stages were NOT reached.
  No complete 700-frame portable artifact exists to resume from. Capture metrics
  survive in test-results/large-project-v2/large-project-700-distinct-078d2--with-bounded-decoded-cache/RESULT.json.
  First trace read occurred before teardown wrote trace.zip; later read succeeded.
- Small safety PASSED: shared duplicate/undo/redo identity, coalesced writes [4,120]
  with active1/pending1, binary Save/Clear/Open two frames/FPS120, actual two-frame
  playback completion at12fps, stale-draw/capture cancellation, byte-budget guards.
- Binary malformed/v1 case PASSED: 11 malformed inputs rejected while preserving
  current frame identity, ZERO PNG-validation calls before rejection; valid legacy
  v1 JSON opens one frame with default hold1 and one PNG-validation call.
- Syntax checks for frame-store/project/animator/main/timeline, new focused test
  and small test reader passed; git diff --check exit0 (line-ending warnings only).
- Completion remains REFUSED/PENDING REVIEW due large autosave failure. No claim
  of working 700-frame persistence/export. No automatic recapture, timeout change,
  fixture simplification, broader tests, dependency or VLC/audio muxer changes.

### SM-067 — Narrow quota diagnosis authorized; no automatic 700 recapture

- Parent authorized a fresh isolated browser quota/IndexedDB-error probe, not a
  camera fixture rerun for diagnosis. Probe uses repeated references to one 1MiB
  Blob to request just beyond the natural quota, only when quota <=~1.1GiB.
  It records navigator.storage.estimate, exception name/message and retained data.
- Production autosave error now uses message || name || String(error), including
  optional access so a missing/blank exception message cannot erase the cause.
- A new 700 run is conditional on quota evidence. If confirmed, only the test
  browser gets a 4GiB CDP quota; production storage policy remains unchanged.
  Portable backup must be saved BEFORE reload and autosave status asserted.
- Diagnostic results pending; no 700 capture started for this authorization yet.

### SM-068 — Isolated diagnostics do NOT establish low origin quota; 700 rerun withheld

- Initial isolated probe: 1 passed, exit0, suite4.4s. Natural storage estimate:
  quota 3,221,299,200 bytes, usage 73,728 bytes (IndexedDB). The conditional
  <=~1.1GiB over-quota write was skipped because the observed quota is about3GiB.
- One narrow follow-up, without camera frames: a 629,145,600-byte composite Blob
  referencing one repeated 1MiB chunk was accepted by IndexedDB. Failure=null;
  stored Blob.size=629,145,600. Final estimate: quota3,226,546,176, usage5,320,704.
  The low usage indicates shared backing/storage accounting; this does NOT prove
  600MiB of unique camera data fits or identify the original failed transaction.
  Follow-up: 1 passed, exit0, suite3.8s; no broad suite or 700 recapture.
- Production blank-message fallback separately verified using an explicitly
  injected blank-message DOMException: visible `Autosave failed: QuotaExceededError`.
  That QuotaExceededError is SYNTHETIC, not the large-write diagnostic outcome.
  The original 700-run IndexedDB failure name remains unknown.
- Evidence: test-results/quota-probe/storage-quota-probe-isolat-c5912--IndexedDB-failure-identity/QUOTA.json
  and test-results/quota-blob-probe/storage-quota-probe-isolat-c5912--IndexedDB-failure-identity/QUOTA.json.
  No test quota override applied: the
  parent's prerequisite of confirmed low quota was NOT established.
- STOP before any 700 rerun, as requested. Autosave error fallback and diagnostic
  source/tests frozen for review; 700 recovery/portable/export remains unverified.

### SM-069 — User resumed narrow save/recovery diagnosis

- User explicitly resumed after the stop. Shared-Blob evidence is insufficient;
  it is not reused as proof of unique-data capacity. No test quota override.
- New isolated diagnostic makes distinct random 1,525,000-byte Blobs, drives the
  existing one-active/one-latest project autosave every100ms, stops after the
  first write failure, and records name/message/cause/estimate plus last durable
  frame count. No PNG capture/decode, speculative storage rewrite or broad suite.
- Initial combined patch failed atomically on log context; reapplied correctly.
  Pending actual evidence before any persistent comparison or storage fix.

### SM-070 — Distinct incognito blobs reproduce QuotaExceededError below advertised quota

- Diagnostic completed: 1 passed, exit0, suite41.3s. Actual first failing
  transaction: QuotaExceededError, empty message, cause=null; 314 frames /
  478,850,000 bytes. Loop stopped at324 generated /494,100,000 bytes,123 writes;
  last successful snapshot306 frames, same306 read back. Diagnostic elapsed35,498.5ms.
- Natural estimate quota3,221,299,200 /usage73,728. At failure quota3,701,030,912 /
  usage479,805,440. Thus failure is NOT exhaustion of the advertised origin quota.
  Browser-private Blob/backing-store limits are suspected, not yet proven.
- Evidence authorizes same distinct-blob comparison in a fresh disk-backed
  persistent Chromium context, no quota override and no production rewrite.
  Output/profile isolated in test-results; persistent result pending.

### SM-071 — Persistent distinct-blob comparison succeeds; final image flow authorized

- Same distinct-Blob diagnostic in fresh persistent Chromium: 1 passed, exit0,
  suite1.5m. Generated700, wrote169 snapshots, lastGood700, readback700, failure=null;
  1,067,500,000 logical bytes, elapsed84,507.4ms. Natural quota10,737,419,341 /
  usage1,101; final quota11,810,397,785 /usage1,072,979,545. No quota override.
- Comparison supports a private-context storage limitation rather than a generic
  inability of the existing autosave to retain this workload. It does NOT prove
  the browser's internal failure mechanism. No individually keyed Blob rewrite
  is justified/implemented by this evidence. Private-context capacity is not fixed.
- README now records the limitation and normal-window/download-backup guidance.
  Previously added error-name fallback exposes the failure instead of blank text.
- Final unchanged textured-image flow now runs in a fresh persistent context,
  saves binary backup + HASHES.json BEFORE checking autosave status or reloading,
  and retains phased RESULT.json. Same300s timeout, no quota override, no broad
  suite or VLC matrix. Pending actual recovery/portable/export evidence.

### SM-072 — Parent accepted persistent diagnostic; student-facing quota warning

- Parent ACCEPTED the persistent distinct-blob diagnostic (700 /1.0675GB
  readback, no failure); final image flow remains pending, not accepted yet.
- Parent requested minimal production feedback: QuotaExceededError now plainly
  says browser storage limit reached, Save Project NOW before closing/reloading,
  use a normal (non-private) window with available storage for large projects,
  and that the last saved project is retained. Does not attribute every quota
  failure to private mode. Generic failures retain message/name/string fallback.
- Diagnostic assertion updated to check the friendly warning. No storage
  architecture change or new feature; final image run continues separately.

### SM-073 — Real 700-frame persistence passes; export Promise-return defect revised

- Persistent image run captured700 unique textured1280x720 PNGs totaling
  1,067,355,713 bytes, average1,524,793.8757142858; capture+autosave160,695.3ms.
  Cache peak8 images/7,372,800pixels,692 closed evictions; no quota override.
- Saved binary backup BEFORE reload:1,067,382,478bytes in7,381ms plus HASHES.json.
  Autosave status asserted Saved. Reload recovered all700 original PNG hashes,
  order/FPS24/thumbnails in11,459ms. Clear/Open binary restored all700 hashes
  exactly; open+validation+autosave/hash checks18,673ms. Persistence evidence passed.
- Run nevertheless FAILED export, exit1: guarded lazy thenable in Animator.encode
  omitted `return`, so muxer's `.then(...).catch(...)` received undefined. This
  initial export revision is REFUSED. Fixed only the missing Promise return;
  generation cancellation and sequential image encoding remain unchanged.
- A resume-only targeted case opens the EXISTING saved binary path and verifies
  its HASHES.json, then exports/checks timestamps/tail/cache. No recapture, no
  storage redesign or quota override. Final export evidence pending.

### SM-074 — Existing large-export EBML boundary defect proven and minimally fixed

- First resumed export completed but ffprobe found0 packets/invalid EBML;
  test failed exit1. Original271,508,174-byte export retained unchanged.
- Read-only inspection identified wrong five-byte size prefix0x80 at offsets40
  (Segment length271,508,129) and938 (Cluster length271,507,231). Both exceed
  four-byte finite VINT maximum268,435,454. Parent independently identified the
  same encodeLength branch. This is an existing large-container bug, NOT quota.
- Diagnostic COPY changed only those two prefix bytes to0x08. ffprobe then found
  707 packets,1280x720,duration29.166666s. Source artifact never overwritten.
  Evidence/copy: test-results/large-ebml-length/corrected-lengths.webm[.json].
- Independent Node boundary test BEFORE fix:1pass/2fail,exit1,247.5083ms;
  values268435454 passed,268435455 and4294967295 failed with128 instead of8.
- Production fix: only0x80->0x08 in that five-byte branch. Boundary rerun and
  real export resumed from existing PNG backup next; NO camera recapture.

### SM-075 — Boundary regression green; fresh export timed out; no automatic rerun

- After one-byte muxer fix, Node boundary regression3passed/0failed,exit0,
  277.8711ms. Animator/project/webm syntax and git diff --check passed (line-ending
  warnings only). No broad suite/VLC matrix. Original failed export is preserved.
- Fixed-source export-only run reopened the existing binary backup and verified
  all700 PNG hashes in43,198ms. Then it exceeded the180,000ms test timeout while
  awaiting Animator.save; runner exit1,0passed/1failed. No completed fresh WebM.
  No encode progress counter was captured, so no percentage/stall cause claimed.
- Parent explicitly said not to blindly rerun. No further encode, capture,
  diagnostic or source/test edits. Source/tests FROZEN for review.
- Independently inspectable complete artifact remains the diagnostic copy:
  test-results/large-ebml-length/corrected-lengths.webm,271,508,174bytes,
  707packets,1280x720,29.166666s, changed ONLY the two proven length markers.
  It is NOT mislabeled as a fresh production export. Native tail-color check
  was not reached by the fresh run; earlier save/recovery/hash evidence remains.
- Full portable backup and HASHES.json remain in test-results/large-project-persistent/
  large-project-700-distinct-078d2--with-bounded-decoded-cache/. No user data or
  server4174 touched; all changes remain uncommitted. Final export acceptance
  remains pending parent review; no universal/private-mode autosave fix claimed.

### SM-076 — Fresh production container verification PASSED; source/tests frozen

- Parent explicitly authorized one focused NodeVM remux using existing encoded
  payloads; no image re-encoding or camera recapture. Loaded real js/media.js and
  js/webm.js. Production decode returned700 WebP-wrapped VP8 exposures,1280x720,
  FPS24; production encode consumed resolved Blob promises. Image encodeFrame was
  replaced by a throwing guard to ensure zero image re-encoding in this check.
- Fresh production output: test-results/production-remux/production-remux.webm,
  271,508,193bytes (>four-byte EBML size threshold),707 packets,1280x720,
  duration29.166666s. This is generated by fixed production code, NOT byte-patched.
  All707 packet SHA256 hashes, timestamps and packet durations exactly match the
  input artifact. First700 onset timestamps have maximum error0.33333333333575865ms.
- Native FFmpeg tail decode versus final PNG read directly from the binary backup:
  original RGB[244,37,63], output[244,36,63], maximum error1 across the sampled2x2
  region. Read only bounded metadata/finalPNG from the1.07GB project, not its whole
  contents. Original WebM, diagnostic copy and portable backup left unchanged.
- Focused script exit0, command wall5.4086824s; production decode/remux/write2,331.0055ms
  on this host (not a general performance benchmark). Evidence in
  test-results/production-remux/RESULT.json; extracted original last PNG beside it.
- Distinction retained: this validates the LARGE CONTAINER FIX with reused encoded
  VP8 payloads. Fresh PNG-to-VP8 export exceeded the180s test deadline; that timeout
  is neither a completed fresh-encode test nor proof the encoder cannot finish.
  700-frame capture, autosave/reload and binary round-trip were independently
  hash-verified in the earlier persistent run. Private-mode capacity is NOT fixed.
- Prior parent diagnostic acceptances remain; focused muxer verification PASSED,
  final source/artifact acceptance reserved for parent review. All source/tests
  now FROZEN. No broader tests, quota overrides, commits or pushes. No active
  commands; user server4174 untouched. Preserve artifacts by using a separate
  output directory for any subsequent independent test run.

### SM-077 — Final parent review ACCEPTED scoped fixes with documented limits

- Parent ACCEPTED the scoped fixes. Independent ffprobe of production-remux.webm:
  1280x720,707 packets,29.166666s,271,508,193bytes. Parent syntax checks for
  webm/animator/project and git diff --check passed.
- Accepted verification scope:700 PNG captures, autosave/reload and binary
  Save/Open with exact PNG/order hashes in a persistent browser context;
  fresh large-container production muxing verified using existing VP8 payloads.
- Explicit limits retained: complete fresh PNG-to-VP8 export timed out at180s;
  its completion/duration remains unverified. The remux is not presented as a
  completed fresh image-encoding run. Private-context storage limits remain;
  normal-window success does not guarantee quota/capacity on every device.
- Log-only acceptance update. No other edits or tests. Source/tests remain
  FROZEN, changes uncommitted, no active commands. Stop work.

### SM-078 — Large-export completion, timing, and encode-concurrency speedup

- Purpose: prove one uninterrupted fresh export of the existing 700-frame project,
  then reduce the measured export time. No frames, holds, fps, image quality, codec or
  container-format changes were authorized or made.
- Completion proof (visible non-private persistent Chromium, agreed 600s ceiling,
  normal Open Project then Export Video/Export WebM controls, existing backup reused
  via a byte-identical copy; no recapture, manual repair or payload reuse): opened
  700 frames at 24fps with all 700 original PNG SHA-256 hashes equal to the saved
  manifest. Export completed with no export error and no page/console/unhandled errors
  (one benign /favicon.ico 404); responsiveness never froze. Actual start-to-download
  times on this host across three fresh runs of the same originals: 150.4s, 209.6s,
  240.6s; longest fully-saved run 244.9s.
- Finished-movie verification (fresh file, SHA256 b44679ca...): 271,508,174bytes,
  707packets, 1280x720, 29.166666s; first 700 onsets at i/24 (max error 1.8e-12ms),
  packet durations within 1ms; the 7 final-exposure copies are byte-identical to
  packet699. All 700 decoded originals vs export (320x180, same decoder): per-frame
  MAE1.35-1.46 and 1398/1398 neighbour-order wins; first/middle/last PSNR
  40.78/41.70/40.94dB. VLC3.0.23 ARM automatic threads: Ended,29166ms, 700 distinct
  pictures, 0lostpictures, demuxcorrupted0, no deadlock/error logged. Chromium played
  the exported blob (readyState4) and seeked to 29.147s.
- Measured bottleneck (24 real frames, test-only probe): PNG decode/draw ~20ms/frame;
  sequential quality-0.98 WebP encode ~178ms/frame; concurrency speedup 1.97x/3.63x/
  4.99x/5.14x at 2/4/8/10 in flight. Two locks serialized all work: stopFrames.use held
  its global decode queue across the entire toBlob, and the muxer awaited one frame
  before starting the next.
- Revision (scheduling only; each frame encoded once at the same quality): js/media.js
  releases the decode lease after drawing and runs the WebP encode off the queue;
  js/animator.js encodes up to min(8,hardwareConcurrency) frames in flight and stops
  scheduling after the first failure. Mux consumption order, hold expansion,
  cancellation checks, quality, codec and container remain unchanged.
- Measured after: start-to-download 28.0-28.8s and fully-saved 31.4-32.1s (~7.6-8.4x
  faster); worst 200ms-heartbeat gap fell from 505ms to 231ms. Output is byte-identical
  to the pre-change verified movie (same SHA256 b44679ca...), so all order/quality/VLC
  results carry over. encodeFrame calls 700 (the 7 final copies reuse the cache; 707
  packets still written).
- Regression suite: 59 tests, 54 passed/4 failed/1 skipped (resume-export skipped; env
  unset). Failures classified; none on the changed export path:
  (a) large-project 700 in incognito hit the known private-context QuotaExceededError
  (needs the persistent non-private context per SM-070/071);
  (b) memory-increment thumbnail reuse failed in fixture setup before any export code
  (play() AbortError / requestVideoFrameCallback stall; spec omits the deterministic
  enumerateDevices stub noted in SM-063);
  (c) timeline delayed-invalid stalls window.createImageBitmap on purpose while its own
  pixels()/testFrameCanvas helper decodes via createImageBitmap, so it hangs on that
  helper (introduced with the SM-062 PNG-record helper migration, before this change);
  (d) timeline history-50 was a concurrent-load timeout and passed alone in 12.5s.
  Directly affected suites passed: export-compat (audio PCM SHA256 unchanged), quality
  (exact SM-039/040 metrics reproduced) and memory lazy-encode counts.
- Test-only files added: tests/e2e/large-export.spec.js, tests/e2e/export-benchmark.spec.js,
  tests/diagnostics/verify-large-export.mjs, tests/diagnostics/vlc-render-bounded.ps1.
  Product files changed: js/media.js, js/animator.js. No dependencies, commits or pushes;
  original saved project and test-results artifacts left unchanged.
- Decision: PENDING PARENT REVIEW. Source/tests uncommitted; prior frozen scope is
  superseded only by this authorized performance change.

### SM-079 — Cross-platform portability assessment, audio-removal decision, iPadOS-15 plan

- Requirement recorded: run on Windows, macOS, Chromebook and iPad (iPads primary),
  capture HD, export as fast as practical, "works on anything"; user decided audio is
  not needed (kids add audio later in Canva).
- Assessment (code + current browser-support data; no product code changed this entry):
  - Video export currently requires `canvas.toBlob('image/webp')` VP8 encoding
    (js/media.js). Implemented by Blink (Windows/Mac/Chromebook/Android Chrome, Edge)
    and Gecko (Firefox 96+); NOT implemented by WebKit. Chrome/Edge/Firefox on iPadOS
    all use WebKit, so export fails on every iPad browser.
  - Audio recording requires `MediaRecorder('audio/webm;codecs=opus')` (js/animator.js),
    supported by Blink only.
  - iPadOS 15.x has no WebCodecs (Safari 16.4+), no WebM/VP8 encode or playback
    (iPadOS 17.4+), and no canvas WebP. Its only native video encoder is
    `MediaRecorder('video/mp4')` (H.264/AAC).
  - Canvas->MediaRecorder is documented unreliable on Safari 15 (WebKit 229611, 230613,
    181663: blank/black/frozen video) and still buggy on iPadOS 26 (WebKit 315091).
  - `getUserMedia` and WebCodecs require a secure (HTTPS) context; the current dev
    server is plain HTTP.
- Decisions (RECORDED; implementation gated on probe results):
  - Remove audio from the app workflow. Keep the project container's `audio` field
    readable-and-ignored on load for backward compatibility rather than breaking v2.
  - Target a single universal output: MP4/H.264. The WebM/VP8 path and its VLC
    final-exposure subdivision are not extended; MP4/H.264 needs no repeated-packet
    compatibility hack because it plays in VLC and every browser.
  - Encoder strategy: WebCodecs H.264 where available; on iPadOS <16.4 either
    MediaRecorder MP4 (only if a real-device probe proves non-blank video) or a WASM
    x264 -> MP4 fallback. Decide from measured probe data, not assumption.
  - Any camera/encode feature requires HTTPS deployment.
- Not to be repeated (already refused/closed): WebKit canvas WebP encoding cannot be
  enabled; hidden-packet and final-exposure subdivision are WebM-specific and closed;
  no false-fps, bitrate-fudging or blank/tail pixel-regeneration workarounds.
- Probe prepared (test-only): tests/diagnostics/device-probe.html reports environment,
  MediaRecorder mime support, canvas WebP result, WebCodecs presence, and whether
  canvas->MediaRecorder yields non-blank, content-varying video at 1280x720 and
  640x480. Intended to be opened on one real iPad via the existing static server.
- Desktop half of the probe can be exercised with Playwright Chromium/Firefox/WebKit.
- Status: ASSESSMENT + DECISIONS RECORDED; probe NOT yet run on hardware; no product
  code changed for portability. Awaiting iPad probe results and parent direction.

### SM-080 — Device probe built and validated on Chromium

- Added test-only tests/diagnostics/device-probe.html (environment/capability report,
  canvas WebP result, MediaRecorder mime support, and canvas->MediaRecorder non-blank
  checks at 1280x720 and 640x480) and tests/e2e/device-probe.spec.js to drive it.
- Measured, Playwright Chromium 153.0.8010.12 (Windows, 10 cores, 16GB):
  - canvas.toBlob('image/webp',0.98) -> image/webp, 570 bytes (WebP encode available).
  - MediaRecorder supports video/mp4;codecs=avc1 and video/webm;codecs=vp8; canvas->
    MediaRecorder at 1280x720 produced video/mp4 (avc1.420020), 355,971 bytes,
    duration 3.057s, non-blank, content varies across sampled frames; draw rate ~23.8fps.
  - Same at 640x480: 224,191 bytes, duration 3.059s, non-blank, content varies.
- Not measured (Playwright browsers not installed for @playwright/test 1.63.0; needs
  firefox-1543 and webkit-2359, only chromium-1243 present): Firefox and WebKit desktop
  runs. `npx playwright install firefox webkit` required before desktop cross-engine runs.
- Status: probe validated on Chromium only; real-iPad run PENDING (user can run it).
  This entry is measurement/harness only; no product code changed.

### SM-081 — Audio feature removed completely (user decision; no backward compatibility)

- Decision: the app is unpublished, so audio was removed with no legacy representation
  kept. The v2 project container no longer carries an audio descriptor/payload.
- Removed (product): index.html Record audio / Clear audio buttons, countdown and
  recording spans, and clear-dialog wording; js/main.js microphone stream, request
  generation, pagehide audio stop, recording-icon/countdown handling, record/clear
  handlers and cancelProjectActivity; js/animator.js audio fields, setAudioSrc,
  recordAudio, clearAudio, audio playback in startPlay/endPlay, audio reset in clear(),
  the encode() audioBuffer path, and audio import in WebM load() (STATE_RECORD too);
  js/project.js audio in snapshot/validateMedia/apply, portable v2 metadata and
  payload, and binary + legacy parse; js/frame-store.js bytes() audio parameter;
  js/timeline.js byte-budget calls; js/storage.js comment.
- Removed (tests): project.spec.js audio persistence / microphone-cancellation cases
  rewritten or trimmed; timeline.spec.js and camera-capture.spec.js microphone tests
  deleted; export-compat.spec.js rewritten without Opus/PCM while KEEPING exposure
  timing, own-import and final-frame-copy assertions; quality.spec.js, large-project.spec.js
  and large-export.spec.js audio/mic fixtures removed; project-file.js helper updated.
  README audio references removed.
- Deliberately NOT removed: js/webm.js still contains an audio-mux branch
  (getAudioBlocks/addAudioBlocks/encodeTrailingAudio/audio track). It is unreachable
  from the app now (encode passes null; decode is called without an audio callback).
  It was left to avoid destabilizing the verified bit-level muxer and will be deleted
  with the MP4 replacement. No product source uses MediaRecorder anymore.
- Measured:
  - Focused suite (project, camera-capture, timeline, quality, export-compat,
    memory-increment, ui): 48 passed / 3 failed of 51. Failures are pre-existing and
    unrelated: memory-increment thumbnail helper (known fixture race), timeline
    delayed-invalid (known test helper that stalls createImageBitmap while its own
    decoder needs it), and the rewritten project test, which failed only in beforeEach
    on native fake-camera startup (readyState 0) and passes 1/1 alone in isolation.
  - Re-ran the full 700-frame export after removal (non-private persistent context,
    existing project): 707 packets, 29.166666s, 1280x720, 271,508,174 bytes,
    SHA256 b44679ca... IDENTICAL to the pre-removal verified export; start-to-save
    37.5s. Audio removal changed no exported pixels.
  - Module syntax checks pass (animator/main/project/frame-store/timeline/storage/webm/media).
- Decision: PENDING PARENT REVIEW. Audio is gone from the app; the dormant WebM audio
  branch is documented above for deletion with the MP4 work.

### SM-082 — Per-capture cost measured; blocking compression identified (no code change)

- Question (user): is compressing every captured frame necessary, and can the shot UX be
  made faster?
- Measured (Playwright Chromium, test-only tests/e2e/capture-cost.spec.js, 1280x720
  textured fixture): canvas.toBlob('image/png') 45.8ms/frame; stopFrames.fromCanvas
  45.3ms/frame (includes the 96x72 thumbnail at 0.11ms); PNG 1,777,317 bytes. For
  comparison, the export WebP quality-0.98 encoder measured ~178ms/frame (SM-078/080).
- Analysis: PNG compression is required by the storage model — it converts each capture
  into an immutable lossless record so full-size canvases are not retained (this is what
  permits 700 frames). Skipping it would either drop lossless originals or reintroduce
  unbounded decoded-canvas memory. The cost is not the codec (PNG is ~4x faster than the
  export WebP encode) but that animator.capture() awaits the PNG before committing the
  frame and sets captureBusy, so every shot blocks for that encode; this is likely larger
  on older iPads. Separately, autosave rewrites the complete snapshot on each change
  (~500ms per ~1GB write at 700 frames per SM-071); it runs in the background but competes.
- Proposed (NOT implemented): non-blocking capture — grab the frame and render the
  thumbnail immediately, run the PNG encode in the background (preferably a Worker /
  OffscreenCanvas), and allow the next shot while the previous frame encodes, with a small
  bounded in-flight queue. Memory cost: a few full canvases in flight. Optional follow-up:
  throttle/batch autosave during rapid capture.
- Status: MEASUREMENT + OPTIONS RECORDED; no product code changed; awaiting direction.

### SM-083 — Non-blocking capture pipeline (implements SM-082 option 1)

- Purpose: restore the original app's instant-capture feel (szager/stop-motion baseline
  6eae625 pushed each canvas synchronously with nothing to await) while keeping the
  lossless PNG-record storage model that bounds memory.
- Change (js/animator.js): capture() now draws the camera frame synchronously, enqueues
  a job, starts drainCaptures(), and returns that job's promise immediately. The drain
  loop compresses each queued canvas to a PNG record in the background and commits
  frames strictly in order (frames/holds/frameWebps + timeline.commit + onProjectChange).
  Queue is capped at 8; cancelQueuedCaptures() runs on invalidateProject() (Clear, Open,
  recovery, WebM load) and marks the active job cancelled so awaiting a cancelled capture
  still means the pipeline has stopped. captureBusy blocks edits/play via timeline.blocked()
  but no longer blocks the Capture button.
- Change (js/timeline.js): updateControls keeps the Capture control enabled while the
  background queue drains (disabled only for projectBusy/loadInProgress).
- Removed the blocking "Compressing capture…" message; each frame still compresses once.
- Not done on purpose (refused alternatives): storing raw canvases as frames (would
  reintroduce unbounded decoded memory) and allowing timeline/undo edits concurrently with
  the queue (would race frame indices/history). Edits and Play remain locked until the
  queue drains.
- Measured: per-capture PNG ~46ms at 1280x720 (SM-082), now off the click path. New
  focused test tests/e2e/capture-pipeline.spec.js: with the first PNG encode held, three
  rapid captures all queued (active+queue 1,2,3), the Capture button stayed enabled, and
  after release all three promises resolved with frames in order (red, lime, blue),
  captureBusy false and queue empty.
- Regression: 54 tests, 52 passed / 2 failed with 1 worker (non-blocking-w1). Both
  failures are pre-existing and off the capture path: memory-increment thumbnail helper
  (SM-063-class late-enumeration fixture race) and timeline delayed-invalid (test helper
  that stalls createImageBitmap while its own pixels() helper needs it). capture-pipeline,
  project, camera-capture, timeline (other), quality, memory export, export-compat,
  ui and the large-project safety/binary cases all pass. (The earlier 3-worker run also
  exposed the host's native video-startup flake as readyState-0 setup failures, unrelated.)
- Files: js/animator.js, js/timeline.js, tests/e2e/capture-pipeline.spec.js (new),
  tests/e2e/large-project.spec.js (cancellation case updated for queued semantics),
  tests/e2e/capture-cost.spec.js (SM-082 measurement, test-only), README.md.
- Status: PENDING PARENT REVIEW. Audio-free app + non-blocking capture uncommitted;
  probe for the iPad export path still pending.

### SM-084 — Published to the owner's GitHub and GitHub Pages

- Target: the owner's own repository `kiwispin/StopMotion` (renamed display from the
  existing `kiwispin/stopmotion`, which held a June-2024 earlier version of this same
  app). The upstream `szager/stop-motion` remote was demoted to `upstream` and was NOT
  pushed to; `origin` now points to `kiwispin/StopMotion`.
- History: full development history retained (upstream baseline 6eae625 plus rebuild
  commit 0ef337e). `main` was force-replaced over the old 4-commit history per owner
  decision.
- GitHub Pages enabled from `main` root over HTTPS; build for 0ef337e reported `built`.
  App: https://kiwispin.github.io/StopMotion/
  Probe: https://kiwispin.github.io/StopMotion/tests/diagnostics/device-probe.html
- Verified live: served js/animator.js contains the non-blocking capture (drainCaptures)
  and concurrency export (navigator.hardwareConcurrency), and contains no recordAudio;
  index.html has no audio controls. HTTPS satisfies the secure-context requirement for
  camera and the probe on iPad/Chromebook.
- Unchanged limitation: the export encoder still uses canvas WebP, which WebKit lacks, so
  iPad export remains blocked until the probe results drive the MP4/H.264 work.
- Status: RECORDED. Deployment only; no further product code change.

### SM-085 — UI Increment 1: design tokens and workspace shell (visual only)

- Purpose: first approved increment of the UI direction in DESIGN_AUDIT.md. Styling and
  layout shell only; behaviour, element IDs and the layout mechanics are unchanged.
- Decisions applied (approved defaults): accent teal `#2dd4bf` with `#14b8a6` hover and
  dark ink `#04211d` on accent; green `#10b981` reserved for success; warning `#f59e0b`,
  danger `#ef4444`. Landscape-first with the portrait stacked layout retained.
- Changes:
  - animator.css: added a token layer (shared family base colours, semantic
    success/warning/danger, type scale, radii 8/12/16, spacing 4-32, focus ring, 44px
    touch targets, elevation shadow, prefers-reduced-motion) and restyled buttons,
    panels, transport, filmstrip, dialogs and inputs to it. Stage max width increased
    580px -> 820px (still height-aware via the container query). Capture is the single
    filled accent primary control ("Capture frame", 52px). Backward-compatible aliases
    --panel/--raised/--muted retained.
  - index.html: save status moved inline into the top bar (single row) replacing the
    separate status strip; Capture label updated. All IDs preserved
    (#project-status, #project-controls, #captureButton, ...).
- Measured (1 worker): ui.spec + quality.spec 15 passed / 0 failed; responsive studio
  at 1440/1024/768/390 has no horizontal overflow, desktop document fits the viewport
  including the complete first thumbnail row, and the 1024 HD stage stays 16:9. Full
  affected behaviour suite 37 passed / 2 failed; both failures are the pre-existing
  ones (memory-increment thumbnail fixture race; timeline delayed-invalid test-helper
  conflict), so no regression from the visual change.
- Screenshots inspected: test-results/studio-1440.png and studio-390.png.
- Deferred to later increments (not started): contextual Live/Review panel and mode
  chip, pending-capture state, save-state set, timeline zoom/go-to/virtualization and
  the export flow. No behaviour was changed in this increment.
- Files: animator.css, index.html, STOPMOTION_CHANGELOG.md.
- Status: PENDING PARENT REVIEW.

### SM-086 — UI Increment 2: modes, contextual panel, pending capture, save state

- Purpose: second approved increment. Behaviour added on top of the Increment 1 shell;
  all existing element IDs and asserted status wording preserved.
- Changes:
  - index.html: stage mode chip (`#modeChip`); pending badge (`#capturePending`) in the
    filmstrip header; contextual `#selected-frame-panel` with a Hold stepper, Duplicate,
    Delete, Move left/right and Back to live camera.
  - js/timeline.js: updateControls now drives the mode chip ("Live camera" / "Reviewing
    frame N") and the contextual panel visibility, labels, hold value and disabled
    states; duplicate/delete/move/hold handlers refactored into functions and exposed on
    the timeline API; panel and stepper controls wired to those functions.
  - js/animator.js: added `pendingCaptures()` and `onCapture`/`refreshSummary` hooks
    called when a shot is queued and when the queue drains.
  - js/main.js: refreshSummary shows "Saving N…" while frames compress; onCapture fires a
    200ms stage border pulse (reduced-motion aware via CSS).
  - js/project.js: report() sets a `data-state` (saving/saved/error/idle) on the status
    bar; animator.css colours the status dot accordingly.
- Measured (1 worker): new tests/e2e/ui-modes.spec.js 3 passed / 0 failed (mode chip and
  contextual panel incl. hold edit, duplicate, delete, back-to-live; pending badge shows
  "Saving 2…" then clears with two frames committed; save status reaches `saved`).
  ui + timeline + project + capture-pipeline 30 passed / 1 failed; the single failure is
  the pre-existing timeline delayed-invalid test-helper conflict. No regressions.
  Screenshot inspected: test-results/review-mode.png (amber review chip + selected-frame
  panel).
- Deliberate limit: exact "Backup downloaded" wording is deferred because ~20 assertions
  match `#project-status` text exactly; the status dot now conveys saved/saving/error
  instead. Placeholder thumbnails for pending captures are also deferred; the honest
  "Saving N…" badge and stage pulse stand in for now.
- Files: index.html, js/timeline.js, js/animator.js, js/main.js, js/project.js,
  animator.css, tests/e2e/ui-modes.spec.js, STOPMOTION_CHANGELOG.md.
- Status: PENDING PARENT REVIEW.

### SM-087 — UI Increment 3: timeline at scale (numbers, hold badges, zoom, go-to, windowing)

- Purpose: third approved increment. Make long projects manageable without turning the
  filmstrip into a wall of thumbnails.
- Changes:
  - js/timeline.js: rendering reworked to framed cells (canvas + frame number + `xN`
    hold badge) with the existing canvas-reuse map preserved. Projects over 120 frames
    now render only the visible window (overscan 6 cells) inside an absolutely
    positioned track of full width, re-rendering on scroll; selection is kept in the
    window and scrolled into view. Added Zoom (48-176px via buttons and a range, applied
    through a `--thumb-w` CSS variable) and Go to frame (1-based input + button, Enter
    supported). updateControls now addresses cells by `data-index`. API exposes
    `goToFrame` and `applyZoom`.
  - index.html: zoom controls and Go to frame added to the timeline toolbar.
  - animator.css: filmstrip track/cell, frame-number, hold-badge and zoom/go-to styling;
    thumbnail container switched from a flex row to a positioned, scrollable track.
- Measured (1 worker): full affected suite 56 passed / 2 failed; both failures are the
  pre-existing ones (memory-increment thumbnail fixture race; timeline delayed-invalid
  test-helper conflict). ui-modes (incl. the new numbers/badges/zoom/go-to case) 4/4.
  Screenshot inspected: test-results/timeline-scale.png (112px cells, `x4` badge on frame
  2, selection on frame 5, zoom slider and Go to frame).
- Test contract updated: large-project 700-frame case now asserts 700 frames with a
  windowed filmstrip (0 < visible cells <= 80) instead of 700 DOM canvases. Small
  projects (<=120 frames) still render every cell, so existing behaviour and assertions
  are unchanged.
- Files: js/timeline.js, index.html, animator.css, README.md,
  tests/e2e/ui-modes.spec.js, tests/e2e/large-project.spec.js, STOPMOTION_CHANGELOG.md.
- Status: PENDING PARENT REVIEW.

### SM-088 — UI Increment 4: export flow (summary, quality, honest progress, guidance)

- Purpose: fourth approved increment. Make export a short, understandable, honest flow.
- Changes:
  - index.html: the export dialog now shows a resolution/fps/duration summary, a plain
    quality selector (High 0.98 / Standard 0.9), a progress bar plus status text, and an
    advisory "not supported on this device yet" notice.
  - js/main.js: openExportDialog computes the summary from the project and probes WebP
    support (`canvas.toBlob('image/webp')`) to show the notice. saveCB keeps the dialog
    open, shows "Encoding frame N of M" then "Finishing the movie…", and on success shows
    download/playback guidance with a Done button; on failure it closes and reports
    `Export failed: …` through #timelineMessage as before. The duplicate saveConfirm
    listener was replaced with a single onclick.
  - js/animator.js: `save(filename, options)` / `encode(title, options)` accept an export
    quality and report `onExportProgress({phase, done, total})`.
  - js/media.js: `encodeFrame(canvas, level)` is parameterised; the single-entry cache is
    keyed by canvas and quality and the in-flight map stores the level with its promise.
  - animator.css: export summary, progress bar and warning styles.
- Measured (1 worker): quality + ui 15 passed / 0 failed; ui-modes 5 passed / 0 failed
  (including the new summary/progress/completion case). Full affected suite 56 passed /
  3 failed, all pre-existing/flaky and unrelated: memory-increment thumbnail fixture race;
  timeline delayed-invalid test-helper conflict; and quality.spec:227, which failed in the
  run only in the `open()` helper on native fake-camera startup (readyState 0) and passed
  3/3 when re-run alone. Screenshot inspected: test-results/export-flow.png.
- Design notes: the unsupported state is advisory (a warning), not blocking, so a
  false-negative probe cannot stop an export that would actually work; a failed attempt
  still reports the specific encoder error. Progress counts exposures encoded, then
  switches to "Finishing" for the mux phase.
- Files: index.html, js/main.js, js/animator.js, js/media.js, animator.css,
    tests/e2e/ui-modes.spec.js, STOPMOTION_CHANGELOG.md.
- Status: PENDING PARENT REVIEW.

### SM-089 — Complete mint/charcoal editing workspace (UI only)
- Status: PENDING PARENT REVIEW; source frozen at handoff.
- Baseline: clean working tree at e169bb9. Inspected current HTML/CSS and
  DESIGN_AUDIT.md; preserved the user's current implementation, including selected-frame
  inspector, virtualized timeline, zoom/go-to, and export dialogs/progress. Audio remains
  absent as in the current app. No JS, tests, dependencies or media/storage changes.
- Files: index.html, animator.css, STOPMOTION_CHANGELOG.md only.
- Presentation: warm charcoal panels, mint primary/selection accents, readable status
  wrapping, compact headings, safe-area dialogs, visible keyboard focus and 44px controls.
  Moved the existing New/Clear button into the project toolbar; no duplicated ID/control.
  Retained intentional inspector/timeline mirrors. Desktop settings scroll internally;
  portrait stacks studio, timeline and settings without hiding controls in menus.
- Measured Chromium smoke checks (two inline browser runs, both exit 0): all 85 original
  static IDs present exactly once; 0 pageerrors in either run. At 1365x768, 1024x1366,
  and 768x1024, page scroll widths were exactly 1365, 1024, and 768px; 0 visible
  button/input/select targets below 44px. Initial captured-fixture studio ratios were
  448/252, 646/363.375, and 718/403.875 (16:9, without stretching).
- Initial six-capture fixture: transport/strip bottom positions were 489/728.5px desktop,
  1037/1326.5px at 1024, and 654.875/944.375px portrait (normal vertical page scrolling).
  Hold increase, Duplicate, Undo, Export dialog/Cancel and New/Clear dialog/Cancel
  completed at each viewport. Follow-up checks exercised Flip, Clock, reachable Import,
  and keyboard focus (solid outline). Export dialog was 440x355px and within each viewport.
- 200-frame UI fixture: Go to frame selected index 199; horizontal strip scrollLeft
  17288px after zoom; page remained 768px wide. This is a layout check, not a media-scale
  or persistence benchmark. No expensive media suites or physical-device tests run.
- Screenshot fixture refinement: initial frame 1 was captured before the simulated scene
  updated and appeared blank; final screenshots use six deterministic canvas-backed
  records and review frame 3. No production behavior changed to accommodate the fixture.
  No rejected implementation attempt in this scoped pass; acceptance remains reviewer-owned.
- Artifacts: test-results/ui-mockup/{1365x768,1024x1366,768x1024}.png;
  results.json (initial capture/layout measurements), interactions.json (focused follow-up).
  CSS respects reduced motion. Real iPad/browser UX remains a user checkpoint.

### SM-090 — Structural workspace revision after mockup review
- SM-089 visual composition REFUSED by parent: restyling retained an undersized stage
  and capture-centric transport. Its functional measurements remain valid, not visual acceptance.
- Revision status: PENDING PARENT VISUAL REVIEW. Inspected the supplied approved mockup.
  Only index.html, animator.css and this log changed; all current JS remains untouched.
- Stage now fills the upper-left studio with contained, uncropped image presentation;
  resolution is an overlay rather than a separate desktop header. Desktop columns are
  3:1 with a 300px minimum inspector; 901–1099px uses a 300px inspector; <=900px stacks
  stage/transport, timeline, inspector. Existing Capture moved into camera settings;
  Undo/Redo moved into timeline. Selected status moved into timeline heading. Existing
  inspector mirrors and Hold controls remain wired, with a prominent Back to live action.
  Export has primary mint emphasis. No fake project title, audio or unwired controls added.
- Focused Chromium run exit 0: 85 original static IDs each exactly once, 0 pageerrors,
  0 visible controls below 44px; page widths exactly 1365/1024/768 at requested viewports.
  Stage bounds: 988.75x347 desktop (previous 448x252), 678x867 at 1024x1366,
  718x403.875 portrait. Inspector widths: 330.25, 300, 736px respectively.
  These are stage bounds, not a claim of image stretching: contained 16:9 pixels retain
  their ratio, with letterboxing where workspace and image proportions differ.
- Transport/first-row strip bottoms: 491.5/732.5px desktop, 1039.5/1330.5px at1024,
  646.875/937.875px portrait. Export dialogs 440x355 fit all three viewports;
  keyboard focus outline solid. Hold/Duplicate/Undo, both dialogs and Cancel, reachable
  Import, Back to live and relocated Capture exercised (6 frames became 7).
  200-frame timeline selected index199 with internal scrollLeft17288; page width768.
- Replaced screenshots with a real canvas-stream simulated camera fixture, no camera
  error overlay: test-results/ui-sm090/1365x768.png, 1024x1366.png, 768x1024.png.
  Inspected all three; results.json records exact measurements. Full image is contained
  rather than cropped to mimic the mockup. Real iPad checks remain pending. No costly
  media suite, JS changes, commits or dependency changes. Frozen for parent review.
- Parent follow-up: composition judged much closer, but stretched stage sizing REFUSED.
  Revision 2 changes only CSS layout and this log: stage uses actual --stage-ratio with
  16:9 fallback, auto height, no flex height expansion. Upper row follows stage height;
  inspector remains independently scrollable. Vertical page scrolling is intentional.
- Revision 2 focused screenshot run exit0, 0 pageerrors: actual stage 988.75x556.171875
  at1365x768, 678x381.375 at1024x1366, 718x403.875 at768x1024. All ratios verified16:9;
  horizontal page widths exactly1365/1024/768. Desktop document now977px tall (scrolls),
  portrait1730px. Inspected all three selected-state screenshots: no stretched black-bar
  workspace. Capture remains enabled by existing JS (disabled=false, opacity1 in each);
  no fake disabled styling or behavior changes. No HTML/JS changes in this correction.
- Current artifacts: test-results/ui-sm090-r2/{1365x768,1024x1366,768x1024}.png and
  results.json. Revision 2 remains PENDING PARENT ACCEPTANCE; source frozen again.

### SM-091 — Mockup-like timeline header, editing toolbar and cards
- Previous flat bottom layout REFUSED by parent/user. Inspected approved mockup and
  supplied 2221x359 screenshot. Revision PENDING PARENT VISUAL ACCEPTANCE.
- Files: index.html, animator.css, STOPMOTION_CHANGELOG.md only. No JS/media/storage,
  stage layout, dependencies or tests changed. The only inspector markup adjustment is
  relocation of its existing wired holdDecrease/holdIncrease buttons into the timeline;
  inspector outputs remain. No fake or duplicate event controls were introduced.
- Header: title/count, actual selectionStatus, distinct mint Live action; duration,
  labelled Zoom and Go-to grouped at right, wrapping onto a header subrow on iPad.
  Separate toolbar: Undo/Redo | Move left/right | Duplicate/Delete | Hold minus,
  editable numeric field, plus and truthful static helper. Dividers preserve group identity.
  Existing zoom input starts at144 instead of96, producing144x108 cards through existing
  JS geometry. Mint selected outline, numbered labels and existing hold badges retained.
  Strip remains content-height, internally scrollable, with a short explanatory footer.
- First focused run exit1: attempted Move right after deletion while selection was absent;
  correctly disabled control timed out at30000ms. Refused harness assumption, not app fix.
  Revised fixture explicitly reselects frame3 before Move; no behavior changed for the test.
- Corrected focused Chromium run exit0: all85 original IDs exactly once, 0 pageerrors.
  Hold +/- and direct numeric edit, Duplicate/Delete, Undo/Redo, Move both directions,
  Live, Go-to and Zoom exercised. Page widths1365/1024/768 exactly match viewports;
  0 timeline button/input targets below44px. Header/toolbar heights69/61px desktop,
  125/61px at1024,125/117px portrait. Non-overlapping rows; thumbnail strip160px high
  with144x108px cards at all sizes. 200-frame fixture selects index199, scrollLeft26888,
  page still768px wide. Larger cards do not fabricate frames to fill short projects.
- Inspected timeline screenshots at all three sizes. Artifacts:
  test-results/ui-sm091/{1365x768,1024x1366,768x1024}.png (full workspace),
  timeline-{1365,1024,768}.png (bottom panel), results.json. No expensive media suites.
  Source frozen for review; no acceptance claimed before parent review.
- Parent visual review ACCEPTED the revised bottom structure: header/actions, separate
  grouped editing row, thumbnails/help visibly match the mockup composition. The previous
  flat layout remains REFUSED as recorded above. Measurements and first failed harness
  attempt retained. git diff --check exit0 (line-ending warnings only). Implementation
  frozen; no further UI changes or tests after this acceptance.

### SM-092 — Exact-crop filmstrip revision
- User REFUSED prior SM-089–091 bottom presentation despite earlier parent acceptance;
  preserve that history rather than treating it as final user approval. Inspected the
  new exact target crop. Current revision PENDING REVIEW, with dynamic text gap below.
- Files: index.html, animator.css, STOPMOTION_CHANGELOG.md only. JS untouched.
  Live and duration relocated to playback; filmstrip header contains title/count,
  selection output, Zoom and Go-to only. Existing Go button retained, visually clipped
  until keyboard focus; existing Enter handler on the number field is the normal submit.
  Edit groups retain requested order, icons, separators, neutral/red treatment and round
  Hold buttons. Existing zoom default136 yields136x102 cards (supported8px zoom steps,
  rather than hardcoding132 and breaking virtualized positions). Existing10px gap retained.
  Single exposures get a decorative ×1 badge; actual hold metadata/selection unchanged.
  Full-width panel2016px at2048 viewport; no invented frames or vertical spacer region.
  Native horizontal scrolling retained; scrollbar visibility follows browser/platform.
- Focused Chromium run exit0; 85 original IDs exactly once, 0 pageerrors. At2048x1152,
  1024x1366,768x1024, page widths exactly2048/1024/768. Panels2016x315,992x413.5,
  736x413.5 respectively. Desktop header57px and toolbar70px; tablet header105.5px
  and toolbar120px after wrapping. Card136x102 and strip148px at each size.
- Hold +/-/numeric, Duplicate/Delete, Undo/Redo, Move both ways exercised. Both relocated
  Live and inspector Back to live return selected=-1. Go-to via Enter selects199 in a
  200-frame fixture; Zoom works, scrollLeft25296, page width remains768. No media suites.
- Inspected crops: test-results/ui-sm092/timeline-{2048,1024,768}.png; results.json.
  Remaining exact-text mismatch explicitly NOT faked: timeline.js currently outputs only
  Frame N, not Frame N of M, and no selected-pose seconds output exists. Request parent
  permission for minimal UI-text-only JS adjustment before changing those dynamic labels.
  Static truthful hold helper retained meanwhile. Frozen pending that review/authority.
- Parent ACCEPTED SM-092 panel geometry and authorized two UI-only dynamic labels.
  Added holdSummary span; timeline.js updateControls now renders Frame N of M and
  hold / playbackSpeed to2 decimals with singular/plural exposure text; live summary empty.
  Footer unchanged. No animation/media/storage logic changed, no CSS changes this revision.
- First text check exit1: after FPS input, helper retained0.29sec from7fps instead of
  0.17sec at12fps because rate changes did not refresh timeline controls. Revised with
  one input listener in timeline.js calling existing updateControls; presentation refresh
  only. Failed attempt retained, not passed off as a test-fixture issue.
- Corrected focused run exit0, 0 pageerrors: Frame3 of6, 2 exposures ·0.17sec at12fps;
  returning live gives Live camera and empty summary. All85 original IDs plus holdSummary
  appear exactly once (86). At2048/1024/768, page widths unchanged and panel sizes
  2016x315,992x413.5,736x413.5. Inspected refreshed filmstrip screenshots:
  test-results/ui-sm092-text/timeline-{2048,1024,768}.png; results.json.
  Text revision pending parent review; source frozen. No media tests or broad changes.

### SM-093 - Align the workspace to the provided mockup (layout/visual fixes)

- Purpose: owner asked to make the current workspace match the supplied mockup; this
  revises the SM-089-092 presentation. No animation/media/storage/export logic changed.
- Desktop shell fixed: at >=901px `body` is `height:100dvh; overflow:hidden`, `main` is
  `flex:1; min-height:0` with rows `minmax(0,1fr) auto`, `#control-column` scrolls
  internally, and the stage is height-aware again via the container query. The page no
  longer scrolls on desktop (ui.spec had measured scrollHeight 1021>900 and 941>768).
- Mock alignment: Frame rate moved into the transport (mock shows fps there); the empty
  Playback panel group removed. Show clock moved into Tools and the onion hint shortened
  so the visible panel matches the mock (Ready to capture, Camera, Frame guides) with
  Tools scrolling below. Added a "Ready to capture" header/subtitle (#liveHeader) and
  "Next frame: N" (#nextFrameHint), both hidden while reviewing. Added a transport
  frame-count summary ("N frames - duration") via #transportFrames. Consolidated
  .export-action into a single filled accent button (mock) and dropped the duplicate
  outline rule.
- Two deliberate reversals of SM-092 choices, flagged for review: (1) the decorative
  "x1" hold badge was removed so only "xN" with N>1 shows, matching the mock; (2) the
  Frame-rate control now lives in the transport rather than the inspector.
- Tests updated for the accepted new contract (owner's changes, not logic changes):
  timeline.spec selectionStatus expectations are "Frame N of M"; ui-modes zoom
  expectation derives from the current `--thumb-w` (default 136, 8px steps); go-to-frame
  uses Enter because the Go button is intentionally visually clipped until focused;
  ui-modes export summary is computed from live state.
- Measured (1 worker): full affected suite 56 passed / 3 failed; all three are
  pre-existing/flaky and unrelated - memory-increment thumbnail fixture race, timeline
  delayed-invalid test-helper conflict, and timeline history-50 exceeding its own 30s
  timeout under sustained load (passes alone in ~11s). ui.spec passes at 1440/1024/768/390
  with no page scroll. Screenshots inspected: test-results/studio-1440.png,
  studio-1024.png, review-mode.png, timeline-scale.png, export-flow.png.
- Files: index.html, animator.css, js/timeline.js, js/main.js,
  tests/e2e/timeline.spec.js, tests/e2e/ui-modes.spec.js, STOPMOTION_CHANGELOG.md.
- Status: PENDING REVIEW (mock alignment); the two SM-092 reversals above are called out
  explicitly rather than silently applied.

### SM-094 - Camera is off by default (privacy)

- Owner requirement: the camera must NOT start automatically; that is a privacy risk.
  The app previously called `enumerateDevices().then(getUserMedia())` on load.
- Change: the on-load camera startup was removed. With no explicit opt-in the app now
  shows "Camera is off. Turn on the camera to start.", the toggle reads "Turn camera on",
  Capture is disabled and the stage chip reads "Camera off". Starting is a deliberate
  user action via the Camera toggle (which requests `getUserMedia` only then). Explicit
  opt-in remains for deep links/tests only: `?camera=1` or `window.__stopmotionAutoCamera`.
- Files: js/main.js, js/timeline.js, index.html, tests/e2e/fixtures.js,
  tests/e2e/ui-modes.spec.js, STOPMOTION_CHANGELOG.md.
- Added a focused ui-modes test asserting: zero `getUserMedia` calls on load, the
  "Camera is off" prompt, disabled Capture, and that clicking the toggle starts the
  camera (streamOn true, Capture enabled, chip "Live camera"). Camera-dependent specs
  keep auto-start through the fixtures test hook.
- Status: PENDING REVIEW. Owner requested the push immediately; the full affected suite
  was aborted before completing and still needs a clean run.

### SM-095 - Camera-off follow-up: keep the UI in sync and tests green

- Problem found by the full run: with camera-off as the default, the UI was not refreshed
  when the stream attached, so Capture stayed disabled and the camera-dependent specs
  timed out (40 failed / 20 passed). Gating Capture on `streamOn` was also too broad: some
  specs attach a fixture stream directly (bypassing the app), so the button stayed disabled.
- Fix: `Animator.attachStream`/`detachStream` now call `refreshSummary` and
  `timeline.updateControls`, so the chip, prompt and controls reflect camera state.
  Capture is no longer disabled by `streamOn`; `capture()` already refuses without a live
  stream, and the off state is shown by the "Camera is off" prompt and the "Camera off"
  stage chip. The focused camera test now asserts `capture() === null` and the chip text
  rather than a disabled button.
- Files: js/animator.js, js/timeline.js, tests/e2e/ui-modes.spec.js, STOPMOTION_CHANGELOG.md.
- Measured (1 worker): full affected suite 58 passed / 2 failed; both failures are the
  pre-existing memory-increment thumbnail fixture race and the timeline delayed-invalid
  test-helper conflict. No regression from the camera privacy change.
- Status: PENDING REVIEW.
