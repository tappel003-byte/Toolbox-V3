// Toolbox — the figure rail.
//
// A narrow column down the right-hand edge of a figure page carrying
// everything about the sheet that is not the drawing: which property, what
// the drawing is, when the survey was done, the relative readings, the figure
// number and the mark.
//
// It replaces chrome that used to be scattered into the four corners — the
// address block upper right, the readings box lower right, the logo floating
// lower left — and the machinery that went with it: a movable, lockable logo
// box, and a title block that needed a button to swap corners when the plan
// grew into one. There are no corners to compete for any more, so none of
// that has to exist.
//
// Tim, on seeing it: "This makes it look a lot more technical and
// professional... it fits for every single page. It opens up the canvas."
// And on how loud it may be: "It's not about us. It's about the customer."
// So the rail is reference matter. The residence is the largest thing in it
// and is still modest; everything else is quieter; nothing in it should pull
// the eye off the drawing.
//
// Width and alignment are settled: about a tenth of the sheet, every line
// right-aligned. Nine per cent was tried and breaks the drawing title into a
// column of single words.
(function () {
  'use strict';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  function rule(parent) {
    parent.appendChild(el('div', 'rb-rail__rule'));
  }

  function section(parent, label) {
    rule(parent);
    if (label) parent.appendChild(el('p', 'rb-rail__label', label));
  }

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    return n.toFixed(typeof dec === 'number' ? dec : 2);
  }

  function readingRow(parent, label, value, dec) {
    var text = formatReading(value, dec);
    if (!text) return;
    var row = el('div', 'rb-rail__row');
    row.appendChild(el('span', 'rb-rail__row-label', label));
    row.appendChild(el('b', null, text + ' in'));
    parent.appendChild(row);
  }

  /**
   * North, at the top of the rail.
   *
   * It used to sit on the drawing beside the front-door note. Tim moved it
   * here: it is reference matter like the rest of the rail, and taking it off
   * the plan clears the last floating object from the drawing. The rotation
   * is kept because north is not always up.
   */
  function northArrow(rotationDeg) {
    var wrap = el('div', 'rb-rail__north');
    wrap.setAttribute('aria-hidden', 'true');
    var deg = typeof rotationDeg === 'number' && isFinite(rotationDeg) ? rotationDeg : 0;
    wrap.style.setProperty('--rb-north-rotation', deg + 'deg');
    wrap.innerHTML =
      '<svg viewBox="0 0 40 52" focusable="false">' +
      '<polygon points="20,2 28,22 20,18 12,22" fill="#111"/>' +
      '<polygon points="20,50 28,30 20,34 12,30" fill="#bbb"/>' +
      '<text x="20" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#111">N</text>' +
      '</svg>';
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
    var root = el('aside', 'rb-rail');
    root.setAttribute('data-rb-rail', '1');

    root.appendChild(northArrow(o.northRotation));

    var id = el('div', 'rb-rail__id');
    if (o.residence) id.appendChild(el('p', 'rb-rail__name', o.residence));
    if (o.address) id.appendChild(el('p', 'rb-rail__addr', o.address));
    if (o.addressCity) id.appendChild(el('p', 'rb-rail__addr', o.addressCity));
    if (id.childNodes.length) root.appendChild(id);

    if (o.title) {
      section(root, 'Drawing title');
      root.appendChild(el('p', 'rb-rail__title', o.title));
    }

    if (o.surveyDate || o.correctedNote) {
      section(root, 'Survey date');
      if (o.surveyDate) root.appendChild(el('p', 'rb-rail__date', o.surveyDate));
      if (o.correctedNote) root.appendChild(el('p', 'rb-rail__note', o.correctedNote));
    }

    var stats = Array.isArray(o.stats) ? o.stats.filter(Boolean) : [];
    if (stats.length) {
      section(root, 'Relative readings');
      stats.forEach(function (item) {
        if (item.name) root.appendChild(el('p', 'rb-rail__level', item.name));
        var dec = item.decimalPlaces;
        readingRow(root, 'High', item.hi, dec);
        readingRow(root, 'Low', item.lo, dec);
        readingRow(root, 'Difference', item.delta, dec);
      });
    }

    // A line the investigator writes, for pages whose rail would otherwise be
    // mostly empty. Tim: "For the times the information is sparse, like
    // pictures, we might use that to have a little bit of report detail --
    // most subsequent damage, pictures 5, 6 and 10." It is his sentence, not
    // a generated one, so nothing is written here that he did not write.
    if (o.note) {
      section(root, o.noteLabel || 'Notes');
      root.appendChild(el('p', 'rb-rail__text', o.note));
    }

    // The foot is pushed down by the sections above it, so the figure number
    // and the mark sit on the bottom edge however much is in the rail.
    var foot = el('div', 'rb-rail__foot');
    if (o.figureLabel) foot.appendChild(el('p', 'rb-rail__figure', o.figureLabel));
    if (o.markSrc) {
      var mark = el('div', 'rb-rail__mark');
      var img = document.createElement('img');
      img.src = o.markSrc;
      img.alt = '';
      mark.appendChild(img);
      foot.appendChild(mark);
    }
    if (foot.childNodes.length) root.appendChild(foot);

    return root;
  }

  window.ToolboxReportRail = {
    render: render,
    northArrow: northArrow,
  };
})();
