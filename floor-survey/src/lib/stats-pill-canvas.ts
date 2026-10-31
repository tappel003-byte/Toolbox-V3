/**
 * H / L / Δ pill drawn on the plan (image coordinates).
 *
 * Data and Topo both use this so the pill pans, zooms, and stays where placed
 * on either screen. Size −/+ still sets the base (shared capture size key).
 */

import { areaCentroid } from "@/lib/areas";
import { STATS_PILL_COLORS, statsPillFont, statsPillPad, statsPillText } from "@/lib/stats-pill";
import type { TopoArea } from "@/lib/types";

export const DEFAULT_STATS_PILL_SIZE = 28;

type PillSeg = { kind: "label" | "hi" | "lo" | "delta"; text: string; w: number };

function measureLabel(text: string, fontPx: number, weight: string) {
  if (typeof document === "undefined") {
    return { w: text.length * fontPx * 0.55, h: fontPx };
  }
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return { w: text.length * fontPx * 0.55, h: fontPx };
  ctx.font = `${weight} ${fontPx}px sans-serif`;
  return { w: ctx.measureText(text).width, h: fontPx };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Segment layout + typography for one pill, in image coords. */
export function pillMetrics(
  h: number,
  label: string | null,
  hi: number,
  lo: number,
  dec: number,
) {
  const font = statsPillFont(h);
  const pad = statsPillPad(h);
  const seg = (kind: PillSeg["kind"], text: string): PillSeg => ({
    kind,
    text,
    w: measureLabel(text, font, "600").w + pad * 2,
  });
  const segs: PillSeg[] = [];
  if (label) segs.push(seg("label", label));
  segs.push(seg("hi", statsPillText("H", hi.toFixed(dec))));
  segs.push(seg("lo", statsPillText("L", lo.toFixed(dec))));
  segs.push(seg("delta", statsPillText("\u0394", (hi - lo).toFixed(dec))));
  const total = segs.reduce((s, x) => s + x.w, 0);
  return { font, pad, h, segs, total };
}

/** Pill center in image coords for an area (offset by stored pillDx/pillDy). */
export function pillCenter(
  area: TopoArea,
  live?: { dx: number; dy: number } | null,
) {
  const c = areaCentroid(area);
  const dx = live ? live.dx : (area.pillDx ?? 0);
  const dy = live ? live.dy : (area.pillDy ?? 0);
  return { cx: c.x + dx, cy: c.y + dy };
}

/** Hit-test a pill in image coords. */
export function hitStatsPill(
  x: number,
  y: number,
  area: TopoArea,
  h: number,
  hi: number,
  lo: number,
  dec: number,
  label: string | null,
): boolean {
  const m = pillMetrics(h, label, hi, lo, dec);
  const { cx, cy } = pillCenter(area);
  const x0 = cx - m.total / 2;
  const y0 = cy - h / 2;
  return x >= x0 && x <= x0 + m.total && y >= y0 && y <= y0 + h;
}

/** Draw a rounded H / L / Δ pill centered on `center`, in image coords. */
export function drawStatsPillAt(
  ctx: CanvasRenderingContext2D,
  opts: {
    h: number;
    label: string | null;
    hi: number;
    lo: number;
    dec: number;
    center: { cx: number; cy: number };
    dragging?: boolean;
  },
) {
  const { h, label, hi, lo, dec, center, dragging = false } = opts;
  const m = pillMetrics(h, label, hi, lo, dec);
  const x0 = center.cx - m.total / 2;
  const y0 = center.cy - h / 2;

  ctx.save();
  ctx.globalAlpha = 1;
  roundRectPath(ctx, x0, y0, m.total, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.lineWidth = dragging ? Math.max(1, h * 0.08) : Math.max(0.6, h * 0.045);
  ctx.strokeStyle = dragging ? "#17130e" : "#cbd0d6";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let sx = x0;
  m.segs.forEach((s, i) => {
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(sx, y0 + h * 0.18);
      ctx.lineTo(sx, y0 + h * 0.82);
      ctx.strokeStyle = "#e2e5e9";
      ctx.lineWidth = Math.max(0.5, h * 0.035);
      ctx.stroke();
    }
    ctx.font = `600 ${m.font}px sans-serif`;
    ctx.fillStyle =
      s.kind === "hi"
        ? STATS_PILL_COLORS.hi
        : s.kind === "lo"
          ? STATS_PILL_COLORS.lo
          : s.kind === "delta"
            ? STATS_PILL_COLORS.delta
            : STATS_PILL_COLORS.label;
    ctx.fillText(s.text, sx + s.w / 2, center.cy);
    sx += s.w;
  });
  ctx.restore();
}
