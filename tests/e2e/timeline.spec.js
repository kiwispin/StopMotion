import {test, expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {asLegacyProject} from './project-file.js';
import path from 'node:path';

const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

// Independent EBML reader: inspect SimpleBlock and BlockGroup timestamps.
function videoTimestamps(bytes) {
  const data = Buffer.from(bytes);
  function vint(offset, keepMarker = false) {
    let length = 1, mask = 128;
    while (!(data[offset] & mask)) { length++; mask >>= 1; }
    let value = keepMarker ? data[offset] : data[offset] & (mask - 1);
    for (let i = 1; i < length; i++) value = value * 256 + data[offset + i];
    return {length, value};
  }
  function chunks(start, end) {
    const result = [];
    while (start < end) {
      const id = vint(start, true); start += id.length;
      const size = vint(start); start += size.length;
      result.push({id: id.value, start, end: start + size.value});
      start += size.value;
    }
    return result;
  }
  const segment = chunks(0, data.length).find(c => c.id === 0x18538067);
  const result = [];
  for (const cluster of chunks(segment.start, segment.end).filter(c => c.id === 0x1f43b675)) {
    const children = chunks(cluster.start, cluster.end);
    const timecode = children.find(c => c.id === 0xe7);
    // EBML permits a zero-length unsigned integer to represent zero.
    let base = 0;
    for (let i = timecode.start; i < timecode.end; i++) base = base * 256 + data[i];
    for (const child of children.filter(c => c.id === 0xa3 || c.id === 0xa0)) {
      const block = child.id === 0xa0 ? chunks(child.start, child.end).find(c => c.id === 0xa1) : child;
      const track = vint(block.start);
      if (track.value === 1) result.push(base + data.readInt16BE(block.start + track.length));
    }
  }
  return result;
}
test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(async () => {
    const an = main.animator;
    an.detachStream();
    const source = document.createElement('canvas');
    source.width = 640; source.height = 480;
    window.colorSource = source;
    const stream = source.captureStream(30);
    an.video.srcObject = stream; an.videoStream = stream; an.streamOn = true;
    source.getContext('2d').fillRect(0, 0, 640, 480);
    await an.video.play();
  });
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });

async function paint(page, color) {
  await page.evaluate(color => new Promise(resolve => {
    const ctx = colorSource.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 480);
    // Wait for the actual media element to present the new canvas-stream frame.
    main.animator.video.requestVideoFrameCallback(() => resolve());
    main.animator.videoStream.getVideoTracks()[0].requestFrame();
  }), color);
}
async function captureColors(page, count = 3) {
  for (const color of colors.slice(0, count)) {
    await paint(page, color);
    await page.locator('#captureButton').click();
    await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  }
}
async function pixels(page) {
  return page.evaluate(async () => {
    const pixel = canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data].slice(0, 3);
    const frames = [];
    for (const frame of main.animator.frames) {
      const canvas = await testFrameCanvas(frame);
      frames.push(pixel(canvas)); canvas.width = canvas.height = 0;
    }
    return {frames,
      thumbs: [...document.querySelectorAll('#thumbnail-container canvas')].map(pixel),
      holds: main.animator.holds};
  });
}
async function hashes(page) {
  return page.evaluate(async () => Promise.all(main.animator.frames.map(async frame => {
    const canvas = await testFrameCanvas(frame);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = canvas.height = 0;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].join(',');
  })));
}
async function select(page, index) {
  await page.locator('#thumbnail-container canvas').nth(index).click();
}
async function hold(page, index, value) {
  await select(page, index);
  await page.locator('#frameHold').fill(String(value));
  await page.locator('#frameHold').press('Tab');
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  return readFile(await (await pending).path());
}
async function upload(page, buffer) {
  await page.locator('#projectFile').setInputFiles({name: 'timeline.stopmotion', mimeType: 'application/json', buffer});
}

