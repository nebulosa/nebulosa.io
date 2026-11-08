// The Contact composer: sends the form to Web3Forms in place. Native validation runs first; a checked NDA box adds
// the NDA flag to the subject. On any failure or after data-timeout ms (default 15 s) the text stays and the status
// offers a mailto link carrying it. While sending the button is aria-disabled (never disabled: focus stays on it).
(function () {
  'use strict';
  var form = document.querySelector('form.nb-compose');
  if (!form || !window.fetch || !window.FormData || !window.AbortController) return;
  var data = function (k) { return form.getAttribute('data-' + k) || ''; };
  var status = form.querySelector('.nb-compose__status');
  var button = form.querySelector('[type="submit"]');
  var busy = false;
  var say = function (text) { status.textContent = text; };

  function subject() {
    var nda = form.querySelector('input[name="nda"]');
    return data('subject') + (nda && nda.checked ? ' — ' + data('nda-subject') : '');
  }

  function mailto() {
    var who = form.elements.name.value.trim(), email = form.elements.email.value.trim();
    var head = who || email ? (who + (email ? ' <' + email + '>' : '')).trim() + '\n\n' : '';
    // RFC 6068: line breaks in a mailto body are CRLF.
    var body = (head + form.elements.message.value).replace(/\r\n|\r|\n/g, '\r\n');
    var a = document.createElement('a');
    a.className = 'nb-compose__mailto';
    a.href = 'mailto:' + data('email') + '?subject=' + encodeURIComponent(subject()) + '&body=' + encodeURIComponent(body);
    a.textContent = data('email');
    return a;
  }

  // Editing after a send clears "sent"; after a failure the fallback link stays and follows the new text.
  form.addEventListener('input', function () {
    if (busy) return;
    var link = status.querySelector('.nb-compose__mailto');
    if (link) link.href = mailto().href; else say('');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    var fd = new FormData(form);
    fd.set('subject', subject());
    fd.delete('redirect'); // the JSON reply is the answer here, not the no-JS page
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, Number(data('timeout')) || 15000);
    busy = true;
    button.setAttribute('aria-disabled', 'true');
    say(data('sending'));
    fetch(form.action, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, signal: ctl.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.success !== true) throw new Error('not sent');
        form.reset();
        say(data('sent'));
      })
      .catch(function () {
        say(data('failed') + ' ');
        status.appendChild(mailto());
      })
      .then(function () {
        clearTimeout(timer);
        busy = false;
        button.removeAttribute('aria-disabled');
      });
  });
})();
