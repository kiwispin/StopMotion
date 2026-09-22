import {test, expect} from '@playwright/test';

test.use({hasTouch: true});
test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto('/'); await page.evaluate(() => main.project.ready);
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });

async function frames(page, {count = 3, holds = [3,2,1], width = 640, height = 360} = {}) {
  await page.evaluate(async ({count, holds, width, height}) => {
    const an = main.animator, c = document.createElement('canvas');
    c.width = width; c.height = height;
    const images = [];
    for (const color of ['#ff0000', '#00ff00', '#0000ff']) {
      c.getContext('2d').fillStyle = color; c.getContext('2d').fillRect(0,0,width,height);
      images.push(await stopFrames.fromCanvas(c));
    }
    an.setDimensions(width,height); an.dimensionsLocked = true;
    an.frames = Array.from({length:count}, (_, i) => images[i % 3]);
    an.holds = Array.from({length:count}, (_, i) => holds[i % holds.length]);
    an.frameWebps = an.frames.map(stopMedia.lazyFrame); an.playbackSpeed = 10;
    an.timeline.reset(); window.watchOriginalFrames = an.frames.slice();
    for (const frame of images) await stopFrames.use(frame, () => {});
  }, {count, holds, width, height});
}
const pixel = page => page.locator('#watchCanvas').evaluate(c =>
  [...c.getContext('2d').getImageData(0,0,1,1).data].slice(0,3));
