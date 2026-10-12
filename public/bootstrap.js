// Same-origin startup code runs under the site's script-src 'self' policy.
(function (location) {
  if (location.search[1] === '/') {
    var decoded = location.search.slice(1).split('&').map(function (part) {
      return part.replace(/~and~/g, '&');
    }).join('?');
    window.history.replaceState(null, null, location.pathname.slice(0, -1) + decoded + location.hash);
  }
})(window.location);

// Apply the saved theme before first paint.
(function () {
  try {
    if (localStorage.getItem('fynx-theme') === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  } catch (_) { /* Storage can be unavailable in private browser modes. */ }
})();
