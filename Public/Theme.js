// Dark by default. The toggle switches to light and remembers the choice on this device.
// Loaded in <head> so the saved theme applies before the page appears (no flash).
(function () {
  var root = document.documentElement;
  try {
    if (localStorage.getItem('theme') === 'light') root.setAttribute('data-theme', 'light');
  } catch (e) { /* storage blocked: stay dark */ }

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    function update() {
      var light = root.getAttribute('data-theme') === 'light';
      button.textContent = light ? 'Dark mode' : 'Light mode';
      button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    }
    update();
    button.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
      update();
    });
  });
})();
