import { readingText } from "@/lib/reading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanCanvas, type PlanCamera } from "../PlanCanvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_STATS_CHIP_SIZE,
  getStatsChipSize,
  setStatsChipSize,
  STATS_CHIP_MAX,
  STATS_CHIP_MIN,
  STATS_CHIP_SIZE_EVENT,
} from "@/components/chrome/StatsChip";
import {
  legendStorageKey,
  patchCaptureSizes,
} from "@/lib/capture-sizes";
import { planLongSide, planProportionalSize, screenAnchoredImageSize } from "@/lib/screen-size";
import { STATS_PILL_COLORS, statsPillFont, statsPillPad, statsPillText } from "@/lib/stats-pill";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Undo2, X, SlidersHorizontal, Minus, Plus, ChevronDown, Hash, Eye, EyeOff } from "lucide-react";
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
import {
  savePoint,
  savePointLabelOffset,
  resetFloorPresentation,
  saveFloor,
} from "@/lib/db";
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
  pointSize?: number;
  pointColor?: string;
  excludedIds?: Set<string>;
  onExcludedIdsChange?: (ids: Set<string>) => void;
  /**
   * Offer "Send to Distress Survey" on a black-and-white contour.
   *
   * Only the field workspace passes this. Report Builder mounts the same
   * component on a slide, and a report sheet is not where a field layer is
   * written. Defaults to off so no other mount gains the action by accident.
   */
  allowContourLayer?: boolean;
  /**
   * The High, Low and difference this view is drawing, per boundary.
   *
   * A report sheet shows these numbers twice: on the pill over the plan and
   * again in its title rail. The rail was reading them from evidence stored
   * when the slide was imported, so a sheet could say 9.40 / 8.10 while the
   * pill beside it said 9.80 / 8.20 -- the drawing and its own caption
   * disagreeing. There is one source, and it is this component.
   *
   * Reporting only. Nothing here changes what is drawn.
   */
  onStats?: (stats: Array<{
    areaId: string;
    name: string;
    hi: number;
    lo: number;
    delta: number;
    decimalPlaces: number;
    /** The colour scale's bands, low to high, for a page that draws its own. */
    bands?: string[];
  }>) => void;
  /** null = "All areas". Owned by the route so the stats pills stay in sync. */
  selectedAreaId?: string | null;
  onSelectedAreaIdChange?: (id: string | null) => void;
  /** Report Builder hosts this same view on a slide. It needs to read the view
   *  the investigator sets, and to put a locked one back. */
  onCamera?: (camera: PlanCamera) => void;
  cameraRequest?: (PlanCamera & { nonce: number }) | null;
  /** Report Builder draws its own colour scale, pill and High/Low markers as
   *  placed boxes, so the drawing carries none of them. */
  hideCanvasChrome?: boolean;
  /**
   * The colour scale and the H/L/delta readings are drawn ON THE PAGE, as one
   * piece the investigator places, so this drawing leaves them off.
   *
   * Unlike `hideCanvasChrome` this does not touch the settings: it only skips
   * drawing those two. The settings matter because every control in the
   * slide's panel writes the resolved object straight back to the Customer
   * File, so forcing a flag to false there is how a report once came back
   * with its chrome switched off by nobody. The High and Low markers stay on
   * the drawing: they point at a spot on the floor, so they belong to the
   * picture and travel with it.
   */
  chromeOnPage?: boolean;
  /**
   * This view is a picture on a page, not a workspace on a screen.
   *
   * Report slides, exports and PDFs size their chrome as a fraction of the
   * plan, so it scales with the drawing and renders identically on any device
   * and on paper. The field app stays screen-anchored.
   */
  presentation?: boolean;
  /**
   * The host owns these render settings and persists them itself.
   *
   * Capture remembers sizes per Customer File on this device. Report Builder
   * owns report sizes in the Customer File report component. When the host
   * owns the settings, this view neither reads nor writes capture localStorage.
   */
  settingsOwnedByHost?: boolean;
  /** Capture scope for per-Customer-File-on-device size keys. */
  customerFileId?: string;
  /**
   * Report Builder rail: stats pill height in CSS px from floorLayout.pillLock.
   * When set with settingsOwnedByHost, the stepper never touches capture keys.
   */
  hostStatsPillPx?: number;
  onHostStatsPillPxChange?: (px: number) => void;
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
  /**
   * Which Topo group the report rail is showing. The tab row itself lives
   * under the Sheet Layout | Topo tabs. Field Control panel does not use this.
   * `legendhl` is accepted as a synonym for `accessories` (older rail state).
   */
  reportGroup?: "contours" | "readings" | "accessories" | "legendhl";
  /** A picture on a page: no pan, no zoom, the plan fits its frame. */
  staticView?: boolean;
  /**
   * Lock: the view is shown, not steered.
   *
   * A locked report slide must not pan, zoom, resize, or let the legend,
   * the pill or the High/Low markers be dragged -- the whole point is that
   * the framing the investigator set holds across every slide. The flag
   * reached the host and stopped there, adding a CSS class that no stylesheet
   * defined, so Lock looked like it worked and changed nothing.
   *
   * Settings are deliberately NOT frozen. Lock is about where things sit;
   * turning contours off on a locked slide is the point of locking it first.
   */
  locked?: boolean;
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
  /**
   * Field Clean view: host hides Data/Topo and the floating H/L/Δ chip when
   * true. Local-only; no network. Report mounts leave this unset.
   */
  onCleanViewChange?: (clean: boolean) => void;
  /**
   * Session diagnostic point panel (exclude from contour math). Host opens this
   * from ⋯; the field corner pill is gone. Uncontrolled when omitted.
   */
  diagnosticOpen?: boolean;
  onDiagnosticOpenChange?: (open: boolean) => void;
}

const DEFAULT_LABEL_DX = 8;
const DEFAULT_LABEL_DY = 6;
const LONG_PRESS_MS = 350;
/** Accessory hold-vs-drag threshold in SCREEN pixels (hand, not image zoom). */
const ACCESSORY_MOVE_PX = 6;
/**
 * Design font (screen CSS px) that authored the label pad 4 / 2.5 and radius 2.5.
 * Padding used to be `4 * (fontPx / fontBase)`. Under screen-anchored capture
 * that ratio is only the inverse view scale, so pad stayed fixed in CSS px while
 * the font stepper shrank the text — at 6px the box was mostly padding.
 * Scale chrome against this reference so the complete label footprint tracks the
 * font setting. At the default 11px font this matches the previous pad.
 */
const LABEL_CHROME_REF_PX = defaultRenderSettings.pointLabelFontSize;

/** Image-space multiplier so label pad/radius/stroke track drawn fontPx. */
function labelChromeK(fontPx: number) {
  return fontPx / LABEL_CHROME_REF_PX;
}

/**
 * The High/Low marker's drawn size, in image coordinates.
 *
 * `highLowPinSize` is the size that reads correctly on a plan of the reference
 * width. It used to be used as a literal image-space number, which meant the
 * marker was a different fraction of every differently-sized plan -- 1% of an
 * 1100 px plan, 0.44% of a 2500 px one -- and on a report slide, where the plan
 * is scaled down to fit the page, it shrank to an unreadable speck beside point
 * labels that held their size.
 *
 * One function, called by the drawing and by the hit test, so the marker cannot
 * be drawn in one size and grabbed in another.
 */
function pinFontPx(settings: RenderSettings, floor: Floor) {
  return planProportionalSize(
    settings.highLowPinSize,
    planLongSide(floor.planWidth, floor.planHeight),
  );
}

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
/**
 * Reading label font in image coordinates.
 *
 * Capture: fixed in image space so labels zoom with the plan (quieter fit
 * overview; pinch-in grows them). Sized from the fit scale so a phone fit
 * lands near ~72% of the old screen-anchored CSS size — a realistic drop that
 * stays readable; Point label size −/+ still scales it. Report slides keep
 * plan-proportional sizing. Legend / H/L/Δ / High/Low keep chromeSizeImg.
 */
const LABEL_FIT_FACTOR = 0.72;
function pointLabelFontImg(
  fontBase: number,
  floor: Floor,
  opts?: { presentation?: boolean; fitScale?: number },
) {
  const base = Math.max(1, fontBase);
  if (opts?.presentation) {
    return planProportionalSize(base, planLongSide(floor.planWidth, floor.planHeight));
  }
  const fit = opts?.fitScale && opts.fitScale > 0 ? opts.fitScale : 1;
  return (base * LABEL_FIT_FACTOR) / fit;
}

/**
 * The H / L / delta pill's drawn height, in image coordinates.
 *
 * Two modes, because the two surfaces genuinely want different things.
 *
 * In the field the pill is screen-anchored: you zoom into a plan to work and
 * the numbers have to stay readable on the device in your hand. That is proven
 * and it stays.
 *
 * On a page there is no screen to anchor to. A report slide, an export and a
 * PDF are pictures, so the pill is a fixed fraction of the plan -- it scales
 * with the drawing when the investigator resizes the topo, and it renders the
 * same on a phone, a desktop and on paper.
 */
