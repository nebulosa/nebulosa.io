// A post's comments: loads the giscus client into .nb-comments__thread with the active template's giscus.css, and
// when the visitor switches templates (html[data-template] changes) tells the giscus iframe to take the new one.
(function () {
  'use strict';
  var box = document.querySelector('.nb-comments__thread');
  if (!box) return;
  var ORIGIN = 'https://giscus.app';
  var html = document.documentElement;
  var version = ((document.currentScript && document.currentScript.src) || '').replace(/^[^?]*/, '');
  // Absolute: the stylesheet is loaded inside the giscus iframe, from giscus.app.
  var theme = function () {
    return location.origin + '/assets/templates/' + html.getAttribute('data-template') + '/giscus.css' + version;
  };
  var sent = theme(), ready = false;

  var s = document.createElement('script');
  s.src = ORIGIN + '/client.js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  var attrs = {
    repo: box.getAttribute('data-repo'), 'repo-id': box.getAttribute('data-repo-id'),
    category: box.getAttribute('data-category'), 'category-id': box.getAttribute('data-category-id'),
    mapping: 'pathname', strict: '1', 'reactions-enabled': '0', 'emit-metadata': '0', 'input-position': 'top',
    theme: sent, lang: html.getAttribute('lang') || 'en', loading: 'lazy'
  };
  for (var k in attrs) s.setAttribute('data-' + k, attrs[k]);
  box.appendChild(s);

  function sync() {
    var want = theme(), frame = box.querySelector('iframe.giscus-frame');
    if (!ready || want === sent || !frame) return;
    frame.contentWindow.postMessage({ giscus: { setConfig: { theme: want } } }, ORIGIN);
    sent = want;
  }
  new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ['data-template'] });
  // A message sent before the iframe's app runs is lost, so switches wait for its first message (it reports its
  // height) and are caught up then.
  window.addEventListener('message', function (e) { if (e.origin === ORIGIN) { ready = true; sync(); } });
})();
