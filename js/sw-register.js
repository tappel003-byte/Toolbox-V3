// Toolbox — register the app-shell service worker. Best-effort: if this
// fails or the browser doesn't support it, the app still works online.
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
