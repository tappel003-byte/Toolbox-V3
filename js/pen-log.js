// Toolbox — Picture/Damage Locations page for Report Builder.
//
// One or more 11×17 sheets per Distress level that has pins: the plan with the
// pin markers, and beside it the schedule of photograph numbers and what each
// one shows. Photograph numbers follow the Distress sequence across levels. A
// report note is stored on record.reportBuilder.penLog and does not change the
// Distress source.
//
// This page was a pre-printed form. It ruled a fixed number of rows down the
// sheet whether or not there were pins to put in them, carried a Location
// column filled in from the area name, and cut a long note off at one row's
// height. Tim: "that funky pre-lined template is no longer what I want. I
// never really wanted it that way -- that's just how I had to make it for my
// boss at my day job, but this is my app." And on what replaces it: "things
// need to just scale to fit properly. If the distress map needs to get
// smaller, if the notes need to get less wide, it can get more tall, and if we
// have to use more pages, so be it."
//
// So: a row is as tall as its own text, there are no rows without pins, a
// short schedule sits centred rather than hanging from the top, and what does
// not fit goes on another sheet. Rules stay between the rows -- Tim: "we can
// even put the lines down for the reader to read it easily, they just don't
// need to be a bunch of empty lines." North, the residence, the figure number
// and the mark are not on this page at all; they are in the rail, like every
// other figure in the book.

