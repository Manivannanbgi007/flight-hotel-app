import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { logIn, newCustomer, type TestCustomer } from './support/auth';
import { bookConfirmedHotelStay, cancelBooking, registerVerifiedCustomer } from './support/api';
import { WCAG_21_AA } from './support/axe';
import { BASE_URL, DEMO_ACCOUNTS, demoPassword } from './support/env';

/**
 * The AI assistant's chat and voice UI against the running stack and the REAL local model (AI_ASSISTANT.md).
 * Answers take 10–60 s on the CPU model (longer while builds run), so each answer gets up to 3 minutes, and only one
 * question is asked at a time. The figures and references are checked against the APIs, never against fixed values.
 */

const ANSWER_TIMEOUT = 180_000;
test.describe.configure({ timeout: 12 * 60_000 });

/** A booking reference (HT-7K3M9Q2X) anywhere in a text. */
const REFERENCE = /\bHT-[A-Z0-9]{6,}\b/g;
const AMOUNT = /(?:₹|\bRs\.?|\bINR)\s?\d/;

async function openAssistant(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Open the assistant/ }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(panel).toBeVisible();
  return panel;
}

/** Asks one question and waits for the whole answer. Returns the answer's list item. */
async function ask(panel: Locator, question: string): Promise<Locator> {
  const input = panel.getByRole('textbox', { name: 'Your question' });
  await input.fill(question);
  await input.press('Enter');
  await expect(panel.getByRole('button', { name: 'Stop the answer' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Stop the answer' })).toBeHidden({ timeout: ANSWER_TIMEOUT });
  // The last message itself (its source chips are list items too).
  const answer = panel.getByRole('list', { name: 'Messages' }).locator(':scope > li').last();
  await expect(answer.getByRole('button', { name: 'Try again' }), `the assistant failed: ${await answer.innerText()}`).toHaveCount(0);
  return answer;
}

/** axe (WCAG 2.1 A + AA) on the launcher and the open panel only: the pages around it have their own scans. */
async function expectPanelAccessible(page: Page, label: string): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page }).include('[data-assistant-root]').withTags(WCAG_21_AA).analyze();
  const lines = violations.map((violation) => `${violation.impact ?? 'unknown'} ${violation.id} x${violation.nodes.length}: ${violation.help}`
    + `\n    ${violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join('\n    ')}`);
  console.log(`[axe] ${label}: ${lines.length === 0 ? 'no violations' : `\n  ${lines.join('\n  ')}`}`);
  await test.info().attach(`axe ${label}`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  const blocking = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking.map((violation) => `${violation.id} (${violation.impact})`), `serious or critical issues in the assistant (${label})`).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

/** A fresh access token from the page's own refresh cookie (no extra login). */
async function accessToken(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/refresh', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

test.describe('assistant: visitors', () => {
  test('a visitor who is not signed in sees no launcher and the config is never asked for', async ({ page }) => {
    const configCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/assistant/')) configCalls.push(request.url());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /assistant/i })).toHaveCount(0);

    await page.goto('/hotels');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /assistant/i })).toHaveCount(0);
    expect(configCalls).toEqual([]);
  });
});