test('colored timeline edits share pixels, undo/redo branch and live capture', async ({page}) => {
  await captureColors(page);
  const original = await hashes(page);
  expect(new Set(original).size).toBe(3);
  await select(page, 0);
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 1 of 3');
  expect(await page.evaluate(() => [...main.animator.playContext.getImageData(0, 0, 1, 1).data])).toEqual([255,0,0,255]);
  await page.locator('#duplicateFrame').click();
  expect(await hashes(page)).toEqual([original[0], original[0], original[1], original[2]]);
  expect(await page.evaluate(() => main.animator.frames[0] === main.animator.frames[1] &&
    main.animator.frameWebps[0] === main.animator.frameWebps[1])).toBe(true);
  await page.locator('#moveRight').click();
  expect(await hashes(page)).toEqual([original[0], original[1], original[0], original[2]]);
  await page.locator('#deleteFrame').click();
  expect(await hashes(page)).toEqual(original);
  await page.locator('#undoButton').click();
  expect(await hashes(page)).toEqual([original[0], original[1], original[0], original[2]]);
  await page.locator('#redoButton').click();
  expect(await hashes(page)).toEqual(original);
  await page.locator('#undoButton').click();
  await page.locator('#moveLeft').click();
  await expect(page.locator('#redoButton')).toBeDisabled();
  const state = await pixels(page);
  expect(state.thumbs).toEqual(state.frames);
  await select(page, 0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 2 of 4');
  await expect(page.locator('#thumbnail-container canvas').nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 4 of 4');
  await page.locator('#liveButton').click();
  await expect(page.locator('#selectionStatus')).toHaveText('Live camera');
  await select(page, 0);
  await paint(page, '#00ffff');
  await page.locator('#captureButton').click();
  expect((await pixels(page)).frames.at(-1)).toEqual([0,255,255]);
  await expect(page.locator('#selectionStatus')).toHaveText('Live camera');
  await page.locator('#undoButton').click();
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 1 of 4');
  await page.locator('#redoButton').click();
  expect((await pixels(page)).frames.at(-1)).toEqual([0,255,255]);
});

test('holds, reordered pixel hashes and history boundary survive reload and portable roundtrip', async ({page}) => {
  await captureColors(page);
  await hold(page, 0, 3);
  await page.locator('#moveRight').click();
  await hold(page, 2, 2);
  const expected = await hashes(page), metadata = await pixels(page);
  await page.evaluate(() => main.project.flushed());
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await hashes(page)).toEqual(expected);
  expect(await pixels(page)).toEqual(metadata);
  await expect(page.locator('#undoButton')).toBeDisabled();
  await expect(page.locator('#redoButton')).toBeDisabled();
  await expect(page.locator('#selectionStatus')).toHaveText('Live camera');
  const buffer = await download(page);
  await page.locator('#clearButton').click(); await page.locator('#clearConfirmButton').click();
  await expect(page.locator('#undoButton')).toBeDisabled();
  await upload(page, buffer);
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  expect(await hashes(page)).toEqual(expected);
  expect(await pixels(page)).toEqual(metadata);
  await expect(page.locator('#undoButton')).toBeDisabled();
  const legacy = asLegacyProject(buffer); delete legacy.holds;
  await upload(page, Buffer.from(JSON.stringify(legacy)));
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  expect((await pixels(page)).holds).toEqual([1,1,1]);
});

test('invalid holds preserve current project and durable snapshot', async ({page}) => {
  await captureColors(page);
  const expected = await hashes(page);
  const data = asLegacyProject(await download(page));
  for (const holds of [[1], [0,1,1], [121,1,1], [1.5,1,1], ['2',1,1], null]) {
    await upload(page, Buffer.from(JSON.stringify({...data, holds})));
    await expect(page.locator('#project-status')).toContainText('Current project preserved');
    expect(await hashes(page)).toEqual(expected);
  }
  await upload(page, Buffer.from(JSON.stringify({...data,
    frames: Array(201).fill(data.frames[0]), holds: Array(201).fill(120)})));
  await expect(page.locator('#project-status')).toContainText('Current project preserved');
  expect(await hashes(page)).toEqual(expected);
  await page.evaluate(async () => {
    main.animator.holds = [120]; main.project.changed(); await main.project.flushed();
  });
  await expect(page.locator('#project-status')).toContainText('Autosave failed');
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await hashes(page)).toEqual(expected);
  expect((await pixels(page)).holds).toEqual([1,1,1]);
});

