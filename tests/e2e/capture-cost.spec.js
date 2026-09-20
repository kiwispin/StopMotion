import {test, expect} from '@playwright/test';

// Diagnostic: per-capture cost at 1280x720 (PNG compression vs thumbnail).
test('measure per-capture PNG compression cost at 1280x720', async ({page}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.evaluate(() => main.project.ready);
  const result = await page.evaluate(async () => {
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    // Fixture-like textured content so compression cost is realistic.
    const texture = document.createElement('canvas'); texture.width = 160; texture.height = 90;
    const t = texture.getContext('2d'), pixels = t.createImageData(160, 90);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = 80 + (seed >>> 27); pixels.data[i + 1] = 110 + (seed >>> 27);
      pixels.data[i + 2] = 130 + (seed >>> 27); pixels.data[i + 3] = 255;
    }
    t.putImageData(pixels, 0, 0);
    const pattern = g.createPattern(texture, 'repeat');
    g.fillStyle = pattern; g.fillRect(0, 0, W, H);
    const gradient = g.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, 'rgba(255,70,30,.25)'); gradient.addColorStop(1, 'rgba(0,40,255,.35)');
    g.fillStyle = gradient; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.font = '36px sans-serif'; g.fillText('Scene 000', 30, 65);

    const pngBlob = () => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const time = async (fn, n) => { const start = performance.now(); for (let i = 0; i < n; i++) await fn(); return (performance.now() - start) / n; };
    const thumbnailOnly = () => {
      const c = document.createElement('canvas'); c.width = 96; c.height = 72;
      stopMedia.drawContained(c.getContext('2d'), canvas, 96, 72);
      c.width = c.height = 0;
    };
    await pngBlob(); await stopFrames.fromCanvas(canvas); thumbnailOnly();
    const pngMs = await time(pngBlob, 15);
    const fromCanvasMs = await time(() => stopFrames.fromCanvas(canvas), 15);
    const thumbnailMs = await time(thumbnailOnly, 15);
    const blob = await pngBlob();
    return {pngMs, fromCanvasMs, thumbnailMs, pngBytes: blob.size};
  });
  await testInfo.attach('capture-cost', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  console.log('CAPTURE COST ' + JSON.stringify(result));
  expect(result.fromCanvasMs).toBeGreaterThan(0);
});