(function () {
  'use strict';

  var PAGE_W = 17;
  var PAGE_H = 11;
  var COL_PHOTO = 0.78;
  var COL_PIN = 0.5;
  // The rail owns the right-hand 2.125 in of the sheet. Everything here stops
  // short of it -- the page border runs between them, and nothing of this
  // page's may touch it.
  var LAYOUT = {
    plan: { x: 0.4, y: 0.45, w: 8.1, h: 10.1 },
    schedule: { x: 8.8, y: 0.45, w: 5.5, h: 10.1 },
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

  /**
   * Fit a note field to its own text.
   *
   * The row is as tall as what is written in it, and a textarea will not do
   * that by itself. Its height is set in px, which means a different thing at
   * every scale this sheet is drawn at -- preview, the print deck, paper --
   * so it is re-measured whenever the page is laid out rather than once at
   * render.
   */
  function autosizeNote(note) {
    if (!note) return;
    note.style.height = 'auto';
    note.style.height = note.scrollHeight + 'px';
  }

  function autosizeNotes(root) {
    if (!root) return;
    var list = root.querySelectorAll('.rb-penlog__note');
    for (var i = 0; i < list.length; i += 1) autosizeNote(list[i]);
  }

  /**
   * Centre a schedule that fits; hang one that does not from the top.
   *
   * The split keeps the rows inside the box, except in the one case it
   * cannot: a single note longer than a whole sheet still has to start
   * somewhere. Centring that would push its first lines off the top of the
   * page as well as its last off the bottom, so a schedule too tall for its
   * box starts at the top and loses only its tail.
   */
  function alignSchedule(root) {
    if (!root) return;
    var box = root.querySelector('.rb-penlog__schedule:not(.rb-penlog__schedule--probe)');
    var grid = box && box.querySelector('.rb-penlog__grid');
    if (!box || !grid) return;
    box.style.justifyContent = grid.offsetHeight > box.clientHeight ? 'flex-start' : 'center';
  }

  function layoutPlans(root) {
    if (!root) return;
    autosizeNotes(root);
    alignSchedule(root);
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

  var COLUMNS = ['Photo', '#', 'Notes'];

  /**
   * The schedule: one row per photograph, each as tall as what is written in
   * it.
   *
   * There is no row without a pin. The old page ruled 32 of them whether or
   * not there was anything to say, which is what made it read as a form
   * somebody had to fill in rather than a figure somebody wrote. A short
   * schedule sits in the middle of its column instead of hanging from the top
   * -- Tim: "if there's only two pictures, the two lines need to be in the
   * middle of the page."
   *
   * `measure` builds the same grid off-page so the splitter can ask how much
   * of it fits before any of it is shown.
   */
  function buildSchedule(pins, model, measure) {
    var grid = document.createElement('div');
    grid.className = 'rb-penlog__grid';
    grid.setAttribute('role', 'table');
    grid.setAttribute('aria-label', 'Picture locations schedule');
    var notesWidth = LAYOUT.schedule.w - COL_PHOTO - COL_PIN;
    grid.style.gridTemplateColumns = [COL_PHOTO, COL_PIN, notesWidth].map(function (width) {
      return width + 'fr';
    }).join(' ');

    COLUMNS.forEach(function (label, index) {
      var head = cell('rb-penlog__cell--head' + (index >= 2 ? ' is-left' : ''), '');
      head.setAttribute('role', 'columnheader');
      head.textContent = label;
      if (label === 'Photo') head.title = 'Photo number or range';
      if (label === '#') head.title = 'Pin number';
      grid.appendChild(head);
    });

    (pins || []).forEach(function (pin) {
      var selected = !measure && pin.id && pin.id === model.selectedPinId;
      var photoCell = cell('is-row' + (selected ? ' is-selected' : ''), pin.id);
      if (pin.photoLabel) {
        var photoBtn = document.createElement('button');
        photoBtn.type = 'button';
        photoBtn.className = 'rb-penlog__photo';
        photoBtn.textContent = pin.photoLabel;
        photoBtn.setAttribute('data-pin-id', pin.id || '');
        photoBtn.setAttribute('aria-label', 'Photographs ' + pin.photoLabel);
        if (!measure) {
          photoBtn.addEventListener('click', function () {
            if (typeof model.onSelect === 'function') model.onSelect(pin.id);
          });
        }
        photoCell.appendChild(photoBtn);
      }
      grid.appendChild(photoCell);

      var pinCell = cell('is-row is-pin' + (selected ? ' is-selected' : ''), pin.id);
      var badge = document.createElement('span');
      badge.className = 'rb-penlog__pinnum';
      badge.textContent = String(pin.number);
      pinCell.appendChild(badge);
      grid.appendChild(pinCell);

      var noteCell = cell('is-row is-left is-note' + (selected ? ' is-selected' : ''), pin.id);
      var note = document.createElement('textarea');
      note.className = 'rb-penlog__note';
      note.rows = 1;
      note.value = pin.note || '';
      note.setAttribute('aria-label', 'Report note for pin ' + pin.number);
      note.setAttribute('data-pin-id', pin.id || '');
      note.setAttribute('data-source-note', pin.sourceNote || '');
      if (measure) {
        note.readOnly = true;
      } else {
        note.addEventListener('focus', function () {
          if (typeof model.onSelect === 'function') model.onSelect(pin.id);
        });
        note.addEventListener('input', function (event) {
          autosizeNote(event.target);
          if (typeof model.onNote === 'function') {
            model.onNote(pin.id, event.target.value, pin.sourceNote || '');
          }
        });
      }
      noteCell.appendChild(note);
      grid.appendChild(noteCell);
    });

    return grid;
  }

  /**
   * How many of these pins fit on one sheet.
   *
   * Measured, not estimated: a note is as tall as its own wrapped text, so
   * nothing short of laying it out at the real width answers the question.
   *
   * It is measured at a FIXED size -- one sheet at 100 px to the inch --
   * rather than at whatever size the sheet happens to be drawn at on screen.
   * Everything on this page is sized in cqh, so the geometry is identical at
   * any scale, but text does not break at identical places: at 1280 px the
   * same 26 notes split 15 and 11, and at 1700 px they split 16 and 10. A
   * report that repaginates when you resize the window is not a report. The
   * reference sheet is the page itself, so the split is the one the paper
   * gets.
   *
   * Returns at least one row -- a note longer than a whole sheet still has to
   * start somewhere, and clipping one row beats looping forever.
   */
  var PROBE_PX_PER_IN = 100;

  function fitCount(pins) {
    var total = (pins || []).length;
    if (total <= 1) return total;
    var host = document.createElement('div');
    host.className = 'rb-penlog-probe-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.width = (PAGE_W * PROBE_PX_PER_IN) + 'px';
    host.style.height = (PAGE_H * PROBE_PX_PER_IN) + 'px';
    var sheet = document.createElement('div');
    sheet.className = 'rb-penlog';
    var probe = document.createElement('div');
    probe.className = 'rb-penlog__schedule rb-penlog__schedule--probe';
    place(probe, LAYOUT.schedule);
    probe.appendChild(buildSchedule(pins, {}, true));
    sheet.appendChild(probe);
    host.appendChild(sheet);
    document.body.appendChild(host);
    autosizeNotes(host);

    // A hair of slack. The reference sheet settles the split, but the page is
    // then drawn at other scales -- a preview, the print deck, paper -- and
    // sub-pixel rounding can make the same rows a shade taller there, and it
    // accumulates down a column of sixteen. A tenth of an inch is invisible
    // and keeps the last row's rule off the bottom edge wherever it lands.
    var limit = probe.clientHeight - 12;
    var rows = probe.querySelectorAll('.rb-penlog__cell.is-row[data-pin-id]');
    var fits = total;
    var seen = {};
    var order = [];
    for (var i = 0; i < rows.length; i += 1) {
      var id = rows[i].getAttribute('data-pin-id');
      if (!id || seen[id]) continue;
      seen[id] = true;
      order.push(rows[i]);
    }
    for (var r = 0; r < order.length; r += 1) {
      if (order[r].offsetTop + order[r].offsetHeight > limit + 0.5) {
        fits = r;
        break;
      }
    }
    document.body.removeChild(host);
    return Math.max(1, Math.min(total, fits));
  }

  function renderPage(sheet, model) {
    model = model || {};
    var pins = Array.isArray(model.pins) ? model.pins : [];
    var mapPins = Array.isArray(model.allPins) ? model.allPins : pins;
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
    mapPins.forEach(function (pin) {
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
    schedule.appendChild(buildSchedule(pins, model));

    root.appendChild(schedule);

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
    COLUMNS: COLUMNS,
    displayNote: displayNote,
    readNotes: readNotes,
    renderPage: renderPage,
    layoutPlans: layoutPlans,
    buildSchedule: buildSchedule,
    fitCount: fitCount,
    saveNotes: saveNotes,
  };

  if (typeof window !== 'undefined') window.ToolboxPenLog = api;
  if (typeof globalThis !== 'undefined') globalThis.ToolboxPenLog = api;
})();
