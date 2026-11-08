// The site's contract, checked headless against a production build. Run through run.sh (Docker only):
//   sh tools/check/run.sh [--only <check>[,<check>]] [--templates <slug>[,<slug>]] [--pages <name>[,<name>]]
// --pages limits every check to those PAGES (by key); without it the per-page checks walk every built page.
// Motion contract: the head's bootstrap sets html[data-motion] ("full" | "reduce") from localStorage nebulosa.effects
// (on | off), else from prefers-reduced-motion; the switcher's .nb-switcher__effects-box shows and changes it.
// Each check is a named async function returning a list of failures; an empty list is a PASS.
// Switcher contract assumed by the checks: .nb-switcher is a disclosure whose button .nb-switcher__toggle
// (aria-expanded) opens .nb-switcher__panel; inside, the control that picks a template carries
// data-template-option="<slug>"; when it is hidden (dark list in light mode), a visible
// data-scheme-option="light|dark" control is used first. Escape closes the panel and returns focus to the button.
// Rail contract: a template that moves .nb-clients__list marks .nb-clients with data-nb-rail. Each template's
// manifest.json says which it is (rail: "moving" | "static") and is held to it: a moving rail must move, stop under
// the pointer and resume; a static list must stand still, unmarked.
// Contact composer contract: form.nb-compose posts to Web3Forms (the check build's key is "check-key", from
// config.yml); with JS compose.js sends it in place. Probes route Web3Forms to fake replies, so nothing leaves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./server');

const PAGES = {
  home: '/', services: '/services.html', process: '/process.html', about: '/about-us.html',
  contact: '/contact-us.html', blog: '/blog/', post: '/blog/any-password-works-if-its-long-enough', sent: '/sent.html',
};
const TEMPLATES = ['constelacion', 'pizarra', 'horizonte', 'polvo'];
const WIDTHS = [1280, 360, 1600, 1866];
// Wide screens (owner, 2026-11-07): from about 1440px the layout grows to about 1600px. At WIDE_AT the widest content
// box in main must be at least WIDE_MIN wide, for every template not in WIDE_EXEMPT (empty on purpose).
const WIDE_AT = 1866, WIDE_MIN = 1400, WIDE_EXEMPT = [];
const DEFAULT = 'constelacion';
const SCHEME = { pizarra: 'light', constelacion: 'dark', horizonte: 'dark', polvo: 'dark' };
// The spec (design review 2026-11-06): "Worked with" moves in every template; only Stardust may keep it
// still if its editorial direction asks. A manifest declaring rail: static outside this list fails the rail check.
const STILL_RAIL_ALLOWED = ['polvo'];
const KEY = 'nebulosa.template';
const NAV = ['Home', 'Services', 'Process', 'About', 'Blog', 'Contact us'];
const CLIENTS = ['IBM', 'Capital One', 'FICO', 'GSK', 'Santander', 'AXA', 'AutoZone', 'DigitalOcean', 'Canonical', 'Tripwire', 'izzi'];
const FORBIDDEN = /blockchain|crypto|smart contract|wallet|8421|Osaka|Steelkiwi|YoTutors/i;
const GOAT_SRC = 'https://gc.zgo.at/count.v4.js';
const GOAT_DATA = 'https://nebulosa.goatcounter.com/count';
// count.js says this, by design, whenever the page is served from localhost (as the harness serves it).
const CONSOLE_ALLOWED = ['warning: goatcounter: not counting because of: localhost'];
const SITE = process.env.CHECK_SITE || path.join(__dirname, 'out', 'site'); // override: a fixture site
const SHOTS = path.join(__dirname, 'out', 'shots');
const PARALLEL = 6;

// ---------- arguments ----------
function parseArgs(argv) {
  const a = { only: null, templates: TEMPLATES, pages: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--only' && v) { a.only = v.split(','); i++; }
    else if (argv[i] === '--templates' && v) { a.templates = v.split(','); i++; }
    else if (argv[i] === '--pages' && v) { a.pages = v.split(','); i++; }
    else throw new Error(`unknown argument ${argv[i]}; usage: [--only <check>[,<check>]] [--templates <slug>[,<slug>]] [--pages <name>[,<name>]]`);
  }
  const bad = a.templates.filter(t => !TEMPLATES.includes(t));
  if (bad.length) throw new Error(`unknown template(s) ${bad.join(', ')}; known: ${TEMPLATES.join(', ')}`);
  const badP = (a.pages || []).filter(n => !PAGES[n]);
  if (badP.length) throw new Error(`unknown page(s) ${badP.join(', ')}; known: ${Object.keys(PAGES).join(', ')}`);
  return a;
}

// ---------- helpers ----------
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// Waits for fn(arg) to be truthy in the page; false on timeout (any other error propagates).
async function until(page, fn, arg, ms = 3000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; }
  catch (e) { if (e.name === 'TimeoutError') return false; throw e; }
}

const forceTemplate = slug => { try { localStorage.setItem('nebulosa.template', slug); } catch (e) { /* about:blank has no storage */ } };

// Every built page, as the URL path GitHub Pages serves it at.
function sitePages() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'assets') walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = path.relative(SITE, p).split(path.sep).join('/');
      if (rel === '404.html') continue;
      if (rel.endsWith('index.html')) out.push('/' + rel.slice(0, -'index.html'.length));
      else if (rel.startsWith('blog/')) out.push('/' + rel.slice(0, -'.html'.length));
      else out.push('/' + rel);
    }
  })(SITE);
  return out.sort();
}
const postPaths = () => sitePages().filter(p => /^\/blog\/[^/]+$/.test(p) && p !== '/blog/rss.xml');

class Run {
  constructor(browser, origin, templates, pages) { this.browser = browser; this.origin = origin; this.templates = templates; this.pageNames = pages; this.sweepP = null; }

  // The URL paths the per-page checks visit: the --pages selection, else every built page.
  paths() { return this.pageNames ? this.pageNames.map(n => PAGES[n]) : sitePages(); }
  // The named PAGES the sweep loads: the --pages selection, else all of them.
  named() { return Object.entries(PAGES).filter(([n]) => !this.pageNames || this.pageNames.includes(n)); }

  // A fresh context + page. opts: {width, template, js, reducedMotion, init: [fn, arg][], routes: [url, handler][]}
  async open(urlPath, opts = {}) {
    const width = opts.width || 1280;
    const ctx = await this.browser.newContext({
      viewport: { width, height: width < 600 ? 740 : 800 },
      javaScriptEnabled: opts.js !== false,
      reducedMotion: opts.reducedMotion || 'no-preference',
    });
    if (opts.template) await ctx.addInitScript(forceTemplate, opts.template);
    for (const [fn, arg] of opts.init || []) await ctx.addInitScript(fn, arg);
    // giscus never loads for real in a probe: an empty client unless a check routes its own stub.
    await ctx.route('https://giscus.app/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    for (const [url, fn] of opts.routes || []) await ctx.route(url, fn);
    const page = await ctx.newPage();
    const log = { console: [], errors: [], responses: [], requests: [] };
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', e => log.errors.push(String(e)));
    page.on('request', r => log.requests.push(r.url()));
    page.on('response', r => log.responses.push({ url: r.url(), status: r.status() }));
    const res = await page.goto(this.origin + urlPath, { waitUntil: 'load' });
    // Also without page JS (evaluate still runs): a late web font reflows text, which would read as movement.
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(opts.settle == null ? 300 : opts.settle);
    return { ctx, page, log, status: res ? res.status() : 0, close: () => ctx.close() };
  }

  // One load per template x page x width, shared by no-overflow and no-console-errors; takes the screenshots.
  sweep() {
    if (!this.sweepP) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const items = [];
      for (const t of this.templates) for (const [name, p] of this.named()) for (const w of WIDTHS) items.push({ t, name, p, w });
      this.sweepP = pool(items, PARALLEL, async it => {
        const s = await this.open(it.p, { width: it.w, template: it.t });
        try {
          const template = await s.page.evaluate(() => document.documentElement.getAttribute('data-template'));
          const fit = await s.page.evaluate(overflowProbe);
          const content = await s.page.evaluate(contentWidthProbe);
          await s.page.screenshot({ path: path.join(SHOTS, `${it.t}-${it.name}-${it.w}.png`), fullPage: true });
          let long = null;
          if (it.w < 600) {
            const injected = await s.page.evaluate(injectLongTokens);
            await s.page.waitForTimeout(100);
            long = { injected, ...(await s.page.evaluate(overflowProbe)) };
          }
          return { ...it, template, fit, long, content, status: s.status, console: s.log.console, errors: s.log.errors };
        } finally { await s.close(); }
      });
    }
    return this.sweepP;
  }
}

// Horizontal fit of the page: scrollWidth, html/body overflow-x (hiding overflow there would mask it), and visible
// elements past the right edge. Only the clients rail (.nb-clients) and a [data-slot] that clips may hold such elements.
function overflowProbe() {
  const iw = window.innerWidth;
  const ox = e => getComputedStyle(e).overflowX;
  const allowed = el => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.matches('.nb-clients') || (a.matches('[data-slot]') && ox(a) !== 'visible')) return true;
    }
    return false;
  };
  const wide = [...document.body.querySelectorAll('*')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > iw + 0.5 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !allowed(e);
  });
  const desc = e => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map(c => '.' + c).join('') + `(right ${Math.round(e.getBoundingClientRect().right)})`;
  return { sw: document.documentElement.scrollWidth, iw, htmlOx: ox(document.documentElement), bodyOx: ox(document.body), wide: wide.length, wideDesc: wide.slice(0, 3).map(desc) };
}

// The widest content box in main. For each direct child of .nb-main, descends through single-child wrappers (a
// full-bleed section around one inner wrapper measures the wrapper, never the section's box), then takes that
// box's width inside padding. Children that count: visible, in flow, not a decorative slot.
function contentWidthProbe() {
  const counts = el => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed' && !el.matches('.nb-slot, script, style, template');
  };
  const content = el => { const cs = getComputedStyle(el); return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
  const widths = [...document.querySelectorAll('.nb-main > *')].filter(counts).map(sec => {
    let node = sec;
    for (;;) {
      const kids = [...node.children].filter(counts);
      if (kids.length !== 1) break;
      node = kids[0];
    }
    return content(node);
  });
  return widths.length ? Math.round(Math.max(...widths)) : 0;
}

// Appends long unbreakable tokens (a 60-char word, a long URL, a long email) to the h1, a body paragraph, a card
// title and a footer link: the copy a narrow screen must survive. Returns which targets existed.
function injectLongTokens() {
  const tokens = ' ' + 'nebulosa'.repeat(7) + 'abcd' +
    ' https://nebulosa.io/blog/a-very-long-path-segment-that-never-breaks-by-itself?utm_source=linkedin&utm_campaign=x' +
    ' engineering.contractors.latam@long-subdomain.nebulosa-engineering.io';
  const targets = {
    h1: ['h1'],
    paragraph: ['.nb-article p', 'article p', 'main p'],
    'card title': ['main :is(li, article) :is(h2, h3)', 'main :is(h2, h3)'],
    'footer link': ['footer.nb-footer a', 'footer a'],
  };
  const hit = [];
  for (const [name, sels] of Object.entries(targets)) {
    const el = sels.map(q => document.querySelector(q)).find(Boolean);
    if (el) { el.append(tokens); hit.push(name); }
  }
  return hit;
}

