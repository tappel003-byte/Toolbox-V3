/**
 * Report Builder topo figure composition.
 *
 * Draws plan + contours + readings into a registered frame using the same
 * Topo pipeline as field Export. Legend and High/Low/Δ are returned as data
 * for fixed Report Builder slots — not baked at field chrome positions.
 */
import { closedAreas, pointsInArea } from "@/lib/areas";
import type { Floor, RenderSettings, SurveyPoint, TopoArea } from "@/lib/types";
import { defaultRenderSettings } from "@/lib/types";
import { contourThresholds, type Grid } from "@/lib/topo";
import {
  buildAreaTopos,
  paletteColor,
  renderTopo,
  resolveSettings,
  type AreaTopo,
} from "@/components/tabs/TopoTab";

export type ReportTopoLegendStop = {
  value: number;
  color: string;
};

/** A High or Low marker, as a fraction of the composed figure (0..1), so
 *  Report Builder can place it over the image at any size or crop. */
export type ReportTopoPin = {
  value: number;
  /** 0..1 across the composed figure. */
  fx: number;
  /** 0..1 down the composed figure. */
  fy: number;
};

export type ReportTopoStats = {
  areaId: string;
  name: string;
  hi: number;
  lo: number;
  delta: number;
  decimalPlaces: number;
  hiPin: ReportTopoPin;
  loPin: ReportTopoPin;
  legend: {
    min: number;
    max: number;
    stops: ReportTopoLegendStop[];
  };
};

/** The region of plan space a figure covers, in plan pixels. */
export type ReportTopoExtent = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ReportTopoComposeResult = {
  dataUrl: string;
  mime: "image/png";
  width: number;
  height: number;
  /** The plan-space region drawn, so a later compose can reproduce it. */
  extent: ReportTopoExtent;
  /** Device pixels per plan pixel actually used. */
  scale: number;
  scope: "all" | "area";
  areaId: string | null;
  title: string;
  stats: ReportTopoStats[];
  readingsRebuilt: true;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Floor plan image failed to load"));
    img.src = src;
  });
}

function contourOptionsFromSettings(settings: RenderSettings, grid: Grid) {
  return {
    first: settings.firstContour,
    step: Math.max(0.01, settings.contourStep || 0.2),
    count: settings.contourCount ?? undefined,
    min: settings.minClamp ?? grid.minValue,
    max: settings.maxClamp ?? grid.maxValue,
  };
}

function legendStopsFor(at: AreaTopo, settings: RenderSettings): ReportTopoStats["legend"] {
  const grid = at.grid;
  const min = settings.minClamp ?? grid.minValue;
  const max = settings.maxClamp ?? grid.maxValue;
  const span = Math.max(1e-6, max - min);
  const thresholds = contourThresholds(grid, contourOptionsFromSettings(settings, grid));
  const edges = [min, ...thresholds.filter((t) => t > min && t < max), max];
  const stops: ReportTopoLegendStop[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const mid = (lo + hi) / 2;
    const t = (mid - min) / span;
    stops.push({
      value: Math.round(((lo + hi) / 2) * 1000) / 1000,
      color: paletteColor(t, settings.palette, settings.reversePalette),
    });
  }
  // Endpoint labels for the bar (high at top, low at bottom).
  if (!stops.length) {
    stops.push({
      value: max,
      color: paletteColor(1, settings.palette, settings.reversePalette),
    });
    stops.push({
      value: min,
      color: paletteColor(0, settings.palette, settings.reversePalette),
    });
  }
  return { min, max, stops };
}

