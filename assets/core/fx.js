/* NebulosaFX: the core's effects engine. A template's effects.js registers itself here and draws only in
   decorative layers inside the core's slots; the engine owns time, visibility and the motion budget.

   NebulosaFX.register('<slug>', { mount(root, api) { ... return { unmount() {} } } });
   NebulosaFX.mount('<slug>', root)  -> mounts that template on root (switch.js passes document.body)
   NebulosaFX.unmountAll()           -> unmounts every root: their unmount(), loops, layers and listeners
   NebulosaFX.loops(root)            -> how many api.raf loops are running on root

   api.layer(slotEl, 'canvas'|'div', {dpr})
                                      -> a child element covering the slot (aria-hidden, inert); canvas sized
                                         to the slot at devicePixelRatio <= 2 (or <= dpr), re-sized on resize
   api.raf(fn, {fps: 30})             -> {stop()}; fn(t, dt) runs only while the root is on screen and the tab is
                                         visible; at most 2 loops per root, at most 30 fps. Under
                                         prefers-reduced-motion no loop starts: fn runs once (the still frame)
                                         and again whenever a resize re-sizes one of the root's canvases
   api.reduced                        -> true when <html data-motion="reduce"> (the head's bootstrap sets it from the
                                         visitor's saved "Animated effects" choice, else prefers-reduced-motion);
                                         without the attribute, the media query. Read live: switch.js remounts the
                                         template when the visitor toggles the checkbox
   api.pointer()                      -> {x, y, inside} in root CSS px; x/y null and inside false until the pointer
                                         has MOVED inside the root: a sample at (0,0) (Chromium's synthetic hover
                                         on load) and a first still sample are no visitor's pointer
   api.q(sel), api.qa(sel)            -> query inside the root
   api.label(el, text)                -> the one permitted text write: el must be inside a [data-slot] of the root
                                         and carry data-fx-label; anything else throws
   Rules: never write text (but through api.label), never move content, never change focus or semantics. */
