// Toolbox — Report Builder discussion page.
//
// Measured from the four shipped decks, which agree to the hundredth of a
// percent on this page: two text columns at 1.96% / 51.87%, both 3.03% down
// and 44.7% wide, 12 pt, with the brand mark at 3.59% / 93.49%. Only the
// column HEIGHT differs between jobs, and that is just the box growing to fit
// what was written.
//
// This is the one page whose content does not come from Toolbox. The
// investigator assembles the evidence, hands it to an AI collaborator, and
// brings the narrative back — so the columns are rich text and markdown
// pasted into them arrives already formatted.
//
// Toolbox seeds only what it already knows: the survey date, the address and
// the orientation. It never writes findings, conclusions, or anything about
// cause. VISION §2 keeps observation and interpretation distinguishable, and
// §13 is explicit that this product does not manufacture professional
// judgement on the investigator's behalf.

(function () {
  'use strict';

  var PT = 100 / 792; // 1 pt as a share of the 11 in page height
  var BODY_PT = 12;

  var FRAME = { x: 0.98, y: 1.52, w: 98.04, h: 97.73 };

  // The decks use two separate boxes at 1.96% and 51.87%, each 44.7% wide.
  // One box spanning both, with a gutter of the gap between them, gives
  // columns of exactly those widths -- and lets a single paste flow down the
  // left and continue into the right instead of being split by hand.
  //   1.96 .. (51.87 + 44.7) = 94.61% wide
  //   gutter = 51.87 - (1.96 + 44.7) = 5.21%
  var BODY = { x: 1.96, y: 3.03, w: 94.61, gutter: 5.21 };
  // The logo artwork is 6.87:1 once its white space is trimmed off; the file
  // in the decks carries 27% horizontal and 62% vertical padding, which is
  // why it looked small inside its box and stretched in the decks.
  // Default to the deck's width and baseline at the artwork's true
  // proportion: height = 15.49 x (17/11) / 6.87 = 3.48%, bottom at 97.84%.
  // From here it is moved, resized and locked like any other element.
  var BRAND = { x: 3.59, y: 94.36, w: 15.49, h: 3.48 };
  var BODY_BOTTOM = 93.49; // text stops above the brand mark

  function bodyStyle() {
    return 'left:' + BODY.x + '%;top:' + BODY.y + '%;width:' + BODY.w + '%;' +
      // cqw, not %: a percentage column-gap resolves against a box that is not
      // the page, which collapsed the gutter to 0.43% of the sheet. cqw is a
      // share of the sheet itself, so the two columns come out at the deck's
      // 44.7% each.
      'height:' + (BODY_BOTTOM - BODY.y) + '%;column-gap:' + BODY.gutter + 'cqw;';
  }

  // Heading + value on one line, as the decks set them: the label bold, the
  // value not. Only facts the Customer File already holds.
  function seedLine(label, value) {
    var runs = [];
    if (label) runs.push({ text: label, bold: true });
    if (value) runs.push({ text: (label ? ' ' : '') + value });
    return { align: 'left', bullet: false, indent: 0, dir: 'ltr', runs: runs };
  }

  function seedBody(facts) {
    var f = facts || {};
    var paragraphs = [];
    paragraphs.push(seedLine('Floor Level Survey Results', ''));
    if (f.surveyDate) paragraphs.push(seedLine('Survey Date:', f.surveyDate));
    if (f.street) paragraphs.push(seedLine('', f.street));
    if (f.cityLine) paragraphs.push(seedLine('', f.cityLine));
    if (f.frontDoor) paragraphs.push(seedLine('Orientation:', 'Front door facing ' + f.frontDoor));
    paragraphs.push(seedLine('', ''));
    return { paragraphs: paragraphs };
  }

  // The logo starts where the decks put it and at the artwork's own
  // proportion; from there the investigator places it and locks it, and the
  // placement carries to every discussion sheet in the book.
  function normalizeBrandBox(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    function clamp(n, lo, hi, fb) {
      var v = typeof n === 'number' && isFinite(n) ? n : fb;
      return Math.max(lo, Math.min(hi, v));
    }
    return {
      x: clamp(src.x, 0, 95, BRAND.x),
      y: clamp(src.y, 0, 97, BRAND.y),
      w: clamp(src.w, 4, 60, BRAND.w),
      h: clamp(src.h, 2, 30, BRAND.h),
      locked: !!src.locked,
    };
  }

  function renderPage(page, options) {
    var opts = options || {};
    var locked = !!opts.locked;
    var text = (page && page.reportText) || {};

    var root = document.createElement('div');
    root.className = 'rb-discussion' + (locked ? ' is-locked' : '');

    var frame = document.createElement('div');
    frame.className = 'rb-discussion__frame';
    frame.style.cssText = 'left:' + FRAME.x + '%;top:' + FRAME.y + '%;' +
      'width:' + FRAME.w + '%;height:' + FRAME.h + '%;';
    frame.setAttribute('aria-hidden', 'true');
    root.appendChild(frame);

    var body = document.createElement('div');
    body.className = 'rb-discussion__body rb-rt';
    body.style.cssText = bodyStyle();
    body.setAttribute('data-rb-section-field', 'body');
    body.setAttribute('data-rb-rich', 'discussion:body');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Discussion');
    if (!locked) {
      body.setAttribute('contenteditable', 'true');
      body.setAttribute('spellcheck', 'true');
    }
    var api = window.ToolboxReportText;
    // Pages written before this was one flowing box kept two columns; join
    // them in order so nothing already typed is lost.
    var value = text.body;
    if (value == null && (text.left != null || text.right != null) && api) {
      var joined = api.normalize(text.left || '').paragraphs
        .concat(api.normalize(text.right || '').paragraphs);
      value = { paragraphs: joined };
    }
    if (value == null && opts.facts) value = seedBody(opts.facts);
    body.innerHTML = api ? api.toHtml(value) : '';
    root.appendChild(body);

    // The decks carry the real SANDIA GEO logo here as an image. Toolbox does
    // not have that file, and the stand-in it was drawing -- a styled span
    // plus the words -- is not the mark. Nothing is better than a wrong logo
    // on a deliverable, so the slot stays empty until the artwork is in.
    if (opts.brandImageUrl) {
      var box = normalizeBrandBox(opts.brandBox);
      var brand = document.createElement('div');
      brand.className = 'rb-discussion__brand' + (box.locked ? ' is-locked' : '');
      brand.setAttribute('data-rb-brand-box', '1');
      brand.style.cssText = 'left:' + box.x + '%;top:' + box.y + '%;' +
        'width:' + box.w + '%;height:' + box.h + '%;';
      var img = document.createElement('img');
      img.src = opts.brandImageUrl;
      img.alt = '';
      brand.appendChild(img);
      if (!box.locked) {
        // The logo is dragged by the logo, the way a picture is moved in
        // PowerPoint. Requiring a small corner handle meant grabbing the
        // image itself did nothing, which reads as broken.
        brand.setAttribute('title', 'Drag to move. Resize from the corner.');
        var grip = document.createElement('span');
        grip.className = 'rb-discussion__brand-resize';
        grip.setAttribute('data-rb-brand-resize', '1');
        brand.appendChild(grip);
      }
      root.appendChild(brand);

      var lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'rb-discussion__brand-lock';
      lock.setAttribute('data-rb-brand-lock', box.locked ? 'unlock' : 'lock');
      lock.textContent = box.locked ? 'Unlock logo' : 'Lock logo';
      root.appendChild(lock);
    }

    // A fixed-height multicol box does not stop at two columns: it keeps
    // making more off to the side, and contenteditable scrolls sideways to
    // follow the caret, which is how a long narrative turned into clipped
    // text running off both edges. The overflow is reported instead of being
    // silently browsable.
    var warn = document.createElement('p');
    warn.className = 'rb-discussion__overflow';
    warn.setAttribute('data-rb-discussion-overflow', '1');
    warn.hidden = true;
    // Continuing is automatic -- the chain re-flows whenever the room changes
    // -- so this only speaks up if something still will not fit after that.
    warn.textContent = 'Some of this text does not fit on the page.';
    root.appendChild(warn);

    return root;
  }

  window.ToolboxReportDiscussion = {
    renderPage: renderPage,
    normalizeBrandBox: normalizeBrandBox,
    BRAND: BRAND,
    seedBody: seedBody,
    BODY_PT: BODY_PT,
    PT: PT,
    BODY: BODY,
  };
})();