// The clients rail's motion: running animations on it and how far its first item moved in 1 s (null: no rail).
async function railMotion(page) {
  const list = page.locator('.nb-clients__list').first();
  if (!(await list.count())) return null;
  const x = () => list.evaluate(l => { const li = l.querySelector('li'); return li ? li.getBoundingClientRect().left : null; });
  await list.evaluate(l => l.scrollIntoView({ block: 'center' }));
  const a = await x();
  await page.waitForTimeout(1000);
  const b = await x();
  const anims = await page.evaluate(() => [...document.querySelectorAll('.nb-clients__list')]
    .flatMap(l => l.getAnimations({ subtree: true })).filter(an => an.playState === 'running').length);
  return { anims, moved: a === null || b === null ? 0 : Math.abs(b - a) };
}

// Applied-template precondition shared by the per-template checks.
const notApplied = (r, slug) => r.status !== 200 ? `${r.p}: HTTP ${r.status}` : r.template === slug ? null : `${r.p}: template ${slug} not applied (html[data-template]=${r.template === null ? 'none' : JSON.stringify(r.template)})`;

// ---------- the switcher, driven by keyboard ----------
// Tabs from wherever focus is until the element matching sel (or a radio in its group) has focus, then
// activates it: arrows inside a radio group, Space on an unchecked radio or on a checkbox, Enter on anything else.
async function keyboardActivate(page, sel) {
  for (let step = 0; step < 150; step++) {
    const s = await page.evaluate(sel => {
      const t = document.querySelector(sel), a = document.activeElement;
      if (!t) return { missing: true };
      const radio = el => el && (el.matches('input[type=radio]') || el.getAttribute('role') === 'radio');
      const check = el => el && el.matches && el.matches('input[type=checkbox]');
      const asRadio = el => radio(el) ? el : el.querySelector('input[type=radio],[role=radio]');
      const tr = asRadio(t);
      const group = el => el.matches('input[type=radio]') ? (el.name ? `${el.form ? 'f' : ''}:${el.name}` : null) : el.closest('[role=radiogroup]');
      const onTarget = a && a !== document.body && (a === t || t.contains(a));
      const sameGroup = !onTarget && radio(a) && tr && group(a) && group(a) === group(tr);
      const checked = tr ? (tr.matches('input') ? tr.checked : tr.getAttribute('aria-checked') === 'true') : false;
      return { onTarget, sameGroup: !!sameGroup, isRadio: !!(onTarget && radio(a)), isCheck: !!(onTarget && check(a)), checked };
    }, sel);
    if (s.missing) return `no element ${sel}`;
    if (s.onTarget) {
      if (s.isRadio) { if (!s.checked) await page.keyboard.press('Space'); }
      else if (s.isCheck) await page.keyboard.press('Space');
      else await page.keyboard.press('Enter');
      return null;
    }
    await page.keyboard.press(s.sameGroup ? 'ArrowRight' : 'Tab');
  }
  return `could not reach ${sel} with Tab/arrow keys`;
}

// Opens the switcher's panel from the keyboard when it is closed. Returns null on success, else the reason.
async function openSwitcher(page) {
  const toggle = '.nb-switcher__toggle';
  const t = page.locator(toggle).first();
  if (!(await t.count())) return `no ${toggle}`;
  if (!(await t.isVisible())) return `no visible ${toggle}`;
  if ((await t.getAttribute('aria-expanded')) === 'true') return null;
  const r = await keyboardActivate(page, toggle);
  if (r) return r;
  const opened = await until(page, s => document.querySelector(s).getAttribute('aria-expanded') === 'true'
    && [...document.querySelectorAll('.nb-switcher__panel')].some(p => p.checkVisibility()), toggle);
  return opened ? null : `${toggle} did not open its panel (aria-expanded + a visible .nb-switcher__panel)`;
}

// Picks a template through the switcher UI. Returns null on success, else the reason.
async function pickTemplate(page, slug) {
  const opt = `.nb-switcher [data-template-option="${slug}"]`;
  const scheme = `.nb-switcher [data-scheme-option="${SCHEME[slug]}"]`;
  if (!(await page.locator('.nb-switcher').first().isVisible())) return 'no visible .nb-switcher';
  const open = await openSwitcher(page);
  if (open) return open;
  if (!(await page.locator(opt).first().isVisible())) {
    if (!(await page.locator(scheme).first().isVisible())) return `no visible ${opt} (nor ${scheme})`;
    const r = await keyboardActivate(page, scheme);
    if (r) return r;
    if (!(await until(page, o => { const e = document.querySelector(o); return e && e.checkVisibility(); }, opt))) return `${opt} stays hidden after choosing ${SCHEME[slug]}`;
  }
  const r = await keyboardActivate(page, opt);
  if (r) return r;
  if (!(await until(page, s => document.documentElement.getAttribute('data-template') === s, slug))) {
    return `choosing ${slug} left html[data-template]=${JSON.stringify(await page.evaluate(() => document.documentElement.getAttribute('data-template')))}`;
  }
  return null;
}

// Switcher controls whose clickable box is under 44 x 44 CSS px: the disclosure button and, while the panel is
// open, the visible controls inside it (a hidden group is skipped), the "Animated effects" label included.
const smallTargets = page => page.evaluate(() => [...document.querySelectorAll('.nb-switcher :is([data-scheme-option], [data-template-option], .nb-switcher__toggle, .nb-switcher__effects)')]
  .filter(e => e.checkVisibility())
  .map(e => { const r = e.getBoundingClientRect(); return { e, w: r.width, h: r.height }; })
  .filter(b => b.w < 44 || b.h < 44)
  .map(b => `${b.e.getAttribute('data-scheme-option') ? `[data-scheme-option="${b.e.getAttribute('data-scheme-option')}"]` : b.e.getAttribute('data-template-option') ? `[data-template-option="${b.e.getAttribute('data-template-option')}"]` : b.e.matches('.nb-switcher__effects') ? '.nb-switcher__effects' : '.nb-switcher__toggle'} ${Math.round(b.w)}x${Math.round(b.h)}`));

const templateCss = page => page.evaluate(() => [...document.querySelectorAll('link[rel~=stylesheet][href*="/assets/templates/"]')]
  .map(l => new URL(l.href).pathname));
const cssOf = slug => `/assets/templates/${slug}/theme.css`;

