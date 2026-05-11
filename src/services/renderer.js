/* global window, document */

import { chromium } from 'playwright';

let browser;
let lastUsed = Date.now();

async function getBrowser() {
  if (browser && browser.isConnected()) {
    lastUsed = Date.now();
    return browser;
  }
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  lastUsed = Date.now();
  return browser;
}

setInterval(async () => {
  if (browser && Date.now() - lastUsed > 30_000) {
    try {
      await browser.close();
    } catch {
      // browser already closed
    }
    browser = null;
  }
}, 10_000);

async function takeScreenshot(url, options = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    deviceScaleFactor: options.scale || 1,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: options.locale || 'en-US',
    javaScriptEnabled: options.js !== false,
  });

  if (options.blockAds) {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      const adDomains = [
        'doubleclick.net',
        'googleadservices.com',
        'googlesyndication.com',
        'google-analytics.com',
        'facebook.net',
        'quantserve.com',
        'scorecardresearch.com',
      ];
      if (adDomains.some((d) => url.includes(d))) {
        return route.abort();
      }
      return route.continue();
    });
  }

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: options.waitUntil || 'networkidle',
      timeout: (options.timeout || 30) * 1000,
    });

    if (options.delay && options.delay > 0) {
      await page.waitForTimeout(options.delay);
    }

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10_000 }).catch(() => {});
    }

    if (options.scrollToBottom) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
    }

    if (options.acceptCookies) {
      await acceptCookieConsent(page, options.acceptCookies);
    }

    if (options.darkMode) {
      await page.emulateMedia({ colorScheme: 'dark' });
    }

    const fullPage = options.fullPage !== false;
    const format = options.format || 'png';
    const quality = options.quality ? Math.min(100, Math.max(1, options.quality)) : undefined;

    let clip;
    if (options.selector) {
      const el = await page.$(options.selector);
      if (el) {
        const box = await el.boundingBox();
        if (box) {
          clip = { x: box.x, y: box.y, width: box.width, height: box.height };
        }
      }
    }

    const width = options.width || 1280;
    const height = options.height || 720;

    if (!clip) {
      await page.setViewportSize({ width, height });
    }

    const screenshotBuffer = await page.screenshot({
      type: format === 'jpeg' ? 'jpeg' : 'png',
      quality: format === 'jpeg' ? quality : undefined,
      fullPage: fullPage && !clip,
      clip,
    });

    return { buffer: screenshotBuffer, format, width, height };
  } finally {
    await context.close();
  }
}

export async function renderScreenshot(url, options = {}) {
  const start = Date.now();
  const result = await takeScreenshot(url, options);
  const duration = Date.now() - start;
  return {
    ...result,
    durationMs: duration,
  };
}

export async function renderHtml(html, options = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    deviceScaleFactor: options.scale || 1,
  });
  const page = await context.newPage();

  try {
    await page.setContent(html, {
      waitUntil: 'networkidle',
      timeout: (options.timeout || 15) * 1000,
    });

    if (options.acceptCookies) {
      await acceptCookieConsent(page, options.acceptCookies);
    }

    if (options.delay && options.delay > 0) {
      await page.waitForTimeout(options.delay);
    }

    const format = options.format || 'png';
    const fullPage = options.fullPage !== false;
    const width = options.width || 1280;
    const height = options.height || 720;

    if (!fullPage) {
      await page.setViewportSize({ width, height });
    }

    const screenshotBuffer = await page.screenshot({
      type: format === 'jpeg' ? 'jpeg' : 'png',
      quality: format === 'jpeg' && options.quality ? Math.min(100, Math.max(1, options.quality)) : undefined,
      fullPage,
    });

    return { buffer: screenshotBuffer, format, width, height };
  } finally {
    await context.close();
  }
}

const COOKIE_SELECTORS = [
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("Accept Cookies")',
  'button:has-text("Accept cookies")',
  'button:has-text("Accept")',
  'button:has-text("I Accept")',
  'button:has-text("I accept")',
  'button:has-text("Got it")',
  'button:has-text("Got It")',
  'button:has-text("Allow All")',
  'button:has-text("Allow all")',
  'button:has-text("Allow Cookies")',
  'button:has-text("Allow cookies")',
  'button:has-text("Allow")',
  'button:has-text("OK")',
  'button:has-text("Consent")',
  'button:has-text("Agree")',
  'button:has-text("I agree")',
  'button:has-text("Yes")',
  'button:has-text("Godta alle")',
  'button:has-text("Godta")',
  'button:has-text("Aksepter")',
  'button:has-text("Aksepter alle")',
  'a:has-text("Accept All")',
  'a:has-text("Accept")',
  'a:has-text("Allow")',
  '#onetrust-accept-btn-handler',
  '.ot-sdk-show-settings',
  '.cmplz-btn-accept',
  '.cmplz-accept',
  '.CybotCookiebotDialogBodyButtonAccept',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '.cc-btn.cc-allow',
  '.cc-btn.cc-accept-all',
  '.cc-dismiss',
  '.osano-cm-accept',
  '.osano-cm-accept-all',
  '.cli-accept-all',
  '.cli-accept-btn',
  '.borlabs-cookie-accept',
  '.cookie-accept-btn',
  '.accept-cookies-button',
  '.accept-cookies',
  '#cookies-eu-accept',
  '#cookie-accept',
  '.cookie-consent-accept',
  '[data-testid="cookie-accept"]',
  '[data-testid="cookie-consent"]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
];

async function acceptCookieConsent(page, customSelector) {
  const selectors = customSelector ? [customSelector, ...COOKIE_SELECTORS] : COOKIE_SELECTORS;

  const tryClick = async (loc) => {
    try {
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        await loc.click({ timeout: 2000 });
        await page.waitForTimeout(300);
        return true;
      }
      if ((await loc.count()) > 0) {
        await loc.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(300);
        return true;
      }
    } catch {
      // locator not found
    }
    return false;
  };

  for (const selector of selectors) {
    if (await tryClick(page.locator(selector).first())) return;
  }

  const childFrames = page.frames().filter((f) => f !== page.mainFrame());
  if (childFrames.length > 0) {
    for (const frame of childFrames) {
      for (const selector of selectors) {
        if (await tryClick(frame.locator(selector).first())) return;
      }
    }
  }

  await page.evaluate(() => {
    if (window._sp_ && window._sp_.gdpr && typeof window._sp_.gdpr.setConsentAndLoadMc === 'function') {
      window._sp_.gdpr.setConsentAndLoadMc();
      return;
    }
    if (window.__tcfapi) {
      window.__tcfapi('postConsent', 2, () => {}, {
        purpose: { consents: Object.fromEntries([...Array(24)].map((_, i) => [i + 1, true])) },
        vendor: { consents: Object.fromEntries([...Array(1000)].map((_, i) => [i + 1, true])) },
      });
      return;
    }
    const texts = [
      'Godta alle',
      'Godta',
      'Aksepter alle',
      'Aksepter',
      'Accept All',
      'Accept all',
      'Accept Cookies',
      'Accept cookies',
    ];
    const btn = [...document.querySelectorAll('button, a, [role=button], span, div')].find((el) =>
      texts.some((t) => el.textContent.trim() === t),
    );
    if (btn) btn.click();
  });
}
