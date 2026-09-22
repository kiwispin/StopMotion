import {test, expect} from './fixtures.js';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';

test('WebP-free browsers export a complete H.264 MP4 with holds intact', async ({page}, testInfo) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === 'image/webp') { callback(null); return; }
      nativeToBlob.call(this, callback, type, quality);
    };
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await page.evaluate(async () => {
    const an = main.animator;
    an.setDimensions(640, 480);
    an.setPlaybackSpeed(6);
    for (const [i, color] of ['#ff0000', '#008000', '#0000ff'].entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d');
      context.fillStyle = color; context.fillRect(0, 0, 640, 480);
      context.fillStyle = '#ffffff'; context.font = 'bold 140px sans-serif';
      context.fillText(String(i + 1), 280, 290);
      const frame = await stopFrames.fromCanvas(canvas);
      an.frames.push(frame); an.holds.push(i + 1); an.frameWebps.push(stopMedia.lazyFrame(frame));
    }
    an.timeline.reset();
    an.refreshSummary();
  });

  await page.locator('#saveButton').click();
  await expect(page.locator('#saveConfirmButton')).toHaveText('Export MP4');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#saveConfirmButton').click();
  await expect(page.locator('#exportProgressText')).toContainText('Creating MP4 frame');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('StopMotion.mp4');
  const output = testInfo.outputPath('six-exposures.mp4');
  await download.saveAs(output);

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets',
    '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,nb_read_packets:format=duration,size', '-of', 'json', output],
  {encoding: 'utf8'}));
  expect(probe.streams[0].codec_name).toBe('h264');
  expect([probe.streams[0].width, probe.streams[0].height]).toEqual([640, 480]);
  expect(Number(probe.streams[0].nb_read_packets)).toBeGreaterThanOrEqual(6);
  expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThan(1 / 6);
  expect(Number(probe.format.size)).toBeGreaterThan(0);

  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-vsync', '0',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], {maxBuffer: 64 * 1024 * 1024});
  const frameBytes = 640 * 480 * 3;
  const colors = [];
  for (let i = 0; i < Math.floor(raw.length / frameBytes); i++) {
    const offset = i * frameBytes + (20 * 640 + 20) * 3;
    const pixel = [raw[offset], raw[offset + 1], raw[offset + 2]];
    colors.push(pixel[0] > pixel[1] * 1.5 ? 'red' : pixel[1] > pixel[2] * 1.5 ? 'green' : 'blue');
  }
  expect(colors.slice(0, 6)).toEqual(['red', 'green', 'green', 'blue', 'blue', 'blue']);
  await expect(page.locator('#saveConfirmButton')).toHaveText('Done');
});

test('export explains when neither WebM nor MP4 encoding is available', async ({page}) => {
  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === 'image/webp') { callback(null); return; }
      nativeToBlob.call(this, callback, type, quality);
    };
    window.MediaRecorder = undefined;
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = main.animator.w; canvas.height = main.animator.h;
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    const frame = await stopFrames.fromCanvas(canvas);
    main.animator.frames.push(frame); main.animator.holds.push(1);
    main.animator.frameWebps.push(stopMedia.lazyFrame(frame));
  });
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveConfirmButton')).toHaveText('Export unavailable');
  await expect(page.locator('#saveConfirmButton')).toBeDisabled();
  await expect(page.locator('#exportUnsupported')).toBeVisible();
});

test('700-frame HD MP4 export completes with every exposure', async ({page}, testInfo) => {
  test.skip(process.env.STOPMOTION_LARGE_MP4 !== '1', 'Run explicitly for the 700-frame MP4 acceptance check.');
  test.setTimeout(120000);
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  const prepared = await page.evaluate(async () => {
    const started = performance.now();
    const an = main.animator;
    an.setDimensions(1280, 720); an.setPlaybackSpeed(24);
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext('2d');
    for (let i = 0; i < 700; i++) {
      context.fillStyle = `hsl(${i * 137.5 % 360} 75% 45%)`;
      context.fillRect(0, 0, 1280, 720);
      context.fillStyle = '#ffffff'; context.font = 'bold 120px sans-serif';
      context.fillText(String(i + 1), 80, 180);
      context.fillStyle = '#111827';
      context.fillRect((i * 37) % 1080, 300 + (i * 19) % 260, 200, 120);
      const frame = await stopFrames.fromCanvas(canvas);
      an.frames.push(frame); an.holds.push(1); an.frameWebps.push(stopMedia.lazyFrame(frame));
    }
    return {prepareMs: performance.now() - started, pngBytes: stopFrames.bytes(an.frames)};
  });
  const downloadPromise = page.waitForEvent('download');
  const exportStarted = Date.now();
  await page.evaluate(() => main.animator.save('700-frames', {format: 'mp4', quality: 0.98}));
  const download = await downloadPromise;
  const output = testInfo.outputPath('700-frames.mp4');
  await download.saveAs(output);
  const exportMs = Date.now() - exportStarted;
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets',
    '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,nb_read_packets:format=duration,size', '-of', 'json', output],
  {encoding: 'utf8'}));
  const result = {prepared, exportMs, packets: Number(probe.streams[0].nb_read_packets),
    duration: Number(probe.format.duration), bytes: Number(probe.format.size),
    codec: probe.streams[0].codec_name, size: [probe.streams[0].width, probe.streams[0].height]};
  await writeFile(testInfo.outputPath('RESULT.json'), JSON.stringify(result, null, 2));
  console.log('LARGE MP4 ' + JSON.stringify(result));
  expect(result.codec).toBe('h264');
  expect(result.size).toEqual([1280, 720]);
  expect(result.packets).toBeGreaterThanOrEqual(700);
  expect(Math.abs(result.duration - 700 / 24)).toBeLessThan((700 / 24) * 0.01);
  expect(result.bytes).toBeGreaterThan(0);
});
