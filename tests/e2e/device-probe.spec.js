import {test, expect} from '@playwright/test';

// Exercise tests/diagnostics/device-probe.html on a desktop engine so the page is
// known-good before it is opened on real iPads. Diagnostic only; no app code.
test('device probe page runs and reports on this engine', async ({page}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/diagnostics/device-probe.html');
  await page.locator('#run').click();
  await page.waitForFunction(
    () => /done|fatal/.test(document.getElementById('out').textContent), null, {timeout: 90000});
  const text = await page.locator('#out').textContent();
  console.log('DEVICE PROBE\n' + text);
  expect(errors).toEqual([]);
  expect(text).toContain('capabilities');
  expect(text).toContain('record1280x720@24');
});
