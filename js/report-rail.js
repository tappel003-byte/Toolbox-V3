// Toolbox — the figure rail.
//
// A narrow column down the right-hand edge of a figure page carrying
// everything about the sheet that is not the drawing: north, whose property
// this is, what the drawing is, when it was surveyed, the relative readings,
// the figure number and the mark.
//
// It replaces chrome that used to be scattered into the four corners — the
// address block upper right, the readings box lower right, the logo floating
// lower left — and the machinery that went with it: a movable, lockable logo
// box, and a title block that would have needed a button to swap corners
// when the plan grew into one. There are no corners to compete for any more,
// so none of that has to exist.
//
// Tim, on seeing it: "This makes it look a lot more technical and
// professional... it fits for every single page. It opens up the canvas."
// And on how loud it may be: "It's not about us. It's about the customer."
//
// The markup below is the structure Tim had ChatGPT write to the agreed
// specification, reproduced element for element so it matches the stylesheet
// that came with it. Three things I had got wrong and it does not: the rail
// clears the page border's stroke instead of painting over it, the foot is a
// grid track of its own so the figure number and the mark share one centre
// line and cannot be clipped by the sections above, and the readings are a
// description list rather than rows of spans.
(function () {
  'use strict';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  /** Lines joined by <br>, the way the template sets them. */
  function lines(tag, cls, parts) {
    var node = el(tag, cls);
    var used = (parts || []).filter(function (part) { return part; });
    used.forEach(function (part, i) {
      if (i) node.appendChild(document.createElement('br'));
      node.appendChild(document.createTextNode(part));
    });
    return used.length ? node : null;
  }

  /**
   * "Mitchell Residence" sets as Mitchell / Residence.
   *
   * The template breaks the client name before its last word rather than
   * letting it wrap wherever it happens to fit.
   */
  function clientLines(name) {
    var text = String(name || '').trim();
    if (!text) return [];
    var at = text.lastIndexOf(' ');
    if (at <= 0) return [text];
    return [text.slice(0, at), text.slice(at + 1)];
  }

  /**
   * A block of the rail the investigator can type over.
   *
   * Tim: "All text on the rail needs to be editable by the user." Every line
   * here is generated -- from the Customer File, from the survey, from the
   * slide's own position in the book -- and generated is right until the one
   * time it is not: a client who goes by another name, a date that needs a
   * qualifier, a reading he wants to state differently on the sheet.
   *
   * So each block carries its own saved text. Nothing is stored until it is
   * typed over; the generated line shows until then; and emptying the block
   * drops the override, which puts the generated line back. That is the way
   * out, and it is the same gesture as the edit.
   *
   * A block nobody has touched keeps exactly the markup it had before any of
   * this -- plain text nodes, no paragraph wrappers -- so a sheet nobody has
   * edited sets precisely as it set before.
   */
  function editable(node, o, key, aria) {
    if (!node || !o.editable) return node;
    node.className += ' rb-rt';
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'true');
    node.setAttribute('role', 'textbox');
    node.setAttribute('data-rb-rail-field', key);
    node.setAttribute('data-rb-rich', 'rail:' + key);
    if (aria) node.setAttribute('aria-label', aria);
    return node;
  }

  /** The investigator's text for a block, or null where they have written none. */
  function savedHtml(o, key) {
    var edits = o && o.edits;
    var model = edits && Object.prototype.hasOwnProperty.call(edits, key) ? edits[key] : null;
    var api = window.ToolboxReportText;
    if (!model || !api || typeof api.toHtml !== 'function') return null;
    if (typeof api.isEmpty === 'function' && api.isEmpty(model)) return null;
    return api.toHtml(model);
  }

  /**
   * One block: what the investigator wrote, or the generated lines.
   *
   * A block with nothing to say is still not drawn. Editable means the text
   * that is there can be changed, not that every sheet grows empty boxes to
   * type into.
   */
  function block(tag, cls, parts, o, key, aria) {
    var html = savedHtml(o, key);
    if (html != null) {
      var written = el(tag, cls);
      written.innerHTML = html;
      return editable(written, o, key, aria);
    }
    return editable(lines(tag, cls, parts), o, key, aria);
  }

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    return n.toFixed(typeof dec === 'number' ? dec : 1);
  }

  function readingRow(list, label, value, dec, o, keyBase) {
    var text = formatReading(value, dec);
    // A reading the investigator has written over keeps its row even when the
    // survey has no number for it any more -- their sheet, their words.
    if (!text && savedHtml(o, keyBase + ':value') == null) return;
    var row = el('div', 'rb-rail__reading');
    row.appendChild(block('dt', 'rb-rail__reading-label', [label], o, keyBase + ':label',
      label + ' label'));
    row.appendChild(block('dd', 'rb-rail__reading-value', [text ? text + ' in' : ''], o,
      keyBase + ':value', label + ' reading'));
    list.appendChild(row);
  }

  function section(label, o, key) {
    var node = el('section', 'rb-rail__section');
    if (label) node.appendChild(block('h3', 'rb-rail__label', [label], o, key, 'Section heading'));
    return node;
  }

  /** The note the investigator writes, which only this person can write.
   *  Tim: "For the times the information is sparse, like pictures, we might
   *  use that to have a little bit of report detail -- most subsequent
   *  damage, pictures 5, 6 and 10." */

  /**
   * North, at the top of the rail.
   *
   * It used to sit on the drawing beside the front-door note. Tim moved it
   * here: it is reference matter like the rest of the rail, and taking it off
   * the plan clears the last floating object from the drawing.
   *
   * Rotation is an SVG transform on the group, the same way Distress Survey's
   * `#northWidgetRot` does it — not a CSS transform. Chrome's print path has
   * dropped CSS rotation on this mark; the SVG attribute always lays out.
   */
  function compass(rotateDeg) {
    var wrap = el('div', 'rb-rail__compass');
    wrap.setAttribute('aria-label', 'North orientation');
    var deg = typeof rotateDeg === 'number' && isFinite(rotateDeg) ? rotateDeg : 0;
    // Distress Survey's arrow, geometry and colours as they are there. Tim:
    // "I like the north arrow that is already in Distress Survey better than
    // what we have. I liked the little colour in it too." The red is the same
    // --accent the pins are drawn in, so the two marks on a Toolbox drawing
    // belong to each other.
    //
    // The whole instrument turns, the N with it, exactly as the widget in
    // Distress does: there the N sits at the foot of the dial inside the
    // rotating group.
    wrap.insertAdjacentHTML('beforeend',
      '<svg class="rb-rail__rose" viewBox="-30 -30 60 60" aria-hidden="true"' +
      ' focusable="false">' +
      '<g class="rb-rail__rose-rot" transform="rotate(' + deg + ')">' +
      '<circle cx="0" cy="0" r="26" fill="#fffaf0" stroke="#1a1a1a"' +
      ' stroke-width="1.5"/>' +
      '<path d="M 0 -22 L 11 14 L 0 5 L -11 14 Z" fill="#c14a2b"/>' +
      '<text x="0" y="20" fill="#1a1a1a" font-size="11" font-weight="700"' +
      ' text-anchor="middle" dominant-baseline="central"' +
      ' font-family="Georgia, \'Times New Roman\', serif">N</text>' +
      '</g>' +
      '</svg>');
    return wrap;
  }

  /**
   * Build the rail.
   *
   * Every section is optional: a page with no readings simply has no readings
   * section, rather than an empty heading. That is what lets one rail serve a
   * Floor Survey sheet, a Picture Locations sheet and a Pictures sheet.
   */
  function render(opts) {
    var o = opts || {};
    var root = el('aside', 'rb-rail__rail');
    root.setAttribute('aria-label', 'Drawing information');
    root.setAttribute('data-rb-rail', '1');
    var deg = typeof o.northRotation === 'number' && isFinite(o.northRotation)
      ? o.northRotation
      : 0;
    // Kept for live drag preview; print reads the SVG transform on the group.
    root.style.setProperty('--rb-north-rotation', deg + 'deg');

    var body = el('div', 'rb-rail__body');
    if (o.north !== false) body.appendChild(compass(deg));

    var head = document.createElement('header');
    var client = block('h2', 'rb-rail__client', clientLines(o.residence), o, 'client',
      'Client name');
    if (client) head.appendChild(client);
    var addr = block('address', 'rb-rail__address', [o.address, o.addressCity], o, 'address',
      'Property address');
    if (addr) head.appendChild(addr);
    if (head.childNodes.length) body.appendChild(head);

    var titleEl = block('p', 'rb-rail__title', String(o.title || '').split('\n'), o, 'title',
      'Drawing title');
    if (titleEl) {
      var titleSection = section('Drawing title', o, 'head:title');
      titleSection.appendChild(titleEl);
      body.appendChild(titleSection);
    }

    var dateEl = block('p', 'rb-rail__date', [o.surveyDate], o, 'date', 'Survey date');
    var correctedEl = block('p', 'rb-rail__note', [o.correctedNote], o, 'corrected',
      'Note under the survey date');
    if (dateEl || correctedEl) {
      var dateSection = section('Survey date', o, 'head:date');
      if (dateEl) dateSection.appendChild(dateEl);
      if (correctedEl) dateSection.appendChild(correctedEl);
      body.appendChild(dateSection);
    }

    var stats = Array.isArray(o.stats) ? o.stats.filter(Boolean) : [];
    if (stats.length) {
      var readings = section('Relative readings', o, 'head:readings');
      stats.forEach(function (item, index) {
        // Keyed by the boundary itself, so a surface renamed or re-measured
        // in Floor Survey keeps the words written about it, and a second
        // boundary added later cannot inherit the first one's.
        var keyBase = 'lvl:' + (item.areaId || ('#' + index));
        var level = el('div', 'rb-rail__level');
        var nameEl = block('h4', 'rb-rail__level-name', [item.name], o, keyBase + ':name',
          'Boundary name');
        if (nameEl) level.appendChild(nameEl);
        var list = el('dl', 'rb-rail__readings');
        var dec = item.decimalPlaces;
        readingRow(list, 'High', item.hi, dec, o, keyBase + ':hi');
        readingRow(list, 'Low', item.lo, dec, o, keyBase + ':lo');
        readingRow(list, 'Difference', item.delta, dec, o, keyBase + ':delta');
        if (list.childNodes.length) level.appendChild(list);
        readings.appendChild(level);
      });
      body.appendChild(readings);
    }

    // A line the investigator writes, for pages whose rail would otherwise be
    // mostly empty. Tim: "For the times the information is sparse, like
    // pictures, we might use that to have a little bit of report detail --
    // most subsequent damage, pictures 5, 6 and 10." It is his sentence, not
    // a generated one, so nothing is written here that he did not write.
    if (o.note || o.noteEditable) {
      var noteSection = section(o.note ? (o.noteLabel || 'Notes') : '', o, 'head:notes');
      var noteEl = el('div', 'rb-rail__note rb-rail__note--body');
      if (o.noteEditable) {
        // The same kind of field as the report's other writing, so the
        // formatting controls in the top rail work on it without a second
        // set of anything.
        noteEl.className += ' rb-rt';
        noteEl.setAttribute('contenteditable', 'true');
        noteEl.setAttribute('spellcheck', 'true');
        noteEl.setAttribute('role', 'textbox');
        noteEl.setAttribute('data-rb-rail-note', '1');
        noteEl.setAttribute('data-rb-rich', 'rail-note');
        noteEl.setAttribute('aria-label', 'Report note for this figure');
      }
      var api = window.ToolboxReportText;
      noteEl.innerHTML = api && typeof api.toHtml === 'function'
        ? api.toHtml(o.note || '')
        : '';
      noteSection.appendChild(noteEl);
      noteSection.setAttribute('data-rb-rail-note-section', '1');
      body.appendChild(noteSection);
    }

    root.appendChild(body);

    var foot = el('footer', 'rb-rail__foot');
    var figureEl = block('p', 'rb-rail__figure', [String(o.figureLabel || '').toUpperCase()], o,
      'figure', 'Figure number');
    if (figureEl) foot.appendChild(figureEl);
    if (o.markSrc) {
      var img = document.createElement('img');
      img.className = 'rb-rail__logo';
      img.src = o.markSrc;
      img.alt = 'Sandia GEO';
      foot.appendChild(img);
    }
    root.appendChild(foot);

    return root;
  }

  window.ToolboxReportRail = {
    render: render,
    compass: compass,
  };
})();