function statsFromTopos(
  areaTopos: AreaTopo[],
  settings: RenderSettings,
  extent: ReportTopoExtent,
): ReportTopoStats[] {
  const dec = settings.decimalPlaces ?? 2;
  const fx = (x: number) => (extent.w > 0 ? (x - extent.x) / extent.w : 0);
  const fy = (y: number) => (extent.h > 0 ? (y - extent.y) / extent.h : 0);
  return areaTopos.map((at) => {
    const hi = at.hi.value;
    const lo = at.lo.value;
    return {
      areaId: at.area.id,
      name: at.area.name || "Boundary",
      hi,
      lo,
      delta: hi - lo,
      decimalPlaces: dec,
      // The pins are NOT drawn into the figure any more. They come back as
      // positions so Report Builder places them as its own movable markers --
      // a pin baked into the image cannot be nudged off a wall.
      hiPin: { value: hi, fx: fx(at.hi.x), fy: fy(at.hi.y) },
      loPin: { value: lo, fx: fx(at.lo.x), fy: fy(at.lo.y) },
      legend: legendStopsFor(at, settings),
    };
  });
}

function reportSettings(partial?: Partial<RenderSettings>): RenderSettings {
  return resolveSettings({
    ...defaultRenderSettings,
    ...(partial || {}),
    // Every piece of chrome is a Report Builder slot, so none of it is baked
    // into the picture: the colour scale, the H/L/delta pill and the High and
    // Low pins all come back as data and are placed, moved and sized on the
    // page. Anything drawn into the PNG is frozen there for good.
    showLegend: false,
    showStatsPill: false,
    showHighLow: false,
  });
}

/** Report figures are drawn well above screen size so they hold up at 17 x 11
 *  in. The plan is typically ~1000 px wide and lands about 14 in across the
 *  page, which is only ~70 dpi -- the reason a report topo looked soft next to
 *  the same drawing in Floor Survey. The long side is taken to 3000 px, about
 *  210 dpi on paper, capped so a very large plan cannot exhaust memory. */
const REPORT_LONG_SIDE = 3000;
const REPORT_MAX_SCALE = 4;

/** The width, in plan pixels, at which the chosen label and dot sizes are
 *  drawn literally. A figure wider than this is drawn with proportionally
 *  larger labels, exactly as the live canvas does when it fits a big plan
 *  into a window. 1100 is where the defaults were calibrated: an 11 px label
 *  is 1% of the figure, which is what the shipped decks show at 17 x 11 in. */
const REPORT_REFERENCE_WIDTH = 1100;

function scaleFor(w: number, h: number): number {
  const longest = Math.max(1, w, h);
  return Math.min(REPORT_MAX_SCALE, Math.max(1, REPORT_LONG_SIDE / longest));
}

/** Everything that has to be inside the frame: the readings, the boundary
 *  outlines and the exclusions. Contours are built from the readings and stay
 *  inside their area, so the areas bound them.
 *
 *  This is deliberately the extent of the DATA, not of the floor plan. A pin
 *  or a reading dropped outside the walls is exactly the case a plan-sized
 *  frame clips, and that is the reading the page most needs to show. */