test.describe.serial('assistant: a customer with a real booking', () => {
  let customer: TestCustomer;
  let apiToken: string;
  let booking: { id: string; reference: string };
  let context: BrowserContext;
  let page: Page;
  let panel: Locator;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    customer = newCustomer('assistant', { firstName: 'Meera', lastName: 'Iyer' });
    apiToken = await registerVerifiedCustomer(customer);
    booking = await bookConfirmedHotelStay(apiToken, customer);
    context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } });
    page = await context.newPage();
    await logIn(page, customer.email, customer.password);
  });

  test.afterAll(async () => {
    await context?.close();
    if (booking) {
      await cancelBooking(apiToken, booking.id).catch(() => undefined);
    }
  });

  test('the empty panel: suggestions for customers, accessible on desktop', async () => {
    await page.goto('/my-trips');
    panel = await openAssistant(page);
    await expect(panel.getByRole('heading', { name: 'Hi Meera, how can I help?' })).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Try asking' }).getByRole('button', { name: 'What are my upcoming trips?' })).toBeVisible();
    await expect(panel.getByText(/changes such as cancelling or paying are made on the pages/)).toBeVisible();
    await expectPanelAccessible(page, 'empty panel, desktop');

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open the assistant' })).toBeFocused();
  });

  test('upcoming trips: the answer names the booking reference from the API and shows its sources', async () => {
    panel = await openAssistant(page);

    const answer = await ask(panel, 'What are my upcoming trips? Please include the booking references.');

    const text = (await answer.innerText()).normalize('NFKC').replace(/[‐-―−]/g, '-');
    console.log(`[assistant] upcoming trips → ${text.replace(/\s+/g, ' ')}`);
    expect(text).toContain(booking.reference);
    await expect(answer.getByText('Based on:')).toBeVisible();
    await expect(answer.getByRole('list', { name: 'Sources' }).getByRole('listitem').first()).toBeVisible();
    expect(await answer.locator('a').count(), 'answers are plain text, never links').toBe(0);

    await expectPanelAccessible(page, 'panel with an answer, desktop');
  });

  test('phone width: a full-screen sheet without horizontal scroll, accessible', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBe(390);
    await expectNoHorizontalScroll(page);
    await expectPanelAccessible(page, 'panel with an answer, phone');
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  test('a reference that does not exist: nothing is invented', async () => {
    const answer = await ask(panel, 'Show me the details of booking HT-ZZ9ZZ9ZZ');

    // The model sometimes writes references with a non-breaking hyphen (U+2011): read them as the grounding check does.
    const text = (await answer.innerText()).normalize('NFKC').replace(/[‐-―−]/g, '-');
    console.log(`[assistant] unknown reference → ${text.replace(/\s+/g, ' ')}`);
    const references = new Set(text.match(REFERENCE) ?? []);
    references.delete('HT-ZZ9ZZ9ZZ');
    references.delete(booking.reference);
    expect([...references], 'no other booking reference may appear').toEqual([]);
    const safeAnswer = /found in your data|could only|can only give/i.test(text);
    const notFound = /(?:not|n['’]t) (?:be )?found|couldn['’]t find|could not find|no booking|unable to find|does(?:n['’]t| not) exist|not able to find|no record/i;
    expect(safeAnswer || notFound.test(text), 'the answer says the booking was not found').toBe(true);
    if (!text.includes(booking.reference)) {
      expect(text, 'no amount for a booking that does not exist').not.toMatch(AMOUNT);
    }
  });

  test('the conversation survives a reload (restored from the server)', async () => {
    await page.reload();
    panel = await openAssistant(page);

    const messages = panel.getByRole('list', { name: 'Messages' });
    await expect(messages.getByText('What are my upcoming trips? Please include the booking references.')).toBeVisible();
    await expect(messages.getByText('Show me the details of booking HT-ZZ9ZZ9ZZ')).toBeVisible();
    await expect(messages.getByText(booking.reference).first()).toBeVisible();
  });

  test('voice round trip: spoken question → transcription in the input → answer read aloud (voice profile only)', async () => {
    const token = await accessToken(page);
    const auth = { Authorization: `Bearer ${token}` };
    const config = (await (await page.request.get('/api/assistant/config', { headers: auth })).json()) as { voice: { transcription: boolean; speech: boolean } };
    test.skip(!config.voice.transcription || !config.voice.speech,
      'The voice profile is not running (config.voice is off): docker compose --profile voice up -d speaches speaches-init');

    // A real spoken question: the speech server's own MP3, decoded and written as WAV for Chrome's fake microphone.
    const mp3 = await page.request.post('/api/assistant/voice/speech', { headers: auth, data: { text: 'What are my upcoming trips?' } });
    expect(mp3.status()).toBe(200);
    expect(mp3.headers()['content-type']).toContain('audio/mpeg');
    const wavBase64 = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const context = new AudioContext();
      const audio = await context.decodeAudioData(bytes.buffer);
      const rate = audio.sampleRate;
      const lead = Math.round(rate * 0.5);
      const tail = Math.round(rate * 3);
      const samples = audio.getChannelData(0);
      const total = lead + samples.length + tail;
      const view = new DataView(new ArrayBuffer(44 + total * 2));
      const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, total * 2, true);
      samples.forEach((sample, i) => view.setInt16(44 + (lead + i) * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
      let binary = '';
      new Uint8Array(view.buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      await context.close();
      return btoa(binary);
    }, (await mp3.body()).toString('base64'));
    const wav = test.info().outputPath('question.wav');
    await writeFile(wav, Buffer.from(wavBase64, 'base64'));

    let voiceBrowser: Browser | null = null;
    try {
      voiceBrowser = await chromium.launch({
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`,
          '--autoplay-policy=no-user-gesture-required'],
      });
      const voiceContext = await voiceBrowser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 }, permissions: ['microphone'] });
      const voicePage = await voiceContext.newPage();
      const problems: string[] = [];
      // Only what voice needs: the microphone (Permissions-Policy) and blob: audio (CSP media-src). Other reports, such
      // as zod's caught `new Function` probe on the sign-in form (script-src eval), are not about the assistant.
      voicePage.on('console', (message) => {
        if (/media-src|blob:|microphone|Permissions policy|NotAllowedError/i.test(message.text())) problems.push(message.text());
      });
      await voicePage.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`));
      });
      await logIn(voicePage, customer.email, customer.password);
      // A new browser: no conversation in this tab yet, so the panel starts empty.
      const voicePanel = await openAssistant(voicePage);
      await voicePanel.getByRole('switch', { name: 'Read answers aloud' }).click();

      await voicePanel.getByRole('button', { name: 'Ask by voice' }).click();
      await expect(voicePanel.getByText('Recording', { exact: true })).toBeVisible();
      // It stops by itself after the pause at the end; the transcription lands in the input.
      const input = voicePanel.getByRole('textbox', { name: 'Your question' });
      await expect(input).toHaveValue(/upcoming trips/i, { timeout: 90_000 });
      console.log(`[assistant] transcription → ${await input.inputValue()}`);

      const speech = voicePage.waitForResponse((response) => response.url().endsWith('/api/assistant/voice/speech'), { timeout: ANSWER_TIMEOUT + 60_000 });
      await input.press('Enter');
      const spoken = await speech;
      expect(spoken.status()).toBe(200);
      await voicePage.waitForTimeout(2_000);
      await expect(voicePanel.getByText("The answer couldn't be read aloud right now.")).toHaveCount(0);
      expect(problems, 'the microphone and the blob: audio must not be blocked by the security headers').toEqual([]);
      await voiceContext.close();
    } finally {
      await voiceBrowser?.close();
    }
  });
});

