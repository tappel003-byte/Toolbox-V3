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

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    return n.toFixed(typeof dec === 'number' ? dec : 1);
  }

  function readingRow(list, label, value, dec) {
    var text = formatReading(value, dec);
    if (!text) return;
    var row = el('div', 'rb-rail__reading');
    row.appendChild(el('dt', 'rb-rail__reading-label', label));
    row.appendChild(el('dd', 'rb-rail__reading-value', text + ' in'));
    list.appendChild(row);
  }

  function section(label) {
    var node = el('section', 'rb-rail__section');
    if (label) node.appendChild(el('h3', 'rb-rail__label', label));
    return node;
  }

  /**
   * North, at the top of the rail.
   *
   * It used to sit on the drawing beside the front-door note. Tim moved it
   * here: it is reference matter like the rest of the rail, and taking it off
   * the plan clears the last floating object from the drawing. Only the rose
   * turns — the N is a label on the sheet, not part of the instrument —
   * because north is not always up.
   */
  function compass() {
    var wrap = el('div', 'rb-rail__compass');
    wrap.setAttribute('aria-label', 'North orientation');
    var n = el('span', 'rb-rail__north', 'N');
    n.setAttribute('aria-hidden', 'true');
    wrap.appendChild(n);
    wrap.insertAdjacentHTML('beforeend',
      '<svg class="rb-rail__rose" viewBox="0 0 100 100" aria-hidden="true"' +
      ' focusable="false">' +
      '<circle cx="50" cy="50" r="46" fill="white" stroke="#1a1a1a"' +
      ' stroke-width="1.3"/>' +
      '<path d="M50 14 L35 77 L50 66 Z" fill="#1a1a1a" stroke="#1a1a1a"' +
      ' stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M50 14 L65 77 L50 66 Z" fill="white" stroke="#1a1a1a"' +
      ' stroke-width="1.3" stroke-linejoin="round"/>' +
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
    root.style.setProperty('--rb-north-rotation', deg + 'deg');

    var body = el('div', 'rb-rail__body');
    if (o.north !== false) body.appendChild(compass());

    var head = document.createElement('header');
    var client = lines('h2', 'rb-rail__client', clientLines(o.residence));
    if (client) head.appendChild(client);
    var addr = lines('address', 'rb-rail__address', [o.address, o.addressCity]);
    if (addr) head.appendChild(addr);
    if (head.childNodes.length) body.appendChild(head);

    if (o.title) {
      var titleSection = section('Drawing title');
      titleSection.appendChild(lines('p', 'rb-rail__title', String(o.title).split('\n')));
      body.appendChild(titleSection);
    }

    if (o.surveyDate || o.correctedNote) {
      var dateSection = section('Survey date');
      if (o.surveyDate) dateSection.appendChild(el('p', 'rb-rail__date', o.surveyDate));
      if (o.correctedNote) dateSection.appendChild(el('p', 'rb-rail__note', o.correctedNote));
      body.appendChild(dateSection);
    }

    var stats = Array.isArray(o.stats) ? o.stats.filter(Boolean) : [];
    if (stats.length) {
      var readings = section('Relative readings');
      stats.forEach(function (item) {
        var level = el('div', 'rb-rail__level');
        if (item.name) level.appendChild(el('h4', 'rb-rail__level-name', item.name));
        var list = el('dl', 'rb-rail__readings');
        var dec = item.decimalPlaces;
        readingRow(list, 'High', item.hi, dec);
        readingRow(list, 'Low', item.lo, dec);
        readingRow(list, 'Difference', item.delta, dec);
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
    if (o.note) {
      var noteSection = section(o.noteLabel || 'Notes');
      noteSection.appendChild(el('p', 'rb-rail__note', o.note));
      body.appendChild(noteSection);
    }

    root.appendChild(body);

    var foot = el('footer', 'rb-rail__foot');
    if (o.figureLabel) {
      foot.appendChild(el('p', 'rb-rail__figure', String(o.figureLabel).toUpperCase()));
    }
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
