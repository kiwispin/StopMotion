import {test, expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {asLegacyProject} from './project-file.js';

test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });

async function capture(page) {
  for (let i = 0; i < 3; i++) {
    await page.locator('#captureButton').click();
    await expect.poll(() => page.evaluate(() => main.animator.captureBusy)).toBe(false);
  }
  await page.locator('#playbackSpeed').fill('9');
  await page.locator('#playbackSpeed').dispatchEvent('input');
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
}
async function state(page) {
  return page.evaluate(async () => ({
    frames: await Promise.all(main.animator.frames.map(async frame =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', await frame.png.arrayBuffer()))].join(','))),
    fps: main.animator.playbackSpeed,
    thumbs: document.querySelectorAll('#thumbnail-container canvas').length
  }));
}
async function clear(page) {
  await page.locator('#clearButton').click();
  await page.locator('#clearConfirmButton').click();
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
}
test('capture autosave reload preserves all pixels, order and fps', async ({page}) => {
  await capture(page);
  const before = await state(page);
  expect(before.frames).toHaveLength(3);
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await state(page)).toEqual(before);
});
test('portable download clear open restores exact frames and settings', async ({page}) => {
  await capture(page); const before = await state(page);
  const download = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const file = await download;
  const buffer = await readFile(await file.path());
  await clear(page);
  await page.locator('#projectFile').setInputFiles({name:'test.stopmotion',mimeType:'application/json',buffer});
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
  expect(await state(page)).toEqual(before);
});
test('malformed project leaves current project intact', async ({page}) => {
  await capture(page); const before = await state(page);
  await page.locator('#projectFile').setInputFiles({name:'bad.stopmotion',mimeType:'application/json',buffer:Buffer.from('{"version":99}')});
  await expect(page.locator('#project-status')).toContainText('Current project preserved');
  expect(await state(page)).toEqual(before);
});
test('clear persists empty project across reload', async ({page}) => {
  await capture(page); await clear(page);
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect((await state(page)).frames).toHaveLength(0);
  expect((await state(page)).thumbs).toBe(0);
});
test('quota failure remains visible and portable save still works', async ({page}) => {
  await page.evaluate(() => {
    projectStorage.write = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.locator('#captureButton').click();
  await expect(page.locator('#project-status')).toContainText('Autosave failed');
  const pending = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const download = await pending;
  const data = asLegacyProject(await readFile(await download.path()));
  expect(data.frames).toHaveLength(1);
  expect(data.frames[0]).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('#retrySave')).toBeVisible();
});

test('unreadable recovery is not overwritten by edits; Clear explicitly replaces it', async ({page}) => {
  await page.evaluate(() => projectStorage.write({version: 999, marker: 'preserve-me'}));
  await page.reload(); await page.evaluate(() => main.project.ready);
  await expect(page.locator('#project-status')).toContainText('Stored data is protected');
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('#captureButton').click();
  await page.evaluate(() => main.project.flushed());
  expect(await page.evaluate(() => projectStorage.read())).toEqual({version:999, marker:'preserve-me'});
  await clear(page);
  expect(await page.evaluate(async () => (await projectStorage.read()).frames.length)).toBe(0);
});

test('invalid Open keeps autosave failure and Retry visible', async ({page}) => {
  await page.evaluate(() => { projectStorage.write = async () => { throw new Error('denied'); }; });
  await page.locator('#captureButton').click();
  await expect(page.locator('#project-status')).toContainText('Autosave failed');
  await page.locator('#projectFile').setInputFiles({name:'bad.stopmotion',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.locator('#project-status')).toContainText('Current project preserved');
  await expect(page.locator('#project-status')).toContainText('Autosave failed');
  await expect(page.locator('#retrySave')).toBeVisible();
});

test('portable export rejects settings that its parser would reject', async ({page}) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.evaluate(() => { main.animator.name = 'x'.repeat(201); });
  await page.locator('#saveProject').click();
  await expect(page.locator('#project-status')).toContainText('Project download failed');
  expect(downloads).toBe(0);
});

test('autosaves serialize writes and snapshot settings before await', async ({page}) => {
  await page.evaluate(() => {
    const write = projectStorage.write.bind(projectStorage);
    window.writes = [];
    let first = true;
    projectStorage.write = async data => {
      if (first) { first = false; await new Promise(resolve => { window.releaseWrite = resolve; }); }
      window.writes.push(data.fps);
      return write(data);
    };
    main.animator.setPlaybackSpeed(4);
    main.animator.setPlaybackSpeed(11);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseWrite)).toBe('function');
  await page.evaluate(() => window.releaseWrite());
  await page.evaluate(() => main.project.flushed());
  expect(await page.evaluate(() => window.writes)).toEqual([4,11]);
  expect(await page.evaluate(async () => (await projectStorage.read()).fps)).toBe(11);
});

test('undo edits persist; corrupt image import preserves pixels', async ({page}) => {
  await capture(page);
  await page.locator('#undoButton').click();
  await page.evaluate(() => main.project.flushed());
  const before = await state(page);
  expect(before.frames).toHaveLength(2);
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect(await state(page)).toEqual(before);
  const bad = {format:'stopmotion-project', version:1, width:640,height:480,fps:9,flip:false,name:'',
    frames:['data:image/png;base64,AQID']};
  await page.locator('#projectFile').setInputFiles({name:'broken.stopmotion',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
  await expect(page.locator('#project-status')).toContainText('Current project preserved');
  expect(await state(page)).toEqual(before);
});

test('project opening blocks capture during validation', async ({page}) => {
  await capture(page);
  const pending = page.waitForEvent('download'); await page.locator('#saveProject').click();
  const buffer = await readFile(await (await pending).path());
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
      await new Promise(resolve => { window.resumeDecode = resolve; });
      window.createImageBitmap = decode;
      return decode(...args);
    };
  });
  await page.locator('#projectFile').setInputFiles({name:'test.stopmotion',mimeType:'application/json',buffer});
  await expect(page.locator('#captureButton')).toBeDisabled();
  await expect(page.locator('#playButton')).toBeDisabled();
  await expect(page.locator('#undoButton')).toBeDisabled();
  await expect(page.locator('#onionOpacity')).toBeDisabled();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => main.animator.frames.length)).toBe(3);
  await page.evaluate(() => { window.resumeDecode(); });
  await expect(page.locator('#project-status')).toHaveText('Saved on this device');
});