// Records every data-template value set on <html> before DOMContentLoaded, every frame painted with a
// different value, and whether any .nb-slot was visible while html.nb-slots-pending was (not yet) cleared.
function fouCProbe(expected) {
  const rec = window.__nbProbe = { values: [], wrongFrames: [], pendingSeen: false, pendingRemoved: false, visibleSlotFrames: 0, frames: 0 };
  let dcl = false;
  document.addEventListener('DOMContentLoaded', () => { dcl = true; });
  new MutationObserver(ms => {
    const html = document.documentElement;
    const recs = ms.filter(m => m.target === html && m.attributeName === 'data-template');
    recs.forEach((m, i) => { if (!dcl) rec.values.push(i + 1 < recs.length ? recs[i + 1].oldValue : html.getAttribute('data-template')); });
    ms.forEach(m => { if (m.target === html && m.attributeName === 'class' && /\bnb-slots-pending\b/.test(m.oldValue || '')) rec.pendingSeen = true; });
  }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-template', 'class'] });
  const t0 = performance.now();
  (function frame() {
    const html = document.documentElement;
    if (html) {
      rec.frames++;
      const v = html.getAttribute('data-template');
      if (v !== expected) rec.wrongFrames.push(v);
      const pending = html.classList.contains('nb-slots-pending');
      if (pending) rec.pendingSeen = true;
      else if (rec.pendingSeen) rec.pendingRemoved = true;
      if (!rec.pendingRemoved && [...document.querySelectorAll('.nb-slot')].some(s => s.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) rec.visibleSlotFrames++;
    }
    if (!rec.pendingRemoved && performance.now() - t0 < 6000) requestAnimationFrame(frame);
  })();
}

// Wraps NebulosaFX.register so every api.raf callback counts its own invocations in window.__nbRaf.
function rafProbe() {
  window.__nbRaf = [];
  const seen = window.__nbFx = { installed: false, registered: [], mounted: [] };
  let fx;
  Object.defineProperty(window, 'NebulosaFX', {
    configurable: true, enumerable: true,
    get() { return fx; },
    set(v) {
      fx = v;
      if (!v || typeof v.register !== 'function') return;
      seen.installed = true;
      const register = v.register.bind(v);
      v.register = (slug, def) => { seen.registered.push(slug); return register(slug, Object.assign({}, def, {
        mount(root, api) {
          seen.mounted.push(slug);
          const wrapped = Object.create(api);
          wrapped.raf = (fn, opts) => { const c = { slug, n: 0 }; window.__nbRaf.push(c); return api.raf((...a) => { c.n++; return fn(...a); }, opts); };
          return def.mount.call(this, root, wrapped);
        },
      })); };
    },
  });
  let n = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { n++; return raf(cb); };
  window.__nbRafCalls = () => n;
}

// Wraps NebulosaFX.register so every mount's api is kept in window.__nbApis ({slug, api}).
function pointerProbe() {
  window.__nbApis = [];
  let fx;
  Object.defineProperty(window, 'NebulosaFX', {
    configurable: true, enumerable: true,
    get() { return fx; },
    set(v) {
      fx = v;
      if (!v || typeof v.register !== 'function') return;
      const register = v.register.bind(v);
      v.register = (slug, def) => register(slug, Object.assign({}, def, {
        mount(root, api) { window.__nbApis.push({ slug, api }); return def.mount.call(this, root, api); },
      }));
    },
  });
}

function blockStorage() {
  const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
}

// ---------- the checks ----------
async function coreMarkup(run) {
  const fails = [];
  await pool(run.paths(), PARALLEL, async p => {
    const s = await run.open(p, { js: false, settle: 0 });
    try {
      const r = await s.page.evaluate(() => {
        const navs = document.querySelectorAll('header.nb-header nav.nb-nav');
        return {
          nb: document.body.classList.contains('nb'),
          h1: document.querySelectorAll('h1').length,
          navs: navs.length,
          links: navs.length ? [...navs[0].querySelectorAll('a')].map(a => a.textContent.replace(/\s+/g, ' ').trim()) : [],
          footers: document.querySelectorAll('footer.nb-footer').length,
        };
      });
      if (!r.nb) fails.push(`${p}: body lacks class nb`);
      if (r.h1 !== 1) fails.push(`${p}: ${r.h1} h1 (want 1)`);
      if (r.navs !== 1) fails.push(`${p}: ${r.navs} header.nb-header nav.nb-nav (want 1)`);
      else if (JSON.stringify(r.links) !== JSON.stringify(NAV)) fails.push(`${p}: nav links ${JSON.stringify(r.links)} (want ${JSON.stringify(NAV)})`);
      if (r.footers !== 1) fails.push(`${p}: ${r.footers} footer.nb-footer (want 1)`);
    } finally { await s.close(); }
  });
  return fails;
}

async function noJsDefault(run) {
  const fails = [];
  await pool(run.paths(), PARALLEL, async p => {
    const s = await run.open(p, { js: false, settle: 0 });
    try {
      const r = await s.page.evaluate(css => {
        const html = document.documentElement;
        const link = [...document.querySelectorAll('link[rel~=stylesheet]')].find(l => new URL(l.href).pathname === css);
        const backdrop = document.querySelector('[data-slot="backdrop"]');
        return {
          template: html.getAttribute('data-template'), scheme: html.getAttribute('data-scheme'),
          css: !!link, applied: !!(link && link.sheet && !link.disabled),
          bg: getComputedStyle(document.body).backgroundColor,
          backdrop: backdrop ? backdrop.innerHTML.trim() !== '' : null,
          switcher: [...document.querySelectorAll('.nb-switcher')].some(e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
        };
      }, cssOf(DEFAULT));
      if (r.template !== DEFAULT) fails.push(`${p}: html[data-template]=${JSON.stringify(r.template)} (want ${DEFAULT})`);
      if (r.scheme !== 'dark') fails.push(`${p}: html[data-scheme]=${JSON.stringify(r.scheme)} (want dark)`);
      if (!r.css) fails.push(`${p}: no stylesheet ${cssOf(DEFAULT)}`);
      else if (!r.applied) fails.push(`${p}: ${cssOf(DEFAULT)} not applied`);
      if (r.bg === 'rgba(0, 0, 0, 0)') fails.push(`${p}: body background is transparent`);
      if (r.backdrop === null) fails.push(`${p}: no [data-slot="backdrop"]`);
      else if (!r.backdrop) fails.push(`${p}: [data-slot="backdrop"] is empty`);
      if (r.switcher) fails.push(`${p}: .nb-switcher visible without JS`);
      if (p === '/') {
        const m = await railMotion(s.page);
        if (!m) fails.push('/: no .nb-clients__list');
        else {
          if (m.anims) fails.push(`/: ${m.anims} running animation(s) on .nb-clients__list without JS`);
          if (m.moved > 0.5) fails.push(`/: clients rail moved ${m.moved.toFixed(1)}px in 1 s without JS`);
        }
      }
    } finally { await s.close(); }
  });
  return fails;
}

async function noOverflow(run) {
  const fails = [];
  for (const r of await run.sweep()) {
    const na = notApplied(r, r.t);
    if (na) { fails.push(`${r.w}px ${na}`); continue; }
    const at = `${r.t} ${r.p} ${r.w}px`;
    const judge = (f, label) => {
      if (f.sw > f.iw) fails.push(`${at}${label}: scrollWidth ${f.sw} > ${f.iw}`);
      if (f.wide) fails.push(`${at}${label}: ${f.wide} element(s) past the right edge: ${f.wideDesc.join(', ')}`);
    };
    if (r.fit.htmlOx !== 'visible' || r.fit.bodyOx !== 'visible') fails.push(`${at}: overflow-x html=${r.fit.htmlOx} body=${r.fit.bodyOx} (want visible: hiding it masks overflow)`);
    judge(r.fit, '');
    if (r.long) judge(r.long, ` with long tokens in ${r.long.injected.join(', ') || 'nothing (no target found)'}`);
  }
  return fails;
}

async function wide(run) {
  const fails = [];
  const results = await run.sweep();
  if (!results.some(r => r.w === WIDE_AT)) return [`no page was loaded at ${WIDE_AT}px (WIDTHS must include WIDE_AT)`];
  for (const r of results) {
    if (r.w !== WIDE_AT || WIDE_EXEMPT.includes(r.t)) continue;
    const na = notApplied(r, r.t);
    if (na) { fails.push(`${r.w}px ${na}`); continue; }
    if (!(r.content >= WIDE_MIN)) fails.push(`${r.t} ${r.p} ${r.w}px: widest content box in main is ${r.content}px (want >= ${WIDE_MIN}: the layout uses the width)`);
  }
  return fails;
}

// The wide probe itself, against two fixtures at WIDE_AT: a full-bleed section around a 1280 wrapper must measure
// the wrapper (and fail the gate); the same around a 1600 one must pass. Keeps the gate from measuring section boxes.
async function wideProbe(run) {
  const fails = [];
  const ctx = await run.browser.newContext({ viewport: { width: WIDE_AT, height: 800 } });
  try {
    const page = await ctx.newPage();
    for (const [name, want] of [['wide-broken', false], ['wide-ok', true]]) {
      await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8'));
      const w = await page.evaluate(contentWidthProbe);
      if ((w >= WIDE_MIN) !== want) fails.push(`fixtures/${name}.html at ${WIDE_AT}px: the probe measured ${w}px (want ${want ? '>=' : '<'} ${WIDE_MIN})`);
    }
  } finally { await ctx.close(); }
  return fails;
}

async function noConsoleErrors(run) {
  const fails = [];
  for (const r of await run.sweep()) {
    const na = notApplied(r, r.t);
    if (na) { fails.push(`${r.w}px ${na}`); continue; }
    for (const m of [...r.console.filter(c => !CONSOLE_ALLOWED.includes(c)), ...r.errors.map(e => `pageerror: ${e}`)]) fails.push(`${r.t} ${r.p} ${r.w}px: ${m}`);
  }
  return fails;
}

async function copyRules(run) {
  const fails = [];
  await pool(run.paths(), PARALLEL, async p => {
    const s = await run.open(p, { settle: 0 });
    try {
      const text = await s.page.evaluate(() => {
        const b = document.body.cloneNode(true);
        b.querySelectorAll('script,style,template').forEach(e => e.remove());
        return `${document.title}\n${b.textContent}`;
      });
      const m = text.match(FORBIDDEN);
      if (m) fails.push(`${p}: contains ${JSON.stringify(m[0])}`);
      if (p !== '/') return;
      for (const want of ['AI-first engineering', 'Staff augmentation']) if (!text.includes(want)) fails.push(`/: missing "${want}"`);
      const list = s.page.locator('.nb-clients__list').first();
      if (!(await list.count())) { fails.push('/: no .nb-clients__list'); return; }
      const names = await list.getByRole('listitem').evaluateAll(lis => lis.map(li =>
        li.innerText.replace(/\s+/g, ' ').trim() || [...li.querySelectorAll('img[alt],[aria-label]')].map(e => e.getAttribute('alt') || e.getAttribute('aria-label')).join(' ').trim()));
      if (JSON.stringify(names) !== JSON.stringify(CLIENTS)) fails.push(`/: clients ${JSON.stringify(names)} (want ${JSON.stringify(CLIENTS)})`);
    } finally { await s.close(); }
  });
  return fails;
}

async function seo(run) {
  const fails = [];
  const posts = postPaths();
  if (!posts.length) fails.push('no /blog/<slug> pages in the build');
  await pool(run.paths(), PARALLEL, async p => {
    const s = await run.open(p, { settle: 0 });
    try {
      const r = await s.page.evaluate(() => {
        const ld = [];
        const flat = v => Array.isArray(v) ? v.forEach(flat) : v && typeof v === 'object' && (ld.push(v), v['@graph'] && flat(v['@graph']));
        let bad = 0;
        document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { flat(JSON.parse(s.textContent)); } catch (e) { bad++; } });
        const types = o => [].concat(o['@type'] || []);
        const hasKey = (o, k) => o && typeof o === 'object' && (k in o || Object.values(o).some(v => hasKey(v, k)));
        const orgs = ld.filter(o => types(o).includes('Organization'));
        const goat = [...document.querySelectorAll('script[src]')].filter(e => e.src === 'https://gc.zgo.at/count.v4.js');
        return {
          badLd: bad,
          canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
          ogType: (document.querySelector('meta[property="og:type"]') || {}).content || null,
          blogPosting: ld.some(o => types(o).includes('BlogPosting')),
          orgs: orgs.length, orgPhone: orgs.some(o => hasKey(o, 'telephone')),
          goat: goat.length, goatIntegrity: goat.some(e => (e.getAttribute('integrity') || '').trim() !== ''),
          goatData: goat.map(e => e.getAttribute('data-goatcounter')),
        };
      });
      if (r.badLd) fails.push(`${p}: ${r.badLd} JSON-LD block(s) do not parse`);
      if (!r.orgs) fails.push(`${p}: no Organization JSON-LD`);
      if (r.orgPhone) fails.push(`${p}: Organization JSON-LD has a telephone`);
      if (!r.goat) fails.push(`${p}: no <script src="${GOAT_SRC}">`);
      else {
        if (!r.goatIntegrity) fails.push(`${p}: GoatCounter script has no integrity attribute`);
        if (!r.goatData.includes(GOAT_DATA)) fails.push(`${p}: GoatCounter data-goatcounter=${JSON.stringify(r.goatData)} (want ${GOAT_DATA})`);
        if (!s.log.requests.includes(GOAT_SRC)) fails.push(`${p}: ${GOAT_SRC} never requested`);
      }
      if (posts.includes(p)) {
        const want = `https://nebulosa.io${p}`;
        if (r.canonical !== want) fails.push(`${p}: canonical ${JSON.stringify(r.canonical)} (want ${want})`);
        if (r.ogType !== 'article') fails.push(`${p}: og:type ${JSON.stringify(r.ogType)} (want article)`);
        if (!r.blogPosting) fails.push(`${p}: no BlogPosting JSON-LD`);
      }
    } finally { await s.close(); }
  });
  for (const p of ['/blog/rss.xml', '/sitemap.xml']) {
    const res = await fetch(run.origin + p);
    if (res.status !== 200) fails.push(`${p}: HTTP ${res.status}`);
  }
  return fails;
}

async function switcher(run) {
  const others = run.templates.filter(t => t !== DEFAULT);
  if (!others.length) return [`needs a template besides ${DEFAULT} (limited by --templates)`];
  const fails = [];
  const s = await run.open('/');
  try {
    const page = s.page;
    const small0 = await smallTargets(page);
    if (small0.length) fails.push(`on load: switcher target(s) under 44x44 px: ${small0.join(', ')}`);
    for (const slug of [...others, DEFAULT]) {
      const before = await page.evaluate(() => {
        const hero = document.querySelector('[data-slot="hero-art"]');
        return { template: document.documentElement.getAttribute('data-template'), hero: hero ? hero.innerHTML : null };
      });
      if (before.hero === null) return [...fails, 'no [data-slot="hero-art"] on /'];
      const why = await pickTemplate(page, slug);
      if (why) return [...fails, `${before.template} -> ${slug}: ${why}`];
      const step = `${before.template} -> ${slug}`;
      if (!(await until(page, c => [...document.querySelectorAll('link[rel~=stylesheet]')].some(l => new URL(l.href).pathname === c), cssOf(slug)))) {
        fails.push(`${step}: no stylesheet ${cssOf(slug)} (have ${JSON.stringify(await templateCss(page))})`);
      } else if ((await templateCss(page)).includes(cssOf(before.template))) fails.push(`${step}: ${cssOf(before.template)} still linked`);
      if (!(await until(page, h => { const e = document.querySelector('[data-slot="hero-art"]'); return e && e.innerHTML !== h; }, before.hero))) fails.push(`${step}: [data-slot="hero-art"] unchanged`);
      const small = await smallTargets(page);
      if (small.length) fails.push(`${step}: switcher target(s) under 44x44 px: ${small.join(', ')}`);
      const stored = await page.evaluate(k => localStorage.getItem(k), KEY);
      if (stored !== slug) fails.push(`${step}: localStorage[${KEY}]=${JSON.stringify(stored)}`);
    }
    // The disclosure itself: Escape closes the panel and returns focus to its button; a click outside closes it.
    const open = await openSwitcher(page);
    if (open) fails.push(`disclosure: ${open}`);
    else {
      await page.keyboard.press('Escape');
      const esc = await page.evaluate(() => ({
        expanded: document.querySelector('.nb-switcher__toggle').getAttribute('aria-expanded'),
        panel: [...document.querySelectorAll('.nb-switcher__panel')].some(e => e.checkVisibility()),
        focus: document.activeElement === document.querySelector('.nb-switcher__toggle'),
      }));
      if (esc.expanded !== 'false' || esc.panel) fails.push(`disclosure: Escape left the panel open (aria-expanded=${esc.expanded}, panel visible=${esc.panel})`);
      if (!esc.focus) fails.push('disclosure: Escape did not return focus to .nb-switcher__toggle');
      const again = await openSwitcher(page);
      if (again) fails.push(`disclosure: ${again}`);
      else {
        await page.mouse.click(8, 400); // the page, away from the switcher
        await page.waitForTimeout(100);
        const out = await page.evaluate(() => document.querySelector('.nb-switcher__toggle').getAttribute('aria-expanded'));
        if (out !== 'false') fails.push(`disclosure: a click outside left the panel open (aria-expanded=${out})`);
      }
    }
    // Reload with a saved non-default template: one value, no wrong frame, slots hidden until ready.
    const saved = others[0];
    const why = await pickTemplate(page, saved);
    if (why) return [...fails, `-> ${saved} before reload: ${why}`];
    await s.ctx.addInitScript(fouCProbe, saved);
    await page.reload({ waitUntil: 'load' });
    await until(page, () => window.__nbProbe && (window.__nbProbe.pendingRemoved || !document.documentElement.classList.contains('nb-slots-pending')), null, 6000);
    await page.waitForTimeout(100);
    const p = await page.evaluate(() => window.__nbProbe);
    const now = await page.evaluate(() => document.documentElement.getAttribute('data-template'));
    if (now !== saved) fails.push(`reload with ${saved} saved: html[data-template]=${JSON.stringify(now)}`);
    const distinct = [...new Set(p.values)];
    if (distinct.length > 1 || (distinct.length === 1 && distinct[0] !== saved)) fails.push(`reload with ${saved} saved: data-template set to ${JSON.stringify(p.values)} before DOMContentLoaded (want only ${saved})`);
    if (p.wrongFrames.length) fails.push(`reload with ${saved} saved: ${p.wrongFrames.length} frame(s) painted with data-template ${JSON.stringify([...new Set(p.wrongFrames)])}`);
    if (!p.pendingSeen) fails.push(`reload with ${saved} saved: html.nb-slots-pending never set`);
    else if (!p.pendingRemoved) fails.push(`reload with ${saved} saved: html.nb-slots-pending never removed`);
    if (p.visibleSlotFrames) fails.push(`reload with ${saved} saved: .nb-slot visible in ${p.visibleSlotFrames} frame(s) before nb-slots-pending was removed`);
    return fails;
  } finally { await s.close(); }
}

async function switchCleanup(run) {
  const others = ['horizonte', 'polvo'].filter(t => run.templates.includes(t));
  const pool2 = others.length ? others : run.templates.filter(t => t !== DEFAULT);
  if (!pool2.length) return [`needs a template besides ${DEFAULT} (limited by --templates)`];
  const seq = [pool2[0], DEFAULT, pool2[1] || pool2[0], DEFAULT];
  const s = await run.open('/', { settle: 1000 });
  try {
    const page = s.page;
    const hasLoops = await page.evaluate(() => !!(window.NebulosaFX && typeof window.NebulosaFX.loops === 'function'));
    if (!hasLoops) return ['no NebulosaFX.loops()'];
    const layers0 = await page.evaluate(() => document.querySelectorAll('.fx-layer').length);
    const slots = () => page.evaluate(() => {
      const o = {};
      // Each slot appears once, but service-art: one in each .nb-service (the core's markup).
      const want = k => k === 'service-art' ? document.querySelectorAll('.nb-service').length : 1;
      document.querySelectorAll('[data-slot]').forEach(e => {
        const k = e.getAttribute('data-slot');
        o[k] = o[k] || { n: 0, want: want(k), kids: e.childElementCount };
        o[k].n++;
      });
      return o;
    });
    const slots0 = await slots();
    const missing = ['hero-art', 'backdrop'].filter(k => !slots0[k]);
    if (missing.length) return [`no ${missing.map(k => `[data-slot="${k}"]`).join(', ')} on /`];
    // The engine may position a slot for its layers; that inline style must not outlive the template. The chain ends
    // on the default template again, so each slot's inline position must be what the first load (same template) had.
    const inlinePositions = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-slot]')]
      .map(e => [e.getAttribute('data-slot'), e.style.position || ''])));
    const positions0 = await inlinePositions();
    const fails = [];
    let from = DEFAULT;
    for (const slug of seq) {
      const why = await pickTemplate(page, slug);
      if (why) return [...fails, `${from} -> ${slug}: ${why}`];
      from = slug;
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const fams = {};
      for (const l of document.querySelectorAll('link[href]')) {
        const u = new URL(l.href);
        let keys = [];
        if (u.hostname === 'fonts.googleapis.com' && /stylesheet/.test(l.rel)) keys = u.searchParams.getAll('family').map(f => 'google:' + f.split(':')[0]);
        else if (/preload/.test(l.rel) && l.getAttribute('as') === 'font') keys = ['preload:' + u.pathname];
        else if (/stylesheet/.test(l.rel) && /\/fonts?[/.]/.test(u.pathname)) keys = ['css:' + u.pathname];
        keys.forEach(k => { fams[k] = (fams[k] || 0) + 1; });
      }
      return { loops: window.NebulosaFX.loops(document.body), layers: document.querySelectorAll('.fx-layer').length, fams };
    });
    const path_ = [DEFAULT, ...seq].join('->');
    if (!(r.loops <= 2)) fails.push(`after ${path_}: NebulosaFX.loops(body)=${r.loops} (want <= 2)`);
    if (r.layers !== layers0) fails.push(`after ${path_}: ${r.layers} .fx-layer (first load had ${layers0})`);
    for (const [k, n] of Object.entries(r.fams)) if (n > 1) fails.push(`after ${path_}: ${n} font links for ${k}`);
    const slots1 = await slots();
    const positions1 = await inlinePositions();
    const styled0 = Object.entries(positions0).filter(([, v]) => v).map(([k, v]) => `${k}(${v})`);
    const styled1 = Object.entries(positions1).filter(([, v]) => v).map(([k, v]) => `${k}(${v})`);
    if (styled0.length) fails.push(`first load: inline position on ${styled0.join(', ')}`);
    if (styled1.length) fails.push(`after ${path_}: inline position left on ${styled1.join(', ')}`);
    for (const [k, v] of Object.entries(slots0)) if (v.n > v.want) fails.push(`first load: [data-slot="${k}"] appears ${v.n} times (want ${v.want})`);
    for (const [k, v] of Object.entries(slots1)) if (v.n > v.want) fails.push(`after ${path_}: [data-slot="${k}"] appears ${v.n} times (want ${v.want})`);
    for (const [k, v] of Object.entries(slots0)) {
      if (!slots1[k]) fails.push(`after ${path_}: [data-slot="${k}"] is gone`);
      else if (slots1[k].kids !== v.kids) fails.push(`after ${path_}: [data-slot="${k}"] has ${slots1[k].kids} child element(s) (first load had ${v.kids})`);
    }
    return fails;
  } finally { await s.close(); }
}

