const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Koha OPAC — covers any Koha install regardless of hosting vendor (ByWater
// Solutions, Bywater, etc. all just run stock Koha). Per-account variation is
// `config.baseUrl`, e.g. https://butte.bywatersolutions.com. See architecture.md §2.
//
// The OPAC login page has two forms: a hidden modal one (#muserid/#mpassword,
// inside #modalAuth) used when logging in from elsewhere on the site, and the
// real inline one shown on opac-user.pl itself (form#auth, plain #userid/#password).
// Use the latter.
const SELECTORS = {
  userid: 'form#auth #userid',
  password: 'form#auth #password',
  loginSubmit: 'form#auth input[type="submit"]',
  checkoutRows: 'table#checkoutst tbody tr',
};

async function captureDebug(page, label) {
  try {
    await page.screenshot({ path: `scraper-debug-${label}.png`, fullPage: true });
    fs.writeFileSync(`scraper-debug-${label}.html`, await page.content());
  } catch (debugError) {
    console.error(`[koha scraper] debug capture (${label}) failed:`, debugError.message || debugError);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(min + Math.random() * (max - min));

// Bot-detection risk scoring weighs a brand-new, cookie-less browser profile
// heavily — every run otherwise looks like a different "device" logging in.
// Reusing one profile per account (never checked in) makes repeat scrapes
// look like the same returning browser instead.
function defaultProfileDir(baseUrl, username) {
  const key = crypto.createHash('sha256').update(`${baseUrl}:${username}`).digest('hex').slice(0, 16);
  return path.join(__dirname, '..', '..', '.puppeteer-profiles', `koha-${key}`);
}

// A WAF/bot-check block (e.g. Cloudflare) doesn't throw — it just serves a
// different page with a 4xx/5xx status. Left undetected, that reads as "this
// patron has nothing checked out" instead of "the scrape didn't happen."
async function detectBlock(response, page) {
  const status = response?.status();
  const title = await page.title().catch(() => '');
  if (status && status >= 400) {
    return `blocked (HTTP ${status}${title ? `, page titled "${title}"` : ''})`;
  }
  if (/attention required|access denied|just a moment|are you human|cloudflare/i.test(title)) {
    return `blocked (page titled "${title}")`;
  }
  return null;
}

module.exports = {
  id: 'koha',

  async scrape({ credentials, config }) {
    const { username, pin } = credentials;
    const { baseUrl, headless = true, debug = false, profileDir } = config;
    if (!baseUrl) throw new Error('koha scraper requires config.baseUrl');

    const userDataDir = profileDir || defaultProfileDir(baseUrl, username);
    fs.mkdirSync(userDataDir, { recursive: true });

    const errors = [];
    let checkouts = [];

    const browser = await puppeteer.launch({ headless, userDataDir });
    let page;
    try {
      page = await browser.newPage();
      // Puppeteer's default UA/viewport are an easy bot-detection tell —
      // look like an ordinary desktop Chrome tab. Stealth plugin (via
      // puppeteer-extra, applied above) handles the deeper fingerprint tells
      // (navigator.webdriver, missing chrome object, plugins list, etc).
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1280, height: 900 });

      const origin = baseUrl.replace(/\/$/, '');
      const loginPageResponse = await page.goto(`${origin}/cgi-bin/koha/opac-user.pl`, {
        waitUntil: 'networkidle2',
      });

      const preLoginBlock = await detectBlock(loginPageResponse, page);
      if (preLoginBlock) {
        if (debug) await captureDebug(page, 'blocked-pre-login');
        errors.push(`koha login page ${preLoginBlock}`);
        return { checkouts, errors };
      }

      // The persistent profile means a prior run may still be logged in —
      // in that case opac-user.pl goes straight to the account page and the
      // login form never appears. Don't assume we need to log in.
      const loginForm = await page.$(SELECTORS.userid);
      if (loginForm) {
        // Instant, uniform-speed form fills are themselves a bot tell — type
        // and pause like a person would.
        await page.type(SELECTORS.userid, username.toString(), { delay: randomDelay(60, 140) });
        await page.type(SELECTORS.password, pin.toString(), { delay: randomDelay(60, 140) });
        await sleep(randomDelay(300, 700));
        const [, postLoginResponse] = await Promise.all([
          page.click(SELECTORS.loginSubmit),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        // Capture what login actually landed on *before* judging the result —
        // a bot check here won't throw, it'll just render something other
        // than the account page, and #checkoutst being absent doesn't say why.
        if (debug) await captureDebug(page, 'post-login');

        const postLoginBlock = await detectBlock(postLoginResponse, page);
        if (postLoginBlock) {
          errors.push(`koha post-login ${postLoginBlock}`);
          return { checkouts, errors };
        }
      } else if (debug) {
        await captureDebug(page, 'already-logged-in');
      }

      // Checkouts render server-side into #checkoutst on page load — no extra
      // waits/clicks needed. If a patron has nothing out, the table is absent.
      await page.waitForSelector(SELECTORS.checkoutRows, { timeout: 10000 }).catch(() => {});

      checkouts = await page.evaluate((rowSelector) => {
        const rows = document.querySelectorAll(rowSelector);
        const items = [];

        rows.forEach((row) => {
          const titleLink = row.querySelector('td.title a.title');
          const title = titleLink?.innerText.replace(/\s+/g, ' ').trim() || 'No title';

          const dueCell = row.querySelector('td.date_due');
          const dueOrder = dueCell?.getAttribute('data-order'); // "2026-09-10 23:59:00"
          const dueDate = dueOrder ? dueOrder.split(' ')[0] : (dueCell?.innerText.trim() || null);

          const overdue = row.classList.contains('overdue');
          const imgSrc = row.querySelector('td.jacketcell img.item-thumbnail')?.getAttribute('src') || null;

          // Prefer the loan's issue ID (unique per checkout transaction); fall
          // back to the bib record ID; fall back to a title+dueDate composite.
          const issueId = row.querySelector('input[name="issue"]')?.value;
          const biblioMatch = titleLink?.getAttribute('href')?.match(/biblionumber=(\d+)/);
          const externalId = issueId
            ? `issue-${issueId}`
            : biblioMatch
              ? `biblio-${biblioMatch[1]}`
              : `${title}::${dueDate}`;

          items.push({ externalId, title, dueDate, overdue, imgSrc });
        });

        return items;
      }, SELECTORS.checkoutRows);

      // Deliberately not logging out: the persistent profile is meant to look
      // like the same returning browser across runs, and a real patron
      // doesn't log out between visits either. Logging out would just throw
      // away the session and make the *next* run look like a fresh device.
    } catch (error) {
      errors.push(error.message || String(error));
      if (debug && page) await captureDebug(page, 'error');
    } finally {
      await browser.close();
    }

    return { checkouts, errors };
  },
};
