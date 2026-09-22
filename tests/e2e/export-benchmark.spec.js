// Performance probe (test-only). Measures the real export encode path on actual
// project frames: PNG decode/draw, quality-0.98 WebP encode, and concurrency
// scaling. No product source changes; no autosave written.
import {test, expect} from './fixtures.js';
import {existsSync} from 'node:fs';
import path from 'node:path';

const DEFAULT_BACKUP = path.join(process.cwd(), 'test-results', 'large-project-persistent',
  'large-project-700-distinct-078d2--with-bounded-decoded-cache', '700-frames.stopmotion');
const BACKUP = process.env.STOPMOTION_RESUME_PROJECT || DEFAULT_BACKUP;

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no camera', 'NotFoundError'); };
    navigator.mediaDevices.enumerateDevices = async () => [];
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  // Avoid writing the 1 GiB autosave during this probe.
  await page.evaluate(() => { projectStorage.write = async () => {}; });
});

test('encode-path profile and concurrency scaling', async ({page}, testInfo) => {
  test.skip(!existsSync(BACKUP), 'Run with an existing 700-frame project backup.');
  test.setTimeout(300000);
  const openStart = Date.now();
  await page.locator('#projectFile').setInputFiles(BACKUP);
  await page.waitForFunction(() => main.animator.frames.length === 700, null, {timeout: 180000});
  const openMs = Date.now() - openStart;

  const result = await page.evaluate(async () => {
    const toBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(
      blob => blob && blob.type === 'image/webp' ? resolve(blob) : reject(new Error('webp encode failed')),
      'image/webp', 0.98));
    const draw = (frame, image) => {
      const surface = document.createElement('canvas');
      surface.width = frame.width; surface.height = frame.height;
      surface.getContext('2d').drawImage(image, 0, 0);
      return surface;
    };
    async function decodeOnly(frames) {
      const start = performance.now();
      for (const frame of frames)
        await stopFrames.use(frame, image => { draw(frame, image).width = 0; });
      return performance.now() - start;
    }
    async function sequential(frames) {
      const start = performance.now();
      for (const frame of frames)
        await stopFrames.use(frame, async image => {
          const surface = draw(frame, image);
          try { return await toBlob(surface); } finally { surface.width = surface.height = 0; }
        });
      return performance.now() - start;
    }
    async function pipelined(frames, limit) {
      const start = performance.now();
      let next = 0;
      await Promise.all(Array.from({length: limit}, async () => {
        while (true) {
          const index = next++;
          if (index >= frames.length) return;
          const frame = frames[index];
          const surface = await stopFrames.use(frame, image => draw(frame, image));
          try { await toBlob(surface); } finally { surface.width = surface.height = 0; }
        }
      }));
      return performance.now() - start;
    }
    const frames = main.animator.frames;
    const slice = (from, n) => frames.slice(from, from + n);
    // Warm up the code paths and the stopFrames cache.
    await sequential(slice(0, 2));
    const n = 24;
    const decodeMs = await decodeOnly(slice(10, n));
    const seqMs = await sequential(slice(100, n));
    const p2 = await pipelined(slice(200, n), 2);
    const p4 = await pipelined(slice(300, n), 4);
    const p8 = await pipelined(slice(400, n), 8);
    const p10 = await pipelined(slice(500, n), 10);
    return {n, decodeMs, seqMs,
      perFrameMs: {decode: decodeMs / n, seq: seqMs / n},
      concurrency: {p2, p4, p8, p10},
      speedup: {p2: seqMs / p2, p4: seqMs / p4, p8: seqMs / p8, p10: seqMs / p10}
    };
  });
  result.openMs = openMs;
  await testInfo.attach('benchmark', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  console.log('BENCHMARK ' + JSON.stringify(result));
  expect(result.speedup.p8).toBeGreaterThan(1.5);
});