async function storageBlocked(run) {
  const others = run.templates.filter(t => t !== DEFAULT);
  if (!others.length) return [`needs a template besides ${DEFAULT} (limited by --templates)`];
  const fails = [];
  const s = await run.open('/', { init: [[blockStorage]] });
  try {
    const t = await s.page.evaluate(() => document.documentElement.getAttribute('data-template'));
    if (t !== DEFAULT) fails.push(`storage blocked: html[data-template]=${JSON.stringify(t)} (want ${DEFAULT})`);
    for (const e of s.log.errors) fails.push(`storage blocked: pageerror ${e}`);
    const why = await pickTemplate(s.page, others[0]);
    if (why) fails.push(`storage blocked: switching to ${others[0]}: ${why}`);
    return fails;
  } finally { await s.close(); }
}

async function staleSlug(run) {
  const fails = [];
  const s = await run.open('/', { template: 'nubes', settle: 1000 });
  try {
    const t = await s.page.evaluate(() => document.documentElement.getAttribute('data-template'));
    if (t !== DEFAULT) fails.push(`saved "nubes": html[data-template]=${JSON.stringify(t)} (want ${DEFAULT})`);
    for (const r of s.log.responses) if (r.status === 404) fails.push(`saved "nubes": 404 ${r.url.replace(run.origin, '')}`);
    return fails;
  } finally { await s.close(); }
}

