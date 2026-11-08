// Mobile menu toggle. Mirrors Bootstrap 4's collapse class cycle
// (collapse -> collapsing -> collapse show) so its CSS transition still applies.
document.querySelectorAll('[data-toggle="collapse"]').forEach(function (button) {
  var target = document.querySelector(button.getAttribute('data-target'));
  if (!target) return;

  button.addEventListener('click', function () {
    if (target.classList.contains('collapsing')) return;
    var opening = !target.classList.contains('show');

    if (opening) {
      target.classList.remove('collapse');
      target.classList.add('collapsing');
      target.style.height = '0px';
      target.offsetHeight; // force reflow so the height change animates
      target.style.height = target.scrollHeight + 'px';
    } else {
      target.style.height = target.getBoundingClientRect().height + 'px';
      target.offsetHeight;
      target.classList.add('collapsing');
      target.classList.remove('collapse', 'show');
      target.style.height = '';
    }

    button.classList.toggle('collapsed', !opening);
    button.setAttribute('aria-expanded', String(opening));

    function done() {
      target.removeEventListener('transitionend', done);
      target.classList.remove('collapsing');
      target.classList.add('collapse');
      target.classList.toggle('show', opening);
      target.style.height = '';
    }

    // No transition (prefers-reduced-motion) means no transitionend event.
    if (parseFloat(getComputedStyle(target).transitionDuration) > 0) {
      target.addEventListener('transitionend', done);
    } else {
      done();
    }
  });
});

// Shrink the header once the page scrolls.
var nav = document.querySelector('.header-area');

window.addEventListener('scroll', function () {
  nav.classList.toggle('active', window.scrollY > 0);
});
