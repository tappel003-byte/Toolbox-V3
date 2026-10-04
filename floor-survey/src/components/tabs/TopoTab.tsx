import { useEffect, useMemo, useRef, useState } from "react";
import { PlanCanvas, type PlanCamera } from "../PlanCanvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  autoStatsChipSize,
  clearStatsChipSize,
  getStatsChipSize,
  setStatsChipSize,
  STATS_CHIP_MAX,
  STATS_CHIP_MIN,
  STATS_CHIP_SIZE_EVENT,
} from "@/components/chrome/StatsChip";
import { screenAnchoredImageSize } from "@/lib/screen-size";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Undo2, X, Waves, Palette, Tag, SlidersHorizontal, Minus, Plus } from "lucide-react";
import type { Floor, RenderSettings, SurveyPoint, TopoArea } from "@/lib/types";
import { defaultRenderSettings } from "@/lib/types";
import { TopoDiagnosticPanel } from "../TopoDiagnosticPanel";
import {
  TOPO_GRID_TARGET_COLS,
  buildGrid,
  clampValue,
  computeContours,
  contourThresholds,
  type Grid,
} from "@/lib/topo";
import { savePoint, saveFloor } from "@/lib/db";
import { pointsOutsideExclusions } from "@/lib/exclusions";
import {
  areaCentroid,
  closedAreas,
  exclusionsForArea,
  getAreas,
  pointsInArea,
  withAreas,
} from "@/lib/areas";

/** One area's own contour surface plus its own High / Low. */
export interface AreaTopo {
  area: TopoArea;
  points: SurveyPoint[];
  grid: Grid;
  contours: ReturnType<typeof computeContours>;
  hi: SurveyPoint;
  lo: SurveyPoint;
}

/** Points inside one area and outside the exclusion zones that fall in it.
 *  Used for that area's contour surface and its High/Low pins. */
export function areaCandidates(pts: SurveyPoint[], floor: Floor, area: TopoArea) {
  return pointsOutsideExclusions(pointsInArea(pts, area), exclusionsForArea(area, floor.exclusions));
}

function hiLoOf(pts: SurveyPoint[]) {
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p.value > hi.value) hi = p;
    if (p.value < lo.value) lo = p;
  }
  return { hi, lo };
}

/**
 * Grid the color/elevation legend should label for a single-surface view.
 * One closed boundary on a Customer File level is one surface and uses that
 * surface. Several boundaries on that same level each keep their own contour
 * range and their own legend on All boundaries.
 * A Customer File level is not a topo boundary.
 */
export function legendGridFor(areaTopos: AreaTopo[]): Grid | null {
  if (areaTopos.length === 0) return null;
  return areaTopos[0].grid;
}

/** Top-left image-coord anchor for a boundary's own color legend. */
export function areaLegendAnchor(area: TopoArea): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of area.polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 24, y: 24 };
  return { x: minX + 8, y: minY + 8 };
}

/** Build one contour surface + High/Low per area with at least 3 usable points. */
export function buildAreaTopos(
  floor: Floor,
  points: SurveyPoint[],
  settings: RenderSettings,
  onlyAreaId?: string | null,
): AreaTopo[] {
  const out: AreaTopo[] = [];
  for (const area of closedAreas(floor)) {
    if (onlyAreaId && area.id !== onlyAreaId) continue;
    const pts = areaCandidates(points, floor, area);
    if (pts.length < 3) continue;
    const exPolys = exclusionsForArea(area, floor.exclusions).map((e) => e.polygon);
    const grid = buildGrid(pts, area.polygon, TOPO_GRID_TARGET_COLS, exPolys);
    if (!grid) continue;
    const contours = computeContours(grid, contourOptions(grid, settings));
    const { hi, lo } = hiLoOf(pts);
    out.push({ area, points: pts, grid, contours, hi, lo });
  }
  return out;
}


interface Props {
  floor: Floor;
  points: SurveyPoint[];
  onPointsChange: (points: SurveyPoint[]) => void;
  onFloorChange: (floor: Floor) => void;
  settings: RenderSettings;
  onSettingsChange: (s: RenderSettings) => void;
  selectedIds?: Set<string>;
  pointSize?: number;
  pointColor?: string;
  excludedIds?: Set<string>;
  onExcludedIdsChange?: (ids: Set<string>) => void;
  /** null = "All areas". Owned by the route so the stats pills stay in sync. */
  selectedAreaId?: string | null;
  onSelectedAreaIdChange?: (id: string | null) => void;
  /** Tap H or L on an area's stats pill to highlight that point. */
  onHighlight?: (p: SurveyPoint) => void;
  /** Report Builder hosts this same view on a slide. It needs to read the view
   *  the investigator sets, and to put a locked one back. */
  onCamera?: (camera: PlanCamera) => void;
  cameraRequest?: (PlanCamera & { nonce: number }) | null;
  /** Report Builder draws its own colour scale, pill and High/Low markers as
   *  placed boxes, so the drawing carries none of them. */
  hideCanvasChrome?: boolean;
  /**
   * The host owns these render settings and persists them itself.
   *
   * The field app remembers the legend size on the device, and did it by
   * writing localStorage into the settings on mount -- which meant a host that
   * passed settings in had them overwritten by a device-local value every time
   * the view opened, and then had its own value written back out over the
   * device's. A report that stored a legend size could not keep it, and sizing
   * a legend on one job changed it on every other job on that iPad.
   *
   * When the host owns the settings, this view neither reads nor writes that
   * key. It renders what it is given and reports changes back.
   */
  settingsOwnedByHost?: boolean;
  /**
   * Draw the H / L / delta pill on the canvas even when the level has a single
   * boundary.
   *
   * In the field a lone surface uses the floating StatsChip instead, which is
   * positioned against the browser window. A report slide is a page, not a
   * window, so that pill has nowhere to live -- and a one-boundary level would
   * be the only page in the book with no pill on it. With this on, one boundary
   * is drawn exactly the way five are.
   */
  statsPillForSingleBoundary?: boolean;
  /**
   * Nothing but the controls: the Contours, Palette and Labels panels stacked,
   * with no canvas. This is what Report Builder's rail renders, so the rail
   * shows the same controls the field app does rather than a rebuilt set that
   * would drift from them.
   */
  controlsOnly?: boolean;
  /** A picture on a page: no pan, no zoom, the plan fits its frame. */
  staticView?: boolean;
  /** Corner grips that resize the drawing, alongside pan and wheel zoom. */
  resizeCorners?: boolean;
  /**
   * Nothing but the canvas.
   *
   * The boundary selector, the Contours / Palette / Labels icons and the
   * diagnostic points panel are positioned against the viewport, which is
   * right when this view owns the screen and wrong when it is living inside a
   * report sheet -- they escape the page and float over the application. They
   * are not contained here; on a slide they belong in Report Builder's rail,
   * where the controls for whatever is on the page live. So the canvas is
   * handed over bare and the rail drives it through props.
   */
  chromeless?: boolean;
}

const DEFAULT_LABEL_DX = 8;
const DEFAULT_LABEL_DY = 6;
const LONG_PRESS_MS = 350;

// Pin geometry — matches drawPin(). Pin box is centered horizontally on the
// point, sitting above it. These functions keep hit-testing and rendering aligned
// as the user changes the High/Low pin size.
function pinHeight(fontPx: number) {
  return Math.round(fontPx * 1.82);
}
function pinTopOffset(fontPx: number) {
  return -Math.round(pinHeight(fontPx) * 1.4);
}
function pinMinWidth(fontPx: number) {
  return Math.round(fontPx * 3.64);
}
function pinPadding(fontPx: number) {
  return Math.round(fontPx * 1.27);
}
function pinCornerRadius(fontPx: number) {
  return Math.round(fontPx * 0.91);
}
function pinStrokeWidth(fontPx: number, highlighted: boolean) {
  return highlighted ? Math.max(1.5, fontPx * 0.23) : Math.max(1, fontPx * 0.18);
}

// Offscreen ctx for text width measurement in event handlers
let measureCtx: CanvasRenderingContext2D | null = null;
function measureLabel(text: string, fontPx: number, weight: string) {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  if (!measureCtx) return { w: text.length * fontPx * 0.6, h: fontPx };
  measureCtx.font = `${weight} ${fontPx}px sans-serif`;
  return { w: measureCtx.measureText(text).width, h: fontPx };
}

function pinWidth(text: string, fontPx: number) {
  const { w } = measureLabel(text, fontPx, "bold");
  return Math.max(pinMinWidth(fontPx), w + pinPadding(fontPx) * 2);
}

// Where the label sits (top-left corner) for a given point in image coords.
// `k` = 1 / canvas zoom, so the default offset stays screen-constant.
function labelAnchor(p: SurveyPoint, k = 1) {
  return {
    x: p.x + (p.labelDx ?? DEFAULT_LABEL_DX * k),
    y: p.y + (p.labelDy ?? DEFAULT_LABEL_DY * k),
  };
}

/* ---------------------------------------------------------------------------
 * H / L / Δ stats pill — drawn on the canvas for multi-area Topo only.
 * One surface / one boundary uses the floating StatsChip instead, so the
 * same readout is not drawn twice. Sized like point labels: chosen screen
 * px holds when fit-scaled out, grows gently when zoomed in.
 * ------------------------------------------------------------------------- */

