import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  await page.goto('/?motion=1');
  await expect(page.locator('#gl')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

test('renders the artwork with GPU particles', async ({ page }) => {
  await page.goto('/?motion=1&debug=1');
  await expect.poll(() => page.evaluate(() => window.__eve?.engine.getState().gpuParticles)).toBe(true);
  // the field is actually drawn: some non-black pixels in the WebGL canvas
  const lit = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 20) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(500);
});

test('answers a typed question with the offline brain', async ({ page }) => {
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await expect(box).toBeFocused();
  await box.fill('15 percent of 80');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('12.');
});

test('saves a composition to MongoDB and keeps it after reload', async ({ page }) => {
  await page.keyboard.press('t');
  await page.locator('#ask').fill('save this composition as dawn');
  await page.locator('#ask').press('Enter');
  await expect(page.locator('#say')).toContainText(/saved/i);
  await page.reload();
  await page.locator('#gl').waitFor();
  await page.keyboard.press('?');
  await expect(page.locator('#help')).toHaveClass(/open/);
  await expect(page.locator('#help .saved')).toContainText('dawn');
});

test('controls menu pauses and shows state', async ({ page }) => {
  await page.mouse.move(200, 200); // with a mouse, the menu button appears on pointer movement
  await page.mouse.move(220, 240);
  await page.locator('#menu').click();
  await expect(page.locator('#bar')).toHaveClass(/open/);
  await page.locator('#bar .btn', { hasText: 'pause' }).click();
  await expect(page.locator('#bar .btn', { hasText: 'play' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#bar')).not.toHaveClass(/open/);
});

test('asks a follow-up question and completes the request (offline)', async ({ page }) => {
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('set a timer for pasta');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('For how long?');
  await box.fill('five minutes');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('5 minutes for pasta');
  await expect(page.locator('.pill.timer')).toContainText('pasta');
});
