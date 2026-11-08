/* NebulosaSwitch: applies a template live. The head's bootstrap has already put the saved (or default) template's
   data-template/data-scheme and CSS/fonts links on the page; the server rendered the default template's slots.
   This script fills the slots when they belong to another template (html.nb-slots-pending), mounts the active
   template's effects, and drives the switcher in the header: the scheme and template controls and the "Animated
   effects" checkbox. That checkbox sets html[data-motion] ("full" | "reduce"), stores nebulosa.effects (on | off)
   and remounts the active template's effects, so they go from loops to still frames and back without a reload;
   with no stored choice data-motion follows prefers-reduced-motion, live.

   NebulosaSwitch.apply(slug) -> Promise: swaps the template CSS (after it loads) and fonts, sets data-template and
   data-scheme, replaces every [data-slot] of the page, remounts effects and stores the choice. */
(function () {
  'use strict';
  var html = document.documentElement;
  // The build version the layout puts on this script's URL; index.json carries it too, so a deploy is never half cached.
  var VERSION = ((document.currentScript && document.currentScript.src) || '').replace(/^[^?]*/, '');
  var KEY = 'nebulosa.template', DARK_KEY = 'nebulosa.dark', MOTION_KEY = 'nebulosa.effects';
  var motionMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var indexP = null, scripts = {}, seq = 0;
  // A visitor with storage blocked still switches; the choice just lasts for the page.
  var memory = {};

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return memory[key] || null; } }
  function save(key, v) { memory[key] = v; try { localStorage.setItem(key, v); } catch (e) { /* blocked: memory only */ } }

  function index() {
    if (!indexP) {
      indexP = fetch('/assets/templates/index.json' + VERSION).then(function (r) {
        if (!r.ok) throw new Error('NebulosaSwitch: /assets/templates/index.json HTTP ' + r.status);
        return r.json();
      });
      indexP.catch(function () { indexP = null; }); // a failed fetch is retried on the next switch
    }
    return indexP;
  }

  function pageName() {
    var m = /(?:^|\s)nb-page--(\S+)/.exec(document.body.className);
    return m ? m[1] : '';
  }

  // Resolves with a new <link> once its stylesheet has loaded; it is inserted right after `after`.
  function stylesheet(href, after) {
    return new Promise(function (ok, fail) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = function () { ok(l); };
      l.onerror = function () { l.remove(); fail(new Error('NebulosaSwitch: could not load ' + href)); };
      after.after(l);
    });
  }

  // One fonts link, the active template's; none when it has no web fonts.
  function setFonts(href) {
    var l = document.getElementById('nb-template-fonts');
    if (!href) { if (l) l.remove(); return; }
    if (l) { if (l.getAttribute('href') !== href) l.setAttribute('href', href); return; }
    l = document.createElement('link');
    l.id = 'nb-template-fonts';
    l.rel = 'stylesheet';
    l.href = href;
    document.getElementById('nb-template-css').before(l);
  }

  // The template's effects.js, appended once per slug; resolves when it has run (and registered itself).
  function effects(slug, src) {
    if (!scripts[slug]) {
      scripts[slug] = new Promise(function (ok, fail) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = function () { delete scripts[slug]; fail(new Error('NebulosaSwitch: could not load ' + src)); };
        document.body.appendChild(s);
      });
    }
    return scripts[slug];
  }

  function mountEffects(slug, t) {
    if (!t.effects) return;
    effects(slug, t.effects).then(function () {
      if (html.getAttribute('data-template') === slug) window.NebulosaFX.mount(slug, document.body);
    }).catch(function (e) { console.error(e); });
  }

  function fillSlots(t) {
    var page = pageName();
    Array.prototype.forEach.call(document.querySelectorAll('[data-slot]'), function (el) {
      var k = el.getAttribute('data-slot'), s = t.slots;
      el.innerHTML = s[page + '.' + k] != null ? s[page + '.' + k] : (s[k] != null ? s[k] : '');
    });
  }

  function apply(slug) {
    var mine = ++seq;
    return index().then(function (idx) {
      var t = idx[slug];
      if (!t) throw new Error('NebulosaSwitch: unknown template ' + slug);
      var css = document.getElementById('nb-template-css');
      var same = css && new URL(css.href, location.href).pathname === t.css;
      return (same ? Promise.resolve(null) : stylesheet(t.css, css)).then(function (fresh) {
        if (mine !== seq) { if (fresh) fresh.remove(); return; } // a later pick won
        if (fresh) { css.remove(); fresh.id = 'nb-template-css'; }
        setFonts(t.fonts[0] || null);
        window.NebulosaFX.unmountAll();
        html.setAttribute('data-template', slug);
        html.setAttribute('data-scheme', t.scheme);
        fillSlots(t);
        html.classList.remove('nb-slots-pending');
        save(KEY, slug);
        if (t.scheme === 'dark') save(DARK_KEY, slug);
        sync();
        mountEffects(slug, t);
      });
    });
  }

  // ---------- the switcher ----------
  function sync() {
    var slug = html.getAttribute('data-template'), scheme = html.getAttribute('data-scheme');
    Array.prototype.forEach.call(document.querySelectorAll('.nb-switcher'), function (sw) {
      sw.querySelectorAll('[data-scheme-option]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-scheme-option') === scheme));
      });
      sw.querySelectorAll('[data-scheme-group]').forEach(function (g) {
        g.hidden = g.getAttribute('data-scheme-group') !== scheme;
      });
      sw.querySelectorAll('input[type=radio]').forEach(function (r) {
        if (r.value === slug) r.checked = true;
      });
      var name = sw.querySelector('[data-template-option="' + slug + '"] .nb-switcher__name');
      var current = sw.querySelector('.nb-switcher__current');
      if (name && current) current.textContent = name.textContent;
      var box = sw.querySelector('.nb-switcher__effects-box');
      if (box) box.checked = html.getAttribute('data-motion') !== 'reduce';
    });
  }

  // ---------- animated effects ----------
  // Remounts the active template's effects under the current data-motion: fx.js reads it at mount, so this is how
  // loops become still frames and back. It stands under apply()'s seq guard: a switch picked after this remount began
  // mounts its own template and this one stands down; the slug is read when the mount happens, never earlier, so a
  // toggle during an in-flight switch cannot mount twice or mount the wrong slug.
  function remount() {
    var mine = seq;
    window.NebulosaFX.unmountAll();
    report(index().then(function (idx) {
      if (mine !== seq) return;
      var slug = html.getAttribute('data-template');
      if (idx[slug]) mountEffects(slug, idx[slug]);
    }));
  }
  function setMotion(value) {
    if (html.getAttribute('data-motion') === value) { sync(); return; }
    html.setAttribute('data-motion', value);
    sync();
    remount();
  }
  document.addEventListener('change', function (e) {
    var box = e.target;
    if (!(box.matches && box.matches('.nb-switcher__effects-box'))) return;
    save(MOTION_KEY, box.checked ? 'on' : 'off');
    setMotion(box.checked ? 'full' : 'reduce');
  });
  // The system preference rules only while the visitor has not chosen; then it is followed as it changes.
  if (motionMQ) {
    var onSystem = function () { if (!load(MOTION_KEY)) setMotion(motionMQ.matches ? 'reduce' : 'full'); };
    if (motionMQ.addEventListener) motionMQ.addEventListener('change', onSystem); else motionMQ.addListener(onSystem);
  }

  // The disclosure: the button opens and closes the panel; Escape inside closes it and returns focus to the
  // button; a click outside closes it.
  function setOpen(sw, open) {
    var b = sw.querySelector('.nb-switcher__toggle'), p = sw.querySelector('.nb-switcher__panel');
    if (!b || !p) return;
    b.setAttribute('aria-expanded', String(open));
    p.hidden = !open;
  }
  function isOpen(sw) {
    var b = sw.querySelector('.nb-switcher__toggle');
    return !!b && b.getAttribute('aria-expanded') === 'true';
  }
  function closeOthers(except) {
    document.querySelectorAll('.nb-switcher').forEach(function (sw) { if (sw !== except && isOpen(sw)) setOpen(sw, false); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.nb-switcher__toggle');
    if (t) { var sw = t.closest('.nb-switcher'); setOpen(sw, !isOpen(sw)); closeOthers(sw); return; }
    if (!(e.target.closest && e.target.closest('.nb-switcher'))) closeOthers(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var sw = e.target.closest && e.target.closest('.nb-switcher');
    if (sw && isOpen(sw)) { e.preventDefault(); setOpen(sw, false); sw.querySelector('.nb-switcher__toggle').focus(); }
    else closeOthers(null);
  });

  function report(p) { p.catch(function (e) { console.error(e); sync(); }); }

  // The scheme buttons go to that scheme's last pick: the saved dark template, else the scheme's first one.
  function pickScheme(scheme) {
    if (html.getAttribute('data-scheme') === scheme) return;
    report(index().then(function (idx) {
      var last = scheme === 'dark' ? load(DARK_KEY) : null;
      var slug = last && idx[last] && idx[last].scheme === scheme ? last
        : Object.keys(idx).filter(function (k) { return idx[k].scheme === scheme; })[0];
      if (!slug) throw new Error('NebulosaSwitch: no ' + scheme + ' template');
      return apply(slug);
    }));
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.nb-switcher [data-scheme-option]');
    if (b) pickScheme(b.getAttribute('data-scheme-option'));
  });
  document.addEventListener('change', function (e) {
    var r = e.target;
    if (r.matches && r.matches('.nb-switcher input[type=radio]') && r.checked) report(apply(r.value));
  });

  window.NebulosaSwitch = { apply: apply };

  // ---------- this page load ----------
  sync();
  var current = html.getAttribute('data-template');
  if (html.classList.contains('nb-slots-pending')) {
    report(apply(current));
  } else {
    report(index().then(function (idx) { if (idx[current]) mountEffects(current, idx[current]); }));
  }
})();
