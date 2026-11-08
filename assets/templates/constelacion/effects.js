/* constelacion effects, on the core's NebulosaFX engine (assets/core/fx.js). Two loops per root:
   1. The sky: a canvas (device pixel ratio 1: it is up to 1800px tall) over the backdrop slot with stars at three
      depths that twinkle (24 fps) and shift with the pointer by depth (3 / 7 / 12 px); frames are skipped while the
      sky is scrolled out of view. The static SVG sky drops to opacity .25 and stays as the haze. The field is
      generated for the slot's size from a fixed seed, so the same sky comes back on every load and re-forms on resize.
      Under reduced motion the SVG sky keeps its stars and the canvas adds only the bright depth, once.
   2. The lines: for each art slot with an SVG figure, a canvas reads the figure's <line>s and draws them growing from
      the first star over 2.6 s with a bright head; afterwards one glint travels the figure every 9 s. Coordinates
      stay in viewBox units and scale with the slot each frame, so a resized figure keeps its lines.
   The clients rail: theme.css runs .nb-clients__list as a sliding rail only when a loop copy follows it; this file
   appends that copy (aria-hidden, inert) and marks the section with data-nb-rail; both are undone on unmount. Under
   prefers-reduced-motion the engine runs each loop once (the still frame: full lines, steady stars) and no copy is
   made, so the rail stays static and wrapped. Without JS the SVG sky and lines in the slots are the picture. */
