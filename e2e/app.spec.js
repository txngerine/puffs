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
    let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 20) n++;
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
  await page.goto('/?motion=1&debug=1'); // debug exposes window.__eve for the timer check
  await page.locator('#gl').waitFor();
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('set a timer for pasta');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('For how long?');
  await box.fill('five minutes');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('5 minutes for pasta');
  await expect.poll(() => page.evaluate(
    () => window.__eve.timers.getTimers().some((t) => t.label.includes('pasta')),
  )).toBe(true);
});

test('answers factual questions with a sourced Wikipedia explanation first', async ({ page }) => {
  let searchRequests = 0;
  await page.route('**/api/answer?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ answer: { title: 'Photosynthesis', extract: 'Photosynthesis converts light energy into chemical energy.', url: 'https://en.wikipedia.org/wiki/Photosynthesis' } }),
  }));
  await page.route('**/api/search?**', (route) => { searchRequests++; return route.fulfill({ json: { results: [] } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('what is photosynthesis?');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('Photosynthesis converts light energy into chemical energy.');
  await expect(page.locator('#say a[href="https://en.wikipedia.org/wiki/Photosynthesis"]')).toBeVisible();
  expect(searchRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('routes Malayalam factual questions to Malayalam Wikipedia', async ({ page }) => {
  await page.goto('/?motion=1&debug=1');
  await page.evaluate(() => window.__eve.assistant.setRecognitionLang('ml-IN'));
  let requestedLanguage = '';
  await page.route('**/api/answer?**', (route) => {
    requestedLanguage = new URL(route.request().url()).searchParams.get('lang');
    return route.fulfill({ json: { answer: {
      title: 'പ്രകാശസംശ്ലേഷണം', extract: 'സസ്യങ്ങൾ പ്രകാശോർജ്ജത്തെ രാസോർജ്ജമാക്കി മാറ്റുന്ന പ്രക്രിയയാണ് പ്രകാശസംശ്ലേഷണം.',
      url: 'https://ml.wikipedia.org/wiki/Photosynthesis',
    } } });
  });
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('ഫോട്ടോസിന്തസിസ് എന്താണ്');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('പ്രകാശോർജ്ജത്തെ രാസോർജ്ജമാക്കി');
  await expect.poll(() => requestedLanguage).toBe('ml-IN');
});

test('falls back to typing after repeated speech network failures and keeps the interim transcript', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('eve.greeted', 'true');
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    window.SpeechRecognition = class {
      start() {
        const result = Object.assign([{ transcript: 'what is photosynthesis', confidence: 1 }], { isFinal: false });
        this.onresult?.({ resultIndex: 0, results: [result] });
        setTimeout(() => { this.onerror?.({ error: 'network' }); this.onend?.(); }, 0);
      }
      abort() { this.onend?.(); }
    };
  });
  await page.goto('/?motion=1&debug=1');
  await page.evaluate(() => window.__eve.assistant.toggleAssistant());
  const box = page.locator('#ask');
  await expect(box).toBeVisible({ timeout: 12_000 });
  await expect(box).toHaveValue('what is photosynthesis');
  await expect(page.locator('#sys')).toContainText('type instead');
});

test('shows five useful search links when no Wikipedia article matches', async ({ page }) => {
  await page.route('**/api/answer?**', (route) => route.fulfill({ json: { answer: null } }));
  await page.route('**/api/search?**', (route) => route.fulfill({ json: { results: Array.from({ length: 5 }, (_, i) => ({
    title: `Result ${i + 1}`, snippet: `Useful detail ${i + 1}`, url: `https://example.com/${i + 1}`,
  })) } }));
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('why does this unusual process happen?');
  await box.press('Enter');
  await expect(page.locator('#say')).toContainText('I found 5 search results');
  await expect(page.locator('#say .searchResults li')).toHaveCount(5);
  await expect(page.locator('#say')).toContainText('Useful detail 5');
});

test('provides copy, replay, and clear controls for a conversation', async ({ page }) => {
  await page.keyboard.press('t');
  const box = page.locator('#ask');
  await box.fill('15 percent of 80');
  await box.press('Enter');
  await expect(page.locator('.talkActions')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => {} },
  }));
  await page.getByRole('button', { name: 'copy' }).click();
  await expect(page.locator('#sys')).toContainText('answer copied');
  await page.getByRole('button', { name: 'replay' }).click();
  await expect(page.locator('#say')).toContainText('12.');
  await page.getByRole('button', { name: 'clear' }).click();
  await expect(page.locator('#say')).not.toContainText('12.');
  await expect(page.locator('.talkActions')).toHaveCount(0);
});