export const DEFAULT_STATS_PILL_SIZE = 28;

/** Pill height in IMAGE coords for a given base (screen px) and zoom. */
function pillHeightImg(base: number, viewScale: number) {
  return screenAnchoredImageSize(base, viewScale);
}

type PillSeg = { kind: "label" | "hi" | "lo" | "delta"; text: string; w: number };

/** Segment layout + typography for one pill, in image coords. */
function pillMetrics(h: number, label: string | null, hi: number, lo: number, dec: number) {
  const font = Math.max(4, h * 0.42);
  const pad = Math.max(2, h * 0.22);
  const seg = (kind: PillSeg["kind"], text: string): PillSeg => ({
    kind,
    text,
    w: measureLabel(text, font, "600").w + pad * 2,
  });
  const segs: PillSeg[] = [];
  if (label) segs.push(seg("label", label));
  segs.push(seg("hi", `H ${hi.toFixed(dec)}`));
  segs.push(seg("lo", `L ${lo.toFixed(dec)}`));
  segs.push(seg("delta", `\u0394${(hi - lo).toFixed(dec)}`));
  const total = segs.reduce((s, x) => s + x.w, 0);
  return { font, pad, h, segs, total };
}

/** Pill center in image coords for an area. */
/**
 * Does the canvas carry the H / L / delta pill?
 *
 * The field app draws it per boundary when a level has more than one, and
 * leaves a lone surface to the floating StatsChip. A report slide has no
 * window to float against, so it asks for the pill on one boundary too.
 *
 * This is one function because the drawing and the hit test must agree: when
 * they disagree, a pill is drawn where it cannot be grabbed.
 */
function statsPillOnCanvas(
  settings: RenderSettings,
  areaCount: number,
  forSingleBoundary: boolean,
): boolean {
  if (settings.showStatsPill === false) return false;
  return areaCount > 1 || (forSingleBoundary && areaCount === 1);
}

function pillCenter(area: TopoArea, live?: { dx: number; dy: number } | null) {
  const c = areaCentroid(area);
  const dx = live ? live.dx : (area.pillDx ?? 0);
  const dy = live ? live.dy : (area.pillDy ?? 0);
  return { cx: c.x + dx, cy: c.y + dy };
}