NebulosaFX.register('constelacion', {
  mount: function (root, api) {
    'use strict';
    var LAV = '201, 184, 255';
    var TAU = 6.283185307179586;
    var cleanup = [];

    function rng(seed) { // mulberry32: the same sky on every load
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    /* ── the sky ── */
    var back = api.q('.nb-slot[data-slot="backdrop"]');
    if (back) {
      var canvas = api.layer(back, 'canvas', { dpr: 1 }), ctx = canvas.getContext('2d');
      var staticSky = back.querySelector('svg');
      if (staticSky && !api.reduced) {
        var skyOpacity = staticSky.style.opacity;
        staticSky.style.opacity = '0.25'; // keep the haze, let the canvas own the stars
        cleanup.push(function () { staticSky.style.opacity = skyOpacity; });
      }
      // Stars per depth as a density (the mockup's 150 / 60 / 18 on a 1280 x 1800 field).
      var depths = [{ per: 15360, r: 0.7, a: 0.45, par: 3 }, { per: 38400, r: 1.1, a: 0.7, par: 7 }, { per: 128000, r: 1.7, a: 0.95, par: 12 }];
      var stars = [], skyW = 0, skyH = 0;
      function generate(w, h) {
        var rnd = rng(11);
        stars = [];
        var wide = w > 900; // on a wide screen keep the faint depths out of the hero title's band
        depths.forEach(function (d, di) {
          if (api.reduced && di < 2) return; // the SVG keeps its stars; the canvas adds only the bright depth
          var n = Math.round(w * h / d.per);
          for (var i = 0, guard = 0; i < n && guard < n * 4; guard++) {
            var x = rnd() * w, y = rnd() * h;
            if (wide && di < 2 && x > w * 0.23 && x < w * 0.77 && y > 160 && y < 560) continue;
            stars.push({ x: x, y: y, r: d.r, a: d.a * (0.6 + 0.4 * rnd()), par: d.par, ph: rnd() * TAU, sp: 0.4 + rnd() * 1.2, d: di });
            i++;
          }
        });
        skyW = w; skyH = h;
      }
      var px = 0, py = 0;
      api.raf(function (t) {
        var w = back.offsetWidth, h = back.offsetHeight;
        if (!w || !h) return;
        if (!api.reduced) { // nothing to repaint while the sky is scrolled out of view (the still frame always paints)
          var box = canvas.getBoundingClientRect();
          if (box.bottom < 0 || box.top > window.innerHeight) return;
        }
        if (w !== skyW || h !== skyH) generate(w, h);
        var p = api.pointer();
        var tx = p.inside && p.x !== null ? (p.x - w / 2) / (w / 2) : 0;
        var ty = p.inside && p.y !== null ? (Math.min(p.y, h) - h / 2) / (h / 2) : 0;
        px += (tx - px) * 0.06; py += (ty - py) * 0.06;
        ctx.clearRect(0, 0, w, h);
        var s = t / 1000;
        for (var i = 0; i < stars.length; i++) {
          var st = stars[i], x = st.x - px * st.par, y = st.y - py * st.par;
          var tw = api.reduced ? 1 : 0.72 + 0.28 * Math.sin(s * st.sp + st.ph);
          if (st.d === 2) {
            ctx.fillStyle = 'rgba(' + LAV + ',' + (0.14 * tw).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(x, y, st.r * 4, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,' + (st.a * tw).toFixed(3) + ')';
          } else {
            ctx.fillStyle = 'rgba(' + LAV + ',' + (st.a * tw).toFixed(3) + ')';
          }
          ctx.beginPath(); ctx.arc(x, y, st.r, 0, TAU); ctx.fill();
        }
      }, { fps: 24 });
    }

    /* ── the lines: each art slot's SVG <line>s, redrawn growing from the first star ── */
    var figures = [];
    ['hero-art', 'services-art', 'insights-art', 'cta-art', 'page-head-art'].forEach(function (name) {
      api.qa('.nb-slot[data-slot="' + name + '"]').forEach(function (slot) {
        var svg = slot.querySelector('svg');
        if (!svg) return;
        var vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
        var segs = [], total = 0;
        Array.prototype.forEach.call(svg.querySelectorAll('line'), function (l) {
          var a = { x: +l.getAttribute('x1'), y: +l.getAttribute('y1') }, b = { x: +l.getAttribute('x2'), y: +l.getAttribute('y2') };
          var len = Math.hypot(b.x - a.x, b.y - a.y);
          if (!len) return;
          segs.push({ a: a, b: b, len: len, at: total }); total += len;
        });
        if (!segs.length) return;
        var layer = api.layer(slot, 'canvas');
        figures.push({ slot: slot, ctx: layer.getContext('2d'), vbw: vb[2], segs: segs, total: total });
      });
    });
    if (figures.length) {
      var t0 = null;
      api.raf(function (t) {
        if (t0 === null) t0 = t;
        var e = api.reduced ? 1 : Math.min(1, (t - t0) / 2600);
        var prog = 1 - Math.pow(1 - e, 3); // ease out
        figures.forEach(function (f) {
          var w = f.slot.offsetWidth, h = f.slot.offsetHeight, c = f.ctx;
          if (!w || !h) return; // hidden at this width
          var k = w / f.vbw;
          c.clearRect(0, 0, w, h);
          var drawn = f.total * prog, head = null;
          c.lineWidth = 1; c.lineCap = 'round';
          c.strokeStyle = 'rgba(' + LAV + ',0.85)';
          for (var i = 0; i < f.segs.length; i++) {
            var sg = f.segs[i];
            if (sg.at >= drawn) break;
            var q = Math.min(1, (drawn - sg.at) / sg.len);
            var ex = (sg.a.x + (sg.b.x - sg.a.x) * q) * k, ey = (sg.a.y + (sg.b.y - sg.a.y) * q) * k;
            c.beginPath(); c.moveTo(sg.a.x * k, sg.a.y * k); c.lineTo(ex, ey); c.stroke();
            if (q < 1) head = { x: ex, y: ey };
          }
          if (head) { // the drawing head
            c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(head.x, head.y, 2, 0, TAU); c.fill();
            c.fillStyle = 'rgba(' + LAV + ',0.25)'; c.beginPath(); c.arc(head.x, head.y, 8, 0, TAU); c.fill();
          } else if (!api.reduced) { // after the draw: one glint travels the figure every 9 s
            var g = ((t - t0) % 9000) / 9000 * f.total;
            for (var j = 0; j < f.segs.length; j++) {
              var s2 = f.segs[j];
              if (g >= s2.at && g <= s2.at + s2.len) {
                var r = (g - s2.at) / s2.len, gx = (s2.a.x + (s2.b.x - s2.a.x) * r) * k, gy = (s2.a.y + (s2.b.y - s2.a.y) * r) * k;
                c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(gx, gy, 1.6, 0, TAU); c.fill();
                c.fillStyle = 'rgba(' + LAV + ',0.18)'; c.beginPath(); c.arc(gx, gy, 7, 0, TAU); c.fill();
                break;
              }
            }
          }
        });
      }, { fps: 30 });
    }

    /* ── the clients rail: the loop copy that lets theme.css run the list as a rail ── */
    if (!api.reduced) {
      api.qa('.nb-clients__list:not([aria-hidden])').forEach(function (list) {
        var section = list.closest('.nb-clients');
        var copy = list.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        copy.removeAttribute('id');
        Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (el) { el.removeAttribute('id'); });
        list.after(copy);
        if (section) section.setAttribute('data-nb-rail', '');
        cleanup.push(function () {
          if (copy.parentNode) copy.parentNode.removeChild(copy);
          if (section) section.removeAttribute('data-nb-rail');
        });
      });
    }

    return { unmount: function () { cleanup.forEach(function (fn) { fn(); }); } };
  }
});
