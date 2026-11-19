// The home page's Films strip: every film is in the page, the three newest showing; this shows data-show films at
// random instead, so a returning visitor sees others.
(function () {
  'use strict';
  var strip = document.querySelector('.nb-videos--strip[data-show]');
  if (!strip) return;
  var slots = Array.prototype.slice.call(strip.querySelectorAll('.nb-videos__slot'));
  var n = Math.min(+strip.getAttribute('data-show') || 3, slots.length);
  // Fisher-Yates over the indices; the first n are the ones shown, in their shuffled order.
  for (var i = slots.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = slots[i]; slots[i] = slots[j]; slots[j] = t;
  }
  slots.forEach(function (s, k) { s.hidden = k >= n; if (k < n) strip.appendChild(s); });
})();