(function () {
  'use strict';
  var defs = {};
  var mounted = []; // {root, state}
  var MAX_LOOPS = 2;
  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function reduced() {
    var m = document.documentElement.getAttribute('data-motion');
    return m ? m === 'reduce' : reduceMQ.matches;
  }

  function makeState(root) {
    var st = { loops: [], layers: [], positioned: [], observers: [], listeners: [], stills: [], onScreen: true, instance: null };
    var pointer = { x: null, y: null, inside: false };

    function listen(target, type, fn) { target.addEventListener(type, fn); st.listeners.push([target, type, fn]); }
    function resumeAll() { st.loops.forEach(function (l) { l.resume(); }); }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { st.onScreen = es[0].isIntersecting; resumeAll(); });
      io.observe(root);
      st.observers.push(io);
    }
    listen(document, 'visibilitychange', resumeAll);
    // A pointer counts once it has moved: a sample at exactly (0,0) is dropped (Chromium's synthetic hover on load
    // sits there; headless tooling parks the mouse there too), and the first sample only arms; the next one,
    // elsewhere, turns the pointer on. An effect that follows the pointer would otherwise take the corner for a
    // visitor (Task 7 review).
    var seen = null;
    listen(root, 'pointermove', function (e) {
      if (e.clientX === 0 && e.clientY === 0) return;
      if (seen && e.clientX === seen[0] && e.clientY === seen[1]) return;
      var armed = seen !== null;
      seen = [e.clientX, e.clientY];
      if (!armed) return;
      var r = root.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inside = true;
    });
    listen(root, 'pointerleave', function () { pointer.inside = false; });

    // Sizes a canvas to its slot. Assigning width/height clears the bitmap, so a same-size call (the observer's
    // first callback, among others) is skipped; returns whether the bitmap was reset.
    function sizeCanvas(c, cap) {
      var dpr = Math.min(window.devicePixelRatio || 1, cap || 2);
      var w = c.parentNode.offsetWidth, h = c.parentNode.offsetHeight;
      var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      if (c.width === pw && c.height === ph && c.style.width === w + 'px' && c.style.height === h + 'px') return false;
      c.width = pw; c.height = ph;
      c.style.width = w + 'px'; c.style.height = h + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    // Under reduced motion the still frames live on canvases a resize has just cleared: draw them again.
    function redrawStills() { st.stills.forEach(function (fn) { fn(0, 0); }); }

    st.api = {
      root: root,
      get reduced() { return reduced(); },
      q: function (s) { return root.querySelector(s); },
      qa: function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); },
      pointer: function () { return { x: pointer.x, y: pointer.y, inside: pointer.inside }; },
      layer: function (slot, kind, opts) {
        var cap = opts && opts.dpr;
        var el = document.createElement(kind === 'canvas' ? 'canvas' : 'div');
        el.className = 'fx-layer';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('inert', '');
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
        // Slots outlive a switch, so this inline style is undone on unmount (it would beat the next theme.css).
        if (getComputedStyle(slot).position === 'static' && st.positioned.indexOf(slot) < 0) {
          st.positioned.push(slot);
          slot.style.position = 'relative';
        }
        slot.appendChild(el);
        st.layers.push(el);
        if (kind === 'canvas') {
          sizeCanvas(el, cap);
          if ('ResizeObserver' in window) {
            var ro = new ResizeObserver(function () { if (el.parentNode && sizeCanvas(el, cap) && reduced()) redrawStills(); });
            ro.observe(slot);
            st.observers.push(ro);
          }
        }
        return el;
      },
      raf: function (fn, opts) {
        if (reduced()) {
          st.stills.push(fn);
          fn(0, 0);
          return { stop: function () { var i = st.stills.indexOf(fn); if (i >= 0) st.stills.splice(i, 1); } };
        }
        if (st.loops.length >= MAX_LOOPS) throw new Error('NebulosaFX: more than ' + MAX_LOOPS + ' loops on one root');
        var fps = Math.min((opts && opts.fps) || 30, 30), frame = 1000 / fps, last = 0, scheduled = false;
        var loop = {
          stop: function () {
            var i = st.loops.indexOf(loop);
            if (i >= 0) st.loops.splice(i, 1);
          },
          // Off screen or in a hidden tab the loop stops scheduling frames; this restarts it.
          resume: function () { if (!scheduled && st.loops.indexOf(loop) >= 0) { scheduled = true; requestAnimationFrame(tick); } }
        };
        function tick(t) {
          scheduled = false;
          if (st.loops.indexOf(loop) < 0 || !st.onScreen || document.hidden) { last = 0; return; }
          scheduled = true;
          requestAnimationFrame(tick);
          if (last && t - last < frame) return;
          var dt = last ? t - last : frame; last = t; fn(t, dt);
        }
        st.loops.push(loop);
        loop.resume();
        return { stop: loop.stop };
      },
      label: function (el, text) {
        var slot = el && el.closest ? el.closest('[data-slot]') : null;
        if (!slot || !root.contains(slot) || !el.hasAttribute('data-fx-label')) {
          throw new Error('NebulosaFX: api.label only writes [data-fx-label] elements inside a slot');
        }
        el.textContent = text;
      }
    };
    return st;
  }

  function stateOf(root) {
    for (var i = 0; i < mounted.length; i++) if (mounted[i].root === root) return mounted[i].state;
    return null;
  }

  function teardown(st) {
    try { if (st.instance && typeof st.instance.unmount === 'function') st.instance.unmount(); }
    finally {
      st.loops.slice().forEach(function (l) { l.stop(); });
      st.observers.forEach(function (o) { o.disconnect(); });
      st.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      st.layers.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      st.positioned.forEach(function (slot) { slot.style.removeProperty('position'); });
    }
  }

  window.NebulosaFX = {
    register: function (slug, def) { defs[slug] = def; },
    // A template mounts once per root; mounting another first unmounts the one there.
    mount: function (slug, root) {
      var def = defs[slug];
      if (!def) throw new Error('NebulosaFX: no template registered as ' + slug);
      if (stateOf(root)) this.unmount(root);
      var st = makeState(root);
      mounted.push({ root: root, state: st });
      try { st.instance = def.mount(root, st.api) || null; }
      catch (e) { console.error('NebulosaFX ' + slug + ': mount failed', e); this.unmount(root); }
    },
    unmount: function (root) {
      for (var i = 0; i < mounted.length; i++) {
        if (mounted[i].root === root) { var st = mounted.splice(i, 1)[0].state; teardown(st); return; }
      }
    },
    unmountAll: function () {
      var all = mounted.splice(0);
      all.forEach(function (m) {
        try { teardown(m.state); } catch (e) { console.error('NebulosaFX: unmount failed', e); }
      });
    },
    loops: function (root) { var st = stateOf(root); return st ? st.loops.length : 0; }
  };
})();
