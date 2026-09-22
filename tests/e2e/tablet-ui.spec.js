import {test, expect} from './fixtures.js';

test.use({hasTouch: true});
test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });

async function ready(page, width = 744, height = 1024) {
  await page.setViewportSize({width, height});
  await page.goto('/'); await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
}
async function reachable(page, selector) {
  expect(await page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0 &&
      r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 &&
      el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), selector).toBe(true);
}
for (const [width, height] of [[744,1024], [1133,600], [1024,1240], [1366,900]]) {
  test(`tablet capture and editing ${width}x${height}`, async ({page}) => {
    await ready(page, width, height);
    for (const id of ['captureButton', 'playButton', 'onionToggle', 'tabletSettingsButton', 'tabletProjectButton'])
      await reachable(page, '#' + id);
    const stage = await page.locator('#video-container').boundingBox();
    expect(stage.width / stage.height).toBeCloseTo(16/9, 2);
    expect(stage.width).toBeGreaterThan(width < height ? width - 30 : width === 1133 ? 940 : 1050);
    if (width < height) {
      const shutter = await page.locator('#captureButton').boundingBox();
      expect(shutter.y + shutter.height - (stage.y + stage.height)).toBeCloseTo(20, 1);
    }
    for (let i = 0; i < 3; i++) await page.locator('#captureButton').click();
    await expect(page.locator('#frame-count')).toHaveText('3');
    await page.screenshot({path: `test-results/tablet-live-${width}.png`});
    await page.locator('#lastFrameButton').click();
    await expect(page.locator('#editMode')).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['duplicateFrame', 'deleteFrame', 'moveLeft', 'moveRight', 'holdIncrease'])
      await reachable(page, '#' + id);
    await page.locator('#duplicateFrame').click();
    await expect(page.locator('#frame-count')).toHaveText('4');
    await page.locator('#holdIncrease').click();
    expect(await page.evaluate(() => main.animator.holds.at(-1))).toBe(2);
    await page.locator('#moveLeft').click();
    await page.locator('#deleteFrame').click();
    await expect(page.locator('#frame-count')).toHaveText('3');
    await page.locator('#undoButton').click();
    await expect(page.locator('#frame-count')).toHaveText('4');
    await page.screenshot({path: `test-results/tablet-edit-${width}.png`});
    expect(await page.evaluate(() => ({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})))
      .toEqual({w: width, h: height});
    await page.locator('#captureMode').click();
    await reachable(page, '#captureButton');
    const populated = await page.locator('#video-container').boundingBox();
    console.log('TABLET IMAGE', JSON.stringify({viewport:[width,height],empty:stage,populated}));
  });
}

test('tablet settings, remembered onion, project backup and actual save failure', async ({page}) => {
  await ready(page);
  await page.locator('#captureButton').click();
  await page.locator('#tabletSettingsButton').click();
  await page.locator('#onionOpacity').fill('35');
  await page.locator('#onionOpacity').dispatchEvent('input');
  await page.locator('#playbackSpeed').fill('4');
  await page.locator('#playbackSpeed').dispatchEvent('input');
  await page.getByRole('button', {name:'Close settings', exact:true}).click();
  await page.locator('#onionToggle').click();
  await expect(page.locator('#snapshot-canvas')).toHaveCSS('opacity', '0');
  await page.locator('#onionToggle').click();
  await expect(page.locator('#snapshot-canvas')).toHaveCSS('opacity', '0.35');
  await page.locator('#tabletProjectButton').click();
  const download = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  expect((await download).suggestedFilename()).toBe('StopMotion.stopmotion');
  await expect(page.locator('#tabletProject')).not.toBeVisible();
  await page.evaluate(async () => {
    await main.project.flushed();
    window.originalWrite = projectStorage.write;
    projectStorage.write = async () => { throw new Error('Tablet quota fixture'); };
    main.project.changed();
  });
  await expect(page.locator('#tabletSaveAlert')).toContainText('Tablet quota fixture');
  await reachable(page, '#tabletBackup');
  await page.evaluate(() => { projectStorage.write = originalWrite; });
  await page.locator('#tabletRetry').click();
  await expect(page.locator('#tabletSaveAlert')).toBeHidden();
  await page.locator('#tabletProjectButton').click();
  await page.locator('#clearButton').click();
  await expect(page.locator('#clearConfirmDialog')).toBeVisible();
  await page.locator('#clearCancelButton').click();
  await expect(page.locator('#frame-count')).toHaveText('1');
});