export function TopoTab({
  floor,
  points,
  onPointsChange,
  onFloorChange,
  settings,
  onSettingsChange,
  selectedIds,
  pointSize = 6,
  pointColor = "#dc2626",
  excludedIds: excludedIdsProp,
  onExcludedIdsChange,
  selectedAreaId = null,
  onSelectedAreaIdChange,
  onHighlight,
  onCamera,
  cameraRequest,
  hideCanvasChrome = false,
  settingsOwnedByHost = false,
  statsPillForSingleBoundary = false,
  chromeless = false,
  controlsOnly = false,
  staticView = false,
  resizeCorners = false,
}: Props) {
  const selectedId =
    selectedIds && selectedIds.size > 0 ? (selectedIds.values().next().value ?? null) : null;
  const [openCorner, setOpenCorner] = useState<null | "contours" | "palette" | "labels">(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  // Stats pill (High/Low/Δ chip) size — Auto by viewport, or a locked local size.
  const [statsChipLocked, setStatsChipLocked] = useState<number | null>(null);
  const [statsChipAuto, setStatsChipAuto] = useState(28);
  useEffect(() => {
    setStatsChipLocked(getStatsChipSize());
    setStatsChipAuto(autoStatsChipSize());
    const onResize = () => setStatsChipAuto(autoStatsChipSize());
    const onSize = (e: Event) => {
      const detail = (e as CustomEvent<number | null>).detail;
      setStatsChipLocked(typeof detail === "number" ? detail : null);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    };
  }, []);
  const statsChipSize = statsChipLocked ?? statsChipAuto;
  const [legendDrag, setLegendDrag] = useState<{
    areaId: string;
    /** Pointer offset inside the legend box. */
    dx: number;
    dy: number;
    /** Live legendDx/legendDy while dragging a per-boundary legend. */
    legendDx: number;
    legendDy: number;
  } | null>(null);
  // Topo boundary selector (All boundaries / named border) — drag to clear the plan.
  const BOUNDARY_SELECT_KEY = `topo.boundary-select:${floor.id}`;
  const [boundarySelectPos, setBoundarySelectPos] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`topo.boundary-select:${floor.id}`);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  });
  const boundarySelectDrag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BOUNDARY_SELECT_KEY);
      setBoundarySelectPos(raw ? JSON.parse(raw) : null);
    } catch {
      setBoundarySelectPos(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id]);
  // Current canvas zoom — labels are drawn at a screen-constant size.
  const [viewScale, setViewScale] = useState(1);
  // On a report slide the colour scale, the H/L/delta pill and the High and Low
  // markers are placed boxes that are moved, sized and locked on the page, so
  // the drawing itself carries none of them. Anything drawn into the canvas is
  // stuck where it was drawn.
  const resolved = hideCanvasChrome
    ? resolveSettings({
        ...resolveSettings(settings),
        showLegend: false,
        showStatsPill: false,
        showHighLow: false,
      })
    : resolveSettings(settings);

  // Persist legend scale/position across sessions (localStorage). Defaults: 1.5×.
  const LEGEND_STORAGE_KEY = "topo.legend.v1";
  const legendHydratedRef = useRef(false);
  useEffect(() => {
    if (settingsOwnedByHost) return;
    if (legendHydratedRef.current) return;
    legendHydratedRef.current = true;
    if (typeof window === "undefined") return;
    let stored: { scale?: number; x?: number; y?: number } | null = null;
    try {
      const raw = window.localStorage.getItem(LEGEND_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
    const patch: Partial<RenderSettings> = {};
    if (stored && typeof stored.scale === "number") patch.legendScale = stored.scale;
    else patch.legendScale = 1.5;
    if (stored && typeof stored.x === "number") patch.legendX = stored.x;
    if (stored && typeof stored.y === "number") patch.legendY = stored.y;
    onSettingsChange(resolveSettings({ ...resolved, ...patch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (settingsOwnedByHost) return;
    if (!legendHydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        LEGEND_STORAGE_KEY,
        JSON.stringify({
          scale: resolved.legendScale ?? 1.5,
          x: resolved.legendX,
          y: resolved.legendY,
        }),
      );
    } catch {
      /* ignore quota */
    }
  }, [resolved.legendScale, resolved.legendX, resolved.legendY]);


  // Live drag (long-press-and-drag). One kind at a time: a point label, a H/L
  // pin, or an area's stats pill.
  type DragKind = "label" | "pin-high" | "pin-low" | "pill";
  const [drag, setDrag] = useState<{
    kind: DragKind;
    id: string; // point id for "label", area id for "pill", floor id for pins
    dx: number;
    dy: number;
    startPointerX: number;
    startPointerY: number;
    startDx: number;
    startDy: number;
    active: boolean; // true after long-press fires
  } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  // Point to highlight if the current pill press ends as a tap (no drag).
  const pillTapRef = useRef<SurveyPoint | null>(null);
  type LastMove =
    | { kind: "label"; id: string; prevDx: number | undefined; prevDy: number | undefined }
    | { kind: "pin-high" | "pin-low"; prevDx: number | undefined; prevDy: number | undefined }
    | { kind: "pill"; id: string; prevDx: number | undefined; prevDy: number | undefined };
  const [lastMove, setLastMove] = useState<LastMove | null>(null);

  // Diagnostic exclusion (Topo-only, session-only). Removed points do NOT
  // affect stored data — they're just skipped by the contour math on this tab.
  // Controlled from the route when props are provided so StatsChip can share the set.
  const [excludedIdsLocal, setExcludedIdsLocal] = useState<Set<string>>(() => new Set());
  const excludedIds = excludedIdsProp ?? excludedIdsLocal;
  const setExcludedIds = (ids: Set<string>) => {
    if (onExcludedIdsChange) onExcludedIdsChange(ids);
    else setExcludedIdsLocal(ids);
  };
  const [diagOpen, setDiagOpen] = useState(false);
  useEffect(() => {
    if (onExcludedIdsChange) onExcludedIdsChange(new Set());
    else setExcludedIdsLocal(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id]);

  const visiblePoints = useMemo(
    () => (excludedIds.size ? points.filter((p) => !excludedIds.has(p.id)) : points),
    [points, excludedIds],
  );

  const areas = useMemo(() => closedAreas(floor), [floor]);

  // One contour surface + High/Low per area. Focused on a single area, only
  // that area is computed; "All areas" computes them all.
  const areaTopos = useMemo(
    () => buildAreaTopos(floor, visiblePoints, resolved, selectedAreaId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      floor,
      visiblePoints,
      selectedAreaId,
      resolved.firstContour,
      resolved.contourStep,
      resolved.contourCount,
      resolved.minClamp,
      resolved.maxClamp,
    ],
  );

  const canRender = areaTopos.length > 0;
  // Single-surface view (focused area, or only one area exists).
  const soloTopo = areaTopos.length === 1 ? areaTopos[0] : null;
  const gridAndContours = soloTopo ? { grid: soloTopo.grid, contours: soloTopo.contours } : null;

  const update = (patch: Partial<RenderSettings>) =>
    onSettingsChange(resolveSettings({ ...resolved, ...patch }));

  // High / Low of the focused area (used for pin hit-testing / dragging).
  const hiLo = soloTopo ? { hi: soloTopo.hi, lo: soloTopo.lo } : null;

  // Whether the canvas carries the H / L / delta pill. One definition, used by
  // both the drawing and the hit test: when those two disagreed about where a
  // piece of chrome was, it drew in one place and could be grabbed in another.
  const canvasStatsPill = statsPillOnCanvas(resolved, areaTopos.length, statsPillForSingleBoundary);




  type Hit =
    | { kind: "label"; point: SurveyPoint }
    | { kind: "pin-high" | "pin-low"; point: SurveyPoint; dx: number; dy: number }
    | { kind: "pill"; areaId: string; dx: number; dy: number; tapPoint: SurveyPoint | null };

  function hitDraggable(x: number, y: number): Hit | null {
    if (canvasStatsPill) {
      const h = pillHeightImg(statsChipSize, viewScale);
      const showLabel = true;
      const dec = resolved.decimalPlaces;
      for (let i = areaTopos.length - 1; i >= 0; i--) {
        const at = areaTopos[i];
        const m = pillMetrics(h, showLabel ? at.area.name : null, at.hi.value, at.lo.value, dec);
        const { cx, cy } = pillCenter(at.area);
        const x0 = cx - m.total / 2;
        const y0 = cy - h / 2;
        if (x < x0 || x > x0 + m.total || y < y0 || y > y0 + h) continue;
        let sx = x0;
        let tapPoint: SurveyPoint | null = null;
        for (const s of m.segs) {
          if (x >= sx && x <= sx + s.w) {
            if (s.kind === "hi") tapPoint = at.hi;
            else if (s.kind === "lo") tapPoint = at.lo;
            break;
          }
          sx += s.w;
        }
        return {
          kind: "pill",
          areaId: at.area.id,
          dx: at.area.pillDx ?? 0,
          dy: at.area.pillDy ?? 0,
          tapPoint,
        };
      }
    }
    // Pins next — they sit above the point dot and are visually on top.
    if (resolved.showHighLow && hiLo && gridAndContours?.grid && resolved.mode !== "points-only") {
      const check = (kind: "pin-high" | "pin-low", pt: SurveyPoint, dx: number, dy: number) => {
        const fontPx = resolved.highLowPinSize;
        const w = pinWidth(kind === "pin-high" ? "High" : "Low", fontPx);
        const cx = pt.x + dx;
        const top = pt.y + pinTopOffset(fontPx) + dy;
        return x >= cx - w / 2 && x <= cx + w / 2 && y >= top && y <= top + pinHeight(fontPx);
      };
      const hDx = floor.highPinDx ?? 0;
      const hDy = floor.highPinDy ?? 0;
      const lDx = floor.lowPinDx ?? 0;
      const lDy = floor.lowPinDy ?? 0;
      if (check("pin-high", hiLo.hi, hDx, hDy))
        return { kind: "pin-high", point: hiLo.hi, dx: hDx, dy: hDy };
      if (check("pin-low", hiLo.lo, lDx, lDy))
        return { kind: "pin-low", point: hiLo.lo, dx: lDx, dy: lDy };
    }
    // Point-number labels
    if (resolved.showPoints) {
      const fontBase = resolved.pointLabelFontSize;
      const fontPx = screenAnchoredImageSize(fontBase, viewScale || 1);
      const k = fontPx / fontBase;
      const dec = resolved.decimalPlaces;
      const weight = resolved.pointLabelWeight;
      const pad = 4 * k;
      for (const p of visiblePoints) {
        const text = p.value.toFixed(dec);
        const { w, h } = measureLabel(text, fontPx, weight);
        const a = labelAnchor(p, k);
        if (x >= a.x - pad && x <= a.x + w + pad && y >= a.y - pad && y <= a.y + h + pad) {
          return { kind: "label", point: p };
        }
      }
    }
    return null;
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function commitLabelMove(id: string, dx: number, dy: number) {
    const p = points.find((pt) => pt.id === id);
    if (!p) return;
    setLastMove({ kind: "label", id, prevDx: p.labelDx, prevDy: p.labelDy });
    const updated: SurveyPoint = { ...p, labelDx: dx, labelDy: dy };
    onPointsChange(points.map((pt) => (pt.id === id ? updated : pt)));
    savePoint(updated).catch(() => {});
  }

  function commitPinMove(kind: "pin-high" | "pin-low", dx: number, dy: number) {
    const prevDx = kind === "pin-high" ? floor.highPinDx : floor.lowPinDx;
    const prevDy = kind === "pin-high" ? floor.highPinDy : floor.lowPinDy;
    setLastMove({ kind, prevDx, prevDy });
    const updated: Floor =
      kind === "pin-high"
        ? { ...floor, highPinDx: dx, highPinDy: dy }
        : { ...floor, lowPinDx: dx, lowPinDy: dy };
    onFloorChange(updated);
    saveFloor(updated).catch(() => {});
  }


  /** Write a pill offset onto one area of this floor. */
  function applyPillOffset(areaId: string, dx: number | undefined, dy: number | undefined) {
    const next = getAreas(floor).map((a) =>
      a.id === areaId ? { ...a, pillDx: dx, pillDy: dy } : a,
    );
    const updated = withAreas(floor, next);
    onFloorChange(updated);
    saveFloor(updated).catch(() => {});
  }

  /** Write a color-legend offset onto one area of this floor. */
  function applyLegendOffset(areaId: string, dx: number | undefined, dy: number | undefined) {
    const next = getAreas(floor).map((a) =>
      a.id === areaId ? { ...a, legendDx: dx, legendDy: dy } : a,
    );
    const updated = withAreas(floor, next);
    onFloorChange(updated);
    saveFloor(updated).catch(() => {});
  }

  function commitPillMove(areaId: string, dx: number, dy: number) {
    const prev = getAreas(floor).find((a) => a.id === areaId);
    setLastMove({ kind: "pill", id: areaId, prevDx: prev?.pillDx, prevDy: prev?.pillDy });
    applyPillOffset(areaId, dx, dy);
  }

  function undoLastMove() {
    if (!lastMove) return;
    if (lastMove.kind === "label") {
      const p = points.find((pt) => pt.id === lastMove.id);
      if (!p) {
        setLastMove(null);
        return;
      }
      const updated: SurveyPoint = { ...p, labelDx: lastMove.prevDx, labelDy: lastMove.prevDy };
      onPointsChange(points.map((pt) => (pt.id === lastMove.id ? updated : pt)));
      savePoint(updated).catch(() => {});
    } else if (lastMove.kind === "pill") {
      applyPillOffset(lastMove.id, lastMove.prevDx, lastMove.prevDy);
    } else {
      const updated: Floor =
        lastMove.kind === "pin-high"
          ? { ...floor, highPinDx: lastMove.prevDx, highPinDy: lastMove.prevDy }
          : { ...floor, lowPinDx: lastMove.prevDx, lowPinDy: lastMove.prevDy };
      onFloorChange(updated);
      saveFloor(updated).catch(() => {});
    }
    setLastMove(null);
  }

  function resetAllLabelPositions() {
    const updates = points
      .filter((p) => p.labelDx !== undefined || p.labelDy !== undefined)
      .map((p) => ({ ...p, labelDx: undefined, labelDy: undefined }));
    if (updates.length) {
      const map = new Map(updates.map((u) => [u.id, u]));
      onPointsChange(points.map((p) => map.get(p.id) ?? p));
      updates.forEach((u) => savePoint(u).catch(() => {}));
    }
    // Also clear pin offsets on this floor.
    if (
      floor.highPinDx !== undefined ||
      floor.highPinDy !== undefined ||
      floor.lowPinDx !== undefined ||
      floor.lowPinDy !== undefined
    ) {
      const cleared: Floor = {
        ...floor,
        highPinDx: undefined,
        highPinDy: undefined,
        lowPinDx: undefined,
        lowPinDy: undefined,
      };
      onFloorChange(cleared);
      saveFloor(cleared).catch(() => {});
    }
    setLastMove(null);
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Area selector — only when the floor has more than one drawn area.
          Draggable so report screenshots can clear it off the plan. */}
      {areas.length > 1 && !chromeless && (
        <div
          className="absolute z-30 touch-none"
          style={
            boundarySelectPos
              ? { left: boundarySelectPos.x, top: boundarySelectPos.y }
              : { left: "50%", top: 8, transform: "translateX(-50%)" }
          }
          onPointerDown={(e) => {
            // Drag from the chrome around the select; opening the menu still works on the control.
            if ((e.target as HTMLElement).closest("select")) return;
            const el = e.currentTarget;
            const rect = el.getBoundingClientRect();
            const parent = el.offsetParent as HTMLElement | null;
            const parentRect = parent?.getBoundingClientRect();
            const originX = boundarySelectPos?.x ?? rect.left - (parentRect?.left ?? 0);
            const originY = boundarySelectPos?.y ?? rect.top - (parentRect?.top ?? 0);
            el.setPointerCapture(e.pointerId);
            boundarySelectDrag.current = {
              startX: e.clientX,
              startY: e.clientY,
              originX,
              originY,
              pointerId: e.pointerId,
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const d = boundarySelectDrag.current;
            if (!d || d.pointerId !== e.pointerId) return;
            const dx = e.clientX - d.startX;
            const dy = e.clientY - d.startY;
            if (!d.moved && Math.hypot(dx, dy) < 5) return;
            d.moved = true;
            const next = {
              x: Math.max(4, d.originX + dx),
              y: Math.max(4, d.originY + dy),
            };
            setBoundarySelectPos(next);
            try {
              window.localStorage.setItem(BOUNDARY_SELECT_KEY, JSON.stringify(next));
            } catch {
              /* ignore */
            }
          }}
          onPointerUp={() => {
            boundarySelectDrag.current = null;
          }}
          onPointerCancel={() => {
            boundarySelectDrag.current = null;
          }}
        >
          <div
            className="flex items-center gap-0.5 rounded-full bg-white/95 backdrop-blur border border-gray-300 shadow-md pl-2 pr-1 h-8 cursor-grab active:cursor-grabbing"
            aria-label="Topo boundary selector — drag to move"
          >
            <span className="text-[10px] text-gray-400 select-none px-0.5" aria-hidden>
              ⠿
            </span>
            <select
              value={selectedAreaId ?? ""}
              onChange={(e) => onSelectedAreaIdChange?.(e.target.value || null)}
              aria-label="Topo boundary"
              className="h-7 max-w-[9rem] rounded-full bg-transparent px-2 text-xs text-gray-700 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none cursor-pointer"
            >
              <option value="">All boundaries</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {/* Corner icons — closed by default, tap to open. Hidden while their own panel is open. */}
      {openCorner !== "contours" && !chromeless && !controlsOnly && (
        <CornerIcon
          pos="top-2 left-2 landscape-short:top-auto landscape-short:left-1/2 landscape-short:-translate-x-[calc(100%+0.25rem)] landscape-short:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]"
          active={false}
          onClick={() => setOpenCorner("contours")}
          label="Contours"
        >
          <Waves className="h-4 w-4" />
        </CornerIcon>
      )}
      {openCorner !== "palette" && !chromeless && !controlsOnly && (
        <CornerIcon
          pos="top-2 right-2 landscape-short:top-auto landscape-short:right-auto landscape-short:left-1/2 landscape-short:translate-x-[0.25rem] landscape-short:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]"
          active={false}
          onClick={() => setOpenCorner("palette")}
          label="Palette"
        >
          <Palette className="h-4 w-4" />
        </CornerIcon>
      )}
      {openCorner !== "labels" && !chromeless && !controlsOnly && (
        <button
          type="button"
          onClick={() => setOpenCorner("labels")}
          aria-label="Labels & layers"
          className="fixed z-30 h-9 w-9 rounded-full bg-white/95 backdrop-blur border border-gray-300 shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-50 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-[calc(env(safe-area-inset-right)+0.75rem)]"
        >
          <Tag className="h-4 w-4" />
        </button>
      )}
      {/* Diagnostic panel toggle — Topo-only. Excludes points from contour math without touching stored data. */}
      {!chromeless && (
      <button
        type="button"
        onClick={() => setDiagOpen((v) => !v)}
        aria-label="Diagnostic points panel"
        className={
          "fixed z-30 h-9 min-w-9 px-2 rounded-full backdrop-blur border shadow-md flex items-center justify-center gap-1 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-[calc(env(safe-area-inset-right)+3.5rem)] " +
          (diagOpen || excludedIds.size > 0
            ? "bg-amber-100 border-amber-300 text-amber-900"
            : "bg-white/95 border-gray-300 text-gray-700 hover:bg-gray-50")
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
        {excludedIds.size > 0 && (
          <span className="text-[10px] font-mono tabular-nums">{excludedIds.size}</span>
        )}
      </button>
      )}

      {diagOpen && !chromeless && (
        <TopoDiagnosticPanel
          points={points}
          excludedIds={excludedIds}
          onToggleExclude={(id) => {
            const next = new Set(excludedIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setExcludedIds(next);
          }}
          onRestoreAll={() => setExcludedIds(new Set())}
          onClose={() => setDiagOpen(false)}
        />
      )}

      {/* Warning */}
      {!canRender && !warningDismissed && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 rounded-lg bg-amber-50/95 backdrop-blur border border-amber-200 text-amber-900 text-xs px-3 py-2 shadow-sm flex items-start gap-2 max-w-[calc(100%-6rem)]">
          <span className="flex-1">
            Need at least 3 points inside a closed boundary to generate a topo.
          </span>
          <button
            onClick={() => setWarningDismissed(true)}
            aria-label="Dismiss"
            className="text-amber-700 shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}


      <div
        className={
          controlsOnly
            ? "flex flex-col gap-3 w-full"
            : "flex-1 relative min-h-0 flex flex-col"
        }
      >
        {!controlsOnly && (
        <PlanCanvas
          planDataUrl={floor.planDataUrl}
          planWidth={floor.planWidth}
          planHeight={floor.planHeight}
          hidePlan={!resolved.showPlan}
          planOnTop
          onCamera={onCamera}
          cameraRequest={cameraRequest || undefined}
          staticView={staticView}
          resizeCorners={resizeCorners}
          refitOnResize={false}
          onTransform={(t) => setViewScale((s) => (Math.abs(s - t.scale) > 1e-4 ? t.scale : s))}
          onImagePointerDown={(x, y) => {
            // Legend tap: start drag only. Size is edited in Labels & layers.
            // Every visible contour surface gets its own legend next to that
            // boundary — All boundaries, Main Floor alone, or Lower Bedroom alone.
            if (resolved.showLegend && areaTopos.length > 0 && resolved.mode !== "points-only") {
              for (let i = areaTopos.length - 1; i >= 0; i--) {
                const at = areaTopos[i];
                const box = areaLegendBox(at.area, resolved);
                const inBox =
                  x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
                if (inBox) {
                  setLegendDrag({
                    areaId: at.area.id,
                    dx: x - box.x,
                    dy: y - box.y,
                    legendDx: at.area.legendDx ?? 0,
                    legendDy: at.area.legendDy ?? 0,
                  });
                  return true;
                }
              }
            }
            // Boundary H/L/Δ pills drag immediately (same as the legend).
            // Point labels and High/Low pins still need a long-press.
            const hit = hitDraggable(x, y);
            if (hit) {
              const startDx =
                hit.kind === "label" ? (hit.point.labelDx ?? DEFAULT_LABEL_DX) : hit.dx;
              const startDy =
                hit.kind === "label" ? (hit.point.labelDy ?? DEFAULT_LABEL_DY) : hit.dy;
              pillTapRef.current = hit.kind === "pill" ? hit.tapPoint : null;
              const immediate = hit.kind === "pill";
              setDrag({
                kind: hit.kind,
                id:
                  hit.kind === "label"
                    ? hit.point.id
                    : hit.kind === "pill"
                      ? hit.areaId
                      : floor.id,
                dx: startDx,
                dy: startDy,
                startPointerX: x,
                startPointerY: y,
                startDx,
                startDy,
                active: immediate,
              });
              clearLongPress();
              if (!immediate) {
                longPressTimer.current = window.setTimeout(() => {
                  setDrag((d) => (d ? { ...d, active: true } : d));
                }, LONG_PRESS_MS);
              }
              return true;
            }
            return false;
          }}
          onImagePointerMove={(x, y) => {
            if (legendDrag?.areaId) {
              const area = getAreas(floor).find((a) => a.id === legendDrag.areaId);
              if (area) {
                const anchor = areaLegendAnchor(area);
                setLegendDrag({
                  ...legendDrag,
                  legendDx: x - legendDrag.dx - anchor.x,
                  legendDy: y - legendDrag.dy - anchor.y,
                });
              }
              return;
            }
            if (drag) {
              if (!drag.active) {
                const moved = Math.hypot(x - drag.startPointerX, y - drag.startPointerY);
                if (moved > 6) {
                  clearLongPress();
                  setDrag(null);
                }
                return;
              }
              setDrag({
                ...drag,
                dx: drag.startDx + (x - drag.startPointerX),
                dy: drag.startDy + (y - drag.startPointerY),
              });
            }
          }}
          onImagePointerUp={() => {
            if (legendDrag?.areaId != null && legendDrag.legendDx != null && legendDrag.legendDy != null) {
              applyLegendOffset(legendDrag.areaId, legendDrag.legendDx, legendDrag.legendDy);
            }
            setLegendDrag(null);
            clearLongPress();
            if (drag) {
              const moved = drag.dx !== drag.startDx || drag.dy !== drag.startDy;
              if (drag.active && moved) {
                if (drag.kind === "label") commitLabelMove(drag.id, drag.dx, drag.dy);
                else if (drag.kind === "pill") commitPillMove(drag.id, drag.dx, drag.dy);
                else commitPinMove(drag.kind, drag.dx, drag.dy);
              } else if (drag.kind === "pill" && !moved && pillTapRef.current) {
                // Quick tap on the pill's H or L segment highlights that point.
                onHighlight?.(pillTapRef.current);
              }
            }
            pillTapRef.current = null;
            setDrag(null);
          }}
          drawOverlay={(ctx) => {
            renderTopoBase(ctx, floor, resolved, areaTopos);
          }}
          drawOverlayTop={(ctx) => {
            const activeLabel =
              drag && drag.active && drag.kind === "label"
                ? { id: drag.id, dx: drag.dx, dy: drag.dy }
                : null;
            const activePinHigh =
              drag && drag.active && drag.kind === "pin-high" ? { dx: drag.dx, dy: drag.dy } : null;
            const activePinLow =
              drag && drag.active && drag.kind === "pin-low" ? { dx: drag.dx, dy: drag.dy } : null;
            const activePill =
              drag && drag.active && drag.kind === "pill"
                ? { id: drag.id, dx: drag.dx, dy: drag.dy }
                : null;
            const activeLegend =
              legendDrag?.areaId != null &&
              legendDrag.legendDx != null &&
              legendDrag.legendDy != null
                ? { id: legendDrag.areaId, dx: legendDrag.legendDx, dy: legendDrag.legendDy }
                : null;
            renderTopoTop(ctx, floor, visiblePoints, resolved, areaTopos, {
              liveDrag: activeLabel,
              highlightId: activeLabel?.id ?? selectedId,
              livePinHigh: activePinHigh,
              livePinLow: activePinLow,
              highlightPin:
                drag?.active && (drag.kind === "pin-high" || drag.kind === "pin-low")
                  ? drag.kind
                  : null,
              livePill: activePill,
              liveLegend: activeLegend,
              pillSize: statsChipSize,
              pillForSingleBoundary: statsPillForSingleBoundary,
              pointSize,
              pointColor,
              viewScale,
            });
          }}
        />
        )}

        {/* Contours popover — upper left */}
        {(openCorner === "contours" || controlsOnly) && (
          <CornerPanel inline={controlsOnly} pos="top-12 left-2 landscape-short:top-2 landscape-short:left-auto landscape-short:right-2" onClose={() => setOpenCorner(null)} title="Contours">
            {gridAndContours?.grid && (
              <p className="text-[10px] text-muted-foreground tabular-nums -mt-1">
                Range {gridAndContours.grid.minValue.toFixed(2)}"–
                {gridAndContours.grid.maxValue.toFixed(2)}"
              </p>
            )}
            <div>
              <Label className="text-xs">Mode</Label>
              <select
                value={resolved.mode}
                onChange={(e) => update({ mode: e.target.value as RenderSettings["mode"] })}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-xs"
              >
                <option value="contour-fill">Color fill</option>
                <option value="contour-cells">Color cells</option>
                <option value="contour-bw">B&W lines</option>
                <option value="points-only">Points only</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">First</Label>
                <Input
                  type="number"
                  step="0.05"
                  enterKeyHint="done"
                  value={resolved.firstContour ?? ""}
                  placeholder="auto"
                  onChange={(e) =>
                    update({
                      firstContour: e.target.value === "" ? null : parseFloat(e.target.value),
                    })
                  }
                  className="mt-1 h-9 text-base"
                />
              </div>
              <div>
                <Label className="text-xs">Step</Label>
                <StepInput
                  value={resolved.contourStep}
                  onCommit={(step) => update({ contourStep: step, interval: step })}
                />
              </div>
              <div>
                <Label className="text-xs">Count</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="done"
                  value={resolved.contourCount ?? ""}
                  placeholder="auto"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "" || raw.toLowerCase() === "auto") {
                      update({ contourCount: null });
                    } else {
                      const n = parseInt(raw, 10);
                      update({ contourCount: isFinite(n) ? Math.max(2, n) : null });
                    }
                  }}
                  className="mt-1 h-9 text-base"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Line thickness</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {resolved.lineThickness.toFixed(1)}
                </span>
              </div>
              <Slider
                min={0.5}
                max={4}
                step={0.1}
                value={[resolved.lineThickness]}
                onValueChange={(v) => update({ lineThickness: v[0] })}
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Contours on</Label>
              <Switch
                checked={resolved.showContours}
                onCheckedChange={(v) => update({ showContours: v })}
              />
            </div>
          </CornerPanel>
        )}

        {/* Palette popover — upper right */}
        {(openCorner === "palette" || controlsOnly) && (
          <CornerPanel
            inline={controlsOnly}
            pos="top-12 right-2 w-60 landscape-short:top-2"
            onClose={() => setOpenCorner(null)}
            title="Palette"
          >
            <div className="flex items-center justify-between">
              <Label className="text-xs">Reverse</Label>
              <Switch
                checked={resolved.reversePalette}
                onCheckedChange={(v) => update({ reversePalette: v })}
              />
            </div>
            <PalettePicker
              value={resolved.palette}
              onChange={(p) => update({ palette: p })}
            />
          </CornerPanel>
        )}

        {/* Labels & layers popover — lower right */}
        {(openCorner === "labels" || controlsOnly) && (
          <CornerPanel
            inline={controlsOnly}
            pos="bottom-14 right-3"
            onClose={() => setOpenCorner(null)}
            title="Labels & layers"
          >
            <div className="grid grid-cols-2 gap-2">
              <SwitchRow
                label="Labels"
                checked={resolved.showLabels}
                onChange={(v) => update({ showLabels: v })}
              />
              <NumberControl
                label="Decimals"
                value={resolved.decimalPlaces}
                min={0}
                max={3}
                step={1}
                onChange={(v) =>
                  update({ decimalPlaces: Math.max(0, Math.min(3, Math.round(v ?? 2))) })
                }
              />
              <SwitchRow
                label="Floor plan"
                checked={resolved.showPlan}
                onChange={(v) => update({ showPlan: v })}
              />
              <SwitchRow
                label="Points"
                checked={resolved.showPoints}
                onChange={(v) => update({ showPoints: v, pointsOpacity: 1 })}
              />
              <SwitchRow
                label="Legend"
                checked={resolved.showLegend}
                onChange={(v) => update({ showLegend: v })}
              />
              <SwitchRow
                label="High / low"
                checked={resolved.showHighLow}
                onChange={(v) => update({ showHighLow: v })}
              />
              <SwitchRow
                label="Declutter"
                checked={resolved.declutterLabels !== false}
                onChange={(v) => update({ declutterLabels: v })}
              />
              <StepperControl
                label="Legend size"
                value={Math.round((resolved.legendScale ?? 1) * 10) / 10}
                min={0.4}
                max={4}
                step={0.1}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) =>
                  update({ legendScale: Math.max(0.4, Math.min(4, Math.round(v * 10) / 10)) })
                }
              />
              <div className="col-span-2 space-y-1">
                <StepperControl
                  label="Stats pill size"
                  value={statsChipSize}
                  min={STATS_CHIP_MIN}
                  max={STATS_CHIP_MAX}
                  step={2}
                  format={(v) =>
                    statsChipLocked == null ? `Auto ${Math.round(v)}px` : `${Math.round(v)}px`
                  }
                  onChange={(v) => {
                    const n = Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(v)));
                    setStatsChipLocked(n);
                    setStatsChipSize(n);
                  }}
                />
                {statsChipLocked != null && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground underline underline-offset-2"
                    onClick={() => {
                      setStatsChipLocked(null);
                      clearStatsChipSize();
                    }}
                  >
                    Use Auto size for this screen
                  </button>
                )}
              </div>
              <div className="col-span-2 flex items-center justify-between gap-2">
                <Label className="text-xs">Label bg</Label>
                <div className="inline-flex rounded-md border overflow-hidden">
                  {(["white", "transparent", "plain"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={`px-2 py-1 text-xs ${
                        resolved.pointLabelBackground === opt
                          ? "bg-primary text-primary-foreground"
                          : "bg-background"
                      }`}
                      onClick={() => update({ pointLabelBackground: opt })}
                    >
                      {opt === "white" ? "Box" : opt === "transparent" ? "Border" : "Plain"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <details className="border-t pt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Label style
              </summary>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <StepperControl
                  label="Point label size"
                  value={resolved.pointLabelFontSize}
                  min={6}
                  max={28}
                  step={1}
                  onChange={(v) =>
                    update({ pointLabelFontSize: Math.max(6, Math.min(28, Math.round(v))) })
                  }
                />
                <StepperControl
                  label="High / low size"
                  value={resolved.highLowPinSize}
                  min={7}
                  max={28}
                  step={1}
                  onChange={(v) =>
                    update({ highLowPinSize: Math.max(7, Math.min(28, Math.round(v))) })
                  }
                />
                <div>
                  <Label className="text-xs">Weight</Label>
                  <select
                    value={resolved.pointLabelWeight}
                    onChange={(e) =>
                      update({ pointLabelWeight: e.target.value as "normal" | "bold" })
                    }
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Color</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={resolved.pointLabelColor}
                      onChange={(e) => update({ pointLabelColor: e.target.value })}
                      className="h-9 w-12 rounded-md border bg-background p-1 cursor-pointer"
                    />
                    <Input
                      enterKeyHint="done"
                      value={resolved.pointLabelColor}
                      onChange={(e) => update({ pointLabelColor: e.target.value })}
                      className="h-9 flex-1 font-mono text-base"
                    />
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={resetAllLabelPositions}
                className="mt-2 w-full h-8"
              >
                Reset label positions
              </Button>
            </details>
          </CornerPanel>
        )}
      </div>
    </div>
  );
}

function CornerIcon({
  pos,
  active,
  onClick,
  label,
  children,
}: {
  pos: string;
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={
        "absolute z-30 h-9 w-9 rounded-full backdrop-blur border shadow-sm flex items-center justify-center " +
        pos +
        " " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background/90 hover:bg-background")
      }
    >
      {children}
    </button>
  );
}

function CornerPanel({
  pos,
  title,
  onClose,
  children,
  inline = false,
}: {
  pos: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** In Report Builder's rail these are not corner popovers floating over a
   *  canvas -- they are a stacked column of controls. Same contents, so there
   *  is one definition of what a Contours panel contains. */
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? "rounded-xl border bg-card p-3 w-full overflow-visible space-y-3 text-sm"
          : "absolute z-30 rounded-xl border bg-card/95 backdrop-blur shadow-2xl p-3 w-64 max-h-[calc(100%-4rem)] overflow-auto space-y-3 text-sm " +
            pos
      }
    >
      <div className="flex items-center justify-between -mt-1">
        <span className="text-xs font-semibold">{title}</span>
        {!inline && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// Free-form step input. Keeps local text state so partial input like "." or
// "0." doesn't clobber the committed value mid-typing.
function StepInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const lastValueRef = useRef(value);
  // Sync external changes (e.g. Reset) into the text field
  if (value !== lastValueRef.current && String(value) !== text) {
    lastValueRef.current = value;
    // schedule via microtask isn't safe here — set directly
    setText(String(value));
  }
  return (
    <Input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        // Only commit when it parses to a positive finite number.
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) onCommit(n);
      }}
      onBlur={() => {
        const n = parseFloat(text);
        if (!Number.isFinite(n) || n <= 0) {
          setText(String(value));
        } else {
          setText(String(n));
        }
      }}
      className="w-20 h-10 text-base"
    />
  );
}

function NumberControl({
  label,
  value,
  placeholder,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === null || value === undefined ? "" : String(value));
  const commit = (raw: string) => {
    setDraft(null);
    if (raw === "") {
      onChange(null);
      return;
    }
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      onChange(null);
      return;
    }
    let clamped = n;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    onChange(clamped);
  };
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={display}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="mt-1 h-9"
      />
    </div>
  );
}

function StepperControl({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const display = format ? format(value) : `${value}px`;
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40 shrink-0"
        >
          <Minus className="h-3 w-3" />
        </button>
        <output
          aria-label={`${label}: ${display}`}
          className="flex h-6 flex-1 min-w-0 select-none items-center justify-center rounded-md border border-input bg-background px-1 text-center font-mono text-[10px] leading-none tabular-nums text-foreground"
        >
          {display}
        </output>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40 shrink-0"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// Exported so ExportTab can reuse the exact rendering pipeline.
export function renderTopo(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  points: SurveyPoint[],
  settings: RenderSettings,
  areaTopos: AreaTopo[],
  /** Forwarded so a caller that is not the live canvas -- Report Builder's
   *  figure composer -- can still say how big the drawing will be seen, which
   *  is what sizes the reading labels and dots. */
  overlay?: Parameters<typeof renderTopoTop>[5],
) {
  renderTopoBase(ctx, floor, settings, areaTopos);
  renderTopoTop(ctx, floor, points, settings, areaTopos, overlay);
}

// Base pass: contour fills / lines / boundary. Meant to sit UNDER the wall plan.
function renderTopoBase(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  settings: RenderSettings,
  areaTopos: AreaTopo[],
) {
  const w = Math.max(1, Math.ceil(floor.planWidth ?? 1000));
  const h = Math.max(1, Math.ceil(floor.planHeight ?? 750));
  // The contour fills are drawn into an offscreen layer and then stamped on.
  // Sizing that layer to the PLAN's pixels capped the contours at plan
  // resolution however large they were finally drawn, so every band edge came
  // out stair-stepped once the drawing was shown bigger than the plan image --
  // the pixelation on a report slide. The layer is sized for the resolution it
  // will actually be seen at instead: the transform in force here already
  // carries the zoom and the device pixel ratio.
  const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const outScale = m ? Math.max(Math.abs(m.a), Math.abs(m.d)) || 1 : 1;
  // Capped so a deep zoom on a large plan cannot ask for an enormous bitmap.
  const layerScale = Math.min(4, Math.max(1, outScale));
  const layer = document.createElement("canvas");
  layer.width = Math.ceil(w * layerScale);
  layer.height = Math.ceil(h * layerScale);
  const layerCtx = layer.getContext("2d");
  if (!layerCtx) return;
  layerCtx.setTransform(layerScale, 0, 0, layerScale, 0, 0);
  renderTopoBaseLayer(layerCtx, floor, settings, areaTopos);
  ctx.drawImage(layer, 0, 0, w, h);
}

function renderTopoBaseLayer(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  settings: RenderSettings,
  areaTopos: AreaTopo[],
) {
  const resolved = resolveSettings(settings);
  const traceExclusionCutouts = () => {
    for (const ex of floor.exclusions ?? []) {
      if (ex.polygon.length < 3) continue;
      ctx.beginPath();
      ex.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
  };

  // Each boundary keeps its own elevation range so All boundaries shows
  // distinct contour surfaces (and matching per-boundary legends).
  for (const at of areaTopos) {
    const g = at.grid;
    const cs = at.contours;
    const polygon = at.area.polygon;
    const areaPaletteMin = resolved.minClamp ?? g.minValue;
    const areaPaletteMax = resolved.maxClamp ?? g.maxValue;
    ctx.save();
    ctx.beginPath();
    polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    for (const ex of floor.exclusions ?? []) {
      if (ex.polygon.length < 3) continue;
      ex.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.clip("evenodd");



    if (g && resolved.showContours && resolved.mode === "contour-cells") {
      // Paint cells opaque to an offscreen canvas first, then blit with opacity.
      // Prevents sub-pixel seams (white streaks) between adjacent cells when
      // globalAlpha < 1 blends each cell individually against the canvas.
      const pad = 2;
      const offW = Math.max(1, Math.ceil(g.width * g.step) + pad * 2);
      const offH = Math.max(1, Math.ceil(g.height * g.step) + pad * 2);
      const off = document.createElement("canvas");
      off.width = offW;
      off.height = offH;
      const octx = off.getContext("2d");
      if (octx) {
        for (let r = 0; r < g.height; r++) {
          for (let c = 0; c < g.width; c++) {
            const idx = r * g.width + c;
            if (!g.mask[idx]) continue;
            const t = clampValue(g.values[idx], areaPaletteMin, areaPaletteMax);
            octx.fillStyle = paletteColor(t, resolved.palette, resolved.reversePalette);
            octx.fillRect(pad + c * g.step, pad + r * g.step, g.step + 1, g.step + 1);
          }
        }
        ctx.globalAlpha = resolved.contourOpacity;
        ctx.drawImage(off, g.x0 - pad, g.y0 - pad);
        ctx.globalAlpha = 1;
      }
    }


    // Contour polygons
    if (
      cs &&
      g &&
      resolved.showContours &&
      resolved.mode !== "points-only" &&
      resolved.mode !== "contour-cells"
    ) {
      ctx.save();
      if (resolved.mode === "contour-fill") {
        const minColorT = clampValue(areaPaletteMin, areaPaletteMin, areaPaletteMax);
        ctx.fillStyle = paletteColor(minColorT, resolved.palette, resolved.reversePalette);
        ctx.globalAlpha = 0.7 * resolved.contourOpacity;
        ctx.fillRect(g.x0, g.y0, g.width * g.step, g.height * g.step);
        ctx.globalAlpha = 1;
      }
      ctx.translate(g.x0, g.y0);
      ctx.scale(g.step, g.step);
      for (const c of cs) {
        ctx.beginPath();
        for (const poly of c.coordinates) {
          for (const ring of poly) {
            ring.forEach((pt, i) =>
              i === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]),
            );
            ctx.closePath();
          }
        }
        if (resolved.mode === "contour-fill") {
          const t = clampValue(c.value, areaPaletteMin, areaPaletteMax);
          ctx.fillStyle = paletteColor(t, resolved.palette, resolved.reversePalette);
          ctx.globalAlpha = 0.7 * resolved.contourOpacity;
          ctx.fill();
          ctx.globalAlpha = resolved.contourOpacity;
          ctx.strokeStyle = "rgba(35,24,14,0.58)";
          ctx.lineWidth = resolved.lineThickness / g.step;
          ctx.stroke();
        } else {
          // contour-bw
          const step = Math.max(0.01, resolved.contourStep);
          const isMajor = Math.abs(c.value / (step * 5) - Math.round(c.value / (step * 5))) < 0.03;
          ctx.strokeStyle = "#17130e";
          ctx.lineWidth = (isMajor ? resolved.lineThickness * 2 : resolved.lineThickness) / g.step;
          ctx.globalAlpha = resolved.contourOpacity;
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // True cutout: remove topo pixels inside exclusions. This does not paint
  // white and does not draw an outline, so the wall plan shows through cleanly.
  if ((floor.exclusions ?? []).some((ex) => ex.polygon.length >= 3)) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    traceExclusionCutouts();
    ctx.restore();
  }
}

// Top pass: points, point labels, high/low pins, legend. Meant to sit OVER the wall plan.
function renderTopoTop(
  ctx: CanvasRenderingContext2D,
  floor: Floor,
  points: SurveyPoint[],
  settings: RenderSettings,
  areaTopos: AreaTopo[],
  overlay?: {
    liveDrag?: { id: string; dx: number; dy: number } | null;
    highlightId?: string | null;
    livePinHigh?: { dx: number; dy: number } | null;
    livePinLow?: { dx: number; dy: number } | null;
    highlightPin?: "pin-high" | "pin-low" | null;
    /** Area whose stats pill is being dragged right now. */
    livePill?: { id: string; dx: number; dy: number } | null;
    /** Area whose color legend is being dragged right now. */
    liveLegend?: { id: string; dx: number; dy: number } | null;
    /** Base (1x zoom) stats-pill height in screen px. */
    pillSize?: number;
    /** Draw the pill on a one-boundary level too (a report slide does). */
    pillForSingleBoundary?: boolean;
    pointSize?: number;
    pointColor?: string;
    viewScale?: number;
  },
) {
  const resolved = resolveSettings(settings);
  const live = overlay?.liveDrag ?? null;
  const highlightId = overlay?.highlightId ?? null;
  const livePinHigh = overlay?.livePinHigh ?? null;
  const livePinLow = overlay?.livePinLow ?? null;
  const highlightPin = overlay?.highlightPin ?? null;
  const liveLegend = overlay?.liveLegend ?? null;
  const viewScale = overlay?.viewScale || 1;
  // Label font: chosen screen px holds when the plan is fit-scaled out
  // (desktop), and grows gently when zoomed in. Exports at 1x still match
  // the chosen size.
  const fontBase = resolved.pointLabelFontSize;
  const fontPx = screenAnchoredImageSize(fontBase, viewScale);
  const k = fontPx / fontBase;
  const weight = resolved.pointLabelWeight;
  const color = resolved.pointLabelColor;

  if (resolved.showPoints) {
    ctx.globalAlpha = resolved.pointsOpacity;
    // Dot: same anchoring as the label, but keyed to the user's dot-size
    // stepper (pointSize) instead of font size, so the stepper actually
    // controls what's drawn.
    const dotBase = overlay?.pointSize ?? 6;
    const dotR = screenAnchoredImageSize(dotBase, viewScale);
    const dotColor = overlay?.pointColor ?? "#dc2626";
    const padX = 4 * k;
    const padY = 2.5 * k;

    // Decluttering: figure out which labels can be drawn without colliding.
    // Dots always draw. Highlighted / dragged labels win ties.
    ctx.font = `${weight} ${fontPx}px sans-serif`;
    const rectFor = (p: SurveyPoint) => {
      const isLive = live && live.id === p.id;
      const dx = isLive ? live!.dx : (p.labelDx ?? DEFAULT_LABEL_DX * k);
      const dy = isLive ? live!.dy : (p.labelDy ?? DEFAULT_LABEL_DY * k);
      const w = ctx.measureText(p.value.toFixed(resolved.decimalPlaces)).width + padX * 2;
      return { x: p.x + dx - padX, y: p.y + dy - padY, w, h: fontPx + padY * 2 };
    };
    const visibleLabelIds = new Set<string>();
    if (resolved.declutterLabels === false) {
      for (const p of points) visibleLabelIds.add(p.id);
    } else {
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const ordered = [...points].sort((a, b) => {
        const pr = (p: SurveyPoint) =>
          highlightId === p.id ? 0 : p.labelDx !== undefined || p.labelDy !== undefined ? 1 : 2;
        return pr(a) - pr(b);
      });
      for (const p of ordered) {
        const r = rectFor(p);
        const hit = placed.some(
          (q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y,
        );
        if (!hit) {
          placed.push(r);
          visibleLabelIds.add(p.id);
        }
      }
    }

    for (const p of points) {
      // dot — matches data screen: solid colored fill, no white ring.
      ctx.beginPath();
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = p.isBasePoint ? "#16a34a" : dotColor;
      ctx.fill();
      if (highlightId === p.id) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotR + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "hsl(var(--primary))";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // label
      if (!visibleLabelIds.has(p.id)) continue;
      const text = p.value.toFixed(resolved.decimalPlaces);
      ctx.font = `${weight} ${fontPx}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const isLive = live && live.id === p.id;
      const dx = isLive ? live!.dx : (p.labelDx ?? DEFAULT_LABEL_DX * k);
      const dy = isLive ? live!.dy : (p.labelDy ?? DEFAULT_LABEL_DY * k);
      const tx = p.x + dx;
      const ty = p.y + dy;
      const tw = ctx.measureText(text).width;
      const inverted = highlightId === p.id;
      const pillW = tw + padX * 2;
      const pillH = fontPx + padY * 2;
      const radius = 2.5 * k;
      const cx = tx + tw / 2;
      const cy = ty + fontPx / 2;

      if (inverted) {
        // Inverted highlight: dark pill, light text
        ctx.fillStyle = color;
        roundRectPath(ctx, tx - padX, ty - padY, pillW, pillH, radius);
        ctx.fill();
        ctx.lineWidth = k;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, cx, cy);
      } else {
        if (resolved.pointLabelBackground === "white") {
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          roundRectPath(ctx, tx - padX, ty - padY, pillW, pillH, radius);
          ctx.fill();
        }
        if (resolved.pointLabelBackground !== "plain") {
          ctx.lineWidth = 0.8 * k;
          ctx.strokeStyle = color;
          roundRectPath(ctx, tx - padX, ty - padY, pillW, pillH, radius);
          ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.fillText(text, cx, cy);
      }
    }
    ctx.globalAlpha = 1;
  } else if (highlightId) {
    const sel = points.find((p) => p.id === highlightId);
    if (sel) {
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  // Legend + High/Low pins
  if (areaTopos.length && resolved.mode !== "points-only") {
    // Legend ON: one color/elevation legend per contour surface on screen.
    // Same path for All boundaries, a single named boundary, or one-boundary
    // floors — the legend sits on that boundary so it stays in view.
    if (resolved.showLegend) {
      for (const at of areaTopos) {
        const live =
          liveLegend && liveLegend.id === at.area.id
            ? { dx: liveLegend.dx, dy: liveLegend.dy }
            : null;
        drawLegend(
          ctx,
          resolved,
          at.grid,
          areaTopos.length === 1 ? at.contours : null,
          !!live,
          areaLegendBox(at.area, resolved, live),
        );
      }
    }
    // Each area gets its own High/Low pins, scoped to that area's polygon and
    // outside the exclusion zones inside it.
    if (resolved.showHighLow) {
      // Pin nudges are stored per floor and apply to every area's pins.
      const hDx = livePinHigh ? livePinHigh.dx : (floor.highPinDx ?? 0);
      const hDy = livePinHigh ? livePinHigh.dy : (floor.highPinDy ?? 0);
      const lDx = livePinLow ? livePinLow.dx : (floor.lowPinDx ?? 0);
      const lDy = livePinLow ? livePinLow.dy : (floor.lowPinDy ?? 0);
      for (const at of areaTopos) {
        drawPin(ctx, at.hi.x + hDx, at.hi.y + hDy, "High", "#b51d16", resolved.highLowPinSize, highlightPin === "pin-high");
        drawPin(ctx, at.lo.x + lDx, at.lo.y + lDy, "Low", "#1f5f9f", resolved.highLowPinSize, highlightPin === "pin-low");
      }
    }
  }

  // One named pill per boundary. In the field a lone surface uses the floating
  // StatsChip instead, so H / L / Δ is not drawn twice; a report slide asks for
  // it here so one boundary looks the same as five.
  if (statsPillOnCanvas(resolved, areaTopos.length, !!overlay?.pillForSingleBoundary)) {
    const livePill = overlay?.livePill ?? null;
    const base = overlay?.pillSize ?? DEFAULT_STATS_PILL_SIZE;
    const h = pillHeightImg(base, viewScale);
    for (const at of areaTopos) {
      const live = livePill && livePill.id === at.area.id ? livePill : null;
      drawStatsPill(
        ctx,
        at,
        h,
        at.area.name,
        resolved.decimalPlaces,
        pillCenter(at.area, live),
        !!live,
      );
    }
  }
}

/** Rounded H / L / Δ pill, centered on `center`, in image coords. */
function drawStatsPill(
  ctx: CanvasRenderingContext2D,
  at: AreaTopo,
  h: number,
  label: string | null,
  dec: number,
  center: { cx: number; cy: number },
  dragging: boolean,
) {
  const m = pillMetrics(h, label, at.hi.value, at.lo.value, dec);
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
        ? "#b51d16"
        : s.kind === "lo"
          ? "#1f5f9f"
          : s.kind === "delta"
            ? "#6b7280"
            : "#6b7280";
    ctx.fillText(s.text, sx + s.w / 2, center.cy);
    sx += s.w;
  });
  ctx.restore();
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  letter: string,
  color: string,
  fontPx: number,
  highlighted = false,
) {
  const pinH = pinHeight(fontPx);
  const topOffset = pinTopOffset(fontPx);
  const pad = pinPadding(fontPx);
  const radius = pinCornerRadius(fontPx);
  ctx.font = `bold ${fontPx}px sans-serif`;
  const w = Math.max(pinMinWidth(fontPx), ctx.measureText(letter).width + pad * 2);
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y + topOffset, w, pinH, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = highlighted ? "#17130e" : "#fff";
  ctx.lineWidth = pinStrokeWidth(fontPx, highlighted);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, x, y + topOffset + pinH / 2);
}

export function resolveSettings(settings: RenderSettings): RenderSettings {
  const contourStep =
    settings.contourStep ?? settings.interval ?? defaultRenderSettings.contourStep;
  return {
    ...defaultRenderSettings,
    ...settings,
    contourStep,
    interval: contourStep,
    contourCount: settings.contourCount ?? defaultRenderSettings.contourCount,
    decimalPlaces: settings.decimalPlaces ?? defaultRenderSettings.decimalPlaces,
    palette: settings.palette ?? defaultRenderSettings.palette,
    lineThickness: settings.lineThickness ?? defaultRenderSettings.lineThickness,
  };
}

function contourOptions(grid: Grid, settings: RenderSettings) {
  return {
    first: settings.firstContour,
    step: settings.contourStep,
    count: settings.contourCount ?? undefined,
    min: settings.minClamp ?? grid.minValue,
    max: settings.maxClamp ?? grid.maxValue,
  };
}

const PALETTE_LABELS: Record<RenderSettings["palette"], string> = {
  brown: "Earth Tone",
  rainbow: "Rainbow",
  "blue-red": "Blue → Red",
  "red-yellow-green": "Red → Green",
  gray: "Grayscale",
  ocean: "Ocean",
  sunset: "Sunset",
  forest: "Forest",
  viridis: "Viridis",
  topographic: "Topographic",
  "gray-amber": "Gray + Amber",
  "nm-sunset": "New Mexico Sunset",
  mountain: "Mountain Top",
};
const PRIMARY_PALETTES: RenderSettings["palette"][] = [
  "brown",
  "rainbow",
  "blue-red",
  "topographic",
];
const EXTRA_PALETTES: RenderSettings["palette"][] = [
  "red-yellow-green",
  "ocean",
  "sunset",
  "forest",
  "viridis",
  "gray",
  "gray-amber",
  "nm-sunset",
  "mountain",
];

function PaletteSwatch({ palette }: { palette: RenderSettings["palette"] }) {
  const bg = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
    .map((t) => paletteColor(t, palette, false))
    .join(", ")})`;
  return <div className="h-4 w-full rounded-sm border" style={{ background: bg }} />;
}

function PaletteRow({
  palette,
  active,
  onClick,
}: {
  palette: RenderSettings["palette"];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md border px-2 py-1.5 text-xs transition ${
        active ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">{PALETTE_LABELS[palette]}</span>
        {active && <span className="text-[10px] text-primary">Selected</span>}
      </div>
      <PaletteSwatch palette={palette} />
    </button>
  );
}

function PalettePicker({
  value,
  onChange,
}: {
  value: RenderSettings["palette"];
  onChange: (p: RenderSettings["palette"]) => void;
}) {
  const activeInExtras = EXTRA_PALETTES.includes(value);
  const [expanded, setExpanded] = useState(activeInExtras);
  return (
    <div className="space-y-2">
      <Label className="text-xs">Palette</Label>
      <div className="space-y-1.5">
        {PRIMARY_PALETTES.map((p) => (
          <PaletteRow key={p} palette={p} active={value === p} onClick={() => onChange(p)} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left text-xs text-muted-foreground hover:text-foreground py-1"
      >
        {expanded ? "▾" : "▸"} More palettes
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {EXTRA_PALETTES.map((p) => (
            <PaletteRow key={p} palette={p} active={value === p} onClick={() => onChange(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function paletteColor(input: number, palette: RenderSettings["palette"], reverse: boolean) {
  const t = reverse ? 1 - input : input;
  const stops: Record<RenderSettings["palette"], Array<[number, number, number]>> = {
    brown: [
      [130, 90, 55],
      [149, 99, 50],
      [201, 153, 83],
      [239, 213, 146],
      [116, 146, 118],
    ],
    rainbow: [
      [49, 75, 160],
      [46, 156, 202],
      [80, 177, 94],
      [245, 214, 79],
      [201, 65, 45],
    ],
    "blue-red": [
      [45, 86, 150],
      [120, 167, 204],
      [238, 222, 172],
      [206, 115, 73],
      [142, 45, 35],
    ],
    "red-yellow-green": [
      [220, 40, 40],
      [230, 100, 40],
      [255, 235, 60],
      [150, 210, 60],
      [34, 160, 50],
    ],
    gray: [
      [42, 42, 42],
      [92, 92, 92],
      [145, 145, 145],
      [198, 198, 198],
      [238, 238, 238],
    ],
    ocean: [
      [10, 30, 70],
      [20, 80, 130],
      [40, 150, 175],
      [130, 210, 210],
      [235, 230, 200],
    ],
    sunset: [
      [50, 20, 80],
      [130, 40, 120],
      [220, 70, 110],
      [245, 140, 60],
      [250, 215, 100],
    ],
    forest: [
      [20, 50, 30],
      [45, 90, 55],
      [110, 140, 70],
      [180, 175, 110],
      [240, 232, 200],
    ],
    viridis: [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ],
    topographic: [
      [90, 130, 80],
      [175, 190, 120],
      [220, 190, 140],
      [165, 120, 85],
      [245, 245, 245],
    ],
    "gray-amber": [
      [55, 55, 55],
      [110, 110, 110],
      [175, 175, 175],
      [220, 200, 150],
      [240, 175, 60],
    ],
    "nm-sunset": [
      [250, 170, 175],
      [235, 145, 145],
      [200, 165, 170],
      [150, 145, 150],
      [90, 95, 105],
    ],
    mountain: [
      [140, 100, 70],
      [80, 130, 60],
      [120, 170, 90],
      [230, 220, 200],
      [255, 255, 255],
    ],
  };
  const s = stops[palette];
  const scaled = Math.max(0, Math.min(0.999, t)) * (s.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = s[i];
  const b = s[i + 1] ?? a;
  const rgb = a.map((v, idx) => Math.round(v + (b[idx] - v) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

const LEGEND_BASE_W = 82;
const LEGEND_BASE_H = 226;

function legendBox(settings: RenderSettings) {
  const s = settings.legendScale ?? 1;
  return {
    x: settings.legendX,
    y: settings.legendY,
    w: LEGEND_BASE_W * s,
    h: LEGEND_BASE_H * s,
    scale: s,
  };
}

/** Color-legend box for one boundary on the All boundaries view. */
function areaLegendBox(
  area: TopoArea,
  settings: RenderSettings,
  live?: { dx: number; dy: number } | null,
) {
  const s = settings.legendScale ?? 1;
  const anchor = areaLegendAnchor(area);
  const dx = live ? live.dx : (area.legendDx ?? 0);
  const dy = live ? live.dy : (area.legendDy ?? 0);
  return {
    x: anchor.x + dx,
    y: anchor.y + dy,
    w: LEGEND_BASE_W * s,
    h: LEGEND_BASE_H * s,
    scale: s,
  };
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  settings: RenderSettings,
  grid: Grid,
  _contours: ReturnType<typeof computeContours> | null,
  selected: boolean,
  boxOverride?: { x: number; y: number; w: number; h: number; scale: number },
) {
  const box = boxOverride ?? legendBox(settings);
  const s = box.scale;
  const min = settings.minClamp ?? grid.minValue;
  const max = settings.maxClamp ?? grid.maxValue;
  const span = Math.max(1e-6, max - min);

  const thresholds = contourThresholds(grid, contourOptions(grid, settings));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "rgba(23,19,14,0.85)";
  ctx.lineWidth = 1;
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 6 * s);
  ctx.fill();
  ctx.stroke();

  const barX = box.x + 14 * s;
  const barY = box.y + 18 * s;
  const barW = 18 * s;
  const barH = box.h - 42 * s;

  const edges = [min, ...thresholds.filter((t) => t > min && t < max), max];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const mid = (lo + hi) / 2;
    const t = (mid - min) / span;
    const yTop = barY + barH - ((hi - min) / span) * barH;
    const yBot = barY + barH - ((lo - min) / span) * barH;
    ctx.fillStyle = paletteColor(t, settings.palette, settings.reversePalette);
    ctx.fillRect(barX, yTop, barW, yBot - yTop + 0.5);
  }
  ctx.strokeStyle = "#17130e";
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = "#17130e";
  ctx.font = `bold ${10 * s}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labels: number[] = [];
  if (thresholds.length <= 7) {
    labels.push(...thresholds);
  } else {
    const stride = Math.ceil(thresholds.length / 6);
    for (let i = 0; i < thresholds.length; i += stride) labels.push(thresholds[i]);
    if (labels[labels.length - 1] !== thresholds[thresholds.length - 1]) {
      labels.push(thresholds[thresholds.length - 1]);
    }
  }
  for (const value of labels) {
    const y = barY + barH - ((value - min) / span) * barH;
    ctx.beginPath();
    ctx.moveTo(barX + barW, y);
    ctx.lineTo(barX + barW + 5 * s, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(settings.decimalPlaces), barX + barW + 8 * s, y);
  }

  ctx.fillStyle = "rgba(23,19,14,0.7)";
  ctx.font = `bold ${9 * s}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("ELEV.", box.x + box.w / 2, box.y + box.h - 12 * s);

  // Selection outline (indicates the legend is tappable / size slider is open)
  if (selected) {
    ctx.strokeStyle = "hsl(var(--primary))";
    ctx.lineWidth = 2;
    roundRectPath(ctx, box.x - 2, box.y - 2, box.w + 4, box.h + 4, 8 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
