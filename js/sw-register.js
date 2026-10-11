// Toolbox — register the app-shell service worker. Best-effort: if this
// fails or the browser doesn't support it, the app still works online.
//
// Reloading is NOT enough to pick up a new deployment. Navigations are
// network-first, so the document arrives fresh, but the scripts and styles it
// then asks for are served cache-first out of the installed shell. The page
// therefore reloads into the OLD application, and keeps doing so until the
// browser happens to notice sw.js changed. After a deploy that reads as the
// fix not having worked.
//
// So Refresh asks the browser to check for a new worker, waits for it to take
// over, and only then reloads — and the app watches for a new version
// arriving on its own.

(function () {
  'use strict';

  var registration = null;
  var reloading = false;

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  if (!('serviceWorker' in navigator)) {
    window.ToolboxUpdate = {
      check: function () { return Promise.resolve(false); },
      refresh: function () { reloadOnce(); return Promise.resolve(); },
      onAvailable: function () {},
    };
    return;
  }

  var availableHandlers = [];

  function announceAvailable() {
    availableHandlers.forEach(function (fn) {
      try { fn(); } catch (err) { /* a listener must not block the update */ }
    });
  }

  // A worker that reaches 'installed' while one is already in control is a
  // new version waiting its turn.
  function watchForUpdate(reg) {
    reg.addEventListener('updatefound', function () {
      var next = reg.installing;
      if (!next) return;
      next.addEventListener('statechange', function () {
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          announceAvailable();
        }
      });
    });
  }

  // The new worker calls skipWaiting, so control changes as soon as it
  // activates. Reload then, once, so the page is running the code it just
  // installed rather than a mix of old and new.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (pendingRefresh) reloadOnce();
  });

  var pendingRefresh = false;

  function check() {
    if (!registration) return Promise.resolve(false);
    return registration.update().then(function () {
      return !!(registration.installing || registration.waiting);
    }).catch(function () { return false; });
  }

  function refresh() {
    pendingRefresh = true;
    if (!registration) { reloadOnce(); return Promise.resolve(); }
    return registration.update().then(function () {
      var next = registration.waiting || registration.installing;
      if (!next) { reloadOnce(); return; }
      // Already activated between the check and here.
      if (next.state === 'activated') { reloadOnce(); return; }
      next.addEventListener('statechange', function () {
        if (next.state === 'activated' || next.state === 'redundant') reloadOnce();
      });
      // Never leave the investigator looking at a spinner because an update
      // stalled; reload anyway.
      setTimeout(reloadOnce, 4000);
    }).catch(function () { reloadOnce(); });
  }

  window.ToolboxUpdate = {
    check: check,
    refresh: refresh,
    onAvailable: function (fn) { if (typeof fn === 'function') availableHandlers.push(fn); },
  };

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      registration = reg;
      watchForUpdate(reg);
      // A deploy made while the app was open should not wait for a restart.
      check();
      setInterval(check, 5 * 60 * 1000);
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
