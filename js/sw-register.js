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
//
// GPT-034: readiness is sticky for THIS document. skipWaiting + clients.claim
// can activate the new worker while the old page JS is still running; the red
// Update ready control must stay until this document actually reloads into
// the new shell. Late onAvailable listeners must hear the current state.
// Focus / visibility / online re-check so a phone that slept does not depend
// on catching updatefound or a five-minute timer.

(function () {
  'use strict';

  var registration = null;
  var reloading = false;
  /** True once a newer shell was discovered while this page ran older code. */
  var updateReady = false;
  var pendingRefresh = false;
  var availableHandlers = [];
  var lastCheckAt = 0;
  var CHECK_COALESCE_MS = 8000;
  var PERIODIC_MS = 5 * 60 * 1000;
  var watchedInstalling = null;

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
      isAvailable: function () { return false; },
    };
    return;
  }

  function announceAvailable() {
    availableHandlers.forEach(function (fn) {
      try { fn(); } catch (err) { /* a listener must not block the update */ }
    });
  }

  function markAvailable() {
    if (updateReady) return;
    updateReady = true;
    announceAvailable();
  }

  function watchInstalling(worker) {
    if (!worker || worker === watchedInstalling) return;
    watchedInstalling = worker;
    worker.addEventListener('statechange', function onState() {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        markAvailable();
      }
      if (worker.state === 'activated' || worker.state === 'redundant') {
        if (watchedInstalling === worker) watchedInstalling = null;
      }
    });
    // Already past the event we care about.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      markAvailable();
    }
  }

  function syncFromRegistration(reg) {
    if (!reg) return;
    // A waiting worker is the classic "new version ready" signal.
    if (reg.waiting && navigator.serviceWorker.controller) {
      markAvailable();
    }
    if (reg.installing) {
      watchInstalling(reg.installing);
    }
  }

  function watchForUpdate(reg) {
    reg.addEventListener('updatefound', function () {
      var next = reg.installing;
      if (!next) return;
      // First install (no controller yet) is not an "update" for a running app.
      watchInstalling(next);
    });
  }

  // The new worker calls skipWaiting, so control can change without the user
  // tapping Refresh. Do NOT clear updateReady here — this document is still
  // the old app until it reloads. Only a deliberate Refresh reloads.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (pendingRefresh) reloadOnce();
  });

  function check(opts) {
    var force = !!(opts && opts.force);
    var now = Date.now();
    if (!force && lastCheckAt && (now - lastCheckAt) < CHECK_COALESCE_MS) {
      return Promise.resolve(updateReady);
    }
    lastCheckAt = now;
    if (!registration) return Promise.resolve(updateReady);
    return registration.update().then(function () {
      syncFromRegistration(registration);
      return updateReady;
    }).catch(function () {
      // Offline / failed check: keep known readiness; do not clear the red.
      return updateReady;
    });
  }

  function refresh() {
    pendingRefresh = true;
    if (!registration) { reloadOnce(); return Promise.resolve(); }
    return registration.update().then(function () {
      syncFromRegistration(registration);
      var next = registration.waiting || registration.installing;
      if (!next) {
        // Already activated (skipWaiting) or no update — reload this document
        // so scripts/styles come from the controlling shell.
        reloadOnce();
        return;
      }
      if (next.state === 'activated') { reloadOnce(); return; }
      next.addEventListener('statechange', function () {
        if (next.state === 'activated' || next.state === 'redundant') reloadOnce();
      });
      // Never leave the investigator looking at a spinner because an update
      // stalled; reload anyway.
      setTimeout(reloadOnce, 4000);
    }).catch(function () { reloadOnce(); });
  }

  function onAvailable(fn) {
    if (typeof fn !== 'function') return;
    availableHandlers.push(fn);
    // Late subscription must receive current readiness (GPT-034).
    if (updateReady) {
      try { fn(); } catch (err) { /* ignore */ }
    }
  }

  window.ToolboxUpdate = {
    check: check,
    refresh: refresh,
    onAvailable: onAvailable,
    isAvailable: function () { return updateReady; },
  };

  function onForeground() {
    check({ force: false });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') onForeground();
  });
  window.addEventListener('focus', onForeground);
  window.addEventListener('pageshow', onForeground);
  window.addEventListener('online', onForeground);

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      registration = reg;
      watchForUpdate(reg);
      // Already installing/waiting when this page attached (GPT-034).
      syncFromRegistration(reg);
      check({ force: true });
      setInterval(function () { check({ force: true }); }, PERIODIC_MS);
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
