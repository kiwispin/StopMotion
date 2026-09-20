import {test, expect} from '@playwright/test';

async function ready(page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await page.evaluate(async () => {
    const an = main.animator;
    const fixture = document.createElement('canvas'); fixture.width = 64; fixture.height = 48;
    const ctx = fixture.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 64, 48);
    const stream = fixture.captureStream(30);
    navigator.mediaDevices.getUserMedia = async () => stream;
    an.detachStream(); an.clear();
    await an.attachStream('modes-fixture');
    await an.video.play().catch(() => {});
    for (let i = 0; i < 100 && an.video.readyState < 2; i++) {
      stream.getVideoTracks()[0].requestFrame();
      await new Promise(r => setTimeout(r, 50));
    }
    an.syncCameraDimensions(false);
  });
}

test('live and review modes drive the chip and contextual panel', async ({page}) => {
  test.setTimeout(30000);
  await ready(page);
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await main.animator.capture(); });

  expect(await page.evaluate(() => ({
    chip: document.getElementById('modeChip').textContent,
    live: document.getElementById('modeChip').classList.contains('live'),
    panelHidden: document.getElementById('selected-frame-panel').hidden,
    frames: main.animator.frames.length
  }))).toEqual({chip: 'Live camera', live: true, panelHidden: true, frames: 3});

  await page.locator('#thumbnail-container canvas').first().click();
  expect(await page.evaluate(() => ({
    chip: document.getElementById('modeChip').textContent,
    review: document.getElementById('modeChip').classList.contains('review'),
    panelHidden: document.getElementById('selected-frame-panel').hidden,
    label: document.getElementById('selectedFrameLabel').textContent,
    hold: document.getElementById('holdValue').textContent
  }))).toEqual({chip: 'Reviewing frame 1', review: true, panelHidden: false, label: 'Frame 1', hold: '1'});
  await page.screenshot({path: 'test-results/review-mode.png', fullPage: true});

  await page.locator('#holdIncrease').click();
  await page.locator('#holdIncrease').click();
  expect(await page.evaluate(() => ({
    hold: document.getElementById('holdValue').textContent,
    label: document.getElementById('selectedHoldLabel').textContent,
    stored: main.animator.holds[0]
  }))).toEqual({hold: '3', label: '3 exposures', stored: 3});

  await page.locator('#panelDuplicate').click();
  expect(await page.evaluate(() => main.animator.frames.length)).toBe(4);
  await page.locator('#panelDelete').click();
  expect(await page.evaluate(() => main.animator.frames.length)).toBe(3);

  await page.locator('#panelBackToLive').click();
  expect(await page.evaluate(() => ({
    chip: document.getElementById('modeChip').textContent,
    hidden: document.getElementById('selected-frame-panel').hidden
  }))).toEqual({chip: 'Live camera', hidden: true});
});

test('capture shows a pending badge while frames compress', async ({page}) => {
  test.setTimeout(30000);
  await ready(page);
  const pending = await page.evaluate(async () => {
    const an = main.animator;
    const native = HTMLCanvasElement.prototype.toBlob, held = [];
    let hold = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      const run = () => native.call(this, callback, ...args);
      if (hold) held.push(run); else run();
    };
    const first = an.capture(), second = an.capture();
    const badge = document.getElementById('capturePending').textContent;
    const count = an.pendingCaptures();
    hold = false;
    while (held.length) held.shift()();
    HTMLCanvasElement.prototype.toBlob = native;
    await Promise.all([first, second]);
    return {badge, count, after: document.getElementById('capturePending').textContent, frames: an.frames.length};
  });
  expect(pending.count).toBe(2);
  expect(pending.badge).toBe('Saving 2\u2026');
  expect(pending.after).toBe('');
  expect(pending.frames).toBe(2);
});

test('frame numbers, hold badges, zoom and go-to-frame work', async ({page}) => {
  test.setTimeout(30000);
  await ready(page);
  await page.evaluate(async () => { for (let i = 0; i < 5; i++) await main.animator.capture(); });

  await page.locator('#thumbnail-container canvas').nth(1).click();
  for (let i = 0; i < 3; i++) await page.locator('#holdIncrease').click();

  expect(await page.evaluate(() => [...document.querySelectorAll('#thumbnail-container .thumb')].map(cell => ({
    index: cell.dataset.index,
    number: cell.querySelector('.thumb-number').textContent,
    hold: cell.querySelector('.thumb-hold').hidden ? null : cell.querySelector('.thumb-hold').textContent
  })))).toEqual([
    {index: '0', number: '1', hold: null},
    {index: '1', number: '2', hold: '\u00d74'},
    {index: '2', number: '3', hold: null},
    {index: '3', number: '4', hold: null},
    {index: '4', number: '5', hold: null}
  ]);

  const before = await page.locator('#thumbnail-container canvas').first().boundingBox();
  await page.locator('#zoomIn').click();
  const after = await page.locator('#thumbnail-container canvas').first().boundingBox();
  expect(after.width).toBeGreaterThan(before.width);
  expect(await page.evaluate(() =>
    getComputedStyle(document.getElementById('thumbnail-container')).getPropertyValue('--thumb-w').trim())).toBe('112px');

  await page.locator('#goToFrame').fill('5');
  await page.locator('#goToFrameButton').click();
  expect(await page.evaluate(() => ({
    status: document.getElementById('selectionStatus').textContent,
    chip: document.getElementById('modeChip').textContent,
    selected: main.animator.timeline.selected
  }))).toEqual({status: 'Frame 5', chip: 'Reviewing frame 5', selected: 4});
  await page.screenshot({path: 'test-results/timeline-scale.png', fullPage: true});
});

test('save status exposes a state for the indicator dot', async ({page}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  await page.evaluate(() => main.project.changed());
  await expect.poll(() => page.evaluate(() => document.querySelector('.statusbar').dataset.state)).toBe('saved');
});