async function reducedMotion(run) {
  const fails = [];
  await pool(run.templates, PARALLEL, async slug => {
    const s = await run.open('/', { template: slug, reducedMotion: 'reduce', init: [[rafProbe]], settle: 500 });
    try {
      const page = s.page;
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-template'));
      if (t !== slug) { fails.push(`${slug}: template not applied (html[data-template]=${JSON.stringify(t)})`); return; }
      if (!(await page.evaluate(() => !!window.NebulosaFX))) fails.push(`${slug}: no NebulosaFX`);
      const calls0 = await page.evaluate(() => window.__nbRafCalls());
      const m = await railMotion(page); // waits 1 s
      if (!m) { fails.push(`${slug}: no .nb-clients__list`); return; }
      const r = await page.evaluate(() => ({
        raf: window.__nbRaf.filter(c => c.n > 1).map(c => `${c.slug}:${c.n}`),
        rafSlugs: window.__nbRaf.map(c => c.slug), fx: window.__nbFx, calls: window.__nbRafCalls(),
      }));
      if (m.anims) fails.push(`${slug}: ${m.anims} running animation(s) on .nb-clients__list`);
      if (m.moved > 0.5) fails.push(`${slug}: clients rail moved ${m.moved.toFixed(1)}px in 1 s`);
      if (r.raf.length) fails.push(`${slug}: api.raf loop(s) ran more than once: ${r.raf.join(', ')}`);
      if (r.calls - calls0 > 2) fails.push(`${slug}: requestAnimationFrame called ${r.calls - calls0} times in 1 s`);
      // Without this, a probe that never installed would make the per-loop counts pass vacuously.
      const res = await fetch(`${run.origin}/assets/templates/${slug}/manifest.json`);
      if (res.status !== 200) { fails.push(`${slug}: manifest.json HTTP ${res.status}`); return; }
      const manifest = await res.json();
      if (manifest.effects === true) {
        if (!r.fx.installed) fails.push(`${slug}: effects: true but window.NebulosaFX was never assigned an object with register()`);
        else if (!r.fx.registered.includes(slug)) fails.push(`${slug}: effects: true but NebulosaFX.register('${slug}') never called`);
        else if (!r.fx.mounted.includes(slug)) fails.push(`${slug}: effects: true but its mount() never ran`);
        else if (!r.rafSlugs.includes(slug)) fails.push(`${slug}: effects: true but it never called api.raf (a still frame is drawn through it)`);
        // The still frame must survive the canvas being sized: after load, and again after a resize.
        const painted = () => page.evaluate(() => {
          const c = document.querySelector('[data-slot="backdrop"] canvas');
          if (!c) return null;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
          return false;
        });
        const p0 = await painted();
        if (p0 === false) fails.push(`${slug}: the backdrop canvas is blank after load under reduced motion`);
        if (p0 !== null) {
          await page.setViewportSize({ width: 1100, height: 800 });
          await page.waitForTimeout(300);
          if (!(await painted())) fails.push(`${slug}: the backdrop canvas is blank after a resize under reduced motion`);
        }
      }
    } finally { await s.close(); }
  });
  return fails;
}

