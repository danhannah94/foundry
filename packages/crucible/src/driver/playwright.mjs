import { chromium } from 'playwright';

export function createPlaywrightDriver({ viewport } = {}) {
  let browser = null;
  let context = null;
  let page = null;

  async function ensurePage() {
    if (!browser) {
      browser = await chromium.launch({ headless: true });
    }
    if (!context) {
      context = await browser.newContext({ viewport });
    }
    if (!page) {
      page = await context.newPage();
    }
    return page;
  }

  async function navigate(url, { waitUntil = 'load', timeoutMs = 30_000 } = {}) {
    const p = await ensurePage();
    const response = await p.goto(url, { waitUntil, timeout: timeoutMs });
    return {
      url: p.url(),
      status: response ? response.status() : null,
    };
  }

  async function screenshotPage({ fullPage = true } = {}) {
    const p = await ensurePage();
    const buffer = await p.screenshot({ fullPage, type: 'png' });
    const vp = p.viewportSize() || viewport || null;
    return { png: buffer, viewport: vp, url: p.url() };
  }

  async function close() {
    try { if (page) await page.close(); } catch {}
    try { if (context) await context.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    page = null;
    context = null;
    browser = null;
  }

  return { navigate, screenshotPage, close, ensurePage };
}
