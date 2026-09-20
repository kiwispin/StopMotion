// Verification-only harness (no application source changes).
// Proves one uninterrupted fresh export of the existing saved 700-frame project:
// open via the normal Open Project control, confirm 700 frames / 24 fps / exact
// original PNG hashes, export via the normal Export Video control, and time the
// whole thing. Runs in a visible, non-private (disk-backed) browser context.
import {test as base, expect} from './fixtures.js';
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BACKUP = path.join(process.cwd(), 'test-results', 'large-project-persistent',
  'large-project-700-distinct-078d2--with-bounded-decoded-cache', '700-frames.stopmotion');
const BACKUP = process.env.STOPMOTION_RESUME_PROJECT || DEFAULT_BACKUP;
const HASHES_PATH = path.join(path.dirname(BACKUP), 'HASHES.json');
// Agreed export ceiling: 10 minutes. The run stops early on success.
const WINDOW_MS = Number(process.env.STOPMOTION_EXPORT_WINDOW_MS || 600000);

const test = base.extend({
  context: async ({}, use, testInfo) => {
    const context = await chromium.launchPersistentContext(testInfo.outputPath('browser-profile'), {
      headless: false,
      acceptDownloads: true,
      baseURL: 'http://127.0.0.1:4173',
      permissions: ['camera'],
      viewport: {width: 1280, height: 800}
    });
    try { await use(context); } finally { await context.close(); }
  }
});

