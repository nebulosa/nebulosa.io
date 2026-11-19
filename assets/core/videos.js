// The films' viewer: a card opens its film in the <dialog> in place and the address becomes the film's own page
// (/videos/<slug>, a real page, so a reload or a shared link lands on the same view); closing goes back to /videos/.
// Copy buttons copy the caption or the link. On a touch screen that can share files, «Share the video…» hands the
// vertical file to the phone's share menu (Instagram, TikTok and WhatsApp take a video only that way) after copying
// the caption, which Instagram drops from a shared file.
(function () {
  'use strict';
  var dlg = document.getElementById('nb-visor');
  var dataEl = document.getElementById('nb-videos-data');
  if (!dlg || !dataEl || typeof dlg.showModal !== 'function') return;
  var films = JSON.parse(dataEl.textContent), bySlug = {};
  films.forEach(function (f) { bySlug[f.slug] = f; });
  var q = function (sel) { return dlg.querySelector(sel); };
  var video = q('.nb-visor__video'), status = q('.nb-visor__status'), native = q('.nb-visor__native');
  var upright = window.matchMedia('(max-width: 720px) and (orientation: portrait)');
  var origin = location.origin, indexTitle = document.title.replace(/^[^|]*\|/, 'Videos |');
  var current = null, sayTimer = 0, files = {};

  function say(text) {
    clearTimeout(sayTimer); status.textContent = text;
    sayTimer = setTimeout(function () { status.textContent = ''; }, 4000);
  }
  function mb(bytes) { return (Math.round(bytes / 104857.6) / 10) + ' MB'; }
  function base(f) { return '/assets/videos/' + f.slug; }
  function shareText(f) { return f.caption || f.title; }
  function slugOf(path) { var m = /^\/videos\/([^/]+?)(?:\.html)?$/.exec(path); return m && bySlug[m[1]] ? m[1] : null; }

  function setPoster() {
    if (current) video.poster = base(current) + (upright.matches ? '/poster-vertical.jpg' : '/poster.jpg');
  }

  // Server-rendered for one film; every field is rewritten for another.
  function fill(f) {
    var b = base(f), link = origin + '/videos/' + f.slug, enc = encodeURIComponent, tags = f.tags.join(' ');
    current = f;
    video.pause();
    q('.nb-visor__src-v').src = b + '/vertical.mp4';
    q('.nb-visor__src-h').src = b + '/horizontal.mp4';
    video.load(); setPoster();
    q('.nb-visor__title').textContent = f.title;
    q('.nb-visor__line').textContent = f.caption;
    q('.nb-visor__line').hidden = !f.caption;
    q('.nb-visor__caption').hidden = !f.caption;
    var text = q('.nb-visor__caption-text');
    text.textContent = f.caption;
    if (tags) { var t = document.createElement('span'); t.className = 'nb-visor__tags'; t.textContent = tags; text.append(' ', t); }
    var h = q('.nb-visor__download--h'), v = q('.nb-visor__download--v');
    h.href = b + '/horizontal.mp4'; h.download = 'nebulosa-' + f.slug + '-16x9.mp4';
    v.href = b + '/vertical.mp4'; v.download = 'nebulosa-' + f.slug + '-9x16.mp4';
    h.querySelector('.nb-visor__size').textContent = mb(f.size_horizontal);
    v.querySelector('.nb-visor__size').textContent = mb(f.size_vertical);
    var nets = {
      whatsapp: 'https://wa.me/?text=' + enc(shareText(f) + ' ' + link),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(link),
      x: 'https://x.com/intent/post?text=' + enc(shareText(f)) + '&url=' + enc(link),
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + enc(link),
      email: 'mailto:?subject=' + enc(f.title) + '&body=' + enc(link)
    };
    dlg.querySelectorAll('[data-net]').forEach(function (a) { a.href = nets[a.getAttribute('data-net')]; });
    q('[data-copy="link"]').setAttribute('data-link', link);
    status.textContent = '';
  }

  // play: the open comes from a tap on a card, whose user activation lets the film start with sound in that same
  // tap. A film's page loaded directly, or reached through Back/Forward, has no tap behind it: it waits for ▶.
  function open(slug, push, play) {
    var f = bySlug[slug];
    if (f !== current) fill(f);
    if (!dlg.open) {
      dlg.showModal();
      // The dialog itself takes the focus, never the ×: autofocus alone loses to the page's first load (from the
      // home page), where the browser hands the focus to the first control and rings it.
      dlg.tabIndex = -1;
      dlg.focus({ preventScroll: true });
    }
    if (play) video.play().catch(function (err) {
      // NotAllowedError: the browser still wants a tap on ▶; AbortError: another film was picked before this one began.
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') say('The film could not start: ' + err.message);
    });
    document.title = f.title + ' | ' + indexTitle.split('|').pop().trim();
    if (push) history.pushState({ video: slug }, '', '/videos/' + slug);
  }

  var closingFromHistory = false;
  dlg.addEventListener('close', function () {
    video.pause();
    document.title = indexTitle;
    if (!closingFromHistory && slugOf(location.pathname)) history.pushState({}, '', '/videos/');
    closingFromHistory = false;
  });
  window.addEventListener('popstate', function () {
    var slug = slugOf(location.pathname);
    if (slug) open(slug, false);
    else if (dlg.open) { closingFromHistory = true; dlg.close(); }
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-video]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !bySlug[a.getAttribute('data-video')]) return;
    e.preventDefault();
    open(a.getAttribute('data-video'), true, true);
  });
  q('.nb-visor__close').addEventListener('click', function (e) { e.preventDefault(); dlg.close(); });
  // A click on the backdrop lands on the dialog itself; the frame fills the box.
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  upright.addEventListener('change', function () { if (current) { setPoster(); video.load(); } });

  function copy(text, done) {
    if (!navigator.clipboard) { say('Select the text to copy it.'); return Promise.resolve(false); }
    return navigator.clipboard.writeText(text).then(function () { if (done) say(done); return true; },
      function () { say('Copying was blocked: select the text instead.'); return false; });
  }
  function captionText(f) { return f.caption + (f.tags.length ? ' ' + f.tags.join(' ') : ''); }
  dlg.querySelectorAll('[data-copy]').forEach(function (b) {
    if (navigator.clipboard) b.hidden = false;
    b.addEventListener('click', function () {
      if (b.getAttribute('data-copy') === 'link') copy(b.getAttribute('data-link'), 'Link copied.');
      else copy(captionText(current), 'Caption copied.');
    });
  });

  // «Share the video…»: only on touch screens whose browser shares files. The file is fetched once per film; when
  // fetching outlasts the tap's permission to share, the next tap shares the file already in hand.
  var probe = typeof File === 'function' && navigator.canShare &&
    navigator.canShare({ files: [new File([''], 'probe.mp4', { type: 'video/mp4' })] });
  if (probe && window.matchMedia('(pointer: coarse)').matches) native.hidden = false;
  native.addEventListener('click', function () {
    var f = current;
    if (f.caption) copy(captionText(f), null);
    var share = function (file) {
      return navigator.share({ files: [file], title: f.title }).then(function () {
        say(f.caption ? 'Caption copied: paste it in the app.' : 'Shared.');
      });
    };
    var got = files[f.slug] || fetch(base(f) + '/vertical.mp4').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) { return new File([blob], 'nebulosa-' + f.slug + '-9x16.mp4', { type: 'video/mp4' }); });
    files[f.slug] = got;
    say('Preparing the video…');
    got.then(share).catch(function (err) {
      if (err && err.name === 'AbortError') status.textContent = '';  // the share menu was dismissed
      else if (err && err.name === 'NotAllowedError') say('The video is ready: tap «Share the video…» again.');
      else { delete files[f.slug]; say('Sharing failed: use the Vertical 9:16 download instead.'); }
    });
  });

  // The film's own page arrives with the dialog open but not modal: reopen it as a modal (focus, Esc, backdrop).
  // Dropping the attribute, unlike close(), queues no close event, whose handler would take the address back.
  var start = slugOf(location.pathname);
  current = start ? bySlug[start] : films[0];
  setPoster();
  // Arriving from another page of this site (a card on the home page) follows the visitor's own click, which
  // browsers count as interaction with the site: the film starts. From outside (a shared link) it waits for ▶.
  var fromHere = false;
  try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) { fromHere = false; }
  if (start) {
    history.replaceState({ video: start }, '', location.pathname);
    dlg.removeAttribute('open');
    open(start, false, fromHere);
  }
})();