export function reportTopoDataExtent(options: {
  floor: Floor;
  points: SurveyPoint[];
  areaId?: string | null;
  /** White space around the data, as a fraction of its longer side. */
  margin?: number;
  /** Used only to size the reading labels; the drawing itself is unaffected. */
  settings?: Partial<RenderSettings>;
}): ReportTopoExtent | null {
  const floor = options.floor;
  const onlyAreaId = options.areaId && options.areaId !== "all" ? options.areaId : null;
  const closed = closedAreas(floor);
  const areas = onlyAreaId ? closed.filter((a) => a.id === onlyAreaId) : closed;
  const pts = onlyAreaId
    ? (() => {
        const area = areas[0];
        return area ? pointsInArea(options.points || [], area) : [];
      })()
    : options.points || [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  // A reading is a dot with a label box beside it, so the point coordinate is
  // not its visual extent. These match what the renderer draws: the label sits
  // at +8 / +6 from the dot (unless nudged), is padded 4 / 2.5, and is as wide
  // as the value at the chosen label font. Without this the outlying reading
  // that the frame exists to include had its label cut off by the edge.
  const ls = { ...defaultRenderSettings, ...(options.settings || {}) };
  const fontPx = Math.max(1, ls.pointLabelFontSize || 11);
  const chars = (ls.decimalPlaces ?? 2) + 3; // "9.75" and friends
  const labelW = fontPx * 0.6 * chars + 8;
  const labelH = fontPx + 5;
  const dotR = 8;

  for (const p of pts) {
    see(p.x - dotR, p.y - dotR);
    see(p.x + dotR, p.y + dotR);
    const dx = p.labelDx ?? 8;
    const dy = p.labelDy ?? 6;
    see(p.x + dx - 4, p.y + dy - 2.5);
    see(p.x + dx - 4 + labelW, p.y + dy - 2.5 + labelH);
  }
  for (const area of areas) for (const v of area.polygon || []) see(v.x, v.y);
  for (const ex of floor.exclusions || []) for (const v of ex.polygon || []) see(v.x, v.y);

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  if (maxX <= minX) maxX = minX + 1;
  if (maxY <= minY) maxY = minY + 1;

  const pad = Math.max(maxX - minX, maxY - minY) * (typeof options.margin === "number" ? options.margin : 0.04);
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * Render one registered topo drawing for Combined (all closed areas) or one area.
 */
export async function composeReportTopoFigure(options: {
  floor: Floor;
  points: SurveyPoint[];
  /** null / "all" = Combined; otherwise one area id. */
  areaId?: string | null;
  settings?: Partial<RenderSettings>;
  /** The plan-space region to draw. Omitted, it is computed from the data.
   *  Report Builder passes one frame for the whole job so every level lands
   *  at the same scale in the same place. */
  extent?: ReportTopoExtent | null;
  /** White space around the data when the extent is computed here. */
  margin?: number;
}): Promise<ReportTopoComposeResult | null> {
  const floor = options.floor;
  const allPoints = Array.isArray(options.points) ? options.points : [];
  const settings = reportSettings(options.settings);
  const onlyAreaId = options.areaId && options.areaId !== "all" ? options.areaId : null;
  const areaTopos = buildAreaTopos(floor, allPoints, settings, onlyAreaId);
  if (!areaTopos.length) return null;
  // Named-boundary pages only plot readings inside that boundary so the
  // registered frame does not show other areas' points.
  const points = onlyAreaId
    ? (() => {
        const area = closedAreas(floor).find((a) => a.id === onlyAreaId);
        return area ? pointsInArea(allPoints, area) : allPoints;
      })()
    : allPoints;

  const planW = Math.max(1, Math.round(floor.planWidth || 1000));
  const planH = Math.max(1, Math.round(floor.planHeight || 750));

  // The frame is the region of plan space this figure shows. Cropping is
  // choosing that region, not trimming the picture afterwards: the chosen
  // region is drawn at full resolution, so a tighter frame comes out sharper
  // rather than softer.
  const extent =
    options.extent ||
    reportTopoDataExtent({
      floor,
      points: allPoints,
      areaId: onlyAreaId,
      margin: options.margin,
      settings,
    }) ||
    { x: 0, y: 0, w: planW, h: planH };

  const scale = scaleFor(extent.w, extent.h);
  const imgW = Math.max(1, Math.round(extent.w * scale));
  const imgH = Math.max(1, Math.round(extent.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgW, imgH);

  // Draw in plan coordinates; the transform handles the crop and the scale, so
  // every routine below is unchanged and unaware of either.
  ctx.setTransform(scale, 0, 0, scale, -extent.x * scale, -extent.y * scale);

  if (settings.showPlan && floor.planDataUrl) {
    try {
      const img = await loadImage(floor.planDataUrl);
      ctx.globalAlpha = settings.planOpacity;
      ctx.drawImage(img, 0, 0, planW, planH);
      ctx.globalAlpha = 1;
    } catch {
      // Plan missing — still draw contours/readings.
    }
  }

  // Reading labels and dots are sized for the SCREEN, not for plan pixels:
  // Floor Survey asks for 11 px and, when a big plan is fit into a window,
  // draws it larger in plan coordinates so it still reads 11 px. The composer
  // never said how big the figure would be seen, so it got viewScale 1 and
  // drew 11 literal plan pixels. On an 1100 px plan that is right; on a
  // 2500 px floor plan it is 0.4% of the width -- the unreadable specks that
  // made a report topo look nothing like the same drawing in Floor Survey.
  //
  // The figure is seen about REPORT_REFERENCE_WIDTH across, so that is the
  // scale it is drawn for, and every screen-anchored size follows.
  renderTopo(ctx, floor, points, settings, areaTopos, {
    viewScale: REPORT_REFERENCE_WIDTH / Math.max(1, extent.w),
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const closed = closedAreas(floor);
  let title = floor.name || "Floor Level Survey";
  let scope: "all" | "area" = "all";
  let areaId: string | null = null;
  if (onlyAreaId) {
    scope = "area";
    areaId = onlyAreaId;
    const named = closed.find((a) => a.id === onlyAreaId);
    title = (named && named.name) || areaTopos[0].area.name || "Boundary";
  } else if (closed.length > 1) {
    title = "Combined";
  } else if (closed.length === 1) {
    scope = "area";
    areaId = closed[0].id;
    title = closed[0].name || floor.name || "Boundary";
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    mime: "image/png",
    width: imgW,
    height: imgH,
    extent,
    scale,
    scope,
    areaId,
    title,
    stats: statsFromTopos(areaTopos, settings, extent),
    readingsRebuilt: true,
  };
}

export type ReportTopoPageSpec = {
  canvasId: string;
  levelName: string;
  epochId: string;
  epochLabel: string;
  surveyDate: string;
  areaId: string | null;
  scope: "all" | "area";
  scopeTitle: string;
  frontDoorFacing: string;
  readingCount: number;
  areaCount: number;
};

function facingLabel(value: string): string {
  const map: Record<string, string> = {
    N: "North",
    S: "South",
    E: "East",
    W: "West",
    NE: "Northeast",
    NW: "Northwest",
    SE: "Southeast",
    SW: "Southwest",
  };
  const key = (value || "").trim().toUpperCase();
  return map[key] || value || "";
}

function closedAreasFromLayer(layer: any): TopoArea[] {
  const areas = Array.isArray(layer?.areas) ? layer.areas : [];
  const closed = areas.filter(
    (a: any) => a && Array.isArray(a.polygon) && a.polygon.length >= 3,
  ) as TopoArea[];
  if (closed.length) return closed;
  const boundary = Array.isArray(layer?.boundary) ? layer.boundary : [];
  if (boundary.length >= 3) {
    return [
      {
        id: "legacy",
        name: "Boundary 1",
        polygon: boundary,
        createdAt: Date.now(),
      },
    ];
  }
  return [];
}

function layerHasSurveyWork(layer: any): boolean {
  if (!layer || typeof layer !== "object") return false;
  if (Array.isArray(layer.points) && layer.points.length) return true;
  if (closedAreasFromLayer(layer).length) return true;
  if (typeof layer.recoveryPdfMediaId === "string" && layer.recoveryPdfMediaId.trim()) return true;
  return false;
}

/**
 * Page specs for typical Floor Level topo assembly:
 * Combined (when 2+ closed boundaries), then each named boundary.
 */
export function listReportTopoPageSpecs(record: any): ReportTopoPageSpec[] {
  const floor = record?.floorSurvey;
  if (!floor || typeof floor !== "object") return [];
  const canvases = Array.isArray(record?.planSetup?.canvases) ? record.planSetup.canvases : [];
  const info: Record<string, any> = {};
  canvases.forEach((c: any, index: number) => {
    if (c?.id) info[c.id] = { ...c, order: index };
  });

  const epochs: Array<{
    id: string;
    label: string;
    surveyDate: string;
    byCanvasId: Record<string, any>;
  }> = [];

  if (floor.byCanvasId && typeof floor.byCanvasId === "object") {
    epochs.push({
      id: floor.id || "current",
      label: "Current Floor Survey",
      surveyDate: typeof floor.inspectionDate === "string" ? floor.inspectionDate : "",
      byCanvasId: floor.byCanvasId,
    });
  }
  for (const group of ["epochs", "sessions", "surveys"] as const) {
    const list = floor[group];
    if (!Array.isArray(list)) continue;
    list.forEach((entry: any, index: number) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const by = entry.byCanvasId && typeof entry.byCanvasId === "object" ? entry.byCanvasId : null;
      if (!by) return;
      epochs.push({
        id: entry.id || `${group}-${index + 1}`,
        label: entry.label || entry.name || `Survey ${index + 1}`,
        surveyDate: entry.inspectionDate || entry.surveyDate || "",
        byCanvasId: by,
      });
    });
  }

  const specs: ReportTopoPageSpec[] = [];
  for (const epoch of epochs) {
    const canvasIds = Object.keys(epoch.byCanvasId).filter((id) =>
      layerHasSurveyWork(epoch.byCanvasId[id]),
    );
    canvasIds.sort((a, b) => {
      const ao = info[a]?.order ?? 10000;
      const bo = info[b]?.order ?? 10000;
      if (ao !== bo) return ao - bo;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const canvasId of canvasIds) {
      const layer = epoch.byCanvasId[canvasId] || {};
      const canvas = info[canvasId];
      const levelName = (canvas && canvas.name) || layer.name || canvasId;
      const facing = facingLabel(
        typeof canvas?.frontDoorFacing === "string" ? canvas.frontDoorFacing : "",
      );
      const closed = closedAreasFromLayer(layer);
      const readingCount = Array.isArray(layer.points) ? layer.points.length : 0;
      const base = {
        canvasId,
        levelName,
        epochId: epoch.id,
        epochLabel: epoch.label,
        surveyDate: epoch.surveyDate,
        frontDoorFacing: facing,
        readingCount,
      };
      if (closed.length >= 2) {
        specs.push({
          ...base,
          areaId: null,
          scope: "all",
          scopeTitle: "Combined",
          areaCount: closed.length,
        });
        for (const area of closed) {
          specs.push({
            ...base,
            areaId: area.id,
            scope: "area",
            scopeTitle: area.name || "Boundary",
            areaCount: closed.length,
          });
        }
      } else if (closed.length === 1) {
        specs.push({
          ...base,
          areaId: closed[0].id,
          scope: "area",
          scopeTitle: closed[0].name || levelName,
          areaCount: 1,
        });
      } else {
        specs.push({
          ...base,
          areaId: null,
          scope: "all",
          scopeTitle: levelName,
          areaCount: 0,
        });
      }
    }
  }
  return specs;
}

function layerToFloorForReport(
  record: any,
  canvas: any,
  layer: any,
  planDataUrl: string | undefined,
  order: number,
): Floor {
  const plan = canvas?.plan;
  return {
    id: canvas.id,
    projectId: record.id,
    name: canvas.name || "Floor Plan",
    order,
    planDataUrl,
    planWidth: plan?.width,
    planHeight: plan?.height,
    boundary: Array.isArray(layer.boundary) ? layer.boundary : [],
    areas: layer.areas,
    scale: layer.scale,
    createdAt: layer.createdAt || Date.now(),
    updatedAt: layer.updatedAt || Date.now(),
    highPinDx: layer.highPinDx,
    highPinDy: layer.highPinDy,
    lowPinDx: layer.lowPinDx,
    lowPinDy: layer.lowPinDy,
    notes: layer.notes,
    transitions: layer.transitions,
    transitionGroupAverages: layer.transitionGroupAverages,
    exclusions: layer.exclusions,
    planTransform: layer.planTransform,
    bp1Gps: layer.bp1Gps,
  };
}

function findLayer(record: any, epochId: string, canvasId: string): any | null {
  const floor = record?.floorSurvey;
  if (!floor) return null;
  if ((floor.id || "current") === epochId && floor.byCanvasId) {
    return floor.byCanvasId[canvasId] || null;
  }
  for (const group of ["epochs", "sessions", "surveys"] as const) {
    const list = floor[group];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || entry.id !== epochId) continue;
      return entry.byCanvasId?.[canvasId] || null;
    }
  }
  // Current floor without matching id.
  if (floor.byCanvasId && floor.byCanvasId[canvasId] && (epochId === "current" || !epochId)) {
    return floor.byCanvasId[canvasId];
  }
  return null;
}

/**
 * Compose one Report Builder topo page figure from a Customer File + page spec.
 */
export async function composeReportTopoFigureForPage(
  record: any,
  spec: {
    canvasId: string;
    epochId: string;
    areaId?: string | null;
    scope?: "all" | "area";
    /** The display settings this slide is set to. Without these the figure
     *  was always composed at the defaults, so nothing chosen in Floor Survey
     *  or in the Report Builder rail ever reached the page. */
    settings?: Partial<RenderSettings>;
    /** One frame for the whole job, so every level lands at the same scale in
     *  the same place. Omitted, it is computed from this level's data. */
    extent?: ReportTopoExtent | null;
    margin?: number;
  },
  getMedia?: (id: string) => Promise<string | null>,
): Promise<ReportTopoComposeResult | null> {
  const canvases = Array.isArray(record?.planSetup?.canvases) ? record.planSetup.canvases : [];
  const canvasIndex = canvases.findIndex((c: any) => c && c.id === spec.canvasId);
  const canvas = canvasIndex >= 0 ? canvases[canvasIndex] : null;
  if (!canvas) return null;
  const layer = findLayer(record, spec.epochId, spec.canvasId);
  if (!layer) return null;

  let planDataUrl: string | undefined;
  if (canvas.plan?.id && typeof getMedia === "function") {
    try {
      planDataUrl = (await getMedia(canvas.plan.id)) || undefined;
    } catch {
      planDataUrl = undefined;
    }
  } else if (canvas.plan?.id && window.ToolboxDB?.getMedia) {
    try {
      planDataUrl = (await window.ToolboxDB.getMedia(canvas.plan.id)) || undefined;
    } catch {
      planDataUrl = undefined;
    }
  }

  const floor = layerToFloorForReport(record, canvas, layer, planDataUrl, Math.max(0, canvasIndex));
  const points = Array.isArray(layer.points) ? layer.points : [];
  const areaId = spec.scope === "all" ? null : spec.areaId || null;
  return composeReportTopoFigure({
    floor,
    points,
    areaId,
    settings: spec.settings,
    extent: spec.extent,
    margin: spec.margin,
  });
}

/**
 * The data extent for one page spec, without composing the picture.
 *
 * Report Builder asks for this across every level of a job, unions the
 * answers, and passes that back as one frame -- which is what makes the
 * building sit in the same place at the same scale on every slide.
 */
export async function reportTopoExtentForPage(
  record: any,
  spec: {
    canvasId: string;
    epochId: string;
    areaId?: string | null;
    scope?: "all" | "area";
    margin?: number;
    settings?: Partial<RenderSettings>;
  },
): Promise<ReportTopoExtent | null> {
  const canvases = Array.isArray(record?.planSetup?.canvases) ? record.planSetup.canvases : [];
  const canvasIndex = canvases.findIndex((c: any) => c && c.id === spec.canvasId);
  const canvas = canvasIndex >= 0 ? canvases[canvasIndex] : null;
  if (!canvas) return null;
  const layer = findLayer(record, spec.epochId, spec.canvasId);
  if (!layer) return null;
  const floor = layerToFloorForReport(record, canvas, layer, undefined, Math.max(0, canvasIndex));
  const points = Array.isArray(layer.points) ? layer.points : [];
  const areaId = spec.scope === "all" ? null : spec.areaId || null;
  return reportTopoDataExtent({ floor, points, areaId, margin: spec.margin, settings: spec.settings });
}