async function rail(run) {
  const fails = [];
  await pool(run.templates, PARALLEL, async slug => {
    const s = await run.open('/', { template: slug, settle: 500 });
    try {
      const page = s.page;
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-template'));
      if (t !== slug) { fails.push(`${slug}: template not applied (html[data-template]=${JSON.stringify(t)})`); return; }
      const list = page.locator('.nb-clients__list').first();
      if (!(await list.count())) { fails.push(`${slug}: no .nb-clients__list`); return; }
      const items = await list.getByRole('listitem').count();
      if (items !== CLIENTS.length) fails.push(`${slug}: ${items} accessible listitem(s) in .nb-clients__list (want ${CLIENTS.length})`);
      const res = await fetch(`${run.origin}/assets/templates/${slug}/manifest.json`);
      if (res.status !== 200) { fails.push(`${slug}: manifest.json HTTP ${res.status}`); return; }
      const want = (await res.json()).rail;
      if (want !== 'moving' && want !== 'static') { fails.push(`${slug}: manifest.json rail=${JSON.stringify(want)} (want "moving" or "static")`); return; }
      if (want === 'static' && !STILL_RAIL_ALLOWED.includes(slug)) {
        fails.push(`${slug}: manifest declares rail: static, but the spec has "Worked with" moving in every template except ${STILL_RAIL_ALLOWED.join(', ')} (design review 2026-11-06)`);
        return;
      }
      // The rail never stops moving, so no locator action (they wait for a stable box): plain DOM + mouse.
      await list.evaluate(l => l.scrollIntoView({ block: 'center' }));
      await page.mouse.move(0, 0);
      const x = () => list.evaluate(l => { const li = l.querySelector('li'); return li ? li.getBoundingClientRect().left : null; });
      const moving = async () => { const a = await x(); await page.waitForTimeout(1000); const b = await x(); return a !== null && Math.abs(b - a) > 1; };
      const still = async () => { await page.waitForTimeout(400); const a = await x(); await page.waitForTimeout(1000); return Math.abs((await x()) - a) <= 0.5; };
      const moves = await moving();
      if (want === 'static') {
        if (moves) fails.push(`${slug}: manifest says rail: static but the clients list moved over 1 s`);
        if (await page.evaluate(() => !!document.querySelector('.nb-clients[data-nb-rail]'))) fails.push(`${slug}: manifest says rail: static but .nb-clients carries data-nb-rail`);
        return;
      }
      if (!moves) { fails.push(`${slug}: manifest says rail: moving but the clients rail does not move over 1 s`); return; }
      // The loop copies ride the same line as the list (a margin meant for the first one shifted it in pizarra).
      const tops = await page.evaluate(() => [...document.querySelectorAll('.nb-clients__list')].map(l => Math.round(l.getBoundingClientRect().top)));
      if (new Set(tops).size > 1) fails.push(`${slug}: clients list and its loop copies sit at different heights (tops ${tops.join(', ')})`);
      const box = await list.evaluate(l => {
        const r = l.getBoundingClientRect(), left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
        return { x: (left + right) / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.move(box.x, box.y);
      if (!(await still())) fails.push(`${slug}: clients rail keeps moving under the pointer`);
      await page.mouse.move(0, 0);
      if (!(await moving())) fails.push(`${slug}: clients rail does not resume after hover`);
    } finally { await s.close(); }
  });
  return fails;
}

// The Contact composer posts to Web3Forms (WEB3FORMS). No probe reaches it: every page routes it to a fake reply.
// Without JS the browser posts the form and Web3Forms redirects to /sent.html; with JS compose.js sends it in place.
const WEB3FORMS = 'https://api.web3forms.com/submit';
const COMPOSE = {
  key: 'check-key', subject: 'Project inquiry', nda: 'Project inquiry — NDA requested', email: 'hello@nebulosa.io',
  sending: 'Sending…', sent: "Message sent. We'll reply from hello@nebulosa.io.", failed: "It didn't go through. Write to us directly:",
  sentHeading: 'Message sent', sentLead: "Thanks. We'll reply from hello@nebulosa.io.",
};
// A form post's fields as [name, value] pairs, urlencoded or multipart; null when the body is neither.
function postedFields(req) {
  const type = req.headers()['content-type'] || '', body = req.postData() || '';
  if (type.startsWith('application/x-www-form-urlencoded')) return [...new URLSearchParams(body)];
  const m = type.match(/boundary=(.+)$/);
  if (!m) return null;
  return body.split('--' + m[1]).slice(1, -1).map(part => {
    const f = part.match(/name="([^"]*)"[^]*?\r\n\r\n([^]*)\r\n$/);
    return f ? [f[1], f[2]] : [null, part];
  });
}

async function contact(run) {
  if (run.pageNames && !run.pageNames.includes('contact')) return [];
  const p = PAGES.contact;
  const fails = [];
  const MSG = 'a & b #c\nd', MAILBODY = 'Ada Lovelace <ada@example.com>\r\n\r\na & b #c\r\nd';
  // Opens the Contact page with Web3Forms answered by reply(n) (n: the post's index); returns the probe and its posts.
  const openWith = async (opts, reply) => {
    const posts = [];
    const s = await run.open(p, { settle: 0, ...opts, routes: [['https://api.web3forms.com/**', async route => {
      const n = posts.push(route.request()) - 1;
      await reply(route, n);
    }]] });
    return { s, posts };
  };
  const json = (status, body) => route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const fill = async page => {
    await page.locator('#nb-compose-name').fill('Ada Lovelace');
    await page.locator('#nb-compose-email').fill('ada@example.com');
    await page.locator('#nb-compose-message').fill(MSG);
  };
  const state = page => page.evaluate(() => {
    const f = document.querySelector('form.nb-compose'), st = f.querySelector('.nb-compose__status'), a = st.querySelector('a');
    const b = f.querySelector('[type=submit]');
    return {
      status: st.textContent, mailto: a ? a.getAttribute('href') : null,
      disabled: b.disabled, aria: b.getAttribute('aria-disabled'), focus: document.activeElement === b,
      name: f.elements.name.value, email: f.elements.email.value, message: f.elements.message.value, nda: f.elements.nda.checked,
    };
  });

  // Markup, per template: action, hidden fields, the honeypot out of sight and out of the accessibility tree,
  // labelled required fields, 44 px targets.
  await pool(run.templates, PARALLEL, async slug => {
    const { s } = await openWith({ template: slug }, json(200, { success: true }));
    try {
      const f = await s.page.evaluate(() => {
        const form = document.querySelector('form.nb-compose');
        if (!form) return null;
        const el = n => form.querySelector(`[name="${n}"]`);
        const hidden = n => { const e = el(n); return e && e.type === 'hidden' ? e.value : null; };
        const labelled = e => !!(e && e.labels && e.labels.length && e.labels[0].textContent.trim());
        const size = e => { if (!e) return null; const r = (e.closest('label.nb-compose__check') || e).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        const trap = el('botcheck'), st = form.querySelector('.nb-compose__status');
        const field = n => { const e = el(n); return e && { tag: e.tagName.toLowerCase(), type: e.type, required: e.required, auto: e.getAttribute('autocomplete'), labelled: labelled(e), size: size(e) }; };
        return {
          action: form.getAttribute('action'), method: (form.getAttribute('method') || '').toLowerCase(), enctype: form.getAttribute('enctype'),
          key: hidden('access_key'), subject: hidden('subject'), fromName: hidden('from_name'), redirect: hidden('redirect'),
          trap: trap && { type: trap.type, tabindex: trap.getAttribute('tabindex'), visible: trap.checkVisibility(), display: getComputedStyle(trap).display },
          name: field('name'), email: field('email'), message: field('message'),
          nda: field('nda'), ndaChecked: el('nda') ? el('nda').checked : null, ndaValue: el('nda') ? el('nda').value : null,
          btn: size(form.querySelector('button[type=submit]')),
          status: st && { role: st.getAttribute('role'), live: st.getAttribute('aria-live'), text: st.textContent },
        };
      });
      const at = `${p} (${slug})`;
      if (!f) { fails.push(`${at}: no form.nb-compose`); return; }
      if (f.action !== WEB3FORMS || f.method !== 'post') fails.push(`${at}: form ${f.method} ${JSON.stringify(f.action)} (want post ${WEB3FORMS})`);
      if (f.enctype) fails.push(`${at}: form enctype=${f.enctype} (want the default)`);
      if (f.key !== COMPOSE.key) fails.push(`${at}: access_key ${JSON.stringify(f.key)} (want the check build's ${COMPOSE.key})`);
      if (f.subject !== COMPOSE.subject) fails.push(`${at}: hidden subject ${JSON.stringify(f.subject)}`);
      if (f.fromName !== 'nebulosa.io') fails.push(`${at}: hidden from_name ${JSON.stringify(f.fromName)}`);
      if (!f.redirect || new URL(f.redirect).pathname !== '/sent.html') fails.push(`${at}: hidden redirect ${JSON.stringify(f.redirect)} (want …/sent.html)`);
      if (!f.trap) fails.push(`${at}: no botcheck honeypot`);
      else if (f.trap.type !== 'checkbox' || f.trap.tabindex !== '-1' || f.trap.visible || f.trap.display !== 'none') fails.push(`${at}: honeypot ${JSON.stringify(f.trap)} (want a display:none checkbox, tabindex -1)`);
      const boxes = await s.page.locator('form.nb-compose').getByRole('checkbox').count();
      // A live region has to be in the accessibility tree before it speaks, so the empty status must be there too.
      const live = await s.page.locator('form.nb-compose').getByRole('status').count();
      if (live !== 1) fails.push(`${at}: the empty status is ${live ? 'there ' + live + ' times' : 'not'} in the accessibility tree (want once)`);
      if (boxes !== 1) fails.push(`${at}: ${boxes} checkbox(es) in the accessibility tree (want 1: the NDA box; the honeypot stays out)`);
      for (const [n, want] of [['name', { type: 'text', auto: 'name' }], ['email', { type: 'email', auto: 'email' }], ['message', { tag: 'textarea' }]]) {
        const e = f[n];
        if (!e) { fails.push(`${at}: no field ${n}`); continue; }
        if (!e.required) fails.push(`${at}: ${n} not required`);
        if (!e.labelled) fails.push(`${at}: ${n} has no <label for>`);
        if (want.type && e.type !== want.type) fails.push(`${at}: ${n} type=${e.type} (want ${want.type})`);
        if (want.auto && e.auto !== want.auto) fails.push(`${at}: ${n} autocomplete=${e.auto} (want ${want.auto})`);
        if (want.tag && e.tag !== want.tag) fails.push(`${at}: ${n} is a ${e.tag} (want ${want.tag})`);
        if (n !== 'message' && (e.size[0] < 44 || e.size[1] < 44)) fails.push(`${at}: ${n} target ${e.size.join('x')} px (want 44x44)`);
      }
      if (!f.nda) fails.push(`${at}: no NDA checkbox input[name=nda]`);
      else {
        if (f.ndaChecked) fails.push(`${at}: NDA checkbox is checked by default`);
        if (f.ndaValue !== 'yes') fails.push(`${at}: NDA value ${JSON.stringify(f.ndaValue)} (want yes)`);
        if (!f.nda.labelled) fails.push(`${at}: NDA checkbox has no label`);
        if (f.nda.size[0] < 44 || f.nda.size[1] < 44) fails.push(`${at}: NDA target ${f.nda.size.join('x')} px (want 44x44)`);
      }
      if (!f.btn) fails.push(`${at}: no submit button`);
      else if (f.btn[0] < 44 || f.btn[1] < 44) fails.push(`${at}: submit target ${f.btn.join('x')} px (want 44x44)`);
      if (!f.status) fails.push(`${at}: no .nb-compose__status`);
      else if (f.status.role !== 'status' || f.status.live !== 'polite' || f.status.text !== '') fails.push(`${at}: status ${JSON.stringify(f.status)} (want an empty role=status, aria-live=polite)`);
    } finally { await s.close(); }
  });
  if (fails.length) return fails;

  // Empty submit: native validation stops it, nothing is posted.
  {
    const { s, posts } = await openWith({}, json(200, { success: true }));
    try {
      await s.page.locator('form.nb-compose button[type=submit]').click();
      await s.page.waitForTimeout(200);
      if (posts.length) fails.push(`${p}: an empty submit posted ${posts.length} time(s) (want validation to stop it)`);
      if (await s.page.evaluate(() => document.querySelector('form.nb-compose').checkValidity())) fails.push(`${p}: the empty form is valid`);
    } finally { await s.close(); }
  }

  // Filled submits, by mouse and (NDA checked) by keyboard. The reply is held so the in-flight state can be read.
  for (const nda of [false, true]) {
    const at = `${p}${nda ? ' (NDA checked)' : ''}`;
    let release;
    const held = new Promise(r => { release = r; });
    const { s, posts } = await openWith({}, async route => { await held; await json(200, { success: true, message: 'ok' })(route); });
    try {
      await fill(s.page);
      if (nda) { await s.page.locator('form.nb-compose input[name=nda]').focus(); await s.page.keyboard.press('Space'); }
      const btn = s.page.locator('form.nb-compose button[type=submit]');
      if (nda) { await btn.focus(); await s.page.keyboard.press('Enter'); } else await btn.click();
      if (!(await until(s.page, () => document.querySelector('.nb-compose__status').textContent !== ''))) fails.push(`${at}: no status while sending`);
      const mid = await state(s.page);
      if (mid.status !== COMPOSE.sending) fails.push(`${at}: in flight status ${JSON.stringify(mid.status)} (want ${JSON.stringify(COMPOSE.sending)})`);
      // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
      if (mid.aria !== 'true' || mid.disabled || !mid.focus) fails.push(`${at}: in flight button aria-disabled=${mid.aria} disabled=${mid.disabled} focused=${mid.focus} (want "true", false, true)`);
      await s.page.keyboard.press('Enter'); // a second submit while in flight is ignored
      await s.page.waitForTimeout(100);
      release();
      await until(s.page, t => document.querySelector('.nb-compose__status').textContent === t, COMPOSE.sent);
      await s.page.waitForTimeout(100);
      if (posts.length !== 1) { fails.push(`${at}: ${posts.length} posts for one submit (want 1)`); continue; }
      const req = posts[0];
      if (req.url() !== WEB3FORMS || req.method() !== 'POST') fails.push(`${at}: ${req.method()} ${req.url()} (want POST ${WEB3FORMS})`);
      if (req.headers().accept !== 'application/json') fails.push(`${at}: Accept ${JSON.stringify(req.headers().accept)} (want application/json)`);
      const pairs = postedFields(req) || [];
      const got = Object.fromEntries(pairs);
      const twice = pairs.map(x => x[0]).filter((k, i, a) => a.indexOf(k) !== i);
      if (twice.length) fails.push(`${at}: field(s) posted twice: ${twice.join(', ')}`);
      const want = { access_key: COMPOSE.key, subject: nda ? COMPOSE.nda : COMPOSE.subject, from_name: 'nebulosa.io', name: 'Ada Lovelace', email: 'ada@example.com' };
      for (const [k, v] of Object.entries(want)) if (got[k] !== v) fails.push(`${at}: posted ${k}=${JSON.stringify(got[k])} (want ${JSON.stringify(v)})`);
      if ((got.message || '').replace(/\r\n/g, '\n') !== MSG) fails.push(`${at}: posted message ${JSON.stringify(got.message)} (want ${JSON.stringify(MSG)})`);
      if (nda ? got.nda !== 'yes' : 'nda' in got) fails.push(`${at}: posted nda=${JSON.stringify(got.nda)} (want ${nda ? '"yes"' : 'absent'})`);
      if (got.botcheck) fails.push(`${at}: posted botcheck=${JSON.stringify(got.botcheck)} (want it empty)`);
      if ('redirect' in got) fails.push(`${at}: posted redirect (the in-page send reads the JSON reply, not the no-JS page)`);
      const end = await state(s.page);
      if (end.status !== COMPOSE.sent) fails.push(`${at}: status after success ${JSON.stringify(end.status)} (want ${JSON.stringify(COMPOSE.sent)})`);
      if (end.name || end.email || end.message || end.nda) fails.push(`${at}: fields not cleared after success ${JSON.stringify(end)}`);
      if (end.disabled || end.aria) fails.push(`${at}: button still disabled after success (disabled=${end.disabled}, aria-disabled=${end.aria})`);
      if (!end.focus) fails.push(`${at}: focus left the button after the send`);
      if (!s.page.url().endsWith(p)) fails.push(`${at}: page navigated to ${s.page.url()}`);
      await s.page.locator('#nb-compose-message').type('x');
      if ((await state(s.page)).status !== '') fails.push(`${at}: "sent" stays after the visitor starts a new message`);
    } finally { await s.close(); }
  }

  // Failures (HTTP 500, then success:false): the text stays, the status offers a mailto link carrying it (CRLF body).
  {
    const replies = [json(500, { success: false }), json(200, { success: false, message: 'nope' })];
    const { s, posts } = await openWith({}, (route, n) => replies[Math.min(n, 1)](route));
    try {
      await fill(s.page);
      for (const [i, why] of ['HTTP 500', 'success:false'].entries()) {
        const at = `${p} (${why})`;
        await s.page.locator('form.nb-compose button[type=submit]').click();
        if (!(await until(s.page, () => !!document.querySelector('.nb-compose__status a')))) { fails.push(`${at}: no mailto link in the status`); break; }
        await until(s.page, () => !document.querySelector('form.nb-compose [type=submit]').disabled);
        const r = await state(s.page);
        if (posts.length !== i + 1) fails.push(`${at}: ${posts.length} posts (want ${i + 1})`);
        if (!r.status.startsWith(COMPOSE.failed)) fails.push(`${at}: status ${JSON.stringify(r.status)} (want it to start ${JSON.stringify(COMPOSE.failed)})`);
        if (r.disabled || r.aria) fails.push(`${at}: button still disabled (disabled=${r.disabled}, aria-disabled=${r.aria})`);
        if (!r.focus) fails.push(`${at}: focus left the button`);
        if (r.name !== 'Ada Lovelace' || r.message.replace(/\r\n/g, '\n') !== MSG) fails.push(`${at}: the text was not kept ${JSON.stringify(r)}`);
        const url = r.mailto || '', q = url.indexOf('?');
        if (url.slice(0, q) !== `mailto:${COMPOSE.email}`) fails.push(`${at}: link ${JSON.stringify(url.slice(0, 60))} (want mailto:${COMPOSE.email}?…)`);
        if (/[ #\r\n]/.test(url) || !url.includes('%26')) fails.push(`${at}: mailto URL not encoded ${JSON.stringify(url)}`);
        const fields = Object.fromEntries(url.slice(q + 1).split('&').map(x => { const e = x.indexOf('='); return [x.slice(0, e), decodeURIComponent(x.slice(e + 1))]; }));
        if (fields.subject !== COMPOSE.subject) fails.push(`${at}: mailto subject ${JSON.stringify(fields.subject)}`);
        if (fields.body !== MAILBODY) fails.push(`${at}: mailto body ${JSON.stringify(fields.body)} (want ${JSON.stringify(MAILBODY)})`);
      }
      await s.page.locator('#nb-compose-message').press('End');
      await s.page.keyboard.type('!');
      const after = await state(s.page), b = decodeURIComponent((after.mailto || '').split('&body=')[1] || '');
      if (!after.status.startsWith(COMPOSE.failed) || !b.endsWith('!')) fails.push(`${p}: after a failure, editing must keep the mailto link and carry the new text (status ${JSON.stringify(after.status)}, body ends ${JSON.stringify(b.slice(-8))})`);
    } finally { await s.close(); }
  }

  // A reply that never comes: after the form's timeout (shortened here through data-timeout) the failed path runs.
  {
    const { s, posts } = await openWith({}, () => new Promise(() => {}));
    try {
      await fill(s.page);
      await s.page.evaluate(() => document.querySelector('form.nb-compose').setAttribute('data-timeout', '300'));
      await s.page.locator('form.nb-compose button[type=submit]').click();
      const at = `${p} (no reply)`;
      if (!(await until(s.page, () => !!document.querySelector('.nb-compose__status a'), null, 3000))) fails.push(`${at}: no failed copy 3 s after a 300 ms timeout`);
      else {
        const r = await state(s.page);
        if (!r.status.startsWith(COMPOSE.failed)) fails.push(`${at}: status ${JSON.stringify(r.status)}`);
        if (r.aria || !r.focus) fails.push(`${at}: button aria-disabled=${r.aria}, focused=${r.focus} after the timeout`);
      }
      if (posts.length !== 1) fails.push(`${at}: ${posts.length} posts (want 1)`);
    } finally { await s.close(); }
  }

  // Without JS the browser posts the same form itself, every field Web3Forms needs included.
  {
    const { s, posts } = await openWith({ js: false }, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));
    try {
      await fill(s.page);
      await s.page.locator('form.nb-compose button[type=submit]').click();
      await s.page.waitForLoadState('load');
      const at = `${p} (no JS)`;
      if (posts.length !== 1) fails.push(`${at}: ${posts.length} posts (want 1)`);
      else {
        const req = posts[0], got = Object.fromEntries(postedFields(req) || []);
        if (req.url() !== WEB3FORMS || req.method() !== 'POST') fails.push(`${at}: ${req.method()} ${req.url()}`);
        const want = { access_key: COMPOSE.key, subject: COMPOSE.subject, from_name: 'nebulosa.io', name: 'Ada Lovelace', email: 'ada@example.com' };
        for (const [k, v] of Object.entries(want)) if (got[k] !== v) fails.push(`${at}: posted ${k}=${JSON.stringify(got[k])} (want ${JSON.stringify(v)})`);
        if (!got.redirect || new URL(got.redirect).pathname !== '/sent.html') fails.push(`${at}: posted redirect ${JSON.stringify(got.redirect)}`);
        if ((got.message || '').replace(/\r\n/g, '\n') !== MSG) fails.push(`${at}: posted message ${JSON.stringify(got.message)}`);
      }
    } finally { await s.close(); }
  }

  // /sent.html, where the no-JS post lands: built, noindex, out of the sitemap.
  const sent = await fetch(run.origin + PAGES.sent);
  if (sent.status !== 200) fails.push(`${PAGES.sent}: HTTP ${sent.status}`);
  else {
    const html = await sent.text(), text = re => ((html.match(re) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'").trim();
    if (!/<meta name="robots" content="noindex">/.test(html)) fails.push(`${PAGES.sent}: no <meta name="robots" content="noindex">`);
    if (text(/<title>([^]*?)<\/title>/) !== `${COMPOSE.sentHeading} | Nebulosa`) fails.push(`${PAGES.sent}: <title> ${JSON.stringify(text(/<title>([^]*?)<\/title>/))}`);
    if (text(/<h1[^>]*>([^]*?)<\/h1>/) !== COMPOSE.sentHeading) fails.push(`${PAGES.sent}: h1 ${JSON.stringify(text(/<h1[^>]*>([^]*?)<\/h1>/))} (want ${JSON.stringify(COMPOSE.sentHeading)})`);
    if (text(/class="nb-page-head__lead"[^>]*>([^]*?)<\/p>/) !== COMPOSE.sentLead) fails.push(`${PAGES.sent}: lead ${JSON.stringify(text(/class="nb-page-head__lead"[^>]*>([^]*?)<\/p>/))} (want ${JSON.stringify(COMPOSE.sentLead)})`);
  }
  const map = await (await fetch(run.origin + '/sitemap.xml')).text();
  if (map.includes('sent.html')) fails.push(`/sitemap.xml lists ${PAGES.sent}`);
  if (!map.includes('contact-us.html')) fails.push('/sitemap.xml lacks /contact-us.html (is it the sitemap?)');
  return fails;
}

// Animated effects: html[data-motion] comes from the visitor's saved choice (nebulosa.effects: on | off), else from
// the system's prefers-reduced-motion; the switcher's checkbox shows it, and a template with effects follows it
// live: loops under "full", still frames (no loop) under "reduce", flipping when the box is toggled. Under "reduce"
// nothing on the page animates at all: no running entry in document.getAnimations() (CSS animations included).
// Post comments (giscus): the block and its ids from tools/check/config.yml, the client loaded with the active
// template's giscus.css, every template's giscus.css built, and a template switch handed to the iframe. A stub client
// makes an iframe whose stub widget reports ready and keeps the setConfig messages it gets.
const GISCUS = { repo: 'nebulosa/nebulosa.io', repoId: 'check-repo', category: 'Announcements', categoryId: 'check-category' };
const GISCUS_ROUTES = [
  ['https://giscus.app/client.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: `(() => {
    const s = document.currentScript, f = document.createElement('iframe');
    f.className = 'giscus-frame';
    f.src = 'https://giscus.app/widget?theme=' + encodeURIComponent(s.getAttribute('data-theme'));
    s.after(f);
  })();` })],
  ['https://giscus.app/widget*', r => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>
    window.got = [];
    addEventListener('message', e => { if (e.data && e.data.giscus) window.got.push(e.data.giscus); });
    parent.postMessage({ giscus: { resizeHeight: 120 } }, '*');
  </script>` })],
];
async function comments(run) {
  if (run.pageNames && !run.pageNames.includes('post')) return [];
  const fails = [];
  for (const t of run.templates) {
    const at = `${t} post`;
    const s = await run.open(PAGES.post, { template: t, routes: GISCUS_ROUTES });
    try {
      const r = await s.page.evaluate(() => {
        const box = document.querySelector('.nb-comments .nb-comments__thread');
        const client = document.querySelector('script[src="https://giscus.app/client.js"]');
        const a = (e, k) => e && e.getAttribute(k);
        return {
          title: (document.querySelector('.nb-comments__title') || {}).textContent,
          box: box && { repo: a(box, 'data-repo'), repoId: a(box, 'data-repo-id'), category: a(box, 'data-category'), categoryId: a(box, 'data-category-id') },
          client: client && Object.fromEntries([...client.attributes].filter(x => x.name.startsWith('data-')).map(x => [x.name.slice(5), x.value])),
        };
      });
      if (r.title !== 'Comments') fails.push(`${at}: .nb-comments__title ${JSON.stringify(r.title)} (want "Comments")`);
      if (JSON.stringify(r.box) !== JSON.stringify(GISCUS)) fails.push(`${at}: thread ids ${JSON.stringify(r.box)} (want ${JSON.stringify(GISCUS)})`);
      if (!r.client) { fails.push(`${at}: no giscus client script`); continue; }
      const theme = new URL(r.client.theme || '', run.origin);
      if (theme.origin !== run.origin || theme.pathname !== `/assets/templates/${t}/giscus.css`) fails.push(`${at}: data-theme ${r.client.theme} (want ${run.origin}/assets/templates/${t}/giscus.css)`);
      for (const [k, v] of Object.entries({ repo: GISCUS.repo, 'repo-id': GISCUS.repoId, 'category-id': GISCUS.categoryId, mapping: 'pathname', strict: '1', lang: 'en', loading: 'lazy' })) {
        if (r.client[k] !== v) fails.push(`${at}: giscus data-${k}=${JSON.stringify(r.client[k])} (want ${JSON.stringify(v)})`);
      }
      // The switch: the iframe gets setConfig with the new template's giscus.css once it has said it is ready.
      const frame = () => s.page.frames().find(f => f.url().startsWith('https://giscus.app/widget'));
      if (!(await until(s.page, () => !!document.querySelector('iframe.giscus-frame')))) { fails.push(`${at}: no giscus iframe`); continue; }
      await s.page.waitForTimeout(300);
      const other = run.templates.find(x => x !== t) || TEMPLATES.find(x => x !== t);
      const pick = await pickTemplate(s.page, other);
      if (pick) { fails.push(`${at}: ${pick}`); continue; }
      let got = [];
      const last = () => { const g = got.map(x => x.setConfig && x.setConfig.theme).filter(Boolean); return g.length ? new URL(g[g.length - 1]).pathname : ''; };
      for (let i = 0; i < 20 && last() !== `/assets/templates/${other}/giscus.css`; i++) { await s.page.waitForTimeout(100); got = frame() ? await frame().evaluate(() => window.got) : []; }
      const want = `/assets/templates/${other}/giscus.css`;
      const themes = got.map(g => g.setConfig && g.setConfig.theme).filter(Boolean);
      // Arrow keys walk the radio group and each option applies live, so the iframe may pass through a template on
      // the way: what counts is that it ends on the page's.
      if (!themes.length || new URL(themes[themes.length - 1]).pathname !== want) fails.push(`${at} → ${other}: the iframe got ${JSON.stringify(themes)} (want the last setConfig theme ending ${want})`);
    } finally { await s.close(); }
  }
  // Each template's giscus.css is built (front matter rendered), maps the template's tokens and loads its fonts.
  for (const t of TEMPLATES) {
    const css = fs.existsSync(path.join(SITE, 'assets/templates', t, 'giscus.css')) ? fs.readFileSync(path.join(SITE, 'assets/templates', t, 'giscus.css'), 'utf8') : null;
    if (css === null) { fails.push(`${t}: no assets/templates/${t}/giscus.css in the build`); continue; }
    if (/\{[%{]|^---/m.test(css)) fails.push(`${t}: giscus.css still holds Liquid or front matter`);
    for (const k of ['--g-bg', '--g-ink', '--g-link', '--g-btn', '--g-font', '--color-canvas-default: var(--g-bg)', '--color-accent-fg: var(--g-link)']) {
      if (!css.includes(k)) fails.push(`${t}: giscus.css lacks ${k}`);
    }
  }
  return fails;
}

async function motion(run) {
  const fails = [];
  const saveChoice = v => { try { localStorage.setItem('nebulosa.effects', v); } catch (e) { /* about:blank has no storage */ } };
  const state = page => page.evaluate(() => {
    const b = document.querySelector('.nb-switcher__effects-box');
    let stored;
    try { stored = localStorage.getItem('nebulosa.effects'); } catch (e) { stored = 'blocked'; }
    return {
      motion: document.documentElement.getAttribute('data-motion'),
      loops: window.NebulosaFX ? window.NebulosaFX.loops(document.body) : null,
      anims: document.getAnimations().filter(a => a.playState === 'running').length,
      box: b ? b.checked : null, stored,
    };
  });
  const cases = [
    { name: 'system reduce, choice on', reducedMotion: 'reduce', stored: 'on', motion: 'full' },
    { name: 'system reduce, no choice', reducedMotion: 'reduce', stored: null, motion: 'reduce', toggle: true },
    { name: 'system no-preference, choice off', reducedMotion: 'no-preference', stored: 'off', motion: 'reduce' },
    { name: 'system no-preference, no choice', reducedMotion: 'no-preference', stored: null, motion: 'full' },
  ];
  await pool(run.templates, PARALLEL, async slug => {
    const res = await fetch(`${run.origin}/assets/templates/${slug}/manifest.json`);
    if (res.status !== 200) { fails.push(`${slug}: manifest.json HTTP ${res.status}`); return; }
    const hasFx = (await res.json()).effects === true;
    const judge = (at, r, want) => {
      if (r.motion !== want) fails.push(`${at}: html[data-motion]=${JSON.stringify(r.motion)} (want ${want})`);
      if (r.box !== (want === 'full')) fails.push(`${at}: .nb-switcher__effects-box checked=${r.box} (want ${want === 'full'})`);
      if (want === 'reduce' && r.anims) fails.push(`${at}: ${r.anims} running animation(s) in document.getAnimations() under reduce (want 0: CSS animations and transitions included)`);
      if (!hasFx) return;
      if (want === 'full' && !(r.loops > 0)) fails.push(`${at}: effects: true but NebulosaFX.loops(body)=${r.loops} (want > 0: the loops run)`);
      if (want === 'reduce' && r.loops !== 0) fails.push(`${at}: NebulosaFX.loops(body)=${r.loops} under reduce (want 0: still frames only)`);
    };
    for (const c of cases) {
      const s = await run.open('/', { template: slug, reducedMotion: c.reducedMotion, init: c.stored ? [[saveChoice, c.stored]] : [], settle: 800 });
      try {
        const page = s.page;
        const at = `${slug} (${c.name})`;
        const t = await page.evaluate(() => document.documentElement.getAttribute('data-template'));
        if (t !== slug) { fails.push(`${at}: template not applied (html[data-template]=${JSON.stringify(t)})`); return; }
        judge(at, await state(page), c.motion);
        if (!c.toggle) continue;
        // Live: from the system's reduce, checking the box turns the effects on (and stores it); unchecking, off.
        const open = await openSwitcher(page);
        if (open) { fails.push(`${at}: ${open}`); continue; }
        const box = '.nb-switcher__effects-box';
        const why = await keyboardActivate(page, box);
        if (why) { fails.push(`${at}: ${why}`); continue; }
        await page.waitForTimeout(500);
        let r = await state(page);
        judge(`${at}, box checked`, r, 'full');
        if (r.stored !== 'on') fails.push(`${at}, box checked: localStorage[nebulosa.effects]=${JSON.stringify(r.stored)} (want "on")`);
        await page.keyboard.press('Space'); // focus is still on the box
        await page.waitForTimeout(500);
        r = await state(page);
        judge(`${at}, box unchecked`, r, 'reduce');
        if (r.stored !== 'off') fails.push(`${at}, box unchecked: localStorage[nebulosa.effects]=${JSON.stringify(r.stored)} (want "off")`);
      } finally { await s.close(); }
    }
  });
  return fails;
}

// Links in lists are 44 px targets: the topic pills and the topic index on /blog/, "On this page" in an article.
// The hit box counts an absolutely positioned ::before halo (a 36 px pill reaching 44 px through top/bottom -4px).
async function listTargets(run) {
  const fails = [];
  const probe = () => [...document.querySelectorAll('.nb-topic__link, .nb-topic-index__link, .nb-toc__link')].map(el => {
    const b = el.getBoundingClientRect();
    let h = b.height;
    const ps = getComputedStyle(el, '::before');
    if (ps.content !== 'none' && ps.position === 'absolute') { const t = parseFloat(ps.top), bo = parseFloat(ps.bottom); if (t < 0) h -= t; if (bo < 0) h -= bo; }
    return { sel: el.className.split(' ')[0], text: el.textContent.trim().slice(0, 30), w: Math.round(b.width), h: Math.round(h * 100) / 100 };
  }).filter(t => t.w > 0 && (t.w < 44 || t.h < 44));
  const post = postPaths()[0];
  const pages = [PAGES.blog, post].filter(Boolean);
  await pool(run.templates, PARALLEL, async slug => {
    for (const p of pages) for (const w of [1280, 360]) {
      const s = await run.open(p, { template: slug, width: w, settle: 200 });
      try {
        const na = notApplied({ p, status: s.status, template: await s.page.evaluate(() => document.documentElement.getAttribute('data-template')) }, slug);
        if (na) { fails.push(`${w}px ${na}`); continue; }
        for (const t of await s.page.evaluate(probe)) fails.push(`${slug} ${p} ${w}px: .${t.sel} ${JSON.stringify(t.text)} is ${t.w}x${t.h} px (want 44x44)`);
      } finally { await s.close(); }
    }
  });
  return fails;
}

// Decorative glyphs drawn with CSS content (ornaments, middots, dashes, visual counters) stay out of accessible names:
// `content: "✦" / ""`. Read through the accessibility tree (ariaSnapshot): the clients list reads as the eleven names
// alone, no ✦ anywhere on the page (the switcher's panel open), topic links read as their text, no bullet or dash
// opens a prose text node.
async function decorNames(run) {
  const fails = [];
  const post = postPaths()[0];
  const items = snap => [...snap.matchAll(/^\s*- listitem: (.*)$/gm)].map(m => m[1].trim());
  await pool(run.templates, PARALLEL, async slug => {
    for (const p of [PAGES.home, PAGES.services, PAGES.blog, post].filter(Boolean)) {
      const s = await run.open(p, { template: slug, settle: 200 });
      try {
        const na = notApplied({ p, status: s.status, template: await s.page.evaluate(() => document.documentElement.getAttribute('data-template')) }, slug);
        if (na) { fails.push(na); continue; }
        const page = s.page;
        if (p === PAGES.home) {
          const got = items(await page.locator('.nb-clients__list').first().ariaSnapshot());
          if (got.join('|') !== CLIENTS.join('|')) fails.push(`${slug} ${p}: the clients list reads as ${JSON.stringify(got)} (want the names alone)`);
          await page.locator('.nb-switcher__toggle').click(); // the panel's labels count too
        }
        const starred = (await page.locator('body').ariaSnapshot()).split('\n').filter(l => l.includes('✦')).slice(0, 2).map(l => l.trim());
        if (starred.length) fails.push(`${slug} ${p}: ✦ in accessible text: ${starred.join(' | ')}`);
        if (p === PAGES.blog) {
          for (const link of await page.locator('.nb-topic__link').all()) {
            const text = (await link.textContent()).trim();
            const m = /- link "(.*)"/.exec(await link.ariaSnapshot());
            if (!m || m[1] !== text) fails.push(`${slug} ${p}: topic link ${JSON.stringify(text)} reads as ${JSON.stringify(m ? m[1] : '?')}`);
          }
        }
        if (p === post) {
          const led = (await page.locator('.nb-prose').ariaSnapshot()).split('\n').filter(l => /^\s*- (text|listitem): [—·✦]/.test(l)).slice(0, 2).map(l => l.trim());
          if (led.length) fails.push(`${slug} ${p}: a bullet or dash read as text: ${led.join(' | ')}`);
        }
      } finally { await s.close(); }
    }
  });
  return fails;
}

// The engine's pointer (api.pointer()): after load with no mouse movement no template sees one; a sample at (0,0)
// (where Chromium puts its synthetic hover on load; page.mouse.move(0, 0) delivers the same trusted pointermove)
// is dropped; a first still sample only arms; the next one, elsewhere, turns the pointer on with coordinates. An
// effect that follows the pointer would otherwise take the corner for a visitor.
async function pointerIdle(run) {
  const fails = [];
  await pool(run.templates, PARALLEL, async slug => {
    const res = await fetch(`${run.origin}/assets/templates/${slug}/manifest.json`);
    if (res.status !== 200) { fails.push(`${slug}: manifest.json HTTP ${res.status}`); return; }
    if ((await res.json()).effects !== true) return;
    const s = await run.open('/', { template: slug, init: [[pointerProbe]], settle: 800 });
    try {
      const page = s.page;
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-template'));
      if (t !== slug) { fails.push(`${slug}: template not applied (html[data-template]=${JSON.stringify(t)})`); return; }
      const state = () => page.evaluate(() => window.__nbApis.map(a => Object.assign({ slug: a.slug }, a.api.pointer())));
      const judgeIdle = (at, ps) => ps.forEach(p => {
        if (p.inside || p.x !== null || p.y !== null) fails.push(`${slug}: api.pointer() ${at} is ${JSON.stringify(p)} (want inside false, x/y null)`);
      });
      const idle = await state();
      if (!idle.length) { fails.push(`${slug}: effects: true but no mount reached the probe`); return; }
      judgeIdle('after load with no mouse movement', idle);
      await page.mouse.move(0, 0); // the synthetic hover's sample
      await page.waitForTimeout(100);
      judgeIdle('after a pointermove at (0,0)', await state());
      await page.mouse.move(200, 300); // one still sample: arms, does not count
      await page.waitForTimeout(100);
      judgeIdle('after a single pointermove (no movement yet)', await state());
      await page.mouse.move(220, 320); // a visitor's pointer: it moved
      await page.waitForTimeout(100);
      (await state()).forEach(p => {
        if (!p.inside || p.x === null || p.y === null) fails.push(`${slug}: api.pointer() after a real move is ${JSON.stringify(p)} (want inside true with coordinates)`);
      });
    } finally { await s.close(); }
  });
  return fails;
}

const CHECKS = {
  'core-markup': coreMarkup, 'no-js-default': noJsDefault, 'no-overflow': noOverflow, wide, 'wide-probe': wideProbe, 'no-console-errors': noConsoleErrors,
  'copy-rules': copyRules, seo, switcher, 'switch-cleanup': switchCleanup, 'storage-blocked': storageBlocked,
  'stale-slug': staleSlug, 'reduced-motion': reducedMotion, rail, contact, motion, 'pointer-idle': pointerIdle, 'list-targets': listTargets,
  'decor-names': decorNames, comments,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.only || Object.keys(CHECKS);
  const unknown = names.filter(n => !CHECKS[n]);
  if (unknown.length) throw new Error(`unknown check(s) ${unknown.join(', ')}; known: ${Object.keys(CHECKS).join(', ')}`);
  if (!fs.existsSync(path.join(SITE, 'index.html'))) throw new Error(`no build at ${SITE}`);
  const { server, origin } = await serve(SITE);
  const browser = await chromium.launch();
  const run = new Run(browser, origin, args.templates, args.pages);
  let pass = 0, fail = 0;
  const t0 = Date.now();
  try {
    for (const name of names) {
      const t1 = Date.now();
      let fails;
      try { fails = await CHECKS[name](run); }
      catch (e) { fails = [`check crashed: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`]; }
      const secs = ((Date.now() - t1) / 1000).toFixed(1);
      if (!fails.length) { pass++; console.log(`PASS ${name} (${secs}s)`); continue; }
      fail++;
      console.log(`FAIL ${name}: ${fails[0]}${fails.length > 1 ? ` (+${fails.length - 1} more)` : ''} (${secs}s)`);
      fails.slice(1, 6).forEach(f => console.log(`     ${f}`));
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${pass} PASS, ${fail} FAIL (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exitCode = fail ? 1 : 0;
}

main().catch(e => { console.error(e.message); process.exitCode = 2; });