test('invalid local snapshots preserve last recoverable durable project', async ({page}) => {
  await capture(page);
  for (const invalid of ['frames', 'pixels', 'name']) {
    await page.evaluate(kind => {
      const an = main.animator;
      const original = {frames:an.frames, w:an.w, h:an.h, name:an.name};
      if (kind === 'frames') an.frames = Array(2001).fill(an.frames[0]);
      if (kind === 'pixels') { an.w = 4096; an.h = 4096; an.frames = Array(9).fill(an.frames[0]); }
      if (kind === 'name') an.name = 'x'.repeat(201);
      main.project.changed();
      Object.assign(an, original);
    }, invalid);
    await page.evaluate(() => main.project.flushed());
    await expect(page.locator('#project-status')).toContainText('Last saved project retained');
    expect(await page.evaluate(async () => {
      const data = await projectStorage.read();
      return {frames:data.frames.length, fps:data.fps, name:data.name};
    })).toEqual({frames:3,fps:9,name:''});
  }
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect((await state(page)).frames).toHaveLength(3);
});

test('Clear on empty protected recovery writes exactly one empty snapshot', async ({page}) => {
  await page.evaluate(() => projectStorage.write({version:999}));
  await page.reload(); await page.evaluate(() => main.project.ready);
  expect((await state(page)).frames).toHaveLength(0);
  await page.evaluate(() => {
    window.resetWrites = [];
    const write = projectStorage.write.bind(projectStorage);
    projectStorage.write = data => { resetWrites.push({frames:data.frames.length}); return write(data); };
  });
  await clear(page); await page.evaluate(() => main.project.flushed());
  expect(await page.evaluate(() => resetWrites)).toEqual([{frames:0}]);
  await page.reload(); await page.evaluate(() => main.project.ready);
  await expect(page.locator('#project-status')).toHaveText('Recovered saved project');
});

test('saving a project does not decode frames and Clear persists an empty project', async ({page}) => {
  await capture(page);
  await page.evaluate(() => {
    window.decodeCalls = 0;
    const decode = createImageBitmap;
    window.createImageBitmap = (...args) => { decodeCalls++; return decode(...args); };
  });
  const pending = page.waitForEvent('download'); await page.locator('#saveProject').click(); await pending;
  expect(await page.evaluate(() => decodeCalls)).toBe(0);
  await clear(page);
  expect(await page.evaluate(async () => {
    const data = await projectStorage.read(); return {frames:data.frames.length};
  })).toEqual({frames:0});
});