test('hold playback draws actual colors on schedule with no one-second tail', async ({page}) => {
  await captureColors(page);
  await hold(page, 0, 3); await hold(page, 1, 2);
  await page.locator('#playbackSpeed').fill('12'); await page.locator('#playbackSpeed').dispatchEvent('input');
  await select(page, 1);
  await page.clock.install({time: new Date('2026-01-01T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.evaluate(() => { main.animator.startPlay(); });
  const shown = () => page.evaluate(() => [...main.animator.playContext.getImageData(0,0,1,1).data].slice(0,3));
  expect(await shown()).toEqual([255,0,0]);
  await page.clock.runFor(249); expect(await shown()).toEqual([255,0,0]);
  const progress = Number(await page.getByRole('progressbar', {name:'Elapsed animation progress'}).getAttribute('aria-valuenow'));
  expect(progress).toBeGreaterThanOrEqual(45); expect(progress).toBeLessThanOrEqual(50);
  await page.clock.runFor(2); expect(await shown()).toEqual([0,255,0]);
  await page.clock.runFor(167); expect(await shown()).toEqual([0,0,255]);
  await page.clock.runFor(83);
  expect(await page.evaluate(() => main.animator.isPlaying())).toBe(false);
  expect(await shown()).toEqual([0,255,0]); // selected preview restored after playback
  await expect(page.locator('#duration')).toHaveText('0.50 s');
  await expect(page.locator('#progress-container')).toHaveAttribute('aria-valuenow','0');
  await page.evaluate(() => { main.animator.startPlay(); });
  await page.clock.runFor(100);
  await page.locator('#duplicateFrame').click();
  expect(await page.evaluate(() => main.animator.isPlaying())).toBe(false);
  await page.clock.runFor(1200);
  await expect(page.locator('#progress-container')).toHaveAttribute('aria-valuenow','0');
});

test('native WebM duration has no repeated interval rounding drift at 12 and 24 fps', async ({page}) => {
  await captureColors(page);
  for (let index = 0; index < 3; index++) await hold(page, index, 120);
  for (const fps of [12,24]) {
    const result = await page.evaluate(async fps => {
      main.animator.setPlaybackSpeed(fps);
      const blob = await main.animator.encode('hold-duration');
      const video = document.createElement('video');
      const url = URL.createObjectURL(blob);
      try {
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Native WebM decode failed'));
          video.src = url;
        });
        const samples = [];
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        for (const time of [0.1, 120 / fps + 0.01, 240 / fps + 0.01]) {
          await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
          canvas.getContext('2d').drawImage(video, 0, 0, 1, 1);
          samples.push([...canvas.getContext('2d').getImageData(0,0,1,1).data].slice(0,3));
        }
        return {duration: video.duration, samples, bytes: [...new Uint8Array(await blob.arrayBuffer())]};
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    }, fps);
    expect(Math.abs(result.duration - 360 / fps)).toBeLessThanOrEqual(0.001);
    const timestamps = videoTimestamps(result.bytes);
    expect(timestamps).toHaveLength(367); // 360 exposures + seven final-image transport copies.
    const error = Math.max(...timestamps.slice(0,360).map((time, i) => Math.abs(time - i * 1000 / fps)));
    const lastStart = Math.round(359 * 1000 / fps);
    expect(timestamps.slice(360)).toEqual(Array.from({length:7},(_,i)=>
      Math.round(lastStart + (360 * 1000 / fps - lastStart) * (i+1) / 8)));
    expect(timestamps.at(-1)).toBeLessThan(360 * 1000 / fps);
    expect(error).toBeLessThanOrEqual(1);
    for (const [i, expected] of [[0,[255,0,0]], [1,[0,255,0]], [2,[0,0,255]]]) {
      result.samples[i].forEach((value, c) => expect(Math.abs(value - expected[c])).toBeLessThanOrEqual(5));
    }
    console.log(`Native WebM ${fps}fps / 360 exposures: ${result.duration}s; max block error ${error.toFixed(6)}ms; seek RGB ${JSON.stringify(result.samples)}`);
  }
});

test('timeline autosave snapshots holds before await and persists undo redo deletion', async ({page}) => {
  await captureColors(page);
  const original = await hashes(page);
  await page.evaluate(async () => {
    await main.project.flushed();
    const write = projectStorage.write.bind(projectStorage);
    window.holdWrites = [];
    let first = true;
    projectStorage.write = async data => {
      if (first) { first = false; await new Promise(resolve => { window.releaseTimelineWrite = resolve; }); }
      holdWrites.push(data.holds.slice());
      return write(data);
    };
  });
  await hold(page, 0, 2);
  await page.locator('#moveRight').click();
  await page.locator('#undoButton').click();
  await page.locator('#redoButton').click();
  await page.evaluate(async () => { releaseTimelineWrite(); await main.project.flushed(); });
  expect(await page.evaluate(() => holdWrites)).toEqual([[2,1,1],[1,2,1]]);
  await page.locator('#deleteFrame').click();
  await page.evaluate(() => main.project.flushed());
  expect(await page.evaluate(async () => (await projectStorage.read()).frames.length)).toBe(2);
  await page.locator('#undoButton').click();
  await page.evaluate(() => main.project.flushed());
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await hashes(page)).toEqual([original[1],original[0],original[2]]);
  expect((await pixels(page)).holds).toEqual([1,2,1]);
});

test('delayed invalid project locks timeline and preserves selection and history', async ({page}) => {
  await captureColors(page); await select(page, 0);
  const original = await hashes(page), buffer = await download(page);
  await page.evaluate(() => {
    window.createImageBitmap = () => new Promise((resolve, reject) => {
      window.rejectImage = () => reject(new Error('Delayed invalid image'));
    });
  });
  await upload(page, buffer);
  await expect.poll(() => page.evaluate(() => typeof rejectImage)).toBe('function');
  for (const id of ['captureButton','playButton','undoButton','redoButton','liveButton',
    'duplicateFrame','deleteFrame','moveLeft','moveRight','frameHold'])
    await expect(page.locator('#'+id)).toBeDisabled();
  await page.locator('#thumbnail-container canvas').nth(2).dispatchEvent('click');
  await page.locator('#frameHold').evaluate(input => { input.value = 9; input.dispatchEvent(new Event('change')); });
  expect((await pixels(page)).holds).toEqual([1,1,1]);
  await page.evaluate(() => rejectImage());
  await expect(page.locator('#project-status')).toContainText('Current project preserved');
  expect(await hashes(page)).toEqual(original);
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 1 of 3');
  await expect(page.locator('#undoButton')).toBeEnabled();
  await expect(page.locator('#redoButton')).toBeDisabled();
  await expect(page.locator('#moveLeft')).toBeDisabled();
});

test('history is bounded to 50 edits and deleting the final frame returns Live', async ({page}) => {
  test.setTimeout(30000); // 52 hold edits plus 50 actual Undo button interactions.
  await captureColors(page, 1);
  await select(page, 0);
  for (let i = 0; i < 52; i++) await hold(page, 0, i % 2 ? 1 : 2);
  for (let i = 0; i < 50; i++) await page.locator('#undoButton').click();
  await expect(page.locator('#undoButton')).toBeDisabled();
  expect((await pixels(page)).frames).toEqual([[255,0,0]]);
  await page.locator('#deleteFrame').click();
  await expect(page.locator('#selectionStatus')).toHaveText('Live camera');
  await expect(page.locator('#frame-count')).toHaveText('0');
  await page.locator('#undoButton').click();
  expect((await pixels(page)).frames).toEqual([[255,0,0]]);
});

for (const [width,height] of [[1024,768],[390,844]]) {
  test(`six-color timeline layout ${width}`, async ({page}) => {
    await page.setViewportSize({width,height});
    await captureColors(page, 6); await select(page, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 1024) {
      expect(await page.evaluate(() => scrollY)).toBe(0);
      for (const selector of ['#video-container','.transport','#thumbnail-container']) {
        const box = await page.locator(selector).boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
    }
    for (const id of ['liveButton','duplicateFrame','deleteFrame','moveLeft','moveRight','frameHold','redoButton']) {
      await page.locator('#'+id).scrollIntoViewIfNeeded();
      const box = await page.locator('#'+id).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => { scrollTo(0,0); document.getElementById('control-column').scrollTop = 0; });
    await page.screenshot({path:path.resolve(`test-results/timeline-${width}.png`), fullPage:true});
  });
}
