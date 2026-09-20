import {test, expect} from '@playwright/test';

// Non-blocking capture: shots are grabbed synchronously and PNG-compressed in the
// background, so several can be queued while the first is still encoding, and frame
// order is preserved.
test('rapid captures queue without blocking and commit in order', async ({page}) => {
  test.setTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Deterministic empty enumeration prevents the late initial attach from
    // detaching the fixture stream (SM-063).
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  const result = await page.evaluate(async () => {
    const an = main.animator;
    const fixture = document.createElement('canvas'); fixture.width = 64; fixture.height = 48;
    const ctx = fixture.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 64, 48);
    const stream = fixture.captureStream(30);
    navigator.mediaDevices.getUserMedia = async () => stream;
    an.detachStream(); an.clear();
    await an.attachStream('pipeline-fixture');
    await an.video.play().catch(() => {});
    for (let i = 0; i < 100 && an.video.readyState < 2; i++) {
      stream.getVideoTracks()[0].requestFrame();
      await new Promise(r => setTimeout(r, 50));
    }
    an.syncCameraDimensions(false);
    const ready = {streamOn: an.streamOn, readyState: an.video.readyState,
      dimensions: [an.video.videoWidth, an.video.videoHeight]};
    const diag = {projectBusy: an.projectBusy, streamOn: an.streamOn, playing: an.isPlaying(),
      loadInProgress: an.loadInProgress, w: an.w, h: an.h, videoReady: an.video.readyState,
      vw: an.video.videoWidth, vh: an.video.videoHeight,
      streamActive: (an.videoStream || an.video.srcObject)?.active,
      trackState: an.videoStream?.getVideoTracks?.()[0]?.readyState,
      settings: an.videoStream?.getVideoTracks?.()[0]?.getSettings?.()};
    // Hold every PNG encode until released, so the first capture cannot complete.
    const native = HTMLCanvasElement.prototype.toBlob, held = [];
    let hold = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      const run = () => native.call(this, callback, ...args);
      if (hold) held.push(run); else run();
    };
    const nextFrame = () => new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      an.video.requestVideoFrameCallback(finish);
      stream.getVideoTracks()[0].requestFrame();
      setTimeout(finish, 2000);
    });
    const colors = ['red', 'lime', 'blue'];
    const promises = [];
    const queuedAtEach = [];
    for (const color of colors) {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 48);
      await nextFrame();
      promises.push(an.capture());
      queuedAtEach.push((an.captureActive ? 1 : 0) + an.captureQueue.length);
    }
    const buttonEnabled = !document.getElementById('captureButton').disabled;
    hold = false;
    while (held.length) held.shift()();
    HTMLCanvasElement.prototype.toBlob = native;
    const frames = await Promise.all(promises);
    const pixel = frame => [...frame.thumbnail.getContext('2d').getImageData(48, 36, 1, 1).data].slice(0, 3);
    return {buttonEnabled, queuedAtEach, allQueued: promises.every(p => p && typeof p.then === 'function'),
      returned: frames.map(frame => !!frame), count: an.frames.length,
      colors: an.frames.map(pixel), busy: an.captureBusy, queue: an.captureQueue.length,
      ready, diag, message: document.getElementById('timelineMessage').textContent};
  });
  expect(errors).toEqual([]);
  console.log('CAPTURE PIPELINE ' + JSON.stringify(result));
  expect(result.buttonEnabled).toBe(true);
  expect(result.allQueued).toBe(true);
  expect(result.queuedAtEach).toEqual([1, 2, 3]);
  expect(result.returned).toEqual([true, true, true]);
  expect(result.count).toBe(3);
  expect(result.colors).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  expect(result.busy).toBe(false);
  expect(result.queue).toBe(0);
  console.log('CAPTURE PIPELINE ' + JSON.stringify(result));
});
