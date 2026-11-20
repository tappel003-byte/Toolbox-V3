// Toolbox — Compare two floor level surveys (Tim, Nov 20, 2026).
//
// A pairwise / relative-movement look at two surveys of the same floor taken at different times, when you
// do not know which points moved. Nothing is held fixed: each survey's colour map is read back into
// elevations, the later is laid over the earlier, the difference is taken everywhere they overlap, and the
// zero is set from the crowd -- the median change -- so the places that did not move read as neutral and the
// places that moved read plus or minus, in inches.
//
// It starts from PICTURES (a PDF page or an image of each survey) so it works on surveys Toolbox never
// held: another firm's floor level survey, or an older one. The reading labels on those pages are artwork,
// not data, so the maps are read from their own colours against their own legend. That is accurate to about
// one legend band (about 0.2 in on these surveys), and the dialog says so.
//
// It writes nothing to any Customer File. "Save picture" downloads a PNG.
//
// The maths is in `core` (pure functions on typed arrays) so it can be tested without a screen.

(function () {
  'use strict';

  // ===== core ==============================================================

  /** Grayscale-free helpers on {width, height, data(RGBA)} images. */
  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  /**
   * The legend bar, read top to bottom. rect is {x, y, w, h} in the image's pixels; the top of the bar is
   * topValue and the bottom is bottomValue, linear between. Each row is the median colour across the middle
   * of the bar, so a printed tick mark or label at the edge does not matter.
   */
  function buildLegendLut(img, rect, topValue, bottomValue) {
    const x0 = Math.max(0, Math.round(rect.x + rect.w * 0.2));
    const x1 = Math.min(img.width - 1, Math.round(rect.x + rect.w * 0.8));
    const y0 = Math.max(0, Math.round(rect.y));
    const y1 = Math.min(img.height - 1, Math.round(rect.y + rect.h));
    const rows = [];
    for (let y = y0; y <= y1; y += 1) {
      const rs = []; const gs = []; const bs = [];
      for (let x = x0; x <= x1; x += 1) {
        const i = (y * img.width + x) * 4;
        rs.push(img.data[i]); gs.push(img.data[i + 1]); bs.push(img.data[i + 2]);
      }
      rows.push([median(rs), median(gs), median(bs)]);
    }
    // The strip is the rows between its top and bottom outline when it has one (the box may be drawn loosely,
    // with paper above and below). With no outline, loose paper at either end is trimmed instead.
    // An outline row is dark AND grey; the darkest brown of the scale is dark but not grey.
    const lum = rows.map(function (c) {
      const l = luminance(c[0], c[1], c[2]);
      return (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) < 22 ? l : 255;
    });
    let first = 0; let last = rows.length - 1;
    let iTop = -1; let iBot = -1;
    for (let k = 0; k < rows.length; k += 1) if (lum[k] < 110) { if (iTop < 0) iTop = k; iBot = k; }
    if (iTop >= 0 && iBot > iTop + 8) {
      first = iTop + 1; last = iBot - 1;
    } else {
      const paper = function (c) { return Math.min(c[0], c[1], c[2]) >= 244; };
      while (first < last && paper(rows[first])) first += 1;
      while (last > first && paper(rows[last])) last -= 1;
    }
    // Tick marks across the strip are not colours of the scale; the value is still read off the row's own
    // position between the top and the bottom of the strip.
    const span = Math.max(1, last - first);
    const lut = [];
    for (let k = first; k <= last; k += 1) {
      if (lum[k] < 110) continue;
      const t = (k - first) / span;
      lut.push({ r: rows[k][0], g: rows[k][1], b: rows[k][2], v: topValue + (bottomValue - topValue) * t });
    }
    if (lut.length < 4) return null;
    // A black or very dark row is the bar's outline, not a colour of the scale.
    const kept = lut.filter((e) => luminance(e.r, e.g, e.b) > 40);
    return kept.length >= 4 ? kept : null;
  }

  function median(list) {
    if (!list.length) return NaN;
    const s = list.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** True when the lightest end of the scale is as light as the paper, which then cannot be told apart from it. */
  function topIsPaper(lut) {
    if (!lut || !lut.length) return false;
    let top = lut[0];
    lut.forEach((e) => { if (e.v > top.v) top = e; });
    return Math.min(top.r, top.g, top.b) >= 244;
  }

  /**
   * One value per pixel (NaN = none). A pixel gets the value of the nearest legend colour, if it is near
   * enough. Dark pixels (walls, text, contour lines) and anything else off the scale are none.
   * Paper-white pixels are none -- see exteriorMask for the case where the top of the scale is white.
   */
  function classify(img, lut, tolerance) {
    const tol2 = (tolerance || 24) * (tolerance || 24);
    const w = img.width; const h = img.height;
    const out = new Float32Array(w * h);
    // A small cache by packed colour: maps repeat the same few thousand colours.
    const cache = new Map();
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      const r = img.data[i]; const g = img.data[i + 1]; const b = img.data[i + 2]; const a = img.data[i + 3];
      if (a < 200) { out[p] = NaN; continue; }
      const key = (r << 16) | (g << 8) | b;
      let v = cache.get(key);
      if (v === undefined) {
        let best = Infinity; let bestV = NaN; let bestChroma = 0;
        for (let k = 0; k < lut.length; k += 1) {
          const e = lut[k];
          const dr = r - e.r; const dg = g - e.g; const db = b - e.b;
          const d2 = dr * dr + dg * dg + db * db;
          if (d2 < best) { best = d2; bestV = e.v; bestChroma = Math.max(e.r, e.g, e.b) - Math.min(e.r, e.g, e.b); }
        }
        // A grey anti-aliased line is not a pale tan: the colour's warmth has to agree as well.
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        v = best <= tol2 && Math.abs(chroma - bestChroma) <= 14 ? bestV : NaN;
        cache.set(key, v);
      }
      out[p] = v;
    }
    return out;
  }

  /** Paper-coloured pixels that are open to the edge of the page without crossing a wall: outside the house. */
  function exteriorMask(img, wallGrow) {
    const w = img.width; const h = img.height;
    const dark = new Uint8Array(w * h);
    const white = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      const mx = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]);
      const mn = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
      if (mx < 110) dark[p] = 1;
      if (mn >= 236) white[p] = 1;
    }
    const wall = dilate(dark, w, h, wallGrow == null ? 5 : wallGrow);
    // Open paper is outside the house when it reaches the edge of the page, or is as big as a big part of the
    // page (the white inside the page frame but outside the house).
    const ext = new Uint8Array(w * h);
    const seen = new Uint8Array(w * h);
    const bigArea = w * h * 0.12;
    for (let start = 0; start < w * h; start += 1) {
      if (seen[start] || !white[start] || wall[start]) continue;
      const comp = [start]; seen[start] = 1;
      let touches = false;
      for (let q = 0; q < comp.length; q += 1) {
        const p = comp[q];
        const x = p % w; const y = (p / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (let n = 0; n < 4; n += 1) {
          const m = nb[n];
          if (m < 0 || seen[m] || !white[m] || wall[m]) continue;
          seen[m] = 1; comp.push(m);
        }
      }
      if (touches || comp.length > bigArea) for (let q = 0; q < comp.length; q += 1) ext[comp[q]] = 1;
    }
    return { exterior: ext, white: white, dark: dark };
  }

  function dilate(mask, w, h, r) {
    // Separable square dilation: cheap and good enough for sealing door gaps.
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      let run = 0;
      for (let x = 0; x < w + r; x += 1) {
        if (x < w && mask[y * w + x]) run = 2 * r + 1;
        if (x >= r && x - r < w && run > 0) tmp[y * w + (x - r)] = 1;
        if (run > 0) run -= 1;
      }
    }
    for (let x = 0; x < w; x += 1) {
      let run = 0;
      for (let y = 0; y < h + r; y += 1) {
        if (y < h && tmp[y * w + x]) run = 2 * r + 1;
        if (y >= r && y - r < h && run > 0) out[(y - r) * w + x] = 1;
        if (run > 0) run -= 1;
      }
    }
    return out;
  }

  /**
   * The elevation field of one survey picture. Returns {values:Float32Array, w, h}. NaN is "no reading
   * here": outside the house, or a wall.
   */
  function readSurvey(img, lut, opts) {
    const o = opts || {};
    const values = classify(img, lut, o.tolerance);
    // The legend strip itself is made of the scale's colours; take it out before anything is filled or joined.
    if (o.avoid) {
      const ax0 = Math.max(0, Math.floor(o.avoid.x)); const ax1 = Math.min(img.width - 1, Math.ceil(o.avoid.x + o.avoid.w));
      const ay0 = Math.max(0, Math.floor(o.avoid.y)); const ay1 = Math.min(img.height - 1, Math.ceil(o.avoid.y + o.avoid.h));
      for (let y = ay0; y <= ay1; y += 1) for (let x = ax0; x <= ax1; x += 1) values[y * img.width + x] = NaN;
    }
    if (topIsPaper(lut)) {
      // The lightest band prints as paper. White that a wall closes in is that band; white open to the
      // page edge is outside the house.
      let topV = -Infinity;
      lut.forEach((e) => { if (e.v > topV) topV = e.v; });
      const m = exteriorMask(img, o.wallGrow);
      const inAvoid = function (p) {
        if (!o.avoid) return false;
        const x = p % img.width; const y = (p / img.width) | 0;
        return x >= o.avoid.x && x <= o.avoid.x + o.avoid.w && y >= o.avoid.y && y <= o.avoid.y + o.avoid.h;
      };
      for (let p = 0; p < values.length; p += 1) {
        if (m.white[p]) values[p] = (m.exterior[p] || inAvoid(p)) ? NaN : topV;
      }
    }
    // Thin strokes (door swings, text, contour lines) leave specks; the median of the neighbourhood drops them.
    const cleaned = medianFilter(values, img.width, img.height, o.medianRadius == null ? 2 : o.medianRadius);
    const filled = fillHoles(cleaned, img.width, img.height, o.fillPasses == null ? 8 : o.fillPasses);
    if (o.avoid) {
      const ax0 = Math.max(0, Math.floor(o.avoid.x)); const ax1 = Math.min(img.width - 1, Math.ceil(o.avoid.x + o.avoid.w));
      const ay0 = Math.max(0, Math.floor(o.avoid.y)); const ay1 = Math.min(img.height - 1, Math.ceil(o.avoid.y + o.avoid.h));
      for (let y = ay0; y <= ay1; y += 1) for (let x = ax0; x <= ax1; x += 1) filled[y * img.width + x] = NaN;
    }
    if (o.keepAll) return { values: filled, w: img.width, h: img.height };
    const kept = keepRegions(filled, img.width, img.height, null);
    return { values: kept, w: img.width, h: img.height };
  }

  function medianFilter(src, w, h, r) {
    if (r <= 0) return src;
    const out = new Float32Array(w * h);
    const buf = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        buf.length = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy += 1) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx += 1) {
            const v = src[yy * w + xx];
            if (v === v) buf.push(v);
          }
        }
        // Need a clear majority of the window, else it stays empty (a wall edge, the outside).
        const need = ((2 * r + 1) * (2 * r + 1)) * 0.4;
        out[y * w + x] = buf.length >= need ? median(buf) : NaN;
      }
    }
    return out;
  }

  /** Fill small gaps (walls, contour lines) from their neighbours; large empty areas stay empty. */
  function fillHoles(src, w, h, passes) {
    let cur = src;
    for (let k = 0; k < passes; k += 1) {
      const next = new Float32Array(cur);
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          const p = y * w + x;
          if (cur[p] === cur[p]) continue;
          let s = 0; let c = 0;
          const nb = [p - 1, p + 1, p - w, p + w];
          for (let n = 0; n < 4; n += 1) { const v = cur[nb[n]]; if (v === v) { s += v; c += 1; } }
          if (c >= 2) next[p] = s / c;
        }
      }
      cur = next;
    }
    return cur;
  }

  /**
   * Keep the house: the large connected areas of readings. A legend strip, a title block or a stray mark is
   * a separate small island and is dropped. `avoid` is an optional {x,y,w,h} (the legend box) that no kept
   * area may touch.
   */
  function keepRegions(values, w, h, avoid) {
    const label = new Int32Array(w * h);
    const sizes = [0];
    const hitsAvoid = [false];
    let n = 0;
    const stack = [];
    for (let start = 0; start < w * h; start += 1) {
      if (label[start] || values[start] !== values[start]) continue;
      n += 1; sizes[n] = 0; hitsAvoid[n] = false;
      stack.push(start); label[start] = n;
      while (stack.length) {
        const p = stack.pop();
        sizes[n] += 1;
        const x = p % w; const y = (p / w) | 0;
        if (avoid && x >= avoid.x && x <= avoid.x + avoid.w && y >= avoid.y && y <= avoid.y + avoid.h) hitsAvoid[n] = true;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (let k = 0; k < 4; k += 1) {
          const m = nb[k];
          if (m < 0 || label[m] || values[m] !== values[m]) continue;
          label[m] = n; stack.push(m);
        }
      }
    }
    let biggest = 0;
    for (let i = 1; i <= n; i += 1) if (!hitsAvoid[i] && sizes[i] > biggest) biggest = sizes[i];
    const out = new Float32Array(w * h);
    for (let p = 0; p < w * h; p += 1) {
      const l = label[p];
      out[p] = l && !hitsAvoid[l] && sizes[l] >= biggest * 0.015 ? values[p] : NaN;
    }
    return out;
  }

  /**
   * Find the shift and scale that lay survey B's walls on survey A's: a coarse search for the position that
   * puts B's thick wall pixels closest to A's. Assumes the two are not turned against each other (same north
   * up). Returns {s, tx, ty} with A = s*B + t, or null.
   */
  function autoAlign(imgA, imgB) {
    const wallsA = thickWalls(imgA); const wallsB = thickWalls(imgB);
    if (wallsA.pts.length < 50 || wallsB.pts.length < 50) return null;
    const step = 4;
    const gw = Math.ceil(imgA.width / step); const gh = Math.ceil(imgA.height / step);
    // distance to the nearest A wall, in grid cells
    const dist = new Float32Array(gw * gh).fill(1e6);
    wallsA.pts.forEach(function (p) {
      const gx = Math.min(gw - 1, (p[0] / step) | 0); const gy = Math.min(gh - 1, (p[1] / step) | 0);
      dist[gy * gw + gx] = 0;
    });
    for (let y = 0; y < gh; y += 1) for (let x = 0; x < gw; x += 1) {
      const i = y * gw + x; let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - gw] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - gw - 1] + 1.4);
      if (x < gw - 1 && y > 0) d = Math.min(d, dist[i - gw + 1] + 1.4);
      dist[i] = d;
    }
    for (let y = gh - 1; y >= 0; y -= 1) for (let x = gw - 1; x >= 0; x -= 1) {
      const i = y * gw + x; let d = dist[i];
      if (x < gw - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < gh - 1) d = Math.min(d, dist[i + gw] + 1);
      if (x < gw - 1 && y < gh - 1) d = Math.min(d, dist[i + gw + 1] + 1.4);
      if (x > 0 && y < gh - 1) d = Math.min(d, dist[i + gw - 1] + 1.4);
      dist[i] = d;
    }
    // Thin B's wall pixels to keep the search quick.
    const sample = wallsB.pts.filter(function (_, i) { return i % 3 === 0; });
    let best = { score: Infinity, s: 1, tx: 0, ty: 0 };
    const trunc = 12;
    function score(s, tx, ty) {
      let sum = 0;
      for (let k = 0; k < sample.length; k += 1) {
        const x = (s * sample[k][0] + tx) / step; const y = (s * sample[k][1] + ty) / step;
        const gx = x | 0; const gy = y | 0;
        sum += (gx < 0 || gy < 0 || gx >= gw || gy >= gh) ? trunc : Math.min(trunc, dist[gy * gw + gx]);
      }
      return sum / sample.length;
    }
    // Coarse: scales 0.85..1.15 and shifts of up to a fifth of the page, on a coarse grid.
    for (let s = 0.85; s <= 1.1501; s += 0.02) {
      for (let ty = -imgA.height * 0.2; ty <= imgA.height * 0.2; ty += 8) {
        for (let tx = -imgA.width * 0.2; tx <= imgA.width * 0.2; tx += 8) {
          const sc = score(s, tx, ty);
          if (sc < best.score) best = { score: sc, s: s, tx: tx, ty: ty };
        }
      }
    }
    // Fine: around the best.
    const c = { s: best.s, tx: best.tx, ty: best.ty };
    for (let s = c.s - 0.02; s <= c.s + 0.0201; s += 0.004) {
      for (let ty = c.ty - 8; ty <= c.ty + 8; ty += 2) {
        for (let tx = c.tx - 8; tx <= c.tx + 8; tx += 2) {
          const sc = score(s, tx, ty);
          if (sc < best.score) best = { score: sc, s: s, tx: tx, ty: ty };
        }
      }
    }
    return { s: best.s, tx: best.tx, ty: best.ty, score: best.score };
  }

  /** Thick dark pixels (walls), inside the middle of the page, as [x,y] pairs. */
  function thickWalls(img) {
    const w = img.width; const h = img.height;
    const dark = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) < 90) dark[p] = 1;
    }
    // Erode: a wall is a few pixels thick, a line or a letter is not.
    const er = 2;
    const pts = [];
    for (let y = Math.round(h * 0.07); y < h * 0.78; y += 1) {
      for (let x = Math.round(w * 0.09); x < w * 0.9; x += 1) {
        let ok = true;
        for (let dy = -er; dy <= er && ok; dy += 1) for (let dx = -er; dx <= er; dx += 1) {
          if (!dark[(y + dy) * w + (x + dx)]) { ok = false; break; }
        }
        if (ok) pts.push([x, y]);
      }
    }
    return { pts: pts };
  }

  /**
   * The similarity transform (scale, turn, shift) that carries B onto A, from two points picked on each.
   * a = [{x,y},{x,y}] on A; b = the same two places on B. Returns {s, cos, sin, tx, ty}: A = s*R*B + t.
   */
  function similarityFrom(a, b) {
    const ax = a[1].x - a[0].x; const ay = a[1].y - a[0].y;
    const bx = b[1].x - b[0].x; const by = b[1].y - b[0].y;
    const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by);
    if (!(la > 1) || !(lb > 1)) return null;
    const s = la / lb;
    const ang = Math.atan2(ay, ax) - Math.atan2(by, bx);
    const cos = Math.cos(ang); const sin = Math.sin(ang);
    const tx = a[0].x - s * (cos * b[0].x - sin * b[0].y);
    const ty = a[0].y - s * (sin * b[0].x + cos * b[0].y);
    return { s: s, cos: cos, sin: sin, tx: tx, ty: ty };
  }

  /** Where a point of A lands on B (the inverse of similarityFrom). */
  function mapAtoB(t, x, y) {
    const dx = x - t.tx; const dy = y - t.ty;
    const bx = (t.cos * dx + t.sin * dy) / t.s;
    const by = (-t.sin * dx + t.cos * dy) / t.s;
    return { x: bx, y: by };
  }

  /**
   * Later minus earlier, on A's grid, where both have a reading. `a` and `b` are readSurvey results; `t` takes
   * B onto A (identity when the two are already the same size and place).
   */
  function difference(a, b, t) {
    const w = a.w; const h = a.h;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const va = a.values[y * w + x];
        if (va !== va) { out[y * w + x] = NaN; continue; }
        let bx = x; let by = y;
        if (t) { const m = mapAtoB(t, x, y); bx = m.x; by = m.y; }
        const ix = Math.round(bx); const iy = Math.round(by);
        if (ix < 0 || iy < 0 || ix >= b.w || iy >= b.h) { out[y * w + x] = NaN; continue; }
        const vb = b.values[iy * b.w + ix];
        out[y * w + x] = vb === vb ? vb - va : NaN;
      }
    }
    return { values: out, w: w, h: h };
  }

  /** Subtract the typical change (so the places that did not move read zero), and optionally an overall tilt. */
  function setZero(diff, opts) {
    const o = opts || {};
    const w = diff.w; const h = diff.h;
    const vals = [];
    for (let p = 0; p < w * h; p += 1) { const v = diff.values[p]; if (v === v) vals.push(v); }
    const out = new Float32Array(w * h);
    if (!vals.length) { out.fill(NaN); return { values: out, w: w, h: h, n: 0, shift: 0, tilt: null }; }
    let shift = 0;
    if (o.zero !== 'raw') shift = median(vals);
    let tilt = null;
    if (o.removeTilt) {
      // Least-squares plane through the changes, on a thinned sample.
      let sx = 0; let sy = 0; let sz = 0; let sxx = 0; let sxy = 0; let syy = 0; let sxz = 0; let syz = 0; let n = 0;
      for (let y = 0; y < h; y += 3) {
        for (let x = 0; x < w; x += 3) {
          const v = diff.values[y * w + x];
          if (v !== v) continue;
          const xx = x / w; const yy = y / h;
          sx += xx; sy += yy; sz += v; sxx += xx * xx; sxy += xx * yy; syy += yy * yy; sxz += xx * v; syz += yy * v; n += 1;
        }
      }
      if (n > 10) {
        // Solve [[sxx sx sxy? ...]] by Cramer's rule on the normal equations for z = c + a*x + b*y.
        const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
        const B = [sz, sxz, syz];
        const sol = solve3(A, B);
        if (sol) tilt = { c: sol[0], a: sol[1], b: sol[2] };
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = diff.values[y * w + x];
        if (v !== v) { out[y * w + x] = NaN; continue; }
        out[y * w + x] = tilt ? v - (tilt.c + tilt.a * (x / w) + tilt.b * (y / h)) - (o.zero === 'raw' ? 0 : 0) : v - shift;
      }
    }
    // With a tilt removed the plane carries the median already.
    return { values: out, w: w, h: h, n: vals.length, shift: shift, tilt: tilt };
  }

  function solve3(A, B) {
    const m = [A[0].concat(B[0]), A[1].concat(B[1]), A[2].concat(B[2])];
    for (let i = 0; i < 3; i += 1) {
      let piv = i;
      for (let r = i + 1; r < 3; r += 1) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
      if (Math.abs(m[piv][i]) < 1e-12) return null;
      const t = m[i]; m[i] = m[piv]; m[piv] = t;
      for (let r = i + 1; r < 3; r += 1) {
        const f = m[r][i] / m[i][i];
        for (let c = i; c < 4; c += 1) m[r][c] -= f * m[i][c];
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i -= 1) {
      let s = m[i][3];
      for (let c = i + 1; c < 3; c += 1) s -= m[i][c] * x[c];
      x[i] = s / m[i][i];
    }
    return x;
  }

  /** Drop cells within r of an empty one, so the ragged edge of each map (and a misfit wall) is not read as movement. */
  function erodeValid(field, r) {
    const w = field.w; const h = field.h;
    const valid = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p += 1) valid[p] = field.values[p] === field.values[p] ? 0 : 1; // 1 = empty
    const near = dilate(valid, w, h, r);
    const out = new Float32Array(w * h);
    for (let p = 0; p < w * h; p += 1) out[p] = near[p] ? NaN : field.values[p];
    return { values: out, w: w, h: h };
  }

  /** Smooth a field, ignoring empty cells (so the edge of the house does not fade). */
  function smooth(field, r) {
    if (!(r > 0)) return field;
    const w = field.w; const h = field.h;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let s = 0; let c = 0;
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx += 1) {
          const v = field.values[y * w + xx];
          if (v === v) { s += v; c += 1; }
        }
        tmp[y * w + x] = c ? s / c : NaN;
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const self = field.values[y * w + x];
        if (self !== self) { out[y * w + x] = NaN; continue; }
        let s = 0; let c = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy += 1) {
          const v = tmp[yy * w + x];
          if (v === v) { s += v; c += 1; }
        }
        out[y * w + x] = c ? s / c : NaN;
      }
    }
    return { values: out, w: w, h: h, n: field.n, shift: field.shift, tilt: field.tilt };
  }

  /** Diverging colour for a change in inches: neutral inside the band, cool = lower, warm = higher. */
  function changeColor(v, band, span) {
    if (v !== v) return null;
    const a = Math.abs(v);
    if (a <= band) return null;
    const t = Math.min(1, (a - band) / Math.max(0.05, span - band));
    // 0.35 alpha floor so the first step past the band is still visible over the plan.
    const alpha = 0.35 + 0.5 * t;
    if (v < 0) {
      // light blue -> deep blue
      return [Math.round(120 - 90 * t), Math.round(180 - 110 * t), Math.round(235 - 40 * t), alpha];
    }
    return [Math.round(245 - 15 * t), Math.round(170 - 120 * t), Math.round(90 - 60 * t), alpha];
  }

  const core = {
    buildLegendLut: buildLegendLut,
    classify: classify,
    exteriorMask: exteriorMask,
    readSurvey: readSurvey,
    similarityFrom: similarityFrom,
    mapAtoB: mapAtoB,
    difference: difference,
    setZero: setZero,
    smooth: smooth,
    erodeValid: erodeValid,
    changeColor: changeColor,
    topIsPaper: topIsPaper,
    keepRegions: keepRegions,
    autoAlign: autoAlign,
    median: median,
  };

  // ===== dialog ============================================================

  const WORK_MAX = 1000; // longest side, in pixels, the surveys are read at

  let overlay = null;
  let state = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = '/js/vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('PDF reader did not load')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('PDF reader did not load')); };
      document.head.appendChild(s);
    });
  }

  /** A File -> {canvas, pages, page, name}. A PDF is drawn at WORK_MAX; an image is scaled to it. */
  async function loadSurveyFile(file, pageNumber) {
    const name = file.name || 'survey';
    const isPdf = /pdf$/i.test(file.type || '') || /\.pdf$/i.test(name);
    if (isPdf) {
      const lib = await ensurePdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await lib.getDocument({ data: data }).promise;
      const n = Math.min(doc.numPages, Math.max(1, pageNumber || 1));
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = WORK_MAX / Math.max(base.width, base.height);
      const vp = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return { canvas: canvas, pages: doc.numPages, page: n, name: name, file: file };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise(function (resolve, reject) {
        const i = new Image(); i.onload = function () { resolve(i); }; i.onerror = function () { reject(new Error('Not an image')); }; i.src = url;
      });
      const k = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { canvas: canvas, pages: 1, page: 1, name: name, file: file };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function imageDataOf(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; state = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  }

  function open() {
    if (overlay) return;
    state = {
      slots: [
        { label: 'Earlier survey', src: null, legend: null, top: '', bottom: '', pts: [], lut: null },
        { label: 'Later survey', src: null, legend: null, top: '', bottom: '', pts: [], lut: null },
      ],
      step: 1,
      result: null,
      opts: { zero: 'median', band: 0.2, smooth: 6, tilt: false },
      working: false,
    };
    overlay = el('div', 'sc');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Compare two surveys');
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  // A canvas that shows one survey and lets the user draw a rectangle or click points on it.
  function surveyPicker(slot, mode, onChange) {
    const wrap = el('div', 'sc-pick');
    const canvas = document.createElement('canvas');
    canvas.className = 'sc-canvas';
    canvas.width = slot.src.canvas.width; canvas.height = slot.src.canvas.height;
    wrap.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    function paint() {
      ctx.drawImage(slot.src.canvas, 0, 0);
      if (mode === 'legend' && slot.legend) {
        ctx.strokeStyle = '#c14a2b'; ctx.lineWidth = 3;
        ctx.strokeRect(slot.legend.x, slot.legend.y, slot.legend.w, slot.legend.h);
      }
      if (mode === 'align') {
        slot.pts.forEach(function (p, i) {
          ctx.fillStyle = '#c14a2b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), p.x, p.y + 1);
        });
      }
    }
    paint();
    function at(event) {
      const r = canvas.getBoundingClientRect();
      return { x: (event.clientX - r.left) * canvas.width / r.width, y: (event.clientY - r.top) * canvas.height / r.height };
    }
    let start = null;
    canvas.addEventListener('pointerdown', function (event) {
      const p = at(event);
      if (mode === 'legend') { start = p; canvas.setPointerCapture(event.pointerId); slot.legend = { x: p.x, y: p.y, w: 1, h: 1 }; paint(); }
    });
    canvas.addEventListener('pointermove', function (event) {
      if (mode !== 'legend' || !start) return;
      const p = at(event);
      slot.legend = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      paint();
    });
    canvas.addEventListener('pointerup', function (event) {
      if (mode === 'legend' && start) {
        start = null;
        if (slot.legend && (slot.legend.w < 4 || slot.legend.h < 12)) slot.legend = null;
        slot.lut = null;
        paint(); onChange();
        return;
      }
      if (mode === 'align') {
        const p = at(event);
        if (slot.pts.length >= 2) slot.pts = [];
        slot.pts.push(p);
        paint(); onChange();
      }
    });
    return wrap;
  }

  function render() {
    if (!overlay) return;
    overlay.textContent = '';
    const head = el('div', 'sc__head');
    head.appendChild(el('strong', 'sc__title', 'Compare two surveys'));
    const steps = ['Load', 'Legend', 'Align', 'Result'];
    const bar = el('div', 'sc__steps');
    steps.forEach(function (name, i) {
      const b = el('button', 'sc__step' + (state.step === i + 1 ? ' is-on' : ''), (i + 1) + '. ' + name);
      b.type = 'button';
      b.setAttribute('data-sc-step', String(i + 1));
      b.disabled = i + 1 > maxStep();
      b.addEventListener('click', function () { state.step = i + 1; render(); });
      bar.appendChild(b);
    });
    head.appendChild(bar);
    const x = el('button', 'btn btn--quiet sc__close', 'Close');
    x.type = 'button'; x.id = 'sc-close';
    x.addEventListener('click', close);
    head.appendChild(x);
    overlay.appendChild(head);

    const body = el('div', 'sc__body');
    overlay.appendChild(body);
    if (state.step === 1) renderLoad(body);
    else if (state.step === 2) renderLegend(body);
    else if (state.step === 3) renderAlign(body);
    else renderResult(body);
  }

  function slotsReady() { return state.slots.every(function (s) { return !!s.src; }); }
  function legendsReady() {
    return state.slots.every(function (s) {
      return s.legend && isFinite(parseFloat(s.top)) && isFinite(parseFloat(s.bottom)) && parseFloat(s.top) !== parseFloat(s.bottom);
    });
  }
  function alignReady() { return state.slots.every(function (s) { return s.pts.length === 2; }); }
  function maxStep() {
    if (!slotsReady()) return 1;
    if (!legendsReady()) return 2;
    if (!alignReady()) return 3;
    return 4;
  }

  function note(parent, text) { const p = el('p', 'sc__note', text); parent.appendChild(p); return p; }

  function nextButton(parent, label, enabled, go) {
    const row = el('div', 'sc__row');
    const b = el('button', 'btn btn--accent', label);
    b.type = 'button'; b.id = 'sc-next'; b.disabled = !enabled;
    b.addEventListener('click', go);
    row.appendChild(b);
    parent.appendChild(row);
    return b;
  }

  // ---- step 1: load two files
  function renderLoad(body) {
    note(body, 'Add the two floor level surveys: a PDF or a picture of each. The earlier one first. Nothing is saved anywhere; they stay on this screen.');
    const grid = el('div', 'sc__slots');
    state.slots.forEach(function (slot, idx) {
      const card = el('div', 'sc__slot');
      card.appendChild(el('h3', 'sc__h', slot.label));
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/pdf,image/*'; input.id = 'sc-file-' + idx; input.hidden = true;
      const pick = el('button', 'btn btn--secondary', slot.src ? 'Choose a different file' : 'Choose a PDF or picture…');
      pick.type = 'button';
      pick.addEventListener('click', function () { input.click(); });
      const drop = el('div', 'sc__drop', slot.src ? slot.src.name : 'or drop it here');
      ['dragenter', 'dragover'].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      drop.addEventListener('drop', function (e) {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) take(idx, f, 1);
      });
      input.addEventListener('change', function () { if (input.files[0]) take(idx, input.files[0], 1); });
      card.appendChild(pick); card.appendChild(input); card.appendChild(drop);
      if (slot.src) {
        if (slot.src.pages > 1) {
          const sel = document.createElement('select');
          sel.setAttribute('aria-label', 'PDF page');
          for (let p = 1; p <= slot.src.pages; p += 1) {
            const o = document.createElement('option'); o.value = String(p); o.textContent = 'Page ' + p + ' of ' + slot.src.pages;
            if (p === slot.src.page) o.selected = true; sel.appendChild(o);
          }
          sel.addEventListener('change', function () { take(idx, slot.src.file, Number(sel.value)); });
          card.appendChild(sel);
        }
        const thumb = document.createElement('canvas');
        thumb.className = 'sc__thumb'; thumb.width = slot.src.canvas.width; thumb.height = slot.src.canvas.height;
        thumb.getContext('2d').drawImage(slot.src.canvas, 0, 0);
        card.appendChild(thumb);
      }
      grid.appendChild(card);
    });
    body.appendChild(grid);
    const msg = note(body, '');
    msg.id = 'sc-msg';
    nextButton(body, 'Next: legend', slotsReady(), function () { state.step = 2; render(); });
  }

  async function take(idx, file, pageNumber) {
    const msg = overlay.querySelector('#sc-msg');
    if (msg) msg.textContent = 'Reading ' + file.name + '…';
    try {
      const src = await loadSurveyFile(file, pageNumber);
      const slot = state.slots[idx];
      slot.src = src; slot.legend = null; slot.lut = null; slot.pts = [];
      state.result = null;
      render();
    } catch (err) {
      if (msg) msg.textContent = 'Could not read that file: ' + (err && err.message ? err.message : err);
    }
  }

  // ---- step 2: legend rectangle + the two values
  function renderLegend(body) {
    note(body, 'On each survey, drag a box around the colour scale (the legend strip), then type the value at its top and at its bottom. The strip is read from top to bottom as those two numbers.');
    const grid = el('div', 'sc__slots');
    state.slots.forEach(function (slot, idx) {
      const card = el('div', 'sc__slot');
      card.appendChild(el('h3', 'sc__h', slot.label + ' — ' + slot.src.name));
      card.appendChild(surveyPicker(slot, 'legend', function () { render(); }));
      const row = el('div', 'sc__vals');
      [['top', 'Top value (in)'], ['bottom', 'Bottom value (in)']].forEach(function (pair) {
        const label = el('label', 'sc__val', pair[1] + ' ');
        const input = document.createElement('input');
        input.type = 'number'; input.step = '0.1'; input.value = slot[pair[0]]; input.id = 'sc-' + pair[0] + '-' + idx;
        input.addEventListener('input', function () { slot[pair[0]] = input.value; slot.lut = null; refreshNext(); });
        label.appendChild(input); row.appendChild(label);
      });
      card.appendChild(row);
      grid.appendChild(card);
    });
    body.appendChild(grid);
    const next = nextButton(body, 'Next: align', legendsReady(), function () { state.step = 3; render(); });
    function refreshNext() { next.disabled = !legendsReady(); }
  }

  // ---- step 3: two matching corners on each
  function renderAlign(body) {
    note(body, 'Click the same two places on both surveys (two far-apart wall corners work well), in the same order. The later survey is turned and scaled to sit on the earlier one.');
    const grid = el('div', 'sc__slots');
    state.slots.forEach(function (slot) {
      const card = el('div', 'sc__slot');
      card.appendChild(el('h3', 'sc__h', slot.label + ' — ' + slot.pts.length + ' of 2 points'));
      card.appendChild(surveyPicker(slot, 'align', function () { render(); }));
      grid.appendChild(card);
    });
    body.appendChild(grid);
    const auto = el('button', 'btn btn--secondary', 'Align automatically');
    auto.type = 'button'; auto.id = 'sc-auto';
    auto.addEventListener('click', function () {
      auto.disabled = true; auto.textContent = 'Aligning…';
      setTimeout(function () {
        const A = state.slots[0].src.canvas; const B = state.slots[1].src.canvas;
        const t = core.autoAlign(imageDataOf(A), imageDataOf(B));
        if (!t) { state.alignMsg = 'Could not find the walls to line up. Click two matching corners on each instead.'; render(); return; }
        // Two points on A, and where they sit on B: the same shift and scale as the search found, shown so it can be nudged.
        const a = [{ x: A.width * 0.3, y: A.height * 0.3 }, { x: A.width * 0.7, y: A.height * 0.65 }];
        const b = a.map(function (q) { return { x: (q.x - t.tx) / t.s, y: (q.y - t.ty) / t.s }; });
        state.slots[0].pts = a; state.slots[1].pts = b;
        state.alignMsg = 'Lined up automatically. Check the two numbered dots sit on the same places on both; click to replace them if not.';
        render();
      }, 30);
    });
    const autoRow = el('div', 'sc__row'); autoRow.appendChild(auto); body.insertBefore(autoRow, grid);
    if (state.alignMsg) note(body, state.alignMsg);
    const same = el('button', 'btn btn--quiet', 'They are already the same size and place');
    same.type = 'button'; same.id = 'sc-same';
    same.addEventListener('click', function () {
      state.slots.forEach(function (s) { s.pts = [{ x: 100, y: 100 }, { x: 600, y: 700 }]; });
      state.identity = true;
      compute();
    });
    const row = el('div', 'sc__row'); row.appendChild(same); body.appendChild(row);
    nextButton(body, 'Compare', alignReady(), function () { state.identity = false; compute(); });
  }

  // ---- compute
  function compute() {
    state.step = 4; state.working = true; state.error = ''; render();
    setTimeout(function () {
      try {
        const reads = state.slots.map(function (slot) {
          const img = imageDataOf(slot.src.canvas);
          const lut = core.buildLegendLut(img, slot.legend, parseFloat(slot.top), parseFloat(slot.bottom));
          if (!lut) throw new Error('The legend box on the ' + slot.label.toLowerCase() + ' could not be read. Draw it tighter around the colour strip.');
          slot.lut = lut;
          return core.readSurvey(img, lut, { avoid: { x: slot.legend.x - 6, y: slot.legend.y - 6, w: slot.legend.w + 12, h: slot.legend.h + 12 } });
        });
        let t = null;
        if (!state.identity) {
          t = core.similarityFrom(state.slots[0].pts, state.slots[1].pts);
          // similarityFrom(a, b) carries B onto A; slots[0] is the earlier = A.
          if (!t) throw new Error('The two points on a survey are too close together.');
        }
        state.reads = reads;
        // Each map is smoothed a little first, so the step edges of two differently banded maps do not
        // register as stripes of movement; the ragged outer edge is then trimmed back.
        const soft = reads.map(function (r) { return core.smooth({ values: r.values, w: r.w, h: r.h }, 4); });
        state.diff = core.erodeValid(core.difference(soft[0], soft[1], t), 6);
        state.working = false;
        state.result = true;
        render();
      } catch (err) {
        state.working = false; state.error = err && err.message ? err.message : String(err);
        render();
      }
    }, 30);
  }

  // ---- step 4
  function renderResult(body) {
    if (state.working) { note(body, 'Reading both maps and comparing…'); return; }
    if (state.error) {
      note(body, state.error).classList.add('sc__err');
      const back = el('button', 'btn btn--secondary', 'Back'); back.type = 'button';
      back.addEventListener('click', function () { state.step = 2; render(); });
      body.appendChild(back);
      return;
    }
    if (!state.diff) { note(body, 'Nothing to show yet.'); return; }

    const layout = el('div', 'sc__result');
    const stage = el('div', 'sc__stage');
    const canvas = document.createElement('canvas');
    canvas.id = 'sc-out'; canvas.className = 'sc__out';
    stage.appendChild(canvas);
    const side = el('div', 'sc__side');
    layout.appendChild(stage); layout.appendChild(side);
    body.appendChild(layout);

    const o = state.opts;
    function control(label, node) {
      const row = el('label', 'sc__ctl', label + ' '); row.appendChild(node); side.appendChild(row); return node;
    }
    const zeroSel = document.createElement('select'); zeroSel.id = 'sc-zero';
    [['median', 'Median change (typical movement is zero)'], ['raw', 'Raw difference (no zero set)']].forEach(function (p) {
      const op = document.createElement('option'); op.value = p[0]; op.textContent = p[1]; if (o.zero === p[0]) op.selected = true; zeroSel.appendChild(op);
    });
    zeroSel.addEventListener('change', function () { o.zero = zeroSel.value; draw(); });
    control('Zero', zeroSel);

    const band = document.createElement('input'); band.type = 'number'; band.step = '0.05'; band.min = '0'; band.value = String(o.band); band.id = 'sc-band';
    band.addEventListener('input', function () { o.band = Math.max(0, parseFloat(band.value) || 0); draw(); });
    control('Neutral band ± (in)', band);

    const sm = document.createElement('input'); sm.type = 'range'; sm.min = '0'; sm.max = '12'; sm.value = String(o.smooth); sm.id = 'sc-smooth';
    sm.addEventListener('input', function () { o.smooth = Number(sm.value); draw(); });
    control('Smoothing', sm);

    const tilt = document.createElement('input'); tilt.type = 'checkbox'; tilt.checked = !!o.tilt; tilt.id = 'sc-tilt';
    tilt.addEventListener('change', function () { o.tilt = tilt.checked; draw(); });
    control('Remove overall tilt', tilt);

    const info = el('p', 'sc__info'); info.id = 'sc-info'; side.appendChild(info);
    const save = el('button', 'btn btn--accent', 'Save picture'); save.type = 'button'; save.id = 'sc-save';
    save.addEventListener('click', savePng);
    side.appendChild(save);
    const redo = el('button', 'btn btn--quiet', 'Start over'); redo.type = 'button';
    redo.addEventListener('click', function () { state.step = 1; state.result = null; state.diff = null; render(); });
    side.appendChild(redo);
    side.appendChild(el('p', 'sc__fine',
      'Read from each map\'s own colours, so it is good to about one legend band (about 0.2 in). A purely relative view shows how the parts of the floor moved against each other. It cannot show the whole floor moving together.'));

    function draw() {
      const zeroed = core.setZero(state.diff, { zero: o.zero, removeTilt: o.tilt });
      const shown = core.smooth(zeroed, o.smooth);
      state.shown = shown; state.zeroed = zeroed;
      const w = shown.w; const h = shown.h;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      // The earlier survey, faded, as the plan underneath.
      ctx.globalAlpha = 0.35; ctx.drawImage(state.slots[0].src.canvas, 0, 0, w, h); ctx.globalAlpha = 1;
      const img = ctx.getImageData(0, 0, w, h);
      let lo = Infinity; let hi = -Infinity;
      for (let p = 0; p < w * h; p += 1) {
        const v = shown.values[p];
        if (v !== v) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
        const c = core.changeColor(v, o.band, 1.2);
        if (!c) { // neutral: a flat light grey so "no change" is visibly counted
          img.data[p * 4] = Math.round(img.data[p * 4] * 0.5 + 125); img.data[p * 4 + 1] = Math.round(img.data[p * 4 + 1] * 0.5 + 125); img.data[p * 4 + 2] = Math.round(img.data[p * 4 + 2] * 0.5 + 125);
          continue;
        }
        const a = c[3];
        img.data[p * 4] = Math.round(img.data[p * 4] * (1 - a) + c[0] * a);
        img.data[p * 4 + 1] = Math.round(img.data[p * 4 + 1] * (1 - a) + c[1] * a);
        img.data[p * 4 + 2] = Math.round(img.data[p * 4 + 2] * (1 - a) + c[2] * a);
      }
      ctx.putImageData(img, 0, 0);
      drawLegend(ctx, w, h, o.band);
      state.stats = { lo: lo, hi: hi, n: zeroed.n, shift: zeroed.shift, tilt: zeroed.tilt };
      info.textContent = zeroed.n
        ? ('Zero ' + (o.zero === 'raw' ? 'not set (raw difference)' : 'set at the median change of ' + zeroed.n + ' map cells (shift removed: ' + fmt(zeroed.shift) + ' in)') +
          '. Range ' + fmt(lo) + ' to ' + fmt(hi) + ' in. Cool = lower than the typical change, warm = higher.')
        : 'The two maps do not overlap. Check the alignment points.';
    }
    draw();
  }

  function fmt(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1); }

  function drawLegend(ctx, w, h, band) {
    const bw = Math.round(w * 0.03); const bh = Math.round(h * 0.28);
    const x = w - bw - Math.round(w * 0.04); const y = Math.round(h * 0.08);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x - 8, y - 22, bw + 74, bh + 34);
    ctx.fillStyle = '#222'; ctx.font = Math.max(11, Math.round(w * 0.012)) + 'px sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('inches', x - 2, y - 11);
    for (let i = 0; i < bh; i += 1) {
      const v = 1.2 - (2.4 * i) / bh;
      const c = core.changeColor(v, band, 1.2);
      ctx.fillStyle = c ? 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + c[3] + ')' : '#cfcfcf';
      ctx.fillRect(x, y + i, bw, 1);
    }
    ctx.fillStyle = '#222';
    [[1.2, '+1.2'], [0.6, '+0.6'], [0, '0'], [-0.6, '−0.6'], [-1.2, '−1.2']].forEach(function (p) {
      const yy = y + ((1.2 - p[0]) / 2.4) * bh;
      ctx.fillText(p[1], x + bw + 6, Math.min(y + bh - 4, Math.max(y + 4, yy)));
    });
    ctx.restore();
  }

  function savePng() {
    const src = overlay.querySelector('#sc-out');
    if (!src) return;
    const pad = 70;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height + pad;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = '#111'; ctx.textBaseline = 'top';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('Relative movement: ' + state.slots[0].src.name + ' → ' + state.slots[1].src.name, 16, src.height + 10);
    ctx.font = '13px sans-serif';
    const s = state.stats || {};
    ctx.fillText('Zero ' + (state.opts.zero === 'raw' ? 'not set' : 'at the median change (' + fmt(s.shift || 0) + ' in removed)') + '. Neutral band ±' + state.opts.band + ' in. Read from the maps\' own colours: good to about one legend band.', 16, src.height + 38);
    out.toBlob(function (blob) {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'relative-movement.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }, 'image/png');
  }

  window.ToolboxSurveyCompare = { open: open, close: close, core: core, _state: function () { return state; }, _render: function () { render(); } };
})();