function chromeSizeImg(
  base: number,
  viewScale: number,
  presentation: boolean,
  floor: Floor,
) {
  if (presentation) {
    return planProportionalSize(base, planLongSide(floor.planWidth, floor.planHeight));
  }
  return screenAnchoredImageSize(base, viewScale);
}

function pillHeightImg(
  base: number,
  viewScale: number,
  presentation: boolean,
  floor: Floor,
) {
  return chromeSizeImg(base, viewScale, presentation, floor);
}

type PillSeg = { kind: "label" | "hi" | "lo" | "delta"; text: string; w: number };

/** Segment layout + typography for one pill, in image coords. */
function pillMetrics(h: number, label: string | null, hi: number, lo: number, dec: number) {
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
  pointSize = 6,
  pointColor = "#dc2626",
  excludedIds: excludedIdsProp,
  onExcludedIdsChange,
  selectedAreaId = null,
  onSelectedAreaIdChange,
  onCamera,
  cameraRequest,
  hideCanvasChrome = false,
  chromeOnPage = false,
  presentation = false,
  settingsOwnedByHost = false,
  customerFileId,
  hostStatsPillPx,
  onHostStatsPillPxChange,
  statsPillForSingleBoundary = false,
  chromeless = false,
  controlsOnly = false,
  onCleanViewChange,
  diagnosticOpen: diagnosticOpenProp,
  onDiagnosticOpenChange,
  reportGroup,
  staticView = false,
  locked = false,
  onStats,
  resizeCorners = false,
  allowContourLayer = false,
}: Props) {
  // Field Control panel: Contours | Readings. Legend lives under Contours →
  // Display; H/L/Δ and High/Low live under Readings → Accessories (they come
  // from the readings). Report Builder keeps its own rail (controlsOnly).
  const [openCorner, setOpenCorner] = useState<TrialDoorKey | null>(null);
  /** Hide floating field chrome; Clean pill stays so chrome can return. Local only. */
  const [cleanView, setCleanView] = useState(false);
  /** Last parent tab, so Close then the pill returns to the same group. */
  const [lastTrialDoor, setLastTrialDoor] = useState<TrialDoorKey | null>(null);
  /** Which child tab is open per parent (visit memory only; not a setting). */
  const [trialSectionByDoor, setTrialSectionByDoor] = useState<
    Partial<Record<TrialDoorKey, string>>
  >({
    contours: "display",
    readings: "show",
  });
  const openTrialDoor = useCallback((key: TrialDoorKey) => {
    setLastTrialDoor(key);
    setOpenCorner(key);
  }, []);
  const setTrialSection = useCallback((door: TrialDoorKey, id: string | null) => {
    setTrialSectionByDoor((prev) => {
      const next = { ...prev };
      if (id == null) delete next[door];
      else next[door] = id;
      return next;
    });
  }, []);
  /** Report rail group. The tab row is outside this panel; field doors do not use it. */
  const reportPanel =
    reportGroup === "legendhl" ? "accessories" : reportGroup || "contours";
  /** Accessories sibling inside the report Accessories group. */
  const [reportAccessoryTab, setReportAccessoryTab] = useState<
    "legend" | "hld" | "highlow"
  >("legend");
  /**
   * Tap-to-size HUD for Legend / H/L/Δ / High/Low. Blue −/+ sits way above
   * the accessory so it does not fight press-and-move. Reading labels never
   * open this (they use the Readings | − | + pill).
   */
  const [sizeHud, setSizeHud] = useState<null | {
    kind: "legend" | "pill" | "pin";
    clientX: number;
    clientY: number;
  }>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  // "Send to Distress Survey" — idle while nothing has been asked for.
  const [layerState, setLayerState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [layerMessage, setLayerMessage] = useState("");
  // Stats pill size: capture = per Customer File on this device; report =
  // hostStatsPillPx from floorLayout.pillLock. Any settingsOwnedByHost mount
  // (rail or live drawing) must not read or listen to capture storage.
  const hostOwnsPill = settingsOwnedByHost;
  const [statsChipLocked, setStatsChipLocked] = useState<number | null>(null);
  useEffect(() => {
    if (hostOwnsPill) return;
    setStatsChipLocked(getStatsChipSize(customerFileId));
    const onSize = (e: Event) => {
      const detail = (
        e as CustomEvent<number | { size: number; customerFileId?: string | null }>
      ).detail;
      if (typeof detail === "number") {
        setStatsChipLocked(detail);
        return;
      }
      if (!detail || typeof detail.size !== "number") return;
      if (
        customerFileId &&
        detail.customerFileId &&
        detail.customerFileId !== customerFileId
      ) {
        return;
      }
      setStatsChipLocked(detail.size);
    };
    window.addEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    return () => {
      window.removeEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    };
  }, [customerFileId, hostOwnsPill]);
  const statsChipSize = hostOwnsPill
    ? Math.max(
        STATS_CHIP_MIN,
        Math.min(
          STATS_CHIP_MAX,
          Math.round(hostStatsPillPx ?? DEFAULT_STATS_CHIP_SIZE),
        ),
      )
    : (statsChipLocked ?? DEFAULT_STATS_CHIP_SIZE);
  const commitStatsPillSize = useCallback(
    (raw: number) => {
      const n = Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(raw)));
      if (hostOwnsPill) {
        onHostStatsPillPxChange?.(n);
        return;
      }
      setStatsChipLocked(n);
      setStatsChipSize(n, customerFileId);
      if (customerFileId) patchCaptureSizes(customerFileId, { statsPillSize: n });
    },
    [hostOwnsPill, onHostStatsPillPxChange, customerFileId],
  );
  const [legendDrag, setLegendDrag] = useState<{
    areaId: string;
    /** Pointer offset inside the legend box. */
    dx: number;
    dy: number;
    /** Live legendDx/legendDy while dragging a per-boundary legend. */
    legendDx: number;
    legendDy: number;
    /** Image-space pointer start — used once the drag is armed. */
    startPointerX: number;
    startPointerY: number;
    /** Screen-space start — hold-vs-drag threshold is zoom-independent. */
    startClientX: number;
    startClientY: number;
    /** False until the finger moves; hold-still opens size instead. */
    active: boolean;
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
  /** Scale at which the plan fits the viewport — anchors plan-scaled labels. */
  const [fitScale, setFitScale] = useState(1);
  // The plan's zoom against fit. Reported by the canvas with every camera
  // change; the legend uses it to hold one size on a page.
  const [planZoom, setPlanZoom] = useState(1);
  const handleCamera = useCallback(
    (camera: PlanCamera) => {
      const z = camera.zoom > 0 ? camera.zoom : 1;
      setPlanZoom((prev) => (Math.abs(prev - z) > 1e-4 ? z : prev));
      onCamera?.(camera);
    },
    [onCamera],
  );
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

  // Persist legend scale/position per Customer File on this device (capture only).
  const legendHydratedRef = useRef(false);
  useEffect(() => {
    if (settingsOwnedByHost) return;
    if (!customerFileId) return;
    if (legendHydratedRef.current) return;
    legendHydratedRef.current = true;
    if (typeof window === "undefined") return;
    let stored: { scale?: number; x?: number; y?: number } | null = null;
    try {
      const raw =
        window.localStorage.getItem(legendStorageKey(customerFileId)) ||
        window.localStorage.getItem("topo.legend.v1");
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
    // Only apply stored capture values. Screen defaults already came from the
    // host via loadCaptureSizes — do not force 1.5 over them.
    if (!stored) return;
    const patch: Partial<RenderSettings> = {};
    if (typeof stored.scale === "number") patch.legendScale = stored.scale;
    if (typeof stored.x === "number") patch.legendX = stored.x;
    if (typeof stored.y === "number") patch.legendY = stored.y;
    if (Object.keys(patch).length) {
      onSettingsChange(resolveSettings({ ...resolved, ...patch }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFileId, settingsOwnedByHost]);
  useEffect(() => {
    if (settingsOwnedByHost) return;
    if (!customerFileId) return;
    if (!legendHydratedRef.current) return;
    if (typeof window === "undefined") return;
    patchCaptureSizes(customerFileId, {
      legendScale: resolved.legendScale ?? 1.5,
      legendX: resolved.legendX,
      legendY: resolved.legendY,
    });
  }, [
    customerFileId,
    settingsOwnedByHost,
    resolved.legendScale,
    resolved.legendX,
    resolved.legendY,
  ]);


  // Live drag. Labels: long-press then move (unchanged). Accessories
  // (Legend / H/L/Δ pill / High/Low): press-and-move to move; tap opens the
  // blue size −/+ way above the piece. Reading labels never use this HUD.
  type DragKind = "label" | "pin-high" | "pin-low" | "pill";
  const [drag, setDrag] = useState<{
    kind: DragKind;
    id: string; // point id for "label", area id for "pill", floor id for pins
    dx: number;
    dy: number;
    startPointerX: number;
    startPointerY: number;
    startClientX: number;
    startClientY: number;
    startDx: number;
    startDy: number;
    active: boolean; // true after long-press (labels) or move threshold (accessories)
    /** Accessory (not a reading label): move on drag, size on tap. */
    accessory?: boolean;
  } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  // Drop label long-press timer if Topo unmounts mid-press.
  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);
  // Outside press dismisses the size HUD; −/+ inside it stay usable.
  useEffect(() => {
    if (!sizeHud) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest("[data-accessory-size-hud]")) return;
      setSizeHud(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sizeHud]);
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
  const [diagOpenLocal, setDiagOpenLocal] = useState(false);
  const diagControlled = typeof onDiagnosticOpenChange === "function";
  const diagOpen = diagControlled ? !!diagnosticOpenProp : diagOpenLocal;
  const setDiagOpen = (open: boolean) => {
    if (diagControlled) onDiagnosticOpenChange!(open);
    else setDiagOpenLocal(open);
  };
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

  // Report the numbers this view is drawing, so a sheet's rail cannot drift
  // from the pill on its own plan.
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  useEffect(() => {
    if (!onStatsRef.current) return;
    // The bands are this drawing's own palette, sampled low to high, so a
    // colour scale drawn on the page cannot disagree with the fill under it.
    const bands: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      bands.push(paletteColor(i / 11, resolved.palette, !!resolved.reversePalette));
    }
    onStatsRef.current(
      areaTopos.map((at) => ({
        areaId: at.area.id,
        name: at.area.name || "Boundary",
        hi: at.hi.value,
        lo: at.lo.value,
        delta: at.hi.value - at.lo.value,
        decimalPlaces: resolved.decimalPlaces ?? 2,
        bands: bands.slice(),
      })),
    );
  }, [areaTopos, resolved.decimalPlaces, resolved.palette, resolved.reversePalette]);

  const canRender = areaTopos.length > 0;
  // Single-surface view (focused area, or only one area exists).
  const soloTopo = areaTopos.length === 1 ? areaTopos[0] : null;
  const gridAndContours = soloTopo ? { grid: soloTopo.grid, contours: soloTopo.contours } : null;

  const update = (patch: Partial<RenderSettings>) =>
    onSettingsChange(resolveSettings({ ...resolved, ...patch }));

  /** Last Points/Labels state before a field “Readings” hide — restore on show. */
  const readingsPrevRef = useRef<{ showPoints: boolean; showLabels: boolean } | null>(null);
  const readingsOn = resolved.showPoints || resolved.showLabels;
  const LABEL_SIZE_MIN = 6;
  const LABEL_SIZE_MAX = 28;
  function toggleReadings() {
    if (readingsOn) {
      readingsPrevRef.current = {
        showPoints: resolved.showPoints,
        showLabels: resolved.showLabels,
      };
      update({ showPoints: false, showLabels: false });
    } else {
      const prev = readingsPrevRef.current;
      update({
        showPoints: prev?.showPoints ?? true,
        showLabels: prev?.showLabels ?? true,
      });
    }
  }
  function nudgeLabelSize(delta: number) {
    const next = Math.max(
      LABEL_SIZE_MIN,
      Math.min(LABEL_SIZE_MAX, Math.round(resolved.pointLabelFontSize + delta)),
    );
    if (next !== resolved.pointLabelFontSize) update({ pointLabelFontSize: next });
  }
  function setCleanViewOn(next: boolean) {
    setCleanView(next);
    if (next) setOpenCorner(null);
    onCleanViewChange?.(next);
  }
  useEffect(() => {
    return () => {
      onCleanViewChange?.(false);
    };
  }, [onCleanViewChange]);

  // High / Low of the focused area (used for pin hit-testing / dragging).
  const hiLo = soloTopo ? { hi: soloTopo.hi, lo: soloTopo.lo } : null;

  // Whether the canvas carries the H / L / delta pill. One definition, used by
  // both the drawing and the hit test: when those two disagreed about where a
  // piece of chrome was, it drew in one place and could be grabbed in another.
  const canvasStatsPill = !chromeOnPage &&
    statsPillOnCanvas(resolved, areaTopos.length, statsPillForSingleBoundary);




  type Hit =
    | { kind: "label"; point: SurveyPoint }
    | { kind: "pin-high" | "pin-low"; point: SurveyPoint; dx: number; dy: number }
    | { kind: "pill"; areaId: string; dx: number; dy: number };

  function hitDraggable(x: number, y: number): Hit | null {
    if (canvasStatsPill) {
      const h = pillHeightImg(statsChipSize, viewScale, presentation, floor);
      const showLabel = true;
      const dec = resolved.decimalPlaces;
      for (let i = areaTopos.length - 1; i >= 0; i--) {
        const at = areaTopos[i];
        const m = pillMetrics(h, showLabel ? at.area.name : null, at.hi.value, at.lo.value, dec);
        const { cx, cy } = pillCenter(at.area);
        const x0 = cx - m.total / 2;
        const y0 = cy - h / 2;
        if (x < x0 || x > x0 + m.total || y < y0 || y > y0 + h) continue;
        return {
          kind: "pill",
          areaId: at.area.id,
          dx: at.area.pillDx ?? 0,
          dy: at.area.pillDy ?? 0,
        };
      }
    }
    // Pins next — they sit above the point dot and are visually on top.
    if (resolved.showHighLow && hiLo && gridAndContours?.grid && resolved.mode !== "points-only") {
      const check = (kind: "pin-high" | "pin-low", pt: SurveyPoint, dx: number, dy: number) => {
        const fontPx = pinFontPx(resolved, floor);
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
      // Must match the drawn size exactly, or a tap lands beside the label.
      const fontPx = pointLabelFontImg(fontBase, floor, {
        presentation,
        fitScale,
      });
      const k = fontPx / fontBase;
      const dec = resolved.decimalPlaces;
      const weight = resolved.pointLabelWeight;
      const pad = 4 * labelChromeK(fontPx);
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
    // Only where the label SITS. `points` may be the corrected array -- it is
    // on every topo -- so sending the whole point would write a normalized
    // reading into raw storage.
    savePointLabelOffset(p.floorId, p.id, dx, dy).catch(() => {});
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
      savePointLabelOffset(p.floorId, p.id, lastMove.prevDx, lastMove.prevDy).catch(() => {});
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
    const pinsSet =
      floor.highPinDx !== undefined ||
      floor.highPinDy !== undefined ||
      floor.lowPinDx !== undefined ||
      floor.lowPinDy !== undefined;
    if (!updates.length && !pinsSet) {
      setLastMove(null);
      return;
    }
    const cleared: Floor = {
      ...floor,
      highPinDx: undefined,
      highPinDy: undefined,
      lowPinDx: undefined,
      lowPinDy: undefined,
    };
    if (updates.length) {
      const map = new Map(updates.map((u) => [u.id, u]));
      onPointsChange(points.map((p) => map.get(p.id) ?? p));
    }
    // The reset writes FIRST, and the host is told afterwards.
    //
    // onFloorChange is how a host refreshes, and the report host also
    // persists on it (ReportTopoWorkspace's handleFloor calls saveFloor).
    // That is a second whole-record write, and when it got there first it
    // loaded a record that still had the label offsets on it and wrote them
    // straight back. Consolidating the reset into one save did not make the
    // ACTION one save. Telling the host after the write means whatever it
    // persists is already the cleared record.
    resetFloorPresentation(cleared, updates.map((u) => u.id))
      .then((fresh) => {
        // The host is told with the level as STORAGE now has it, not with the
        // copy this component has been holding. A host that persists on the
        // refresh then writes back what is already there; told `cleared`, it
        // wrote its own stale notes and transitions over a newer stored edit.
        if (fresh) onFloorChange(fresh);
      })
      // A reset that did not land must not run the path that follows a reset
      // that did. .catch before .then let a failed save go on to tell the
      // host the reset had happened.
      .catch(() => {});
    setLastMove(null);
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Area selector — only when the floor has more than one drawn area.
          Draggable so report screenshots can clear it off the plan. */}
      {areas.length > 1 && !chromeless && !cleanView && (
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
      {/* Readings | − | + — on/off + label size; same pill family as Control panel. */}
      {!chromeless && !controlsOnly && !cleanView && (
        <div
          className={
            "absolute z-30 top-2 left-2 landscape-short:top-auto landscape-short:left-[calc(env(safe-area-inset-left)+0.75rem)] landscape-short:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] " +
            "h-9 flex items-stretch rounded-full backdrop-blur shadow-md border overflow-hidden text-xs font-medium " +
            (readingsOn
              ? "bg-white/95 border-gray-300 text-gray-700"
              : "bg-white/80 border-gray-300 text-gray-400")
          }
          role="group"
          aria-label="Readings"
        >
          <button
            type="button"
            onClick={toggleReadings}
            aria-label={readingsOn ? "Hide readings" : "Show readings"}
            aria-pressed={readingsOn}
            className="px-3 flex items-center gap-1.5 hover:bg-gray-50"
          >
            <Hash className="h-3.5 w-3.5 shrink-0" />
            <span>Readings</span>
          </button>
          <span className="w-px bg-gray-200" aria-hidden />
          <button
            type="button"
            onClick={() => nudgeLabelSize(-1)}
            disabled={resolved.pointLabelFontSize <= LABEL_SIZE_MIN}
            aria-label="Smaller reading labels"
            className="w-9 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-px bg-gray-200" aria-hidden />
          <button
            type="button"
            onClick={() => nudgeLabelSize(1)}
            disabled={resolved.pointLabelFontSize >= LABEL_SIZE_MAX}
            aria-label="Larger reading labels"
            className="w-9 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {/* Clean view + Control panel — same row, same height (peer pills). */}
      {!chromeless && !controlsOnly && (
        <div
          className={
            "absolute z-30 top-2 right-2 flex items-center gap-1.5 " +
            "landscape-short:top-auto landscape-short:right-auto landscape-short:left-1/2 landscape-short:-translate-x-1/2 landscape-short:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]"
          }
        >
          <button
            type="button"
            onClick={() => setCleanViewOn(!cleanView)}
            aria-label={cleanView ? "Show chrome" : "Clean view"}
            aria-pressed={cleanView}
            className={
              "h-9 px-3 flex items-center gap-1.5 rounded-full backdrop-blur shadow-md border " +
              "text-xs font-medium " +
              (cleanView
                ? "bg-white/95 border-gray-300 text-gray-700 hover:bg-gray-50"
                : "bg-white/95 border-gray-300 text-gray-700 hover:bg-gray-50")
            }
          >
            {cleanView ? (
              <EyeOff className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Eye className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{cleanView ? "Chrome" : "Clean"}</span>
          </button>
          {!cleanView && openCorner == null && (
            <button
              type="button"
              onClick={() => openTrialDoor(lastTrialDoor ?? "contours")}
              aria-label="Control panel"
              className={
                "h-9 px-3 flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur shadow-md border border-gray-300 " +
                "text-xs font-medium text-gray-700 hover:bg-gray-50"
              }
            >
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span>Control panel</span>
            </button>
          )}
        </div>
      )}
      {/* Diagnostic points — opened from ⋯ (not a field corner pill). */}
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
          onCamera={handleCamera}
          cameraRequest={cameraRequest || undefined}
          staticView={staticView}
          frozen={locked}
          resizeCorners={resizeCorners && !locked}
          refitOnResize={false}
          // A slide's drawing is a picture on paper: when the frame changes
          // size -- the window, one view becoming two, screen to printed
          // sheet -- it shows the same view in the new frame rather than
          // keeping pixels measured against the old one.
          reframeOnResize={presentation}
          onTransform={(t, meta) => {
            setViewScale((s) => (Math.abs(s - t.scale) > 1e-4 ? t.scale : s));
            if (meta?.fitScale > 0) {
              setFitScale((s) => (Math.abs(s - meta.fitScale) > 1e-4 ? meta.fitScale : s));
            }
          }}
          onImagePointerDown={(x, y, event) => {
            // Legend: press-and-move to place; tap opens blue size −/+ above it.
            // Every visible contour surface gets its own legend next to that
            // boundary — All boundaries, Main Floor alone, or Lower Bedroom alone.
            if (resolved.showLegend && !chromeOnPage && areaTopos.length > 0 &&
                resolved.mode !== "points-only") {
              for (let i = areaTopos.length - 1; i >= 0; i--) {
                const at = areaTopos[i];
                const box = areaLegendBox(at.area, resolved, floor, null, {
                  presentation,
                  zoom: planZoom,
                });
                const inBox =
                  x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
                if (inBox) {
                  setLegendDrag({
                    areaId: at.area.id,
                    dx: x - box.x,
                    dy: y - box.y,
                    legendDx: at.area.legendDx ?? 0,
                    legendDy: at.area.legendDy ?? 0,
                    startPointerX: x,
                    startPointerY: y,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    active: false,
                  });
                  clearLongPress();
                  return true;
                }
              }
            }
            // Accessories (pill / High/Low): press-and-move to move; tap for
            // size. Point labels keep long-press-to-arm so a casual pan does
            // not pick one up (and so pinch can cancel before the move arms).
            const hit = hitDraggable(x, y);
            if (hit) {
              const startDx =
                hit.kind === "label" ? (hit.point.labelDx ?? DEFAULT_LABEL_DX) : hit.dx;
              const startDy =
                hit.kind === "label" ? (hit.point.labelDy ?? DEFAULT_LABEL_DY) : hit.dy;
              const accessory = hit.kind !== "label";
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
                startClientX: event.clientX,
                startClientY: event.clientY,
                startDx,
                startDy,
                active: false,
                accessory,
              });
              clearLongPress();
              if (!accessory) {
                longPressTimer.current = window.setTimeout(() => {
                  setDrag((d) => (d ? { ...d, active: true } : d));
                }, LONG_PRESS_MS);
              }
              return true;
            }
            return false;
          }}
          onImagePointerMove={(x, y, event) => {
            if (legendDrag?.areaId) {
              if (!legendDrag.active) {
                // Screen pixels: same finger travel at any canvas zoom.
                const moved = Math.hypot(
                  event.clientX - legendDrag.startClientX,
                  event.clientY - legendDrag.startClientY,
                );
                if (moved > ACCESSORY_MOVE_PX) {
                  setSizeHud(null);
                  setLegendDrag({ ...legendDrag, active: true });
                }
                return;
              }
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
                if (drag.accessory) {
                  const moved = Math.hypot(
                    event.clientX - drag.startClientX,
                    event.clientY - drag.startClientY,
                  );
                  if (moved > ACCESSORY_MOVE_PX) {
                    // Accessory: movement wins — drag; size stays out of the way.
                    setSizeHud(null);
                    setDrag({ ...drag, active: true });
                  }
                } else {
                  // Label: image-space cancel before long-press (proven gesture).
                  const moved = Math.hypot(
                    x - drag.startPointerX,
                    y - drag.startPointerY,
                  );
                  if (moved > 6) {
                    clearLongPress();
                    setDrag(null);
                  }
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
            if (legendDrag?.areaId != null) {
              if (
                legendDrag.active &&
                legendDrag.legendDx != null &&
                legendDrag.legendDy != null
              ) {
                applyLegendOffset(legendDrag.areaId, legendDrag.legendDx, legendDrag.legendDy);
              } else if (!legendDrag.active) {
                // Tap legend → blue size −/+ way above (not under the thumb).
                setSizeHud({
                  kind: "legend",
                  clientX: legendDrag.startClientX,
                  clientY: legendDrag.startClientY,
                });
              }
            }
            setLegendDrag(null);
            clearLongPress();
            if (drag) {
              const moved = drag.dx !== drag.startDx || drag.dy !== drag.startDy;
              if (drag.active && moved) {
                if (drag.kind === "label") commitLabelMove(drag.id, drag.dx, drag.dy);
                else if (drag.kind === "pill") commitPillMove(drag.id, drag.dx, drag.dy);
                else commitPinMove(drag.kind, drag.dx, drag.dy);
              } else if (drag.accessory && !drag.active) {
                // Tap accessory → size. Move is press-and-drag only.
                setSizeHud({
                  kind: drag.kind === "pill" ? "pill" : "pin",
                  clientX: drag.startClientX,
                  clientY: drag.startClientY,
                });
              }
            }
            setDrag(null);
          }}
          onImagePointerCancel={() => {
            // Pinch took over — discard accessory / label drag without commit.
            clearLongPress();
            setLegendDrag(null);
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
              legendDrag?.active &&
              legendDrag.areaId != null &&
              legendDrag.legendDx != null &&
              legendDrag.legendDy != null
                ? { id: legendDrag.areaId, dx: legendDrag.legendDx, dy: legendDrag.legendDy }
                : null;
            renderTopoTop(ctx, floor, visiblePoints, resolved, areaTopos, {
              liveDrag: activeLabel,
              highlightId: activeLabel?.id ?? null,
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
              chromeOnPage,
              presentation,
              planZoom,
              pointSize,
              pointColor,
              viewScale,
              fitScale,
            });
          }}
        />
        )}

        {/* Contours — Control panel destination 1 */}
        {(openCorner === "contours" && !controlsOnly) && (
          <TrialPanel
            title="Contours"
            tabs="contours"
            onTab={openTrialDoor}
            onClose={() => setOpenCorner(null)}
          >
            <TrialSectionTabs
              label="Contours"
              openId={trialSectionByDoor.contours ?? "display"}
              onChange={(id) => setTrialSection("contours", id)}
              lead={
                gridAndContours?.grid ? (
                  <p className="text-[10px] tabular-nums text-muted-foreground">
                    Range {readingText(gridAndContours.grid.minValue)}"–
                    {readingText(gridAndContours.grid.maxValue)}"
                  </p>
                ) : null
              }
              items={[
                {
                  id: "display",
                  title: "Display",
                  body: (
                    <>
                      <div>
                        <Label className="text-xs">Mode</Label>
                        <select
                          value={resolved.mode}
                          onChange={(e) =>
                            update({ mode: e.target.value as RenderSettings["mode"] })
                          }
                          className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="contour-fill">Color fill</option>
                          <option value="contour-cells">Color cells</option>
                          <option value="contour-bw">B&W lines</option>
                          <option value="points-only">Points only</option>
                        </select>
                      </div>
                      <SwitchRow
                        label="Contours on"
                        checked={resolved.showContours}
                        onChange={(v) => update({ showContours: v })}
                      />
                      <SwitchRow
                        label="Floor plan"
                        checked={resolved.showPlan}
                        onChange={(v) => update({ showPlan: v })}
                      />
                      {allowContourLayer && resolved.mode === "contour-bw" && (
                        <div className="border-t pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 w-full text-xs"
                            disabled={layerState === "working"}
                            onClick={async () => {
                              setLayerState("working");
                              setLayerMessage("");
                              try {
                                const [{ composeContourLayer }, { persistContourLayer }] =
                                  await Promise.all([
                                    import("@/lib/contour-layer"),
                                    import("@/lib/db"),
                                  ]);
                                const drawn = await composeContourLayer({
                                  floor,
                                  points,
                                  settings: resolved,
                                  areaId: selectedAreaId,
                                });
                                if (!drawn) {
                                  setLayerState("failed");
                                  setLayerMessage(
                                    "No contours to send yet — this level needs a closed boundary with readings inside it.",
                                  );
                                  return;
                                }
                                await persistContourLayer(floor.id, drawn.dataUrl, {
                                  areaName: drawn.areaName,
                                  width: drawn.extent.w,
                                  height: drawn.extent.h,
                                  pointCount: drawn.pointCount,
                                });
                                setLayerState("done");
                                setLayerMessage(
                                  `Sent ${drawn.areaName}. Distress Survey can show the pins on it.`,
                                );
                              } catch (err) {
                                setLayerState("failed");
                                setLayerMessage(
                                  (err as Error)?.message ||
                                    "Could not send the contour to Distress Survey.",
                                );
                              }
                            }}
                          >
                            {layerState === "working" ? "Sending…" : "Send to Distress Survey"}
                          </Button>
                          {layerMessage && (
                            <p
                              className={
                                "mt-1 text-[10px] leading-tight " +
                                (layerState === "failed"
                                  ? "text-destructive"
                                  : "text-muted-foreground")
                              }
                            >
                              {layerMessage}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="border-t pt-2 space-y-2">
                        <p className="text-[10px] text-muted-foreground">
                          Color scale on the plan. Press and move to place. Tap for
                          size −/+.
                        </p>
                        <SwitchRow
                          label="Legend"
                          checked={resolved.showLegend}
                          onChange={(v) => update({ showLegend: v })}
                        />
                        <StepperControl
                          label="Legend size"
                          value={Math.round((resolved.legendScale ?? 1) * 10) / 10}
                          min={0.4}
                          max={4}
                          step={0.1}
                          unitless
                          onChange={(v) =>
                            update({
                              legendScale: Math.max(0.4, Math.min(4, Math.round(v * 10) / 10)),
                            })
                          }
                        />
                      </div>
                    </>
                  ),
                },
                {
                  id: "colors",
                  title: "Colors",
                  body: (
                    <>
                      <SwitchRow
                        label="Reverse"
                        checked={resolved.reversePalette}
                        onChange={(v) => update({ reversePalette: v })}
                      />
                      <PalettePicker
                        value={resolved.palette}
                        onChange={(p) => update({ palette: p })}
                      />
                    </>
                  ),
                },
                {
                  id: "lines",
                  title: "Lines",
                  body: (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="min-w-0">
                          <Label className="text-xs">First</Label>
                          <Input
                            type="number"
                            step="0.05"
                            enterKeyHint="done"
                            value={resolved.firstContour ?? ""}
                            placeholder="auto"
                            onChange={(e) =>
                              update({
                                firstContour:
                                  e.target.value === "" ? null : parseFloat(e.target.value),
                              })
                            }
                            className="mt-1 h-10 w-full text-base"
                          />
                        </div>
                        <div className="min-w-0">
                          <Label className="text-xs">Step</Label>
                          <StepInput
                            value={resolved.contourStep}
                            onCommit={(step) => update({ contourStep: step, interval: step })}
                          />
                        </div>
                        <div className="min-w-0">
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
                                update({
                                  contourCount: isFinite(n) ? Math.max(2, n) : null,
                                });
                              }
                            }}
                            className="mt-1 h-10 w-full text-base"
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
                    </>
                  ),
                },
              ]}
            />
          </TrialPanel>
        )}

        {(openCorner === "readings" && !controlsOnly) && (
          <TrialPanel
            title="Readings"
            tabs="readings"
            onTab={openTrialDoor}
            onClose={() => setOpenCorner(null)}
          >
            <TrialSectionTabs
              label="Readings"
              openId={trialSectionByDoor.readings ?? "show"}
              onChange={(id) => setTrialSection("readings", id)}
              items={[
                {
                  id: "show",
                  title: "Show",
                  body: (
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-2">
                        <SwitchRow
                          label="Points"
                          checked={resolved.showPoints}
                          onChange={(v) => update({ showPoints: v, pointsOpacity: 1 })}
                        />
                        <SwitchRow
                          label="Labels"
                          checked={resolved.showLabels}
                          onChange={(v) => update({ showLabels: v })}
                        />
                      </div>
                      <SwitchRow
                        label="Declutter"
                        checked={resolved.declutterLabels !== false}
                        onChange={(v) => update({ declutterLabels: v })}
                      />
                    </div>
                  ),
                },
                {
                  id: "format",
                  title: "Format",
                  body: (
                    <div className="space-y-2.5">
                      <StepperControl
                        label="Point label size"
                        value={resolved.pointLabelFontSize}
                        min={6}
                        max={28}
                        step={1}
                        onChange={(v) =>
                          update({
                            pointLabelFontSize: Math.max(6, Math.min(28, Math.round(v))),
                          })
                        }
                      />
                      <div>
                        <Label className="text-xs">Weight</Label>
                        <select
                          value={resolved.pointLabelWeight}
                          onChange={(e) =>
                            update({
                              pointLabelWeight: e.target.value as "normal" | "bold",
                            })
                          }
                          className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Color</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="color"
                            value={resolved.pointLabelColor}
                            onChange={(e) => update({ pointLabelColor: e.target.value })}
                            className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                          />
                          <Input
                            enterKeyHint="done"
                            value={resolved.pointLabelColor}
                            onChange={(e) => update({ pointLabelColor: e.target.value })}
                            className="h-10 flex-1 font-mono text-base"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Label className="shrink-0 text-xs">Label bg</Label>
                        <div className="inline-flex h-10 min-w-0 flex-1 overflow-hidden rounded-md border">
                          {(["white", "transparent", "plain"] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              className={`min-w-0 flex-1 px-2 text-xs font-medium ${
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
                      <NumberControl
                        compact
                        label="Decimals"
                        value={resolved.decimalPlaces}
                        min={0}
                        max={3}
                        step={1}
                        onChange={(v) =>
                          update({
                            decimalPlaces: Math.max(
                              0,
                              Math.min(3, Math.round(v ?? defaultRenderSettings.decimalPlaces)),
                            ),
                          })
                        }
                      />
                    </div>
                  ),
                },
                {
                  id: "accessories",
                  title: "Accessories",
                  body: (
                    <div className="space-y-3">
                      <p className="text-[10px] text-muted-foreground">
                        Summary pill and High/Low markers come from these readings.
                        Press and move to place. Tap for size −/+.
                      </p>
                      <StepperControl
                        label="H/L/Δ size"
                        value={statsChipSize}
                        min={STATS_CHIP_MIN}
                        max={STATS_CHIP_MAX}
                        step={2}
                        unitless
                        onChange={(v) => commitStatsPillSize(v)}
                      />
                      <div className="border-t pt-2 space-y-2">
                        <SwitchRow
                          label="High / low"
                          checked={resolved.showHighLow}
                          onChange={(v) => update({ showHighLow: v })}
                        />
                        <StepperControl
                          label="High/Low size"
                          value={resolved.highLowPinSize}
                          min={7}
                          max={28}
                          step={1}
                          unitless
                          onChange={(v) =>
                            update({
                              highLowPinSize: Math.max(7, Math.min(28, Math.round(v))),
                            })
                          }
                        />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </TrialPanel>
        )}

        {/*
          Three tabs, for the copy of this panel that Report Builder mounts.

          The three panels used to be forced open at once and stacked down the
          rail -- about a thousand pixels of it -- with "Labels & layers"
          doing three unrelated jobs under one name: what is drawn, how the
          numbers read, and how big each piece is. Legend size sat in the
          middle of a pile of switches. Tim: "the contour rail has always been
          very cluttered... the most common used controls are hidden deeper."

          The names are the app's own words, not invented categories. Each
          size sits beside the thing it sizes -- Legend size under Legend,
          H/L/Δ size under H/L/Δ -- so a piece and its size are never in two
          different places.

          The field Control panel is the floating folder tabs. This strip is
          Report Builder only. Accessories holds Legend, H/L/Δ, and High/Low.
        */}
        {controlsOnly && (
          <div
            id="rb-topo-group-panel"
            role="tabpanel"
            aria-labelledby={"rb-topo-tab-" + reportPanel}
            data-rb-topo-panel={reportPanel}
            className="space-y-3 text-sm"
          >
            {/*
              The three groups are a second tab row on the report rail, above
              this panel. Only the selected group's controls render. Field
              Control panel keeps its own accordions.
            */}
            {([
              ["contours", "Contours"],
              ["readings", "Readings"],
              ["accessories", "Accessories"],
            ] as const).filter(([key]) => key === reportPanel).map(([key]) => {
              return (
                <div key={key}>
                      {key === "contours" && (
                        <>
                          {gridAndContours?.grid && (
                            <p className="text-[10px] text-muted-foreground tabular-nums -mt-1">
                              Range {readingText(gridAndContours.grid.minValue)}"–
                              {readingText(gridAndContours.grid.maxValue)}"
                            </p>
                          )}
                          <div>
                            <Label className="text-xs">Mode</Label>
                            <select
                              value={resolved.mode}
                              onChange={(e) =>
                                update({ mode: e.target.value as RenderSettings["mode"] })
                              }
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
                                    firstContour:
                                      e.target.value === "" ? null : parseFloat(e.target.value),
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
                                    update({
                                      contourCount: isFinite(n) ? Math.max(2, n) : null,
                                    });
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
                          <SwitchRow
                            label="Floor plan"
                            checked={resolved.showPlan}
                            onChange={(v) => update({ showPlan: v })}
                          />
                        </>
                      )}
                      {key === "readings" && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <SwitchRow
                              label="Points"
                              checked={resolved.showPoints}
                              onChange={(v) => update({ showPoints: v, pointsOpacity: 1 })}
                            />
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
                                update({
                                  decimalPlaces: Math.max(
                                    0,
                                    Math.min(3, Math.round(v ?? defaultRenderSettings.decimalPlaces)),
                                  ),
                                })
                              }
                            />
                            <SwitchRow
                              label="Declutter"
                              checked={resolved.declutterLabels !== false}
                              onChange={(v) => update({ declutterLabels: v })}
                            />
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
                                    {opt === "white"
                                      ? "Box"
                                      : opt === "transparent"
                                        ? "Border"
                                        : "Plain"}
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
                                  update({
                                    pointLabelFontSize: Math.max(6, Math.min(28, Math.round(v))),
                                  })
                                }
                              />
                              <div>
                                <Label className="text-xs">Weight</Label>
                                <select
                                  value={resolved.pointLabelWeight}
                                  onChange={(e) =>
                                    update({
                                      pointLabelWeight: e.target.value as "normal" | "bold",
                                    })
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
                        </>
                      )}
                      {key === "accessories" && (
                        <div className="space-y-3">
                          <div
                            role="tablist"
                            aria-label="Accessories"
                            className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1"
                          >
                            {(
                              [
                                ["legend", "Legend"],
                                ["hld", "H/L/Δ"],
                                ["highlow", "High/Low"],
                              ] as const
                            ).map(([id, name]) => (
                              <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={reportAccessoryTab === id}
                                onClick={() => setReportAccessoryTab(id)}
                                className={
                                  "rounded-md px-2 py-1.5 text-xs font-medium " +
                                  (reportAccessoryTab === id
                                    ? "bg-background shadow-sm"
                                    : "text-muted-foreground hover:text-foreground")
                                }
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                          {reportAccessoryTab === "legend" && (
                            <div className="grid grid-cols-2 gap-2">
                              <SwitchRow
                                label="Legend"
                                checked={resolved.showLegend}
                                onChange={(v) => update({ showLegend: v })}
                              />
                              <StepperControl
                                label="Legend size"
                                value={Math.round((resolved.legendScale ?? 1) * 10) / 10}
                                min={0.4}
                                max={4}
                                step={0.1}
                                unitless
                                onChange={(v) =>
                                  update({
                                    legendScale: Math.max(
                                      0.4,
                                      Math.min(4, Math.round(v * 10) / 10),
                                    ),
                                  })
                                }
                              />
                            </div>
                          )}
                          {reportAccessoryTab === "hld" && (
                            <div className="grid grid-cols-2 gap-2">
                              <SwitchRow
                                label="H/L/Δ pill"
                                checked={resolved.showStatsPill !== false}
                                onChange={(v) => update({ showStatsPill: v })}
                              />
                              <div className="col-span-2">
                                <StepperControl
                                  label="H/L/Δ size"
                                  value={statsChipSize}
                                  min={STATS_CHIP_MIN}
                                  max={STATS_CHIP_MAX}
                                  step={2}
                                  unitless
                                  onChange={(v) => commitStatsPillSize(v)}
                                />
                              </div>
                            </div>
                          )}
                          {reportAccessoryTab === "highlow" && (
                            <div className="grid grid-cols-2 gap-2">
                              <SwitchRow
                                label="High / low"
                                checked={resolved.showHighLow}
                                onChange={(v) => update({ showHighLow: v })}
                              />
                              <StepperControl
                                label="High/Low size"
                                value={resolved.highLowPinSize}
                                min={7}
                                max={28}
                                step={1}
                                unitless
                                onChange={(v) =>
                                  update({
                                    highLowPinSize: Math.max(7, Math.min(28, Math.round(v))),
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}
                </div>
              );
            })}
          </div>
        )}
        {sizeHud && !controlsOnly && (
          <AccessorySizeHud
            kind={sizeHud.kind}
            clientX={sizeHud.clientX}
            clientY={sizeHud.clientY}
            legendScale={Math.round((resolved.legendScale ?? 1) * 10) / 10}
            pillSize={statsChipSize}
            pinSize={resolved.highLowPinSize}
            onLegend={(v) =>
              update({
                legendScale: Math.max(0.4, Math.min(4, Math.round(v * 10) / 10)),
              })
            }
            onPill={(v) => commitStatsPillSize(v)}
            onPin={(v) =>
              update({
                highLowPinSize: Math.max(7, Math.min(28, Math.round(v))),
              })
            }
            onClose={() => setSizeHud(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Field Control panel parent tabs. */
const TRIAL_DOORS = [
  { key: "contours", name: "Contours" },
  { key: "readings", name: "Readings" },
] as const;

type TrialDoorKey = (typeof TRIAL_DOORS)[number]["key"];

/**
 * Compact card (not full-height). Accordion in the body; Back / destination
 * in the footer. Known-scroll only inside an open section.
 */
/** Customer File visual system — css/styles.css (:root --navy / --accent / --line). */
const TRIAL_NAVY = "#07283d";
const TRIAL_RUST = "#c14a2b";
const TRIAL_LINE = "#c9d0d5";

function TrialFolderTabs({
  active,
  onChange,
}: {
  active: TrialDoorKey;
  onChange: (key: TrialDoorKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Control panel"
      className="flex min-w-0 flex-1 items-end gap-1"
      onKeyDown={(event) => {
        const keys = TRIAL_DOORS.map((d) => d.key);
        const idx = Math.max(0, keys.indexOf(active));
        let next = idx;
        if (event.key === "ArrowRight") next = (idx + 1) % keys.length;
        else if (event.key === "ArrowLeft") next = (idx + keys.length - 1) % keys.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = keys.length - 1;
        else return;
        event.preventDefault();
        const key = keys[next];
        onChange(key);
        requestAnimationFrame(() => {
          document.getElementById("fs-cp-tab-" + key)?.focus();
        });
      }}
    >
      {TRIAL_DOORS.map((d) => {
        const on = d.key === active;
        return (
          <button
            key={d.key}
            type="button"
            role="tab"
            id={"fs-cp-tab-" + d.key}
            data-fs-cp-tab={d.key}
            aria-selected={on}
            aria-controls="fs-cp-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(d.key)}
            className="min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-t-[6px] border px-1 text-center text-xs leading-none"
            style={{
              marginBottom: -1,
              backgroundColor: on ? TRIAL_NAVY : "#e5ebee",
              color: on ? "#fff" : "#3d5c70",
              fontWeight: on ? 700 : 650,
              borderColor: on ? TRIAL_NAVY : TRIAL_LINE,
              borderBottomColor: on ? TRIAL_NAVY : TRIAL_LINE,
            }}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

function TrialPanel({
  title,
  titleAccent,
  stepLabel,
  status,
  onClose,
  children,
  footer,
  tabs,
  onTab,
}: {
  title: string;
  /** Hub only: rust title so the Control panel name carries the accent. */
  titleAccent?: "rust";
  stepLabel?: string;
  status?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Field trial: one folder-tab row. The accepted hub stays in this file and is not opened. */
  tabs?: TrialDoorKey;
  onTab?: (key: TrialDoorKey) => void;
}) {
  const rustTitle = titleAccent === "rust";
  const tabbed = tabs != null && onTab != null;
  return (
    <div
      data-fs-cp={tabbed ? "panel" : undefined}
      className={
        tabbed
          ? "absolute z-30 right-[max(0.5rem,env(safe-area-inset-right))] top-2 flex w-[280px] max-w-[calc(100%-1rem)] max-h-[min(32rem,calc(100%-env(safe-area-inset-bottom)-0.75rem))] flex-col overflow-hidden rounded-xl border bg-white shadow-lg landscape-short:top-2"
          : "absolute z-30 top-12 right-2 flex w-72 max-h-[min(32rem,calc(100%-5.5rem))] flex-col overflow-hidden rounded-xl border bg-white shadow-lg backdrop-blur landscape-short:top-2"
      }
      style={{ borderColor: TRIAL_LINE }}
    >
      {tabbed ? (
        <div className="flex shrink-0 flex-col bg-white">
          <div className="flex h-11 shrink-0 items-center justify-end pr-0.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div
            className="flex shrink-0 items-end border-b pl-1.5 pr-1.5"
            style={{ borderColor: TRIAL_LINE }}
          >
            <TrialFolderTabs active={tabs} onChange={onTab} />
          </div>
        </div>
      ) : (
      <div
        className="flex shrink-0 items-start justify-between gap-2 border-b bg-white px-3 pb-2 pt-2.5"
        style={{ borderColor: TRIAL_LINE }}
      >
        <div className="min-w-0">
          {stepLabel ? (
            <p className="text-[10px] font-medium text-muted-foreground">{stepLabel}</p>
          ) : null}
          <h2
            className={
              rustTitle
                ? "text-base font-bold leading-tight"
                : "text-sm font-semibold leading-tight"
            }
            style={{ color: rustTitle ? TRIAL_RUST : TRIAL_NAVY }}
          >
            {title}
          </h2>
          {status ? (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{status}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      )}
      <div
        id={tabbed ? "fs-cp-panel" : undefined}
        role={tabbed ? "tabpanel" : undefined}
        aria-labelledby={tabbed ? "fs-cp-tab-" + tabs : undefined}
        className={
          tabbed
            ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white text-sm"
            : "flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden bg-white px-3 py-2.5 text-sm"
        }
      >
        {children}
      </div>
      {footer && !tabbed ? (
        <div
          className="shrink-0 border-t bg-white px-3 py-2"
          style={{ borderColor: TRIAL_LINE }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Second folder-tab row. The selected section's controls scroll beneath it. */
function TrialSectionTabs({
  label,
  openId,
  onChange,
  items,
  lead,
}: {
  label: string;
  openId: string;
  onChange: (id: string) => void;
  items: { id: string; title: string; body: React.ReactNode }[];
  lead?: React.ReactNode;
}) {
  const active = items.find((item) => item.id === openId) ?? items[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label={label}
        className="flex shrink-0 items-end gap-1 border-b bg-white px-1.5 pt-1"
        style={{ borderColor: TRIAL_LINE }}
        onKeyDown={(event) => {
          const idx = Math.max(0, items.findIndex((item) => item.id === active?.id));
          let next = idx;
          if (event.key === "ArrowRight") next = (idx + 1) % items.length;
          else if (event.key === "ArrowLeft") next = (idx + items.length - 1) % items.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = items.length - 1;
          else return;
          event.preventDefault();
          const id = items[next].id;
          onChange(id);
          requestAnimationFrame(() => {
            document.getElementById("fs-cp-section-" + id)?.focus();
          });
        }}
      >
        {items.map((item) => {
          const on = item.id === active?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={"fs-cp-section-" + item.id}
              data-fs-cp-section={item.id}
              aria-selected={on}
              aria-controls="fs-cp-section-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(item.id)}
              className="min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-t-[6px] border px-1 text-center text-xs leading-none"
              style={{
                marginBottom: -1,
                backgroundColor: on ? TRIAL_NAVY : "#e5ebee",
                color: on ? "#fff" : "#3d5c70",
                fontWeight: on ? 700 : 650,
                borderColor: on ? TRIAL_NAVY : TRIAL_LINE,
              }}
            >
              {item.title}
            </button>
          );
        })}
      </div>
      <div
        id="fs-cp-section-panel"
        role="tabpanel"
        aria-labelledby={active ? "fs-cp-section-" + active.id : undefined}
        data-fs-cp-section-body={active?.id}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-white px-3 py-2.5 text-left"
      >
        {lead}
        {active?.body}
      </div>
    </div>
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
    <div className="flex min-h-10 items-center justify-between gap-2">
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
  // Sync external changes into the text field
  if (value !== lastValueRef.current && String(value) !== text) {
    lastValueRef.current = value;
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
      className="mt-1 h-10 w-full text-base"
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
  /** Short values (e.g. Decimals 0–3): ~3-char box, not full panel width. */
  compact,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  compact?: boolean;
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
    <div className={compact ? "shrink-0" : undefined}>
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
        className={
          compact
            ? "mt-1 h-10 w-14 px-1 text-center text-base tabular-nums"
            : "mt-1 h-10 w-full text-base"
        }
      />
    </div>
  );
}

/**
 * Tap-to-size −/+ for Legend / H/L/Δ / High/Low.
 * Compact chrome-navy pill, way above the accessory so move stays clear.
 * Panel steppers remain as the same sizes.
 */
/** Screen gap above the tapped accessory — clear of the drag target. */
const ACCESSORY_SIZE_HUD_ABOVE_PX = 112;

function AccessorySizeHud({
  kind,
  clientX,
  clientY,
  legendScale,
  pillSize,
  pinSize,
  onLegend,
  onPill,
  onPin,
  onClose,
}: {
  kind: "legend" | "pill" | "pin";
  clientX: number;
  clientY: number;
  legendScale: number;
  pillSize: number;
  pinSize: number;
  onLegend: (v: number) => void;
  onPill: (v: number) => void;
  onPin: (v: number) => void;
  onClose: () => void;
}) {
  const label =
    kind === "legend" ? "Legend size" : kind === "pill" ? "H/L/Δ size" : "High/Low size";
  const value = kind === "legend" ? legendScale : kind === "pill" ? pillSize : pinSize;
  const min = kind === "legend" ? 0.4 : kind === "pill" ? STATS_CHIP_MIN : 7;
  const max = kind === "legend" ? 4 : kind === "pill" ? STATS_CHIP_MAX : 28;
  const step = kind === "legend" ? 0.1 : kind === "pill" ? 2 : 1;
  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const left = Math.min(Math.max(8, clientX - 36), vw - 88);
  // Way above the accessory (not near the finger on the piece).
  const top = Math.max(8, clientY - ACCESSORY_SIZE_HUD_ABOVE_PX);
  return (
    <div
      data-accessory-size-hud=""
      className="fixed z-50 flex h-7 items-stretch overflow-hidden rounded-full border shadow-md"
      style={{ left, top, background: TRIAL_NAVY, borderColor: TRIAL_NAVY }}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => {
          const next =
            kind === "legend"
              ? Math.max(min, Math.round((value - step) * 10) / 10)
              : Math.max(min, value - step);
          if (kind === "legend") onLegend(next);
          else if (kind === "pill") onPill(next);
          else onPin(next);
        }}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className="flex w-7 items-center justify-center text-white/95 hover:bg-white/10 disabled:opacity-40"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-px self-stretch bg-white/25" aria-hidden />
      <button
        type="button"
        onClick={() => {
          const next =
            kind === "legend"
              ? Math.min(max, Math.round((value + step) * 10) / 10)
              : Math.min(max, value + step);
          if (kind === "legend") onLegend(next);
          else if (kind === "pill") onPill(next);
          else onPin(next);
        }}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className="flex w-7 items-center justify-center text-white/95 hover:bg-white/10 disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close size"
        className="flex w-6 items-center justify-center border-l border-white/25 text-white/80 hover:bg-white/10"
      >
        <X className="h-3 w-3" />
      </button>
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
  unitless = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** Accessory sizes: −/+ only — no px / × in the face. */
  unitless?: boolean;
  onChange: (v: number) => void;
}) {
  const display = unitless ? "" : format ? format(value) : `${value}px`;
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, roundStepper(value - step, step)))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <output
          aria-label={unitless ? label : `${label}: ${display}`}
          className={
            "flex h-10 min-w-0 flex-1 select-none items-center justify-center rounded-md border border-input bg-background px-2 text-center text-xs leading-none text-foreground " +
            (unitless ? "" : "font-mono tabular-nums")
          }
        >
          {unitless ? <span className="text-muted-foreground">− / +</span> : display}
        </output>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, roundStepper(value + step, step)))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function roundStepper(v: number, step: number) {
  if (step >= 1) return Math.round(v);
  const places = Math.max(0, Math.round(-Math.log10(step)));
  const f = 10 ** places;
  return Math.round(v * f) / f;
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
// Exported so the report figure composer can draw the SAME three passes in the
// same order the live canvas does. Nothing about the capture app changes.
export function renderTopoBase(
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
export function renderTopoTop(
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
    /** A picture on a page: size chrome against the plan, not the screen. */
    presentation?: boolean;
    /** The plan's zoom against its fit-to-frame size. Keeps the legend's
     *  printed size steady while the plan itself is resized. */
    planZoom?: number;
    /** Draw the pill on a one-boundary level too (a report slide does). */
    pillForSingleBoundary?: boolean;
    chromeOnPage?: boolean;
    pointSize?: number;
    pointColor?: string;
    viewScale?: number;
    /** Fit-to-viewport scale — capture reading labels are sized from this. */
    fitScale?: number;
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
  const fitScale = overlay?.fitScale || viewScale || 1;
  // Reading labels: plan-scaled in capture (zoom with the drawing); report
  // stays plan-proportional. −/+ sets the size. Other chrome keeps chromeSizeImg.
  const fontBase = resolved.pointLabelFontSize;
  const fontPx = pointLabelFontImg(fontBase, floor, {
    presentation: !!overlay?.presentation,
    fitScale,
  });
  // k scales default label offsets with the drawn font. Label box chrome
  // (pad / radius / stroke) tracks drawn fontPx.
  const k = fontPx / fontBase;
  const chromeK = labelChromeK(fontPx);
  const weight = resolved.pointLabelWeight;
  const color = resolved.pointLabelColor;

  if (resolved.showPoints) {
    ctx.globalAlpha = resolved.pointsOpacity;
    // Dot: same anchoring as the label, but keyed to the user's dot-size
    // stepper (pointSize) instead of font size, so the stepper actually
    // controls what's drawn.
    const dotBase = overlay?.pointSize ?? 6;
    const dotR = chromeSizeImg(dotBase, viewScale, !!overlay?.presentation, floor);
    const dotColor = overlay?.pointColor ?? "#dc2626";
    const padX = 4 * chromeK;
    const padY = 2.5 * chromeK;

    // Decluttering: figure out which labels can be drawn without colliding.
    // Dots always draw when points are on. Labels obey showLabels (Readings pill
    // and Control panel → Readings → Show).
    ctx.font = `${weight} ${fontPx}px sans-serif`;
    const rectFor = (p: SurveyPoint) => {
      const isLive = live && live.id === p.id;
      const dx = isLive ? live!.dx : (p.labelDx ?? DEFAULT_LABEL_DX * k);
      const dy = isLive ? live!.dy : (p.labelDy ?? DEFAULT_LABEL_DY * k);
      const w = ctx.measureText(p.value.toFixed(resolved.decimalPlaces)).width + padX * 2;
      return { x: p.x + dx - padX, y: p.y + dy - padY, w, h: fontPx + padY * 2 };
    };
    const visibleLabelIds = new Set<string>();
    if (resolved.showLabels) {
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
      if (!resolved.showLabels || !visibleLabelIds.has(p.id)) continue;
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
      const radius = 2.5 * chromeK;
      const cx = tx + tw / 2;
      const cy = ty + fontPx / 2;

      if (inverted) {
        // Inverted highlight: dark pill, light text
        ctx.fillStyle = color;
        roundRectPath(ctx, tx - padX, ty - padY, pillW, pillH, radius);
        ctx.fill();
        ctx.lineWidth = chromeK;
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
          ctx.lineWidth = 0.8 * chromeK;
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
    if (resolved.showLegend && !overlay?.chromeOnPage) {
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
          areaLegendBox(at.area, resolved, floor, live, {
            presentation: !!overlay?.presentation,
            zoom: overlay?.planZoom,
          }),
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
        drawPin(ctx, at.hi.x + hDx, at.hi.y + hDy, "High", "#b51d16", pinFontPx(resolved, floor), highlightPin === "pin-high");
        drawPin(ctx, at.lo.x + lDx, at.lo.y + lDy, "Low", "#1f5f9f", pinFontPx(resolved, floor), highlightPin === "pin-low");
      }
    }
  }

  // One named pill per boundary. In the field a lone surface uses the floating
  // StatsChip instead, so H / L / Δ is not drawn twice; a report slide asks for
  // it here so one boundary looks the same as five.
  if (!overlay?.chromeOnPage &&
      statsPillOnCanvas(resolved, areaTopos.length, !!overlay?.pillForSingleBoundary)) {
    const livePill = overlay?.livePill ?? null;
    const base = overlay?.pillSize ?? DEFAULT_STATS_PILL_SIZE;
    const h = pillHeightImg(base, viewScale, !!overlay?.presentation, floor);
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
  const extrasRef = useRef<HTMLDivElement>(null);

  // Inside the short Control-panel accordion the extras open below the fold;
  // bring them into the scrollport so the toggle is not a no-op on the phone.
  useEffect(() => {
    if (!expanded) return;
    extrasRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [expanded]);

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
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
      >
        <ChevronDown
          className={
            "h-4 w-4 shrink-0 transition-transform " +
            (expanded ? "rotate-0" : "-rotate-90")
          }
        />
        More palettes
      </button>
      {expanded ? (
        <div ref={extrasRef} className="space-y-1.5 pb-1">
          {EXTRA_PALETTES.map((p) => (
            <PaletteRow key={p} palette={p} active={value === p} onClick={() => onChange(p)} />
          ))}
        </div>
      ) : null}
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
/**
 * The colour legend's box, in image coordinates.
 *
 * Every dimension inside drawLegend() is a multiple of the returned `scale`,
 * so making that one number plan-proportional sizes the whole legend. It was
 * a literal image-space 82 x 226 before, which made it 7.5% of an 1100 px plan
 * and 3.3% of a 2500 px one -- the same drift the High/Low markers had.
 *
 * Shared by the drawing and the hit test so the legend cannot be drawn in one
 * place and grabbed in another.
 */
function areaLegendBox(
  area: TopoArea,
  settings: RenderSettings,
  floor: Floor,
  live?: { dx: number; dy: number } | null,
  fit?: { presentation?: boolean; zoom?: number } | null,
) {
  let s = planProportionalSize(
    settings.legendScale ?? 1,
    planLongSide(floor.planWidth, floor.planHeight),
  );
  // On a page, hold the legend's printed size while the plan is resized.
  //
  // The legend is a key, not part of the drawing: it should read the same on
  // every slide whatever size the investigator has dragged the plan to. Drawn
  // in image coordinates it did the opposite -- the corner grips scaled it
  // along with the walls and the contours.
  //
  // Dividing by the plan's zoom cancels that. Written out, the legend's height
  // on the sheet is LEGEND_BASE_H x legendScale x (planLong / 1100) x scale,
  // and scale = zoom x fitScale, with fitScale = frameLong / planLong; the
  // plan's size cancels and what is left is the FRAME's long side, which is
  // the sheet. So the legend is a fixed fraction of the page at any zoom, on
  // any plan, on screen and on paper. At the default fit (zoom 1) this is
  // exactly the size it has always been, so nothing moves until the plan is
  // resized -- which is the case being fixed.
  if (fit?.presentation) {
    const zoom = fit.zoom && fit.zoom > 0 ? fit.zoom : 1;
    s /= zoom;
  }
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

export const LEGEND_SHAPE = { w: LEGEND_BASE_W, h: LEGEND_BASE_H };

/**
 * The colour scale, drawn.
 *
 * Exported because a report sheet shows this legend rather than one of its
 * own. It had one of its own -- built out of HTML, out of the colours the
 * slide happened to report, with the high and the low where the contour
 * values belong -- and Tim, looking at a sheet: "the Legend is not right and
 * it does not lock the size, its different than the FS legend." There is one
 * colour scale in Toolbox, and this is it.
 */
export function drawLegend(
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