test('700 frames stay virtualized, scroll away from selection and survive rotation', async ({page}) => {
  await ready(page);
  await page.locator('#captureButton').click();
  await expect(page.locator('#frame-count')).toHaveText('1');
  await page.evaluate(() => {
    const an = main.animator;
    window.originalFrame = an.frames[0];
    an.frames = Array(700).fill(originalFrame);
    an.frameWebps = Array(700).fill(an.frameWebps[0]);
    an.holds = Array(700).fill(1); an.timeline.reset();
  });
  await page.locator('#goToFrame').fill('350');
  await page.locator('#goToFrame').press('Enter');
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 350 of 700');
  await reachable(page, '.thumb[data-index="349"] canvas');
  expect(await page.locator('.thumb').count()).toBeLessThan(60);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 354 of 700');
  await page.locator('#thumbnail-container').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.thumb[data-index="0"]')).toBeVisible();
  await page.locator('#latestFrameButton').click();
  await reachable(page, '.thumb[data-index="699"] canvas');
  expect(await page.locator('.thumb').evaluateAll(cells => cells.every(cell => {
    const next = cells.find(other => Number(other.dataset.index) === Number(cell.dataset.index) + 4);
    return !next || cell.getBoundingClientRect().bottom <= next.getBoundingClientRect().top;
  }))).toBe(true);
  await page.screenshot({path:'test-results/tablet-700.png'});
  for (const [width,height] of [[1366,900], [1024,1240], [1133,600], [744,1024]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('#captureMode')).toBeVisible();
    await expect.poll(() => page.locator('#video-container').evaluate(el => {
      const r = el.getBoundingClientRect(); return Math.abs(r.width / r.height - 16/9) < .001;
    })).toBe(true);
    await expect(page.locator('#selectionStatus')).toHaveText('Frame 700 of 700');
    expect(await page.evaluate(() => main.animator.frames.every(f => f === originalFrame))).toBe(true);
    expect(await page.locator('.thumb').count()).toBeLessThan(60);
  }
  await page.locator('#captureMode').click();
  await page.locator('#captureButton').click();
  await expect(page.locator('#frame-count')).toHaveText('701');
});

test('tablet playback, export and restoring the desktop controls', async ({page}) => {
  await ready(page, 1366, 900);
  for (let i = 0; i < 3; i++) await page.locator('#captureButton').click();
  await page.locator('#lastFrameButton').click();
  await page.locator('#frameHold').fill('12'); await page.locator('#frameHold').press('Tab');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await page.locator('#saveButton').click();
  await expect(page.locator('#saveDialog')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.locator('#saveConfirmButton').click(); await downloaded;
  await expect(page.locator('#exportProgressText')).toContainText('downloading');
  await page.locator('#saveConfirmButton').click();
  await page.setViewportSize({width: 1600, height: 1000});
  await expect(page.locator('.live-capture #captureButton')).toBeVisible();
  await expect(page.locator('.topbar #saveProject')).toBeVisible();
  await expect(page.locator('.filmstrip #undoButton')).toBeVisible();
  await page.locator('#liveButton').click();
  await page.locator('#captureButton').click();
  await expect(page.locator('#frame-count')).toHaveText('4');
  await page.setViewportSize({width: 744, height: 1024});
  await reachable(page, '#captureButton');
  await expect(page.locator('#captureButton')).toHaveCount(1);
});
