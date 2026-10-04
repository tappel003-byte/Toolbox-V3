// Toolbox — Pen Log page for Report Builder.
//
// One native 17×11 sheet per Distress level that has pins. The plan image,
// pin markers, schedule, and report wording are separate elements. Photograph
// numbers follow the Distress sequence across levels. A report note is stored
// on record.reportBuilder.penLog and does not change the Distress source.
//
// Inch placement follows the inspected 1515 structure: a quiet two-line
// figure number and Picture/Damage Locations heading, the plan through about
// x=9.5 in on white, a north arrow above the plan near the schedule, and a
// schedule from x=10 in. The figure number is this sheet's page number.
// Company logos from that file are not in this environment.

(function () {
  'use strict';

  var PAGE_W = 17;
  var PAGE_H = 11;
  var HEADER_IN = 0.32;
  var ROW_IN = 0.3;
  var COL_PHOTO = 0.75;
  var COL_PIN = 0.45;
  var COL_LOCATION = 1.35;
  var LAYOUT = {
    title: { x: 0.4, y: 0.16, w: 9.0 },
    plan: { x: 0.4, y: 0.62, w: 9.1, h: 9.58 },
    north: { x: 9.56, y: 0.18, w: 0.38, h: 0.46 },
    schedule: { x: 10, y: 0.28, w: 6.55, h: 10.12 },
    brand: { x: 0.4, y: 10.52 },
    pageNum: { x: 16.62, y: 10.52 },
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function containedFrame(frameWidth, frameHeight, imageWidth, imageHeight) {
    var frameW = Number(frameWidth);
    var frameH = Number(frameHeight);
    var imageW = Number(imageWidth);
    var imageH = Number(imageHeight);
    if (!(frameW > 0) || !(frameH > 0)) {
      return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
    }
    if (!(imageW > 0) || !(imageH > 0)) {
      return { x: 0, y: 0, width: frameW, height: frameH, scale: 1 };
    }
    var scale = Math.min(frameW / imageW, frameH / imageH);
    var width = imageW * scale;
    var height = imageH * scale;
    return {
      x: (frameW - width) / 2,
      y: (frameH - height) / 2,
      width: width,
      height: height,
      scale: scale,
    };
  }

  function pinPoint(normX, normY, frame) {
    var x = Number(normX);
    var y = Number(normY);
    if (!frame || !isFinite(x) || !isFinite(y)) return null;
    return {
      x: frame.x + x * frame.width,
      y: frame.y + y * frame.height,
    };
  }

  function assignPinNumbers(pins, mode, startNum) {
    var external = mode === 'external';
    var n = typeof startNum === 'number' && isFinite(startNum) ? startNum : 1;
    return (pins || []).map(function (pin) {
      var photoCount = pin && Array.isArray(pin.photos) ? pin.photos.length : 0;
      var take = external ? Math.max(1, (pin && pin.extPhotoCount) || 0) : Math.max(1, photoCount);
      var num = n;
      var photoNumbers = [];
      for (var i = 0; i < photoCount; i += 1) photoNumbers.push(num + i);
      n += take;
      return { num: num, end: num + take - 1, photoNumbers: photoNumbers };
    });
  }

  function photoRange(pinNumber, photoCount) {
    var count = photoCount || 0;
    var num = pinNumber;
    if (!(count > 0) || typeof num !== 'number' || !isFinite(num)) return '';
    if (count === 1) return String(num);
    return num + '\u2013' + (num + count - 1);
  }

  function sourceNote(pin) {
    if (!pin) return '';
    var fromEvidence = text(pin.text);
    if (fromEvidence) return fromEvidence;
    return text(pin.description);
  }

  function displayNote(pin, notes) {
    var id = pin && pin.id;
    if (id && notes && Object.prototype.hasOwnProperty.call(notes, id) && typeof notes[id] === 'string') {
      return notes[id];
    }
    return sourceNote(pin);
  }

  function readNotes(record) {
    var report = record && (record.reportBuilder || record.report);
    var pen = report && report.penLog;
    var notes = pen && pen.notes;
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {};
    var copy = {};
    Object.keys(notes).forEach(function (key) {
      if (typeof notes[key] === 'string') copy[key] = notes[key];
    });
    return copy;
  }

  function bodyCapacity() {
    return Math.max(1, Math.round((LAYOUT.schedule.h - HEADER_IN) / ROW_IN));
  }

  function percentX(inches) {
    return (inches / PAGE_W) * 100;
  }

  function percentY(inches) {
    return (inches / PAGE_H) * 100;
  }

  function place(el, box) {
    el.style.left = percentX(box.x) + '%';
    el.style.top = percentY(box.y) + '%';
    if (box.w) el.style.width = percentX(box.w) + '%';
    if (box.h) el.style.height = percentY(box.h) + '%';
  }

  function layoutPlans(root) {
    if (!root) return;
    var frame = root.querySelector('.rb-penlog__plan');
    var fit = root.querySelector('.rb-penlog__fit');
    if (!frame || !fit) return;
    var rect = containedFrame(
      frame.clientWidth,
      frame.clientHeight,
      frame.getAttribute('data-plan-width'),
      frame.getAttribute('data-plan-height')
    );
    fit.style.left = rect.x + 'px';
    fit.style.top = rect.y + 'px';
    fit.style.width = Math.max(0, rect.width) + 'px';
    fit.style.height = Math.max(0, rect.height) + 'px';
    publishPinSize(root, rect);
  }

  /**
   * Size the pin markers from the PLAN, not from the page.
   *
   * Distress Survey draws a pin at radius 0.00875 of the plan's long side, so
   * its diameter is 1.75% of that side, and the pin-log PDF it exports is the
   * size the investigator has approved. Report Builder does not use that
   * exported picture -- it redraws the pins itself from the clean plan and the
   * normalized coordinates -- and it was sizing them as a fraction of the
   * SHEET. Anchored to the page, a pin keeps its physical size while the plan
   * shrinks under it, so it crowds the drawing and matches the PDF at no plan
   * size at all.
   *
   * Published in cqh rather than px because the sheet is drawn at several
   * scales -- preview, the print deck, 11 x 17 paper -- and a px value
   * computed at one is wrong at the next. The plan's fraction OF THE SHEET does
   * not change when the sheet does, so the ratio survives every scale.
   */
  var DISTRESS_PIN_DIAMETER = 0.0175;

  function publishPinSize(root, rect) {
    var fit = root.querySelector('.rb-penlog__fit');
    if (!fit) return;
    var sheet = root.closest ? root.closest('.rb-sheet') : null;
    var sheetH = sheet ? sheet.clientHeight : 0;
    var longSide = Math.max(rect.width, rect.height);
    if (!(sheetH > 0) || !(longSide > 0)) {
      // Before the first real layout there is nothing to compute from; the CSS
      // fallback holds until there is.
      fit.style.removeProperty('--rb-pin-size');
      return;
    }
    var cqh = (longSide * DISTRESS_PIN_DIAMETER / sheetH) * 100;
    fit.style.setProperty('--rb-pin-size', cqh.toFixed(3) + 'cqh');
  }

  function cell(className, pinId) {
    var el = document.createElement('div');
    el.className = 'rb-penlog__cell ' + className;
    if (pinId) el.setAttribute('data-pin-id', pinId);
    return el;
  }

  function renderPage(sheet, model) {
    model = model || {};
    var pins = Array.isArray(model.pins) ? model.pins : [];
    var plan = model.plan || {};
    sheet.textContent = '';
    sheet.setAttribute('data-page-kind', 'pen-log');
    var levelName = text(model.levelName) || 'Level';
    var figureNumber = model.pageNumber ? String(model.pageNumber) : '';
    var figureLabel = figureNumber ? 'Figure ' + figureNumber : 'Figure';
    var headingText = 'Picture/Damage Locations';
    sheet.setAttribute('aria-label', figureLabel + ', ' + headingText + ', ' + levelName + ', 11 by 17 inch landscape');

    var root = document.createElement('div');
    root.className = 'rb-penlog';
    root.setAttribute('data-level', levelName);

    var title = document.createElement('p');
    title.className = 'rb-penlog__title';
    var kicker = document.createElement('span');
    kicker.className = 'rb-penlog__kicker';
    kicker.textContent = figureLabel;
    var heading = document.createElement('span');
    heading.className = 'rb-penlog__heading';
    heading.textContent = headingText;
    title.appendChild(kicker);
    title.appendChild(heading);
    place(title, LAYOUT.title);
    root.appendChild(title);

    var north = document.createElement('p');
    north.className = 'rb-penlog__north';
    north.setAttribute('role', 'img');
    north.setAttribute('aria-label', 'North');
    var northArrow = document.createElement('span');
    northArrow.className = 'rb-penlog__north-arrow';
    northArrow.setAttribute('aria-hidden', 'true');
    var northLabel = document.createElement('span');
    northLabel.className = 'rb-penlog__north-label';
    northLabel.textContent = 'N';
    north.appendChild(northArrow);
    north.appendChild(northLabel);
    place(north, LAYOUT.north);
    root.appendChild(north);

    var frame = document.createElement('div');
    frame.className = 'rb-penlog__plan';
    place(frame, LAYOUT.plan);
    var planWidth = Number(plan.width);
    var planHeight = Number(plan.height);
    if (planWidth > 0 && planHeight > 0) {
      frame.setAttribute('data-plan-width', String(planWidth));
      frame.setAttribute('data-plan-height', String(planHeight));
      frame.setAttribute('data-registration', 'plan');
    } else {
      frame.setAttribute('data-registration', 'unknown');
    }
    var fit = document.createElement('div');
    fit.className = 'rb-penlog__fit';
    var planUrl = typeof plan.dataUrl === 'string' && plan.dataUrl.indexOf('data:image/') === 0 ? plan.dataUrl : '';
    if (planUrl) {
      var img = document.createElement('img');
      img.className = 'rb-penlog__image';
      img.alt = (model.levelName || 'Floor') + ' plan';
      img.src = planUrl;
      img.addEventListener('load', function () {
        if (!(planWidth > 0) && img.naturalWidth > 0) {
          frame.setAttribute('data-plan-width', String(img.naturalWidth));
          frame.setAttribute('data-plan-height', String(img.naturalHeight));
          frame.setAttribute('data-registration', 'plan');
        }
        layoutPlans(root);
      });
      fit.appendChild(img);
    } else {
      var missing = document.createElement('p');
      missing.className = 'rb-penlog__missing';
      missing.textContent = 'Plan image is not on this device.';
      frame.appendChild(missing);
    }
    pins.forEach(function (pin) {
      if (typeof pin.x !== 'number' || typeof pin.y !== 'number') return;
      var marker = document.createElement('span');
      marker.className = 'rb-penlog__pin' + (pin.exterior ? ' is-exterior' : '');
      if (pin.id && pin.id === model.selectedPinId) marker.classList.add('is-selected');
      // Distress's coordinate, plus this report's own offset. Several
      // photographs at one spot arrive as separate pins on identical
      // coordinates and would otherwise sit exactly on top of each other with
      // only the last number readable; the offset is how they get pulled
      // apart. It is percent of the plan rect, like pin.x/pin.y, and is not
      // clamped to 0..1 -- a pin may be dragged off the plan and onto the
      // white of the page.
      marker.style.left = (Math.max(0, Math.min(1, pin.x)) * 100 + (pin.dx || 0)) + '%';
      marker.style.top = (Math.max(0, Math.min(1, pin.y)) * 100 + (pin.dy || 0)) + '%';
      marker.textContent = String(pin.number);
      if (pin.id) marker.setAttribute('data-pin-id', pin.id);
      marker.setAttribute('data-norm-x', String(pin.x));
      marker.setAttribute('data-norm-y', String(pin.y));
      fit.appendChild(marker);
    });
    frame.appendChild(fit);
    root.appendChild(frame);

    var schedule = document.createElement('div');
    schedule.className = 'rb-penlog__schedule';
    place(schedule, LAYOUT.schedule);
    var notesWidth = LAYOUT.schedule.w - COL_PHOTO - COL_PIN - COL_LOCATION;
    var capacity = bodyCapacity();
    var bodyRows = Math.max(capacity, pins.length);
    var grid = document.createElement('div');
    grid.className = 'rb-penlog__grid';
    grid.setAttribute('role', 'table');
    grid.setAttribute('aria-label', 'Pen Log schedule');
    grid.style.gridTemplateColumns = [COL_PHOTO, COL_PIN, COL_LOCATION, notesWidth].map(function (width) {
      return width + 'fr';
    }).join(' ');
    if (pins.length > capacity) {
      schedule.classList.add('is-scroll');
      var rowShare = (LAYOUT.schedule.h - HEADER_IN) / capacity;
      var contentIn = HEADER_IN + rowShare * bodyRows;
      grid.style.height = (contentIn / LAYOUT.schedule.h * 100) + '%';
      grid.style.gridTemplateRows = HEADER_IN + 'fr repeat(' + bodyRows + ', ' + rowShare + 'fr)';
    } else {
      var rowFr = (LAYOUT.schedule.h - HEADER_IN) / bodyRows;
      grid.style.gridTemplateRows = HEADER_IN + 'fr repeat(' + bodyRows + ', ' + rowFr + 'fr)';
    }
    ['Photo', '#', 'Location', 'Notes'].forEach(function (label, index) {
      var head = cell('rb-penlog__cell--head' + (index >= 2 ? ' is-left' : ''), '');
      head.setAttribute('role', 'columnheader');
      head.textContent = label;
      if (label === 'Photo') head.title = 'Photo number or range';
      if (label === '#') head.title = 'Pin number';
      grid.appendChild(head);
    });
    for (var r = 0; r < bodyRows; r += 1) {
      var pin = pins[r];
      if (!pin) {
        for (var e = 0; e < 4; e += 1) grid.appendChild(cell('', ''));
        continue;
      }
      var selected = pin.id && pin.id === model.selectedPinId;
      var photoCell = cell(selected ? 'is-selected' : '', pin.id);
      if (pin.photoLabel) {
        var photoBtn = document.createElement('button');
        photoBtn.type = 'button';
        photoBtn.className = 'rb-penlog__photo';
        photoBtn.textContent = pin.photoLabel;
        photoBtn.setAttribute('data-pin-id', pin.id || '');
        photoBtn.setAttribute('aria-label', 'Photographs ' + pin.photoLabel);
        photoBtn.addEventListener('click', function (id) {
          return function () {
            if (typeof model.onSelect === 'function') model.onSelect(id);
          };
        }(pin.id));
        photoCell.appendChild(photoBtn);
      }
      grid.appendChild(photoCell);

      var pinCell = cell('is-pin' + (selected ? ' is-selected' : ''), pin.id);
      var badge = document.createElement('span');
      badge.className = 'rb-penlog__pinnum';
      badge.textContent = String(pin.number);
      pinCell.appendChild(badge);
      grid.appendChild(pinCell);

      var locationCell = cell('is-left' + (selected ? ' is-selected' : ''), pin.id);
      locationCell.textContent = pin.location || '';
      grid.appendChild(locationCell);

      var noteCell = cell('is-left is-note' + (selected ? ' is-selected' : ''), pin.id);
      var note = document.createElement('textarea');
      note.className = 'rb-penlog__note';
      note.value = pin.note || '';
      note.setAttribute('aria-label', 'Report note for pin ' + pin.number);
      note.setAttribute('data-pin-id', pin.id || '');
      note.setAttribute('data-source-note', pin.sourceNote || '');
      note.addEventListener('focus', function (id) {
        return function () {
          if (typeof model.onSelect === 'function') model.onSelect(id);
        };
      }(pin.id));
      note.addEventListener('input', function (id, source) {
        return function (event) {
          if (typeof model.onNote === 'function') model.onNote(id, event.target.value, source);
        };
      }(pin.id, pin.sourceNote || ''));
      noteCell.appendChild(note);
      grid.appendChild(noteCell);
    }
    schedule.appendChild(grid);
    root.appendChild(schedule);

    var brand = document.createElement('p');
    brand.className = 'rb-penlog__brand';
    brand.textContent = 'Toolbox';
    place(brand, LAYOUT.brand);
    root.appendChild(brand);

    var pageNum = document.createElement('p');
    pageNum.className = 'rb-penlog__page';
    var footerBits = [];
    if (text(model.property)) footerBits.push(text(model.property));
    footerBits.push('Page ' + (model.pageNumber || ''));
    pageNum.textContent = footerBits.join(' \u00b7 ');
    pageNum.style.top = percentY(LAYOUT.pageNum.y) + '%';
    pageNum.style.right = percentX(PAGE_W - LAYOUT.pageNum.x) + '%';
    root.appendChild(pageNum);

    sheet.appendChild(root);
    layoutPlans(root);
    return {
      layout: function () { layoutPlans(root); },
    };
  }

  function saveNotes(customerFileId, notes) {
    if (!customerFileId) return Promise.reject(new Error('Customer File is required.'));
    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function' ||
        typeof window.ToolboxDB.saveCustomerFile !== 'function') {
      return Promise.reject(new Error('Customer File storage is not available.'));
    }
    return window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (!record || record.deletedAt) throw new Error('Customer File is not on this device.');
      var distressSnapshot = JSON.stringify(record.distress || null);
      var plansSnapshot = JSON.stringify(record.planSetup || null);
      var floorSnapshot = JSON.stringify(record.floorSurvey || null);
      var clean = {};
      Object.keys(notes || {}).forEach(function (key) {
        if (!key || typeof notes[key] !== 'string') return;
        clean[key] = notes[key];
      });
      var report = record.reportBuilder && typeof record.reportBuilder === 'object' && !Array.isArray(record.reportBuilder)
        ? record.reportBuilder
        : {};
      var now = new Date().toISOString();
      report.penLog = {
        schema: 'toolbox.pen-log-notes',
        schemaVersion: 1,
        notes: clean,
      };
      report.updatedAt = now;
      record.reportBuilder = report;
      record.updatedAt = now;
      if (JSON.stringify(record.distress || null) !== distressSnapshot ||
          JSON.stringify(record.planSetup || null) !== plansSnapshot ||
          JSON.stringify(record.floorSurvey || null) !== floorSnapshot) {
        throw new Error('Report note save touched source survey data.');
      }
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        return window.ToolboxDB.getCustomerFile(customerFileId);
      }).then(function (saved) {
        if (!saved || !saved.reportBuilder || saved.reportBuilder.updatedAt !== now) {
          throw new Error('Report note did not persist.');
        }
        var stored = readNotes(saved);
        Object.keys(clean).forEach(function (key) {
          if (stored[key] !== clean[key]) throw new Error('Report note did not persist.');
        });
        if (JSON.stringify(saved.distress || null) !== distressSnapshot) {
          throw new Error('Distress changed while saving a report note.');
        }
        if (JSON.stringify(saved.planSetup || null) !== plansSnapshot) {
          throw new Error('Plans changed while saving a report note.');
        }
        if (JSON.stringify(saved.floorSurvey || null) !== floorSnapshot) {
          throw new Error('Floor Survey changed while saving a report note.');
        }
        return saved.reportBuilder;
      });
    });
  }

  var api = {
    PAGE_W: PAGE_W,
    PAGE_H: PAGE_H,
    LAYOUT: LAYOUT,
    containedFrame: containedFrame,
    pinPoint: pinPoint,
    assignPinNumbers: assignPinNumbers,
    photoRange: photoRange,
    sourceNote: sourceNote,
    displayNote: displayNote,
    readNotes: readNotes,
    bodyCapacity: bodyCapacity,
    renderPage: renderPage,
    layoutPlans: layoutPlans,
    saveNotes: saveNotes,
  };

  if (typeof window !== 'undefined') window.ToolboxPenLog = api;
  if (typeof globalThis !== 'undefined') globalThis.ToolboxPenLog = api;
})();