test.describe.serial('assistant: staff', () => {
  test('an admin asks for a figure: the answer equals GET /api/admin/dashboard', async ({ page }) => {
    await logIn(page, DEMO_ACCOUNTS.admin, demoPassword(), 'admin');
    await expect(page).toHaveURL(/\/admin/);
    const panel = await openAssistant(page);
    await expect(page.locator('[data-assistant-root]')).toHaveClass(/role-admin/);
    await expect(panel.getByRole('list', { name: 'Try asking' }).getByRole('button', { name: 'Failed payments last week' })).toBeVisible();

    const auth = { Authorization: `Bearer ${await accessToken(page)}` };
    const paidBookings = async () => {
      const response = await page.request.get('/api/admin/dashboard?range=THIS_MONTH', { headers: auth });
      expect(response.status()).toBe(200);
      const { bookings } = (await response.json()) as { bookings: { hotel: number; flight: number } };
      return bookings.hotel + bookings.flight;
    };
    const before = await paidBookings();
    const answer = await ask(panel, 'How many paid bookings did we get this month in total?');
    const after = await paidBookings();

    const text = await answer.innerText();
    console.log(`[assistant] bookings this month → ${text.replace(/\s+/g, ' ')} (API: ${before}…${after})`);
    const numbers = (text.replace(/(\d),(?=\d)/g, '$1').match(/\d+/g) ?? []).map(Number);
    // Other suites may book at the same time: the figure must lie between the API's answer before and after.
    expect(numbers.some((value) => value >= before && value <= after), `the answer names ${before}${after !== before ? `…${after}` : ''}`).toBe(true);
    await expect(answer.getByRole('list', { name: 'Sources' })).toBeVisible();
    await expectPanelAccessible(page, 'admin portal panel with an answer');
  });
});
