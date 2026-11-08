/* pizarra effects, on the core's NebulosaFX engine (assets/core/fx.js). One job: the clients rail.
   theme.css lays .nb-clients__list and its loop copies on one line inside the slate band once the section carries
   data-nb-rail; this file appends the copies (aria-hidden, inert; as many as the band is wide, so the loop never
   shows a gap), marks the section and slides the lists left with one api.raf loop (transform, 30 fps, 36 px/s).
   The engine holds the loop off screen and in a hidden tab; the pointer over the band and focus inside the list hold
   it too. Under html[data-motion="reduce"] (api.reduced) no copy is made and the loop is a single still frame, so
   the list stays wrapped in rows; without JS nothing here runs.
   Everything is undone on unmount (a template switch, the effects checkbox): copies, mark, transform. */
NebulosaFX.register('pizarra', {
  mount: function (root, api) {
    'use strict';
    var SPEED = 36; // px per second
    var cleanup = [];
    api.qa('.nb-clients__list:not([aria-hidden])').forEach(function (list) {
      var section = list.closest('.nb-clients');
      if (!section) return;
      var copies = [], x = 0;
      function addCopy() {
        var copy = list.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        copy.removeAttribute('id');
        Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (el) { el.removeAttribute('id'); });
        (copies.length ? copies[copies.length - 1] : list).after(copy);
        copies.push(copy);
      }
      if (!api.reduced) { addCopy(); section.setAttribute('data-nb-rail', ''); }
      // Always through api.raf: under reduced motion the engine runs this once (the still frame) and nothing moves.
      var loop = api.raf(function (t, dt) {
        if (api.reduced || !section.hasAttribute('data-nb-rail')) return;
        var w = list.offsetWidth; // one list and its trailing gap: after that distance a copy stands where the list did
        if (!w) return;
        while (copies.length * w < section.clientWidth) addCopy(); // enough copies to fill the band at any width
        if (section.matches(':hover') || list.matches(':focus-within')) return;
        x = (x + Math.min(dt, 100) * SPEED / 1000) % w;
        var tf = 'translateX(' + (-x).toFixed(2) + 'px)';
        list.style.transform = tf;
        copies.forEach(function (c) { c.style.transform = tf; });
      }, { fps: 30 });
      cleanup.push(function () {
        loop.stop();
        copies.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
        section.removeAttribute('data-nb-rail');
        list.style.removeProperty('transform');
      });
    });
    return { unmount: function () { cleanup.forEach(function (fn) { fn(); }); } };
  }
});