test.beforeEach(async ({page}) => {
  page.pageErrors = [];
  page.browserErrors = [];
  page.benign404 = 0;
  page.on('pageerror', error => page.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // The app ships no favicon; the browser's automatic /favicon.ico request 404s.
    const url = (message.location() && message.location().url) || '';
    if (/\/favicon\.ico$/.test(url)) { page.benign404++; return; }
    page.browserErrors.push(message.text());
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No camera in export test', 'NotFoundError'); };
    navigator.mediaDevices.enumerateDevices = async () => [];
    window.unhandled = [];
    addEventListener('unhandledrejection', event => window.unhandled.push(String(event.reason)));
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
});

test('fresh UI export of the saved 700-frame project completes and is timed', async ({page}, testInfo) => {
  test.setTimeout(WINDOW_MS + 15 * 60 * 1000);

  expect(await page.evaluate(() => main.animator.frames.length)).toBe(0);

  // Open the saved project through the normal Open Project control.
  const openStart = Date.now();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#openProject').click()
  ]);
  await chooser.setFiles(BACKUP);
  await expect(page.locator('#project-status')).toHaveText('Saved on this device', {timeout: 300000});
  const openMs = Date.now() - openStart;

  // Confirm all 700 frames and the correct frame rate.
  await expect(page.locator('#frame-count')).toHaveText('700');
  expect(await page.evaluate(() => main.animator.playbackSpeed)).toBe(24);
  await expect(page.locator('#fps')).toHaveText('24.0');
  expect((await page.locator('#duration').textContent()).trim()).toBe('29.17 s');

  // Confirm every original PNG is present in order (saved manifest, no recapture).
  const expectedHashes = JSON.parse(await readFile(HASHES_PATH, 'utf8'));
  const actualHashes = await page.evaluate(async () => {
    const hashes = [];
    for (const frame of main.animator.frames)
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', await frame.png.arrayBuffer()))].join(','));
    return hashes;
  });
  expect(actualHashes).toEqual(expectedHashes);

  // Instrument encode progress and start a main-thread responsiveness heartbeat.
  await page.evaluate(() => {
    window.__export = {encodeCalls: 0};
    const original = stopMedia.encodeFrame;
    window.stopMedia.encodeFrame = (...args) => { window.__export.encodeCalls++; return original(...args); };
    window.__heartbeat = {ticks: 0, maxGapMs: 0, last: performance.now()};
    window.__heartbeatTimer = setInterval(() => {
      const now = performance.now();
      window.__heartbeat.maxGapMs = Math.max(window.__heartbeat.maxGapMs, now - window.__heartbeat.last);
      window.__heartbeat.last = now; window.__heartbeat.ticks++;
    }, 200);
  });

  // Export through the normal controls (Export Video -> Export WebM).
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveDialog')).toBeVisible();
  await page.locator('#movieName').fill('700-frames');
  const downloadPromise = page.waitForEvent('download', {timeout: WINDOW_MS});
  downloadPromise.catch(() => {});
  const errorPromise = page.waitForFunction(
    () => /Export failed:/.test(document.getElementById('timelineMessage').textContent),
    null, {timeout: WINDOW_MS});
  errorPromise.catch(() => {});
  const exportStart = Date.now();
  await page.locator('#saveConfirmButton').click();

  let download = null, exportError = '';
  const poll = [];
  const deadline = exportStart + WINDOW_MS;
  while (!download && !exportError && Date.now() < deadline) {
    const step = Math.min(20000, deadline - Date.now());
    const outcome = await Promise.race([
      downloadPromise.then(value => ({download: value})),
      errorPromise.then(async () => ({error: (await page.locator('#timelineMessage').textContent()).trim()})),
      new Promise(resolve => setTimeout(() => resolve({tick: true}), step))
    ]).catch(error => ({waitError: String(error.message || error)}));
    if (outcome.download) { download = outcome.download; break; }
    if (outcome.error) { exportError = outcome.error; break; }
    if (outcome.waitError) { exportError = outcome.waitError; break; }
    const progress = await page.evaluate(() => ({
      calls: window.__export.encodeCalls, ticks: window.__heartbeat.ticks, maxGapMs: window.__heartbeat.maxGapMs
    })).catch(() => null);
    poll.push({atMs: Date.now() - exportStart, ...progress});
    console.log('LARGE EXPORT progress ' + JSON.stringify(poll.at(-1)));
  }
  const exportEventMs = Date.now() - exportStart;

  const heartbeat = await page.evaluate(() => {
    clearInterval(window.__heartbeatTimer); return window.__heartbeat;
  }).catch(() => null);
  const encodeCalls = await page.evaluate(() => window.__export.encodeCalls).catch(() => null);
  const timelineMessage = ((await page.locator('#timelineMessage').textContent()) || '').trim();
  const projectStatus = ((await page.locator('#project-status').textContent()) || '').trim();
  const unhandled = await page.evaluate(() => window.unhandled);

  const result = {
    backup: BACKUP, windowMs: WINDOW_MS, openMs, exportEventMs,
    completed: !!download, exportError, poll, heartbeat, encodeCalls,
    timelineMessage, projectStatus,
    benignFavicon404: page.benign404,
    pageErrors: page.pageErrors, browserErrors: page.browserErrors, unhandled
  };

  expect(exportError, 'export failed: ' + exportError).toBe('');
  expect(download, 'export did not produce a download within ' + WINDOW_MS + 'ms').not.toBeNull();

  const videoPath = testInfo.outputPath('700-frames.webm');
  const saveStart = Date.now();
  await download.saveAs(videoPath);
  result.downloadSaveMs = Date.now() - saveStart;
  result.exportCompletedMs = Date.now() - exportStart;

  // Container sanity: 700 exposures plus the 7 final-exposure copies expected from
  // the compatibility mechanism (707 packets is not 707 animation frames).
  const probe = JSON.parse(execFileSync('ffprobe',
    ['-v','error','-select_streams','v:0','-show_packets','-show_streams','-show_format','-of','json',videoPath],
    {encoding:'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true}));
  expect(probe.packets).toHaveLength(707);
  expect([probe.streams[0].width, probe.streams[0].height]).toEqual([1280, 720]);
  expect(Number(probe.format.duration)).toBeCloseTo(700 / 24, 3);
  for (let i = 0; i < 700; i++)
    expect(Math.abs(Number(probe.packets[i].pts_time) - i / 24)).toBeLessThanOrEqual(0.001);
  result.packets = probe.packets.length;
  result.duration = probe.format.duration;
  result.webmBytes = probe.format.size;

  // Browser playback of the exact exported blob.
  const playback = await page.evaluate(async () => {
    const blob = main.animator.exported;
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.src = url;
    document.body.appendChild(video);
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('video error ' + (video.error && video.error.message)));
      });
      const info = {duration: video.duration, width: video.videoWidth, height: video.videoHeight};
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 1200));
      info.currentTime = video.currentTime; info.paused = video.paused; info.readyState = video.readyState;
      await new Promise((resolve, reject) => {
        video.onseeked = resolve; video.onerror = () => reject(new Error('seek error'));
        video.currentTime = Math.max(0, video.duration - 0.02);
      });
      info.endSeekTime = video.currentTime;
      return info;
    } finally { URL.revokeObjectURL(url); video.remove(); }
  });
  result.browserPlayback = playback;

  // Persist the timing/evidence record before the final strict assertions so a
  // diagnostic mismatch still leaves the measured data behind.
  await writeFile(testInfo.outputPath('EXPORT.json'), JSON.stringify(result, null, 2));
  console.log('LARGE EXPORT RESULT ' + JSON.stringify({
    openMs, exportEventMs, exportCompletedMs: result.exportCompletedMs,
    packets: result.packets, duration: result.duration, webmBytes: result.webmBytes,
    heartbeat, encodeCalls, browserPlayback: playback
  }));

  expect(playback.width).toBe(1280);
  expect(playback.height).toBe(720);
  expect(Math.abs(playback.duration - 700 / 24)).toBeLessThan(0.05);
  expect(page.pageErrors).toEqual([]);
  expect(page.browserErrors).toEqual([]);
  expect(unhandled).toEqual([]);
});
