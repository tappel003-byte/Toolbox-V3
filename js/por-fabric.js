// Toolbox — Plan of Repair Fabric.js drawing helpers.
// Vendored Fabric 5.3.0 (MIT). Report Builder / report-overlay.js unchanged.
(function () {
  'use strict';

  var FABRIC_VERSION = '5.3.0';
  var PAPER_W = 1632;
  var PAPER_H = 1056;
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function fabricReady() {
    return typeof window.fabric === 'object' && window.fabric && window.fabric.Canvas;
  }

  function pctToX(p) { return (Number(p) || 0) / 100 * PAPER_W; }
  function pctToY(p) { return (Number(p) || 0) / 100 * PAPER_H; }
  function xToPct(x) { return Math.round((Number(x) || 0) / PAPER_W * 10000) / 100; }
  function yToPct(y) { return Math.round((Number(y) || 0) / PAPER_H * 10000) / 100; }

  function uid(prefix) {
    return (prefix || 'por') + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function strokeWidthFromThick(thick) {
    var t = Number(thick) || 2;
    if (t <= 1) return 1.5;
    if (t >= 3) return 4.5;
    return 3;
  }

  function thickFromStroke(w) {
    var n = Number(w) || 3;
    if (n <= 2) return 1;
    if (n >= 4) return 3;
    return 2;
  }

  function applyCommon(obj, item) {
    obj.set({
      porId: item.id || uid('ov'),
      porKind: item.kind || 'rect',
      porName: item.name || '',
      stroke: HEX.test(String(item.color || '')) ? item.color : '#1d4ed8',
      strokeWidth: strokeWidthFromThick(item.thick),
      fill: item.fill
        ? (HEX.test(String(item.fillColor || '')) ? item.fillColor : (item.color || '#1d4ed8'))
        : 'rgba(0,0,0,0)',
      opacity: item.opacity != null ? Number(item.opacity) : 1,
      angle: Number(item.angle) || 0,
      visible: item.hidden ? false : true,
      selectable: true,
      evented: true,
      objectCaching: false,
    });
    if (item.lockUniScaling) obj.set({ lockUniScaling: true });
    return obj;
  }

  function styleControls(obj) {
    if (!obj) return obj;
    obj.set({
      cornerStyle: 'circle',
      cornerColor: '#2563eb',
      cornerStrokeColor: '#ffffff',
      borderColor: '#2563eb',
      transparentCorners: false,
      cornerSize: 12,
      padding: 4,
      rotatingPointOffset: 28,
    });
    return obj;
  }

  function overlayToObject(item) {
    if (!fabricReady() || !item || !item.kind) return null;
    var f = window.fabric;
    var obj = null;
    if (item.kind === 'path' && Array.isArray(item.points) && item.points.length >= 2) {
      var path = 'M ' + item.points.map(function (p, i) {
        return (i ? 'L ' : '') + pctToX(p[0]) + ' ' + pctToY(p[1]);
      }).join(' ');
      obj = new f.Path(path, { fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' });
      applyCommon(obj, item);
      obj.set({ fill: '' });
    } else if (item.kind === 'rect' || item.kind === 'roundRect') {
      var rx0 = Math.min(item.x0, item.x1); var ry0 = Math.min(item.y0, item.y1);
      var rw = Math.abs(item.x1 - item.x0); var rh = Math.abs(item.y1 - item.y0);
      obj = new f.Rect({
        left: pctToX(rx0),
        top: pctToY(ry0),
        width: Math.max(2, pctToX(rw)),
        height: Math.max(2, pctToY(rh)),
        rx: item.kind === 'roundRect' ? 12 : 0,
        ry: item.kind === 'roundRect' ? 12 : 0,
      });
      applyCommon(obj, item);
    } else if (item.kind === 'circle' || item.kind === 'ellipse') {
      var cx0 = Math.min(item.x0, item.x1); var cy0 = Math.min(item.y0, item.y1);
      var cw = Math.abs(item.x1 - item.x0); var ch = Math.abs(item.y1 - item.y0);
      obj = new f.Ellipse({
        left: pctToX(cx0),
        top: pctToY(cy0),
        rx: Math.max(1, pctToX(cw) / 2),
        ry: Math.max(1, pctToY(ch) / 2),
      });
      applyCommon(obj, item);
    } else if (item.kind === 'triangle') {
      var tx0 = Math.min(item.x0, item.x1); var ty0 = Math.min(item.y0, item.y1);
      var tw = Math.abs(item.x1 - item.x0); var th = Math.abs(item.y1 - item.y0);
      obj = new f.Triangle({
        left: pctToX(tx0),
        top: pctToY(ty0),
        width: Math.max(2, pctToX(tw)),
        height: Math.max(2, pctToY(th)),
      });
      applyCommon(obj, item);
    } else if (item.kind === 'arrow' || item.kind === 'line') {
      var lx0 = pctToX(item.x0); var ly0 = pctToY(item.y0);
      var lx1 = pctToX(item.x1); var ly1 = pctToY(item.y1);
      obj = new f.Line(
        [lx0, ly0, lx1, ly1],
        {
          strokeLineCap: 'round',
          porArrow: item.kind === 'arrow',
          porKind: item.kind === 'arrow' ? 'arrow' : 'line',
        }
      );
      applyCommon(obj, item);
      obj.set({ fill: '', porKind: item.kind === 'arrow' ? 'arrow' : 'line' });
      // Pin the overlay percentages so a no-edit open/close cannot drift.
      obj.porPctEnds = {
        x0: Number(item.x0), y0: Number(item.y0),
        x1: Number(item.x1), y1: Number(item.y1),
      };
      obj.porEnds = { x0: lx0, y0: ly0, x1: lx1, y1: ly1 };
      if (item.kind === 'arrow') decorateArrow(obj);
    } else if (item.kind === 'text' || item.kind === 'ellipse' && item.text != null) {
      // Placed text box (RB-style x,y,w,h) or drawn text.
      var left; var top; var width;
      if (item.x != null) {
        left = pctToX(item.x); top = pctToY(item.y); width = pctToX(item.w || 22);
      } else {
        left = pctToX(Math.min(item.x0, item.x1));
        top = pctToY(Math.min(item.y0, item.y1));
        width = Math.max(40, pctToX(Math.abs((item.x1 || 0) - (item.x0 || 0))));
      }
      var rich = richTextPlainAndBold(item);
      obj = new f.Textbox(String(rich.text || 'Text'), {
        left: left,
        top: top,
        width: Math.max(40, width),
        fontSize: rich.fontSize != null ? rich.fontSize : (Number(item.fontSize) || 18),
        fontFamily: item.fontFamily || 'Calibri, Arial, sans-serif',
        fontWeight: rich.bold ? 'bold' : 'normal',
        fontStyle: rich.italic ? 'italic' : 'normal',
        underline: !!rich.underline,
        linethrough: !!rich.strike,
        textAlign: item.align || 'left',
        fill: HEX.test(String(item.color || '')) ? item.color : '#111111',
        porId: item.id || uid('ov'),
        porKind: 'text',
        objectCaching: false,
      });
      styleControls(obj);
      return obj;
    } else if (item.kind === 'image') {
      // Placeholder geometry; async image fill happens via overlaysToCanvas.
      var ix0 = item.x0 != null ? Math.min(item.x0, item.x1) : (item.x || 10);
      var iy0 = item.y0 != null ? Math.min(item.y0, item.y1) : (item.y || 10);
      var iw = item.x1 != null ? Math.abs(item.x1 - item.x0) : (item.w || 20);
      var ih = item.y1 != null ? Math.abs(item.y1 - item.y0) : (item.h || 15);
      obj = new f.Rect({
        left: pctToX(ix0),
        top: pctToY(iy0),
        width: Math.max(8, pctToX(iw)),
        height: Math.max(8, pctToY(ih)),
        fill: 'rgba(148,163,184,0.25)',
        stroke: '#64748b',
        strokeWidth: 1,
        porId: item.id || uid('ov'),
        porKind: 'image',
        porMediaId: item.mediaId || '',
        porName: item.name || 'Picture',
      });
      return styleControls(obj);
    } else {
      return null;
    }
    return styleControls(obj);
  }

  // Draw a filled arrowhead at the line's end without changing stored geometry.
  function decorateArrow(line) {
    if (!line || line.__porArrowDecorated) return line;
    line.__porArrowDecorated = true;
    line.porArrow = true;
    line.porKind = 'arrow';
    var baseRender = line._render;
    line._render = function (ctx) {
      baseRender.call(this, ctx);
      var x1 = this.x1;
      var y1 = this.y1;
      var x2 = this.x2;
      var y2 = this.y2;
      var angle = Math.atan2(y2 - y1, x2 - x1);
      var head = 10 + (Number(this.strokeWidth) || 2) * 1.8;
      ctx.save();
      ctx.fillStyle = this.stroke || '#1d4ed8';
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - head * Math.cos(angle - Math.PI / 7),
        y2 - head * Math.sin(angle - Math.PI / 7)
      );
      ctx.lineTo(
        x2 - head * Math.cos(angle + Math.PI / 7),
        y2 - head * Math.sin(angle + Math.PI / 7)
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    return line;
  }

  // Absolute top-left + size without stroke padding.
  // getPointByOrigin lifts ActiveSelection/Group-relative left/top into sheet space.
  // Do NOT use getBoundingRect for save — stroke padding drifts marks each open/close.
  function boxFromObject(obj) {
    var w = Math.abs((Number(obj.width) || 0) * (Number(obj.scaleX) || 1));
    var h = Math.abs((Number(obj.height) || 0) * (Number(obj.scaleY) || 1));
    var pt = null;
    try {
      if (typeof obj.getPointByOrigin === 'function') {
        pt = obj.getPointByOrigin('left', 'top');
      }
    } catch (_) { pt = null; }
    if (pt && isFinite(pt.x) && isFinite(pt.y)) {
      return { left: pt.x, top: pt.y, w: w, h: h };
    }
    var left = Number(obj.left) || 0;
    var top = Number(obj.top) || 0;
    if (obj.originX === 'center') left -= w / 2;
    if (obj.originY === 'center') top -= h / 2;
    if (obj.originX === 'right') left -= w;
    if (obj.originY === 'bottom') top -= h;
    return { left: left, top: top, w: w, h: h };
  }

  // Pin line/arrow endpoints in sheet px so open/close cannot drift.
  function captureLineEnds(obj) {
    if (!obj || obj.type !== 'line') return null;
    var lp = typeof obj.calcLinePoints === 'function' ? obj.calcLinePoints() : null;
    if (!lp || !window.fabric || !window.fabric.util) return null;
    var m = obj.calcTransformMatrix();
    var p1 = window.fabric.util.transformPoint({ x: lp.x1, y: lp.y1 }, m);
    var p2 = window.fabric.util.transformPoint({ x: lp.x2, y: lp.y2 }, m);
    obj.porEnds = { x0: p1.x, y0: p1.y, x1: p2.x, y1: p2.y };
    return obj.porEnds;
  }

  function lineEndsPct(obj) {
    // Prefer pinned overlay percentages until the line is actually edited.
    if (obj.porPctEnds && obj.porPctEnds.x0 != null) {
      return {
        x0: Number(obj.porPctEnds.x0),
        y0: Number(obj.porPctEnds.y0),
        x1: Number(obj.porPctEnds.x1),
        y1: Number(obj.porPctEnds.y1),
      };
    }
    var ends = obj.porEnds || captureLineEnds(obj);
    if (!ends) return null;
    return {
      x0: xToPct(ends.x0), y0: yToPct(ends.y0),
      x1: xToPct(ends.x1), y1: yToPct(ends.y1),
    };
  }

  function richTextPlainAndBold(item) {
    var text = item && item.text;
    var bold = !!(item && item.bold);
    var italic = !!(item && item.italic);
    var underline = !!(item && item.underline);
    var strike = !!(item && item.strike);
    var fontSize = item && item.fontSize != null ? Number(item.fontSize) : null;
    if (text && typeof text === 'object') {
      var paras = Array.isArray(text.paragraphs) ? text.paragraphs : [];
      paras.forEach(function (p) {
        (Array.isArray(p && p.runs) ? p.runs : []).forEach(function (r) {
          if (!r) return;
          if (r.bold === true) bold = true;
          if (r.italic === true) italic = true;
          if (r.underline === true) underline = true;
          if (r.strike === true) strike = true;
          if (fontSize == null && r.size != null) fontSize = Number(r.size) || fontSize;
        });
      });
      if (window.ToolboxReportText && typeof window.ToolboxReportText.toPlain === 'function') {
        text = window.ToolboxReportText.toPlain(text);
      } else {
        text = paras.map(function (p) {
          return (Array.isArray(p && p.runs) ? p.runs : []).map(function (r) {
            return (r && r.text) || '';
          }).join('');
        }).join('\n');
      }
    }
    return {
      text: text == null ? '' : String(text),
      bold: bold,
      italic: italic,
      underline: underline,
      strike: strike,
      fontSize: fontSize,
    };
  }

  function styleFromObject(obj, kindHint) {
    var kind = kindHint || obj.porKind || (obj.type === 'textbox' || obj.type === 'i-text' ? 'text' : obj.type);
    var item = {
      id: obj.porId || uid('ov'),
      kind: kind === 'path' ? 'path'
        : kind === 'rect' ? (obj.rx > 0 ? 'roundRect' : 'rect')
        : kind === 'ellipse' || kind === 'circle' ? 'circle'
        : kind === 'triangle' ? 'triangle'
        : kind === 'line' ? (obj.porArrow ? 'arrow' : 'line')
        : kind === 'textbox' || kind === 'i-text' || kind === 'text' ? 'text'
        : (obj.porKind || 'rect'),
      name: obj.porName || '',
      color: (obj.stroke && HEX.test(obj.stroke) ? obj.stroke : null) ||
        (obj.fill && HEX.test(String(obj.fill)) ? obj.fill : '#1d4ed8'),
      thick: thickFromStroke(obj.strokeWidth),
      angle: obj.angle || 0,
      opacity: obj.opacity != null ? obj.opacity : 1,
    };
    if (obj.visible === false) item.hidden = true;
    if (item.kind === 'image' || obj.porKind === 'image') {
      item.kind = 'image';
      item.mediaId = obj.porMediaId || item.mediaId || '';
      var brImg = obj.getBoundingRect(true, true);
      item.x0 = xToPct(brImg.left);
      item.y0 = yToPct(brImg.top);
      item.x1 = xToPct(brImg.left + brImg.width);
      item.y1 = yToPct(brImg.top + brImg.height);
      return item;
    }
    if (obj.fill && obj.fill !== 'rgba(0,0,0,0)' && obj.fill !== '' &&
        item.kind !== 'path' && item.kind !== 'line' && item.kind !== 'arrow' && item.kind !== 'text') {
      item.fill = true;
      if (HEX.test(String(obj.fill))) item.fillColor = obj.fill;
    }
    return item;
  }

  // Group children use coords relative to the group; lift geometry to canvas space.
  function objectToOverlayLifted(child) {
    if (!child) return null;
    if (child.type === 'group' || child.porKind === 'group') return objectToOverlay(child);
    try { child.setCoords(); } catch (_) {}
    var kind = child.porKind || child.type;
    if (child.type === 'line' || kind === 'line' || kind === 'arrow') {
      var itemL = styleFromObject(child, kind === 'arrow' || child.porArrow ? 'arrow' : 'line');
      // Clear pinned pct ends — group transforms mean we must recompute absolute ends.
      child.porPctEnds = null;
      var endsL = lineEndsPct(child);
      if (endsL) {
        itemL.x0 = endsL.x0; itemL.y0 = endsL.y0;
        itemL.x1 = endsL.x1; itemL.y1 = endsL.y1;
        return itemL;
      }
    }
    if (child.type === 'textbox' || child.type === 'i-text' || kind === 'text') {
      var boxT = boxFromObject(child);
      var itemT = styleFromObject(child, 'text');
      itemT.x = xToPct(boxT.left);
      itemT.y = yToPct(boxT.top);
      itemT.w = xToPct(boxT.w);
      itemT.h = yToPct(boxT.h);
      itemT.text = child.text || '';
      itemT.fontSize = child.fontSize || 18;
      itemT.fontFamily = child.fontFamily || 'Calibri, Arial, sans-serif';
      itemT.bold = child.fontWeight === 'bold' || child.fontWeight === 700;
      itemT.italic = child.fontStyle === 'italic';
      itemT.underline = !!child.underline;
      itemT.strike = !!child.linethrough;
      itemT.align = child.textAlign || 'left';
      itemT.color = HEX.test(String(child.fill || '')) ? child.fill : '#111111';
      return itemT;
    }
    var boxB = boxFromObject(child);
    var itemB = styleFromObject(child);
    itemB.x0 = xToPct(boxB.left);
    itemB.y0 = yToPct(boxB.top);
    itemB.x1 = xToPct(boxB.left + boxB.w);
    itemB.y1 = yToPct(boxB.top + boxB.h);
    if (itemB.kind === 'path') {
      itemB.points = [
        [itemB.x0, itemB.y0],
        [itemB.x1, itemB.y1],
      ];
      delete itemB.x0; delete itemB.y0; delete itemB.x1; delete itemB.y1;
    }
    return itemB;
  }

  function objectToOverlay(obj) {
    if (!obj) return null;
    var kind = obj.porKind || (obj.type === 'textbox' || obj.type === 'i-text' ? 'text' : obj.type);
    // Persist Fabric groups (and transient activeSelections) as group overlays.
    // Children store coords relative to the group — lift them to canvas space via
    // getBoundingRect / calcTransformMatrix before writing Plan of Repair overlays.
    if (obj.type === 'group' || obj.type === 'activeSelection' || kind === 'group') {
      var members = [];
      var kids = typeof obj.getObjects === 'function' ? obj.getObjects() : (obj._objects || []);
      kids.forEach(function (child) {
        if (!child) return;
        var lifted = objectToOverlayLifted(child);
        if (lifted) members.push(lifted);
      });
      if (!members.length) return null;
      return {
        id: obj.porId || uid('grp'),
        kind: 'group',
        members: members,
        angle: obj.angle || 0,
      };
    }
    var item = styleFromObject(obj, kind);
    if (item.kind === 'text') {
      var boxTxt = boxFromObject(obj);
      item.x = xToPct(boxTxt.left);
      item.y = yToPct(boxTxt.top);
      item.w = xToPct(boxTxt.w);
      item.h = yToPct(boxTxt.h || ((obj.fontSize || 18) * (obj.scaleY || 1)));
      item.text = obj.text || '';
      item.fontSize = obj.fontSize || 18;
      item.fontFamily = obj.fontFamily || 'Calibri, Arial, sans-serif';
      item.bold = obj.fontWeight === 'bold' || obj.fontWeight === 700;
      item.italic = obj.fontStyle === 'italic';
      item.underline = !!obj.underline;
      item.strike = !!obj.linethrough;
      item.align = obj.textAlign || 'left';
      item.color = HEX.test(String(obj.fill || '')) ? obj.fill : '#111111';
      return item;
    }
    if (item.kind === 'path') {
      // Approximate from path bounding box + sample — keep points if present.
      var pts = [];
      if (obj.path && obj.path.length) {
        var matrix = obj.calcTransformMatrix();
        obj.path.forEach(function (seg) {
          if (!seg || seg.length < 3) return;
          var p = window.fabric.util.transformPoint(
            { x: seg[1], y: seg[2] },
            matrix
          );
          pts.push([xToPct(p.x), yToPct(p.y)]);
        });
      }
      if (pts.length < 2) {
        var bPath = boxFromObject(obj);
        pts = [
          [xToPct(bPath.left), yToPct(bPath.top)],
          [xToPct(bPath.left + bPath.w), yToPct(bPath.top + bPath.h)],
        ];
      }
      item.points = pts;
      return item;
    }
    if (item.kind === 'line' || item.kind === 'arrow') {
      var ends = lineEndsPct(obj);
      if (ends) {
        item.x0 = ends.x0; item.y0 = ends.y0;
        item.x1 = ends.x1; item.y1 = ends.y1;
        return item;
      }
      // Last-resort absolute ends via transform matrix (never left+x1).
      obj.porPctEnds = null;
      var ends2 = lineEndsPct(obj);
      if (ends2) {
        item.x0 = ends2.x0; item.y0 = ends2.y0;
        item.x1 = ends2.x1; item.y1 = ends2.y1;
      }
      return item;
    }
    // Rect / ellipse / triangle from object geometry (not stroke-inflated AABB).
    var box = boxFromObject(obj);
    item.x0 = xToPct(box.left);
    item.y0 = yToPct(box.top);
    item.x1 = xToPct(box.left + box.w);
    item.y1 = yToPct(box.top + box.h);
    if (item.kind === 'roundRect') item.kind = 'roundRect';
    return item;
  }

  function replaceWithImage(canvas, placeholder, dataUrl) {
    if (!canvas || !placeholder || !dataUrl || !fabricReady()) return;
    window.fabric.Image.fromURL(dataUrl, function (img) {
      if (!img) return;
      var w = placeholder.width * (placeholder.scaleX || 1);
      var h = placeholder.height * (placeholder.scaleY || 1);
      img.set({
        left: placeholder.left,
        top: placeholder.top,
        angle: placeholder.angle || 0,
        opacity: placeholder.opacity != null ? placeholder.opacity : 1,
        porId: placeholder.porId,
        porKind: 'image',
        porMediaId: placeholder.porMediaId,
        porName: placeholder.porName || 'Picture',
        objectCaching: false,
      });
      if (img.width > 0) img.scaleToWidth(Math.max(8, w));
      if (img.getScaledHeight() > h && img.height > 0) img.scaleToHeight(Math.max(8, h));
      styleControls(img);
      canvas.remove(placeholder);
      canvas.add(img);
      canvas.requestRenderAll();
    }, { crossOrigin: 'anonymous' });
  }

  function overlaysToCanvas(canvas, overlays, opts) {
    opts = opts || {};
    if (!canvas || !fabricReady()) return;
    canvas.clear();
    canvas.backgroundColor = 'rgba(0,0,0,0)';
    (overlays || []).forEach(function (item) {
      if (item && item.kind === 'group' && Array.isArray(item.members)) {
        var kids = [];
        item.members.forEach(function (m) {
          var o = overlayToObject(m);
          if (o) kids.push(o);
        });
        if (kids.length) {
          var g = new window.fabric.Group(kids, {
            porId: item.id || uid('grp'),
            porKind: 'group',
          });
          styleControls(g);
          canvas.add(g);
        }
        return;
      }
      var obj = overlayToObject(item);
      if (!obj) return;
      canvas.add(obj);
      if (item && item.kind === 'image' && item.mediaId && typeof opts.loadMedia === 'function') {
        opts.loadMedia(item.mediaId).then(function (url) {
          if (url) replaceWithImage(canvas, obj, url);
        }).catch(function () { /* keep placeholder */ });
      }
    });
    canvas.renderAll();
    if (opts.readOnly) {
      canvas.selection = false;
      canvas.forEachObject(function (o) {
        o.selectable = false;
        o.evented = false;
      });
    }
  }

  function canvasToOverlays(canvas) {
    if (!canvas) return [];
    // ActiveSelection rewrites child left/top to group-relative values. Discard
    // it before reading so every save path writes absolute sheet coordinates,
    // then restore the same multi-selection for the investigator.
    var active = null;
    var restoreObjs = null;
    try { active = canvas.getActiveObject(); } catch (_) { active = null; }
    if (active && active.type === 'activeSelection') {
      restoreObjs = (typeof active.getObjects === 'function'
        ? active.getObjects()
        : (active._objects || [])).slice();
      try { canvas.discardActiveObject(); } catch (_) {}
      restoreObjs.forEach(function (o) {
        try { o.setCoords(); } catch (_) {}
      });
    }
    var out = [];
    canvas.getObjects().forEach(function (obj) {
      if (obj.excludeFromExport) return;
      var item = objectToOverlay(obj);
      if (item) out.push(item);
    });
    if (restoreObjs && restoreObjs.length) {
      try {
        var sel = new window.fabric.ActiveSelection(restoreObjs, { canvas: canvas });
        canvas.setActiveObject(sel);
        canvas.requestRenderAll();
      } catch (_) { /* keep absolute state even if restore fails */ }
    }
    return out;
  }

  function createCanvas(el, opts) {
    opts = opts || {};
    if (!fabricReady()) throw new Error('Fabric.js ' + FABRIC_VERSION + ' not loaded');
    var canvas = new window.fabric.Canvas(el, {
      width: opts.width || PAPER_W,
      height: opts.height || PAPER_H,
      preserveObjectStacking: true,
      selection: !opts.readOnly,
      stopContextMenu: true,
      fireRightClick: true,
      fireMiddleClick: true,
      uniformScaling: false,
      centeredRotation: true,
      backgroundColor: 'rgba(0,0,0,0)',
      // Allow programmatic / automation pointer streams (Puppeteer) to drive tools.
      allowTouchScrolling: false,
    });
    // PowerPoint-ish round handles on all future objects.
    window.fabric.Object.prototype.set({
      cornerStyle: 'circle',
      cornerColor: '#2563eb',
      cornerStrokeColor: '#ffffff',
      borderColor: '#2563eb',
      transparentCorners: false,
      cornerSize: 12,
      rotatingPointOffset: 28,
    });
    // Re-decorate arrows after canvas load / enliven.
    canvas.on('object:added', function (opt) {
      var t = opt && opt.target;
      if (t && (t.porArrow || t.porKind === 'arrow') && t.type === 'line') decorateArrow(t);
    });
    // Any geometry edit invalidates pinned line percentages.
    canvas.on('object:modified', function (opt) {
      var t = opt && opt.target;
      if (!t) return;
      function clearPins(o) {
        if (!o) return;
        if (o.type === 'line' || o.porKind === 'line' || o.porKind === 'arrow') {
          o.porPctEnds = null;
          captureLineEnds(o);
        }
      }
      if (t.type === 'activeSelection' || t.type === 'group') {
        var kids = typeof t.getObjects === 'function' ? t.getObjects() : (t._objects || []);
        kids.forEach(clearPins);
      } else {
        clearPins(t);
      }
    });
    return canvas;
  }

  function snapshotCanvas(canvas) {
    if (!canvas) return '';
    canvas.discardActiveObject();
    canvas.renderAll();
    return canvas.toDataURL({ format: 'png', multiplier: 1 });
  }

  window.ToolboxPorFabric = {
    VERSION: FABRIC_VERSION,
    PAPER_W: PAPER_W,
    PAPER_H: PAPER_H,
    ready: fabricReady,
    createCanvas: createCanvas,
    overlaysToCanvas: overlaysToCanvas,
    canvasToOverlays: canvasToOverlays,
    overlayToObject: overlayToObject,
    objectToOverlay: objectToOverlay,
    styleControls: styleControls,
    decorateArrow: decorateArrow,
    captureLineEnds: captureLineEnds,
    richTextPlainAndBold: richTextPlainAndBold,
    snapshotCanvas: snapshotCanvas,
    replaceWithImage: replaceWithImage,
    uid: uid,
    pctToX: pctToX,
    pctToY: pctToY,
    xToPct: xToPct,
    yToPct: yToPct,
    strokeWidthFromThick: strokeWidthFromThick,
  };
})();
