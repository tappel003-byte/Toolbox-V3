// Toolbox — Report Builder rich text.
//
// Report-owned wording (cover fields, discussion, notes) is stored the way
// PowerPoint already stores the decks this product reproduces: a list of
// paragraphs, each carrying its own alignment / bullet / indent / direction,
// each holding runs of text that carry their own marks. That is literally
// what a .pptx text box is -- <a:p> with <a:pPr>, containing <a:r> with
// <a:rPr sz="1300" b="1">. Storing it this way means the investigator writes
// exactly as they do in PowerPoint, the record stays readable for the life of
// the job, and a later export back to .pptx is a direct mapping rather than a
// conversion.
//
//   {
//     paragraphs: [
//       { align: 'left', bullet: false, indent: 0, dir: 'ltr',
//         runs: [ { text: '59 Lodge Trail', bold: true, size: 60 } ] }
//     ]
//   }
//
// Sizes are POINTS, as in the decks. The sheet renders them as cqh so a page
// stays proportional at any size: 11 in = 792 pt, so 1 pt = 0.126263 cqh.
// Defaults are omitted when storing, so an unformatted paragraph stays small.
//
// A plain string is always accepted and upgraded, so pages saved before rich
// text keep working and nothing has to be migrated.

(function () {
  'use strict';

  var PT_TO_CQH = 100 / 792;
  var ALIGNMENTS = { left: 1, center: 1, right: 1, justify: 1 };
  var MAX_INDENT = 8;

  function isObject(v) { return !!v && typeof v === 'object'; }

  function cleanText(value) {
    // A non-breaking space is what contenteditable leaves behind for an
    // ordinary space at the end of a line; store the ordinary one.
    return String(value == null ? '' : value).replace(/ /g, ' ');
  }

  function blankParagraph() {
    return { align: 'left', bullet: false, indent: 0, dir: 'ltr', runs: [] };
  }

  function normalizeRun(raw) {
    if (!isObject(raw)) return null;
    var text = cleanText(raw.text);
    if (!text) return null;
    var run = { text: text };
    // Bold and italic are TRI-STATE: true, explicitly false, or absent
    // (inherit the field's styled default). A field such as the street is
    // bold from the stylesheet, so switching bold off has to be recorded as
    // false -- an absent mark would re-render it bold on the next open.
    if (raw.bold === true) run.bold = true;
    else if (raw.bold === false) run.bold = false;
    if (raw.italic === true) run.italic = true;
    else if (raw.italic === false) run.italic = false;
    if (raw.underline) run.underline = true;
    var size = parseFloat(raw.size);
    if (isFinite(size) && size > 0) run.size = Math.round(size * 10) / 10;
    if (raw.font) run.font = String(raw.font);
    return run;
  }

  function normalizeParagraph(raw) {
    var src = isObject(raw) ? raw : {};
    var para = blankParagraph();
    if (ALIGNMENTS[src.align]) para.align = src.align;
    para.bullet = !!src.bullet;
    var indent = parseInt(src.indent, 10);
    para.indent = isFinite(indent) ? Math.max(0, Math.min(MAX_INDENT, indent)) : 0;
    para.dir = src.dir === 'rtl' ? 'rtl' : 'ltr';
    var runs = Array.isArray(src.runs) ? src.runs : [];
    runs.forEach(function (r) {
      var run = normalizeRun(r);
      if (run) para.runs.push(run);
    });
    return para;
  }

  function isModel(value) {
    return isObject(value) && Array.isArray(value.paragraphs);
  }

  // Accepts a model, a plain string, or nothing.
  function normalize(value) {
    if (isModel(value)) {
      var model = { paragraphs: value.paragraphs.map(normalizeParagraph) };
      if (!model.paragraphs.length) model.paragraphs.push(blankParagraph());
      return model;
    }
    var text = cleanText(value);
    var lines = text.split(/\r?\n/);
    var out = { paragraphs: [] };
    lines.forEach(function (line) {
      var para = blankParagraph();
      if (line) para.runs.push({ text: line });
      out.paragraphs.push(para);
    });
    if (!out.paragraphs.length) out.paragraphs.push(blankParagraph());
    return out;
  }

  // Drop defaults so a plain paragraph stores as {runs:[{text:'...'}]}.
  function compact(model) {
    var src = normalize(model);
    return {
      paragraphs: src.paragraphs.map(function (p) {
        var out = {};
        if (p.align !== 'left') out.align = p.align;
        if (p.bullet) out.bullet = true;
        if (p.indent) out.indent = p.indent;
        if (p.dir === 'rtl') out.dir = 'rtl';
        out.runs = p.runs.map(function (r) {
          var run = { text: r.text };
          if (r.bold === true) run.bold = true;
          else if (r.bold === false) run.bold = false;
          if (r.italic === true) run.italic = true;
          else if (r.italic === false) run.italic = false;
          if (r.underline) run.underline = true;
          if (r.size) run.size = r.size;
          if (r.font) run.font = r.font;
          return run;
        });
        return out;
      }),
    };
  }

  function toPlain(model) {
    return normalize(model).paragraphs.map(function (p) {
      return p.runs.map(function (r) { return r.text; }).join('');
    }).join('\n');
  }

  function isEmpty(model) {
    return !toPlain(model).trim();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function runHtml(run) {
    var style = '';
    if (run.size) style += 'font-size:' + (run.size * PT_TO_CQH).toFixed(3) + 'cqh;';
    if (run.font) style += "font-family:'" + run.font.replace(/'/g, '') + "';";
    var text = escapeHtml(run.text).replace(/ {2}/g, ' &nbsp;');
    if (run.bold === false) style += 'font-weight:normal;';
    if (run.italic === false) style += 'font-style:normal;';
    var html = text;
    if (run.underline) html = '<u>' + html + '</u>';
    if (run.italic === true) html = '<em>' + html + '</em>';
    if (run.bold === true) html = '<strong>' + html + '</strong>';
    if (style) html = '<span style="' + style + '">' + html + '</span>';
    return html;
  }

  function paragraphHtml(para) {
    var style = '';
    if (para.align !== 'left') style += 'text-align:' + para.align + ';';
    if (para.indent) style += 'margin-left:' + (para.indent * 4) + '%;';
    if (para.dir === 'rtl') style += 'direction:rtl;';
    var inner = para.runs.map(runHtml).join('');
    if (!inner) inner = '<br>';
    var tag = para.bullet ? 'li' : 'div';
    return '<' + tag + (style ? ' style="' + style + '"' : '') +
      ' class="rb-rt__p' + (para.bullet ? ' rb-rt__p--bullet' : '') + '">' + inner + '</' + tag + '>';
  }

  // Consecutive bullets share one <ul> so browsers treat them as a real list.
  function toHtml(model) {
    var paras = normalize(model).paragraphs;
    var out = [];
    var i = 0;
    while (i < paras.length) {
      if (!paras[i].bullet) {
        out.push(paragraphHtml(paras[i]));
        i += 1;
        continue;
      }
      var items = [];
      while (i < paras.length && paras[i].bullet) {
        items.push(paragraphHtml(paras[i]));
        i += 1;
      }
      out.push('<ul class="rb-rt__list">' + items.join('') + '</ul>');
    }
    return out.join('');
  }

  // ---- DOM -> model ---------------------------------------------------
  //
  // The editing surface is contenteditable, so the browser produces whatever
  // markup it likes (div per line, nested b/i/u, font tags, pasted spans).
  // This reads that back into the model rather than storing it, which is what
  // keeps the saved report clean no matter what was pasted into it.

  var BLOCK_TAGS = { DIV: 1, P: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1 };

  function styleSize(el) {
    var raw = el.style && el.style.fontSize;
    if (!raw) return null;
    var n = parseFloat(raw);
    if (!isFinite(n)) return null;
    if (/cqh$/.test(raw)) return Math.round((n / PT_TO_CQH) * 10) / 10;
    if (/pt$/.test(raw)) return Math.round(n * 10) / 10;
    if (/px$/.test(raw)) return Math.round((n * 0.75) * 10) / 10;
    return null;
  }

  function styleFont(el) {
    var raw = el.style && el.style.fontFamily;
    if (!raw) return null;
    return raw.split(',')[0].replace(/["']/g, '').trim() || null;
  }

  // An inline style can turn a mark ON or explicitly OFF; anything else leaves
  // whatever the enclosing context had.
  function markState(inherited, tagSaysOn, styleValue, kind) {
    if (tagSaysOn) return true;
    var v = String(styleValue || '').trim();
    if (!v) return inherited;
    if (kind === 'bold') {
      var n = parseInt(v, 10);
      if (v === 'bold' || v === 'bolder' || (isFinite(n) && n >= 600)) return true;
      if (v === 'normal' || v === 'lighter' || (isFinite(n) && n < 600)) return false;
      return inherited;
    }
    if (v === 'italic' || v === 'oblique') return true;
    if (v === 'normal') return false;
    return inherited;
  }

  function fromElement(root) {
    var model = { paragraphs: [] };
    var current = null;

    function startParagraph(source) {
      current = blankParagraph();
      if (source && source.nodeType === 1) {
        var align = source.style && source.style.textAlign;
        if (ALIGNMENTS[align]) current.align = align;
        if (source.tagName === 'LI') current.bullet = true;
        if (source.style && source.style.direction === 'rtl') current.dir = 'rtl';
        var ml = source.style && source.style.marginLeft;
        if (ml && /%$/.test(ml)) {
          var pct = parseFloat(ml);
          if (isFinite(pct)) current.indent = Math.max(0, Math.min(MAX_INDENT, Math.round(pct / 4)));
        }
      }
      model.paragraphs.push(current);
      return current;
    }

    function push(text, ctx) {
      if (!text) return;
      if (!current) startParagraph(null);
      var run = { text: text };
      if (ctx.bold === true) run.bold = true;
      else if (ctx.bold === false) run.bold = false;
      if (ctx.italic === true) run.italic = true;
      else if (ctx.italic === false) run.italic = false;
      if (ctx.underline) run.underline = true;
      if (ctx.size) run.size = ctx.size;
      if (ctx.font) run.font = ctx.font;
      var last = current.runs[current.runs.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic &&
          !!last.underline === !!run.underline && last.size === run.size && last.font === run.font) {
        last.text += run.text;
        return;
      }
      current.runs.push(run);
    }

    function walk(node, ctx) {
      for (var i = 0; i < node.childNodes.length; i += 1) {
        var child = node.childNodes[i];
        if (child.nodeType === 3) {
          push(cleanText(child.nodeValue), ctx);
          continue;
        }
        if (child.nodeType !== 1) continue;
        var tag = child.tagName;
        if (tag === 'BR') {
          startParagraph(null);
          continue;
        }
        if (tag === 'UL' || tag === 'OL') {
          walk(child, ctx);
          continue;
        }
        if (BLOCK_TAGS[tag]) {
          startParagraph(child);
          walk(child, ctx);
          continue;
        }
        var next = {
          bold: markState(ctx.bold, tag === 'B' || tag === 'STRONG',
            child.style && child.style.fontWeight, 'bold'),
          italic: markState(ctx.italic, tag === 'I' || tag === 'EM',
            child.style && child.style.fontStyle, 'italic'),
          underline: ctx.underline || tag === 'U' ||
            (child.style && /underline/.test(child.style.textDecoration || '')),
          size: styleSize(child) || ctx.size,
          font: styleFont(child) || ctx.font,
        };
        walk(child, next);
      }
    }

    walk(root, { bold: null, italic: null, underline: false, size: null, font: null });
    if (!model.paragraphs.length) model.paragraphs.push(blankParagraph());
    // contenteditable leaves a trailing empty block behind constantly.
    while (model.paragraphs.length > 1) {
      var last = model.paragraphs[model.paragraphs.length - 1];
      if (last.runs.length) break;
      model.paragraphs.pop();
    }
    return model;
  }

  // ---- Markdown in --------------------------------------------------------
  //
  // The investigator's narrative comes back from an AI collaborator as
  // markdown. Parsing it on paste means that structure arrives formatted
  // instead of being retyped by hand.

  function inlineRuns(text, base) {
    var runs = [];
    var rest = String(text == null ? '' : text);
    var pattern = /(\*\*\*|\*\*|__|\*|_)(.+?)\1/;
    while (rest) {
      var m = rest.match(pattern);
      if (!m) {
        if (rest) runs.push(Object.assign({ text: rest }, base));
        break;
      }
      if (m.index > 0) runs.push(Object.assign({ text: rest.slice(0, m.index) }, base));
      var mark = m[1];
      var inner = Object.assign({}, base);
      if (mark === '***') { inner.bold = true; inner.italic = true; }
      else if (mark === '**' || mark === '__') inner.bold = true;
      else inner.italic = true;
      inlineRuns(m[2], inner).forEach(function (r) { runs.push(r); });
      rest = rest.slice(m.index + m[0].length);
    }
    return runs.filter(function (r) { return r.text; });
  }

  function looksLikeMarkdown(text) {
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s)|\*\*[^*]+\*\*|__[^_]+__/.test(String(text || ''));
  }

  function fromMarkdown(text, baseSize) {
    var base = parseFloat(baseSize);
    if (!isFinite(base) || base <= 0) base = 0;
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var model = { paragraphs: [] };
    lines.forEach(function (line) {
      if (!line.trim()) return; // separator, not an empty paragraph
      var para = blankParagraph();
      var body = line;
      var heading = body.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      var bullet = body.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
      var runBase = {};
      if (heading) {
        body = heading[2];
        runBase.bold = true;
        // Only scale when a base size is supplied. The shipped reports set
        // every heading bold at the 12 pt body size, so the discussion page
        // passes no base and headings stay in the body's size.
        if (base) {
          var factor = heading[1].length === 1 ? 1.5 : heading[1].length === 2 ? 1.25 : 1.1;
          runBase.size = Math.round(base * factor * 10) / 10;
        }
      } else if (bullet) {
        body = bullet[2];
        para.bullet = true;
        var lead = line.match(/^(\s*)/)[1].length;
        para.indent = Math.min(MAX_INDENT, Math.floor(lead / 2));
      }
      inlineRuns(body, runBase).forEach(function (r) { para.runs.push(r); });
      model.paragraphs.push(para);
    });
    while (model.paragraphs.length > 1 &&
           !model.paragraphs[model.paragraphs.length - 1].runs.length) {
      model.paragraphs.pop();
    }
    if (!model.paragraphs.length) model.paragraphs.push(blankParagraph());
    return model;
  }

  window.ToolboxReportText = {
    PT_TO_CQH: PT_TO_CQH,
    isModel: isModel,
    normalize: normalize,
    compact: compact,
    toPlain: toPlain,
    isEmpty: isEmpty,
    toHtml: toHtml,
    fromElement: fromElement,
    fromMarkdown: fromMarkdown,
    looksLikeMarkdown: looksLikeMarkdown,
  };
})();
