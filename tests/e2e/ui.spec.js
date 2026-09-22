import {test, expect} from './fixtures.js';
import path from 'node:path';

test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });
async function open(page) {
  await page.goto('/'); await page.evaluate(() => main.project.ready);
  await expect.poll(() => page.evaluate(() => main.animator.video.readyState)).toBeGreaterThanOrEqual(2);
}
for (const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844]]) {
  test('responsive studio ' + width, async ({page}) => {
    await page.setViewportSize({width,height}); await open(page);
    for (let i=0;i<3;i++) await page.locator('#captureButton').click();
    await expect(page.locator('#frame-count')).toHaveText('3');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1000) {
      // Check initial composition before any reachability helper can scroll it.
      expect(await page.evaluate(() => scrollY)).toBe(0);
      for (const selector of ['#video-container', '.transport', '#thumbnail-container', '#thumbnail-container canvas']) {
        for (const item of await page.locator(selector).all()) {
          const box = await item.boundingBox();
          expect(box.height).toBeGreaterThan(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(height);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
    }
    for (const id of ['captureButton','playButton','saveProject','openProject','clearButton','onionOpacity']) {
      const control = page.locator('#'+id); await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    await page.locator('#clearButton').click();
    await expect(page.getByRole('dialog', {name:'Start a new animation?'})).toBeVisible();
    await page.locator('#clearCancelButton').click();
    await page.evaluate(() => scrollTo(0,0));
    await page.locator('#control-column').evaluate(panel => { panel.scrollTop = 0; });
    await page.screenshot({path:path.resolve('test-results/studio-'+width+'.png'),fullPage:true});
  });
}
test('iPad Mini portrait keeps capture workflow on one screen', async ({page}) => {
  await page.setViewportSize({width:744,height:1024}); await open(page);
  for (let i=0;i<4;i++) await page.locator('#captureButton').click();
  const live = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {scrollWidth:document.documentElement.scrollWidth,
      scrollHeight:document.documentElement.scrollHeight,
      stage:rect('#video-container'), controls:rect('#control-column'),
      capture:rect('#captureButton'), filmstrip:rect('.filmstrip')};
  });
  expect(live.scrollWidth).toBeLessThanOrEqual(744);
  expect(live.scrollHeight).toBeLessThanOrEqual(1024);
  expect(live.stage.width).toBeGreaterThanOrEqual(710);
  expect(live.stage.height).toBeGreaterThanOrEqual(399);
  expect(live.capture.bottom).toBeLessThanOrEqual(1024);
  expect(live.controls.bottom).toBeLessThan(live.filmstrip.top);
  await page.locator('#thumbnail-container canvas').first().click();
  await expect(page.locator('#selected-frame-panel')).toBeVisible();
  await expect(page.locator('#button-container')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1024);
  await page.screenshot({path:path.resolve('test-results/studio-744.png'),fullPage:true});
});
test('iPad landscape keeps a large camera with browser bars and after rotation', async ({page}) => {
  await page.setViewportSize({width:1133,height:600}); await open(page);
  async function checkCamera() {
    await page.evaluate(() => scrollTo(0,0));
    const stage = await page.locator('#video-container').boundingBox();
    expect(stage.width).toBeGreaterThanOrEqual(600);
    expect(stage.height).toBeGreaterThanOrEqual(339);
    expect(stage.y + stage.height).toBeLessThanOrEqual(600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['#captureButton','#playButton']) {
      expect(await page.locator(selector).evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight &&
          el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2));
      })).toBe(true);
    }
  }
  await checkCamera();
  for (let i=0;i<4;i++) await page.locator('#captureButton').click();
  await expect(page.locator('#frame-count')).toHaveText('4');
  await checkCamera();
  await page.locator('#thumbnail-container canvas').first().click();
  await expect(page.locator('#selected-frame-panel')).toBeVisible();
  await page.locator('#duplicateFrame').click();
  await expect(page.locator('#frame-count')).toHaveText('5');
  await page.locator('#deleteFrame').click();
  await expect(page.locator('#frame-count')).toHaveText('4');
  await page.locator('#liveButton').click();
  await checkCamera();
  await page.screenshot({path:path.resolve('test-results/studio-landscape-1133.png'),fullPage:true});
  await page.setViewportSize({width:744,height:1024});
  expect((await page.locator('#video-container').boundingBox()).width).toBeGreaterThanOrEqual(710);
  await page.setViewportSize({width:1133,height:600});
  await checkCamera();
  await page.setViewportSize({width:1024,height:600});
  await checkCamera();
});

test('onion skin persists and summary tracks delete undo fps and clear', async ({page}) => {
  await open(page);
  await page.locator('#captureButton').click(); await page.locator('#captureButton').click();
  await page.locator('#onionOpacity').fill('25');
  await page.locator('#onionOpacity').dispatchEvent('input');
  await page.locator('#playbackSpeed').fill('4'); await page.locator('#playbackSpeed').dispatchEvent('input');
  await expect(page.locator('#duration')).toHaveText('0.50 s');
  await expect(page.locator('#snapshot-canvas')).toHaveCSS('opacity','0.25');
  await page.evaluate(() => main.project.flushed());
  await page.reload(); await page.evaluate(() => main.project.ready);
  await expect(page.locator('#onionValue')).toHaveText('25%');
  await expect(page.locator('#duration')).toHaveText('0.50 s');
  // Recovery starts a new history boundary; deletion remains an explicit edit.
  await expect(page.locator('#undoButton')).toBeDisabled();
  await page.locator('#thumbnail-container canvas').last().click();
  await page.locator('#deleteFrame').click();
  await expect(page.locator('#duration')).toHaveText('0.25 s');
  await page.locator('#undoButton').click();
  await expect(page.locator('#duration')).toHaveText('0.50 s');
  await page.locator('#redoButton').click();
  await expect(page.locator('#frame-count')).toHaveText('1');
  await expect(page.locator('#duration')).toHaveText('0.25 s');
  await page.locator('#clearButton').click(); await page.locator('#clearConfirmButton').click();
  await expect(page.locator('#frame-count')).toHaveText('0');
});
test('native control shortcuts and accessible transport', async ({page}) => {
  await open(page); await page.locator('#captureButton').click();
  // One exposure at 7fps lasts only 143ms, shorter than a slow-host UI assertion.
  await page.locator('#thumbnail-container canvas').first().click();
  await page.locator('#frameHold').fill('120');
  await page.locator('#frameHold').press('Tab');
  await page.locator('#liveButton').click();
  await page.locator('#onionOpacity').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Backspace');
  await expect(page.locator('#frame-count')).toHaveText('1');
  await page.locator('#saveButton').click();
  await page.locator('#movieName').fill('My clip');
  await page.keyboard.press('Space'); await page.keyboard.press('Backspace');
  await expect(page.locator('#movieName')).toHaveValue('My clip');
  await expect(page.locator('#frame-count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
  await page.locator('#onionOpacity').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#onionOpacity')).toHaveCSS('outline-style','solid');
  await page.locator('#onionOpacity').evaluate(e => e.blur());
  await page.keyboard.press('Space'); await expect(page.locator('#frame-count')).toHaveText('2');
  await page.keyboard.press('Backspace'); await expect(page.locator('#frame-count')).toHaveText('1');
  expect(await page.locator('button').evaluateAll(buttons => buttons.every(b => (b.getAttribute('aria-label') || b.textContent).trim()))).toBe(true);
});