async function frozenClock(page) {
  await page.clock.install({time:new Date('2026-09-22T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
}

test('Watch respects holds, loops, pauses/resumes and stops on the last frame', async ({page}) => {
  await page.setViewportSize({width:1133,height:600});
  await expect(page.locator('#watchButton')).toBeDisabled();
  await frames(page); await frozenClock(page);
  await page.locator('#watchButton').click();
  await expect(page.locator('#watchPosition')).toHaveText('Frame 1 of 3');
  expect(await pixel(page)).toEqual([255,0,0]);
  await page.clock.runFor(200);
  await page.locator('#watchPlay').click();
  await expect(page.locator('#watchPlay')).toHaveAttribute('aria-pressed','false');
  await page.clock.runFor(1000); expect(await pixel(page)).toEqual([255,0,0]);
  await page.locator('#watchPlay').click();
  await page.clock.runFor(99); expect(await pixel(page)).toEqual([255,0,0]);
  await page.clock.runFor(2); expect(await pixel(page)).toEqual([0,255,0]);
  await page.clock.runFor(200); expect(await pixel(page)).toEqual([0,0,255]);
  await page.clock.runFor(100); expect(await pixel(page)).toEqual([255,0,0]);
  await page.clock.runFor(600); expect(await pixel(page)).toEqual([255,0,0]);
  await page.locator('#watchLoop').click();
  await page.clock.runFor(600);
  await expect(page.locator('#watchPlay')).toHaveText('↻ Replay');
  expect(await pixel(page)).toEqual([0,0,255]);
  await page.clock.runFor(1500); expect(await pixel(page)).toEqual([0,0,255]);
  await page.locator('#watchPlay').click();
  expect(await pixel(page)).toEqual([255,0,0]);
  await page.locator('#watchClose').click();
  await expect(page.locator('#watchDialog')).not.toBeVisible();
  await page.clock.runFor(1500);
  expect(await page.locator('#watchCanvas').evaluate(c => [c.width,c.height])).toEqual([1,1]);
  expect(await page.evaluate(() => main.animator.frames.every((f,i) => f === watchOriginalFrames[i]))).toBe(true);
  expect(await page.evaluate(() => main.animator.exposures())).toBe(6);
});

test('Watch rotation keeps the image proportional and controls reachable', async ({page}) => {
  await page.setViewportSize({width:744,height:1024}); await frames(page);
  await page.locator('#watchButton').click();
  for (const [width,height] of [[744,1024],[1133,600],[1024,1240],[1366,900],[390,844],[1440,900]]) {
    await page.setViewportSize({width,height});
    for (const id of ['watchClose','watchPlay','watchLoop']) {
      expect(await page.locator('#'+id).evaluate(el => {
        const r=el.getBoundingClientRect();
        return r.width>=44 && r.height>=44 && r.x>=0 && r.y>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 &&
          el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      }), id).toBe(true);
    }
    const image = await page.locator('#watchCanvas').boundingBox();
    expect(image.width/image.height).toBeCloseTo(16/9,2);
    expect(image.width).toBeCloseTo(Math.min(width,height*16/9),0);
    expect(image.y).toBeGreaterThanOrEqual(-1);
    expect(image.y+image.height).toBeLessThanOrEqual(height+1);
    await page.screenshot({path:`test-results/watch-${width}.png`});
    console.log('WATCH IMAGE', JSON.stringify({viewport:[width,height],image}));
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#watchDialog')).not.toBeVisible();
  await expect(page.locator('#watchButton')).toBeFocused();
});

test('single-frame clips loop and Watch never encodes or expands a large project', async ({page}) => {
  await page.setViewportSize({width:744,height:1024});
  await frames(page,{count:1,holds:[1]}); await frozenClock(page);
  await page.evaluate(() => {
    stopMedia.encodeFrame = () => { throw new Error('Watch must not encode'); };
    main.animator.encode = () => { throw new Error('Watch must not export'); };
  });
  await page.locator('#watchButton').click();
  await page.clock.runFor(501);
  await expect(page.locator('#watchPlay')).toHaveAttribute('aria-pressed','true');
  expect(await pixel(page)).toEqual([255,0,0]);
  await page.locator('#watchClose').click();
  await frames(page,{count:700,holds:[1]});
  await page.locator('#watchButton').click();
  await page.clock.runFor(70100);
  await expect(page.locator('#watchPlay')).toHaveAttribute('aria-pressed','true');
  const stats = await page.evaluate(() => stopFrames.stats());
  expect(stats.entries).toBeLessThanOrEqual(8);
  expect(stats.pixels).toBeLessThanOrEqual(stats.maxPixels);
  expect(await page.evaluate(() => main.animator.frames.length)).toBe(700);
  await page.locator('#watchClose').click();
});

test('closing cancels delayed draws and returning preserves selected frame', async ({page}) => {
  await page.setViewportSize({width:744,height:1024}); await frames(page);
  await page.locator('#latestFrameButton').click();
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 3 of 3');
  await page.evaluate(() => {
    const use = stopFrames.use;
    window.pendingWatchDraws = [];
    stopFrames.use = (...args) => new Promise(resolve => pendingWatchDraws.push(async () => resolve(await use(...args))));
  });
  await page.locator('#watchButton').click();
  await page.locator('#watchClose').click();
  await page.evaluate(async () => { await Promise.all(pendingWatchDraws.splice(0).map(release => release())); });
  await expect(page.locator('#watchDialog')).not.toBeVisible();
  expect(await page.locator('#watchCanvas').evaluate(c => [c.width,c.height])).toEqual([1,1]);
  await expect(page.locator('#selectionStatus')).toHaveText('Frame 3 of 3');
  await expect(page.locator('#editMode')).toHaveAttribute('aria-pressed','true');
});

test('Watch pauses when hidden and contains existing portrait frames', async ({page}) => {
  await page.setViewportSize({width:744,height:1024});
  await frames(page,{width:360,height:640});
  await page.locator('#watchButton').click();
  const image = await page.locator('#watchCanvas').boundingBox();
  expect(image.width/image.height).toBeCloseTo(9/16,2);
  await page.evaluate(() => {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#watchPlay')).toHaveAttribute('aria-pressed','false');
  await page.evaluate(() => { delete document.hidden; });
  await page.locator('#watchPlay').click();
  await expect(page.locator('#watchPlay')).toHaveAttribute('aria-pressed','true');
  await page.locator('#watchClose').click();
});
