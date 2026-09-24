/**
 * Floor Survey field-data recovery sheet.
 *
 * One always-current PDF of the entire plan, not the zoomed viewport.
 * Reuses the existing full-canvas PDF encoder (`canvasToPdfBlob`). The Export
 * tab's topo renderer is a presentation figure (contours, legend, title
 * block) and is not the field evidence, so this sheet draws the plan plus
 * every plotted reading the way the field canvas does — in plan coordinates,
 * with the live pan/zoom left untouched.
 */
import type { Floor, SurveyPoint } from "./types";
import { zoneOfXY } from "./exclusions";
import { formatDelta, transitionDelta } from "./transitions";
import { canvasToPdfBlob } from "./pdf";

/** Live pan/zoom. Accepted and ignored so a zoomed view cannot crop the sheet. */
export type RecoveryViewport = {
  scale: number;
  tx: number;
  ty: number;
  viewWidth: number;
  viewHeight: number;
};

const TARGET_LONG_SIDE = 2000;
const MAX_RENDER_SCALE = 3;

export function recoveryCanvasSize(planWidth?: number, planHeight?: number) {
  const planW = Math.max(1, Math.round(planWidth || 1000));
  const planH = Math.max(1, Math.round(planHeight || 750));
  const longSide = Math.max(planW, planH);
  const scale = Math.min(MAX_RENDER_SCALE, Math.max(1, TARGET_LONG_SIDE / longSide));
  return {
    planWidth: planW,
    planHeight: planH,
    scale,
    width: Math.max(1, Math.round(planW * scale)),
    height: Math.max(1, Math.round(planH * scale)),
  };
}

export function recoveryReadingLabel(point: SurveyPoint, floor: Floor): string {
  const valueText = Number.isFinite(point.value) ? point.value.toFixed(2) : "—";
  const transition = point.transitionId
    ? floor.transitions?.find((item) => item.id === point.transitionId)
    : undefined;
  if (transition && !point.isTransitionAnchor) {
    return `${valueText}${formatDelta(transitionDelta(transition, floor.transitionGroupAverages))}`;
  }
  return valueText;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Floor plan image failed to load"));
    img.src = src;
  });
}

function roundRect(
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

function drawPlanImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  floor: Floor,
) {
  ctx.save();
  const planTransform = floor.planTransform;
  if (planTransform) {
    const cx = imgW / 2;
    const cy = imgH / 2;
    ctx.translate(cx + planTransform.tx, cy + planTransform.ty);
    ctx.rotate(planTransform.rotation);
    ctx.scale(planTransform.scale, planTransform.scale);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(img, 0, 0, imgW, imgH);
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  anchorY: number,
  fontPx: number,
  imgW: number,
  imgH: number,
) {
  ctx.font = `bold ${fontPx}px sans-serif`;
  const padX = fontPx * 0.28;
  const padY = fontPx * 0.16;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = fontPx + padY * 2;
  let x = anchorX + fontPx * 0.45;
  let y = anchorY - boxH * 0.2;
  if (x + boxW > imgW - 2) x = anchorX - fontPx * 0.45 - boxW;
  if (x < 2) x = 2;
  if (y < 2) y = 2;
  if (y + boxH > imgH - 2) y = Math.max(2, imgH - 2 - boxH);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, boxW, boxH, Math.max(2, fontPx * 0.18));
  ctx.fill();
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = Math.max(1, fontPx * 0.06);
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + boxW / 2, y + boxH / 2);
  return { x, y, boxW, boxH };
}

/**
 * Raster of the whole plan and every current reading.
 * `viewport` is not read — zoom and pan must not crop or reframe this sheet.
 */
export async function renderFloorSurveyRecoveryCanvas(options: {
  floor: Floor;
  points: SurveyPoint[];
  viewport?: RecoveryViewport | null;
}): Promise<HTMLCanvasElement> {
  const { floor, points } = options;
  const size = recoveryCanvasSize(floor.planWidth, floor.planHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Recovery canvas is unavailable");

  ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.planWidth, size.planHeight);

  if (floor.planDataUrl) {
    const img = await loadImage(floor.planDataUrl);
    drawPlanImage(ctx, img, size.planWidth, size.planHeight, floor);
  } else {
    ctx.strokeStyle = "#d6d3d1";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size.planWidth - 2, size.planHeight - 2);
  }

  const longSide = Math.max(size.planWidth, size.planHeight);
  const fontPx = Math.max(12, Math.min(48, longSide * 0.022));
  const markerR = Math.max(3.5, fontPx * 0.28);

  const ordered = points.slice().sort((a, b) => a.index - b.index);
  for (const point of ordered) {
    const isAnchor = !!point.isTransitionAnchor;
    if (isAnchor) {
      const r = markerR + fontPx * 0.12;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - r);
      ctx.lineTo(point.x + r, point.y);
      ctx.lineTo(point.x, point.y + r);
      ctx.lineTo(point.x - r, point.y);
      ctx.closePath();
      ctx.fillStyle = "#eab308";
      ctx.fill();
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = Math.max(1, fontPx * 0.06);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, markerR, 0, Math.PI * 2);
      ctx.fillStyle = point.isBasePoint ? "#16a34a" : "#dc2626";
      ctx.fill();
    }

    const labelBox = drawLabel(
      ctx,
      recoveryReadingLabel(point, floor),
      point.x,
      point.y,
      fontPx,
      size.planWidth,
      size.planHeight,
    );
    const zone = zoneOfXY(point.x, point.y, floor.exclusions);
    if (zone?.label) {
      ctx.font = `${Math.max(9, fontPx * 0.72)}px sans-serif`;
      ctx.fillStyle = "rgba(75,85,99,0.95)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(zone.label, labelBox.x, labelBox.y + labelBox.boxH + fontPx * 0.12);
    }
  }

  const notes = floor.notes ?? [];
  const noteR = Math.max(8, fontPx * 0.62);
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    ctx.beginPath();
    ctx.arc(note.x, note.y, noteR, 0, Math.PI * 2);
    ctx.fillStyle = "#f97316";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, fontPx * 0.08);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(10, noteR)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), note.x, note.y);
  }

  return canvas;
}

export function recoveryCanvasToPdfBlob(canvas: HTMLCanvasElement): Blob {
  const blob = canvasToPdfBlob(canvas);
  if (!blob || blob.size < 64) throw new Error("Recovery PDF was empty");
  return blob;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read recovery PDF"));
    reader.readAsDataURL(blob);
  });
}

type RecoveryRenderer = typeof renderFloorSurveyRecoveryCanvas;
let recoveryRendererOverride: RecoveryRenderer | null = null;

/** Test-only. Production Save uses the real full-canvas renderer. */
export function setRecoveryRendererForTests(renderer: RecoveryRenderer | null) {
  recoveryRendererOverride = renderer;
}

export async function renderRecoveryForSave(options: {
  floor: Floor;
  points: SurveyPoint[];
  viewport?: RecoveryViewport | null;
}): Promise<HTMLCanvasElement> {
  const render = recoveryRendererOverride ?? renderFloorSurveyRecoveryCanvas;
  return render(options);
}
