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
  // The deck places the logo in a 15.49% x 4.35% box, but the artwork fills
  // its canvas at 3.55:1 and that box is 5.48:1 -- so PowerPoint stretches it.
  // Keep the deck's width and baseline and give the box the logo's own
  // proportion instead, so it prints at full size undistorted:
  //   height = 15.49 x (17/11) / 3.55 = 6.74%, bottom at 93.49 + 4.35 = 97.84%
  var BRAND = { x: 3.59, y: 91.10, w: 15.49, h: 6.74 };
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
      var brand = document.createElement('div');
      brand.className = 'rb-discussion__brand';
      brand.style.cssText = 'left:' + BRAND.x + '%;top:' + BRAND.y + '%;' +
        'width:' + BRAND.w + '%;height:' + BRAND.h + '%;';
      var img = document.createElement('img');
      img.src = opts.brandImageUrl;
      img.alt = '';
      brand.appendChild(img);
      root.appendChild(brand);
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
    warn.textContent = 'This narrative is longer than one page holds.';
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'rb-discussion__continue';
    go.setAttribute('data-rb-discussion-continue', '1');
    go.textContent = 'Continue on next page';
    warn.appendChild(go);
    root.appendChild(warn);

    return root;
  }

  window.ToolboxReportDiscussion = {
    renderPage: renderPage,
    seedBody: seedBody,
    BODY_PT: BODY_PT,
    PT: PT,
    BODY: BODY,
  };
})();
