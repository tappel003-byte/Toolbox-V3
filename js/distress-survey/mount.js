/**
 * Toolbox host mount for proven Distress Survey (field-reporter-pro survey.html).
 * Customer File supplies plan canvases; survey runs in an iframe for chrome isolation.
 */
(function () {
  'use strict';

  var hostEl = null;
  var iframe = null;
  var onBackCb = null;

  function leave() {
    var cb = onBackCb;
    unmount();
    if (typeof cb === 'function') cb();
  }

  function onMessage(ev) {
    if (!ev || !ev.data || ev.data.type !== 'toolbox-distress-back') return;
    leave();
  }

  function mount(el, options) {
    unmount();
    if (!el || !options || !options.customerFileId) {
      throw new Error('ToolboxDistress.mount requires element and customerFileId');
    }
    hostEl = el;
    onBackCb = options.onBack || null;
    window.__toolboxDistressBack = leave;
    window.addEventListener('message', onMessage);

    el.classList.add('distress-survey-host');
    el.style.height = '100%';
    el.style.minHeight = '0';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.innerHTML = '';

    iframe = document.createElement('iframe');
    iframe.title = 'Distress Survey';
    iframe.setAttribute('allow', 'camera; microphone; fullscreen');
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.flex = '1';
    iframe.style.minHeight = '0';
    iframe.style.background = '#f4f0e8';
    var src =
      'distress-survey/survey.html?cf=' +
      encodeURIComponent(options.customerFileId) +
      '&_=' +
      Date.now();
    iframe.src = src;
    el.appendChild(iframe);

    return { unmount: unmount };
  }

  function unmount() {
    window.removeEventListener('message', onMessage);
    if (window.__toolboxDistressBack === leave) {
      try {
        delete window.__toolboxDistressBack;
      } catch (_) {
        window.__toolboxDistressBack = null;
      }
    }
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    iframe = null;
    if (hostEl) {
      hostEl.classList.remove('distress-survey-host');
      hostEl.innerHTML = '';
      hostEl = null;
    }
    onBackCb = null;
  }

  window.ToolboxDistress = { mount: mount, unmount: unmount };
})();
