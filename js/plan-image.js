// Toolbox — plan image processing adapted from field-reporter-pro.
//
// Proven standalone behavior lives in public/survey.html:
//   resizeImage(), addPlanGutter(), onPlanFileChange()
// This module ports those helpers for Toolbox Plan Setup without modifying
// the standalone repository. Capture is not implemented here.

(function () {
  'use strict';

  // Matches field-reporter-pro MAX_IMG_DIM for floor plans.
  const MAX_IMG_DIM = 2400;

  function resizeImage(dataUrl, maxDim, cb, onError) {
    const img = new Image();
    img.onload = function () {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.85), w, h);
    };
    img.onerror = function () {
      if (onError) onError(new Error('Could not load that image.'));
    };
    img.src = dataUrl;
  }

  // Add a uniform white gutter around a plan image. pct is fraction per side
  // (0.05 = 5%), matching field-reporter-pro addPlanGutter().
  function addPlanGutter(dataUrl, w, h, pct, cb) {
    const img = new Image();
    img.onload = function () {
      const padX = Math.round(w * pct);
      const padY = Math.round(h * pct);
      const nw = w + padX * 2;
      const nh = h + padY * 2;
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, nw, nh);
      ctx.drawImage(img, padX, padY, w, h);
      cb(c.toDataURL('image/jpeg', 0.85), nw, nh);
    };
    img.onerror = function () {
      cb(dataUrl, w, h);
    };
    img.src = dataUrl;
  }

  // Process a File from the plan picker the same way FRP onPlanFileChange does:
  // image-only → readAsDataURL → resize ≤ 2400 → 5% white gutter → callback.
  function processPlanFile(file, onReady, onError) {
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
      if (onError) onError(new Error('Please choose an image file (JPG/PNG).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = function (ev) {
      resizeImage(ev.target.result, MAX_IMG_DIM, function (dataUrl, w, h) {
        addPlanGutter(dataUrl, w, h, 0.05, function (paddedUrl, pw, ph) {
          onReady({ dataUrl: paddedUrl, width: pw, height: ph });
        });
      }, onError);
    };
    reader.onerror = function () {
      if (onError) onError(new Error('Could not read that file.'));
    };
    reader.readAsDataURL(file);
  }

  function newPlanId() {
    return 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  window.ToolboxPlanImage = {
    MAX_IMG_DIM: MAX_IMG_DIM,
    resizeImage: resizeImage,
    addPlanGutter: addPlanGutter,
    processPlanFile: processPlanFile,
    newPlanId: newPlanId,
  };
})();
