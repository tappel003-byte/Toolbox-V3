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

export type ReportTopoStats = {
  areaId: string;
  name: string;
  hi: number;
  lo: number;
  delta: number;
  decimalPlaces: number;
  legend: {
    min: number;
    max: number;
    stops: ReportTopoLegendStop[];
  };
};

export type ReportTopoComposeResult = {
  dataUrl: string;
  mime: "image/png";
  width: number;
  height: number;
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

function statsFromTopos(areaTopos: AreaTopo[], settings: RenderSettings): ReportTopoStats[] {
  const dec = settings.decimalPlaces ?? 2;
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
      legend: legendStopsFor(at, settings),
    };
  });
}

function reportSettings(partial?: Partial<RenderSettings>): RenderSettings {
  return resolveSettings({
    ...defaultRenderSettings,
    ...(partial || {}),
    // Chrome is Report Builder slots — keep field legend/stats pills off the drawing.
    showLegend: false,
    showStatsPill: false,
    showHighLow: true, // High/Low pins on the drawing remain useful
  });
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

  const imgW = Math.max(1, Math.round(floor.planWidth || 1000));
  const imgH = Math.max(1, Math.round(floor.planHeight || 750));
  const canvas = document.createElement("canvas");
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgW, imgH);

  if (settings.showPlan && floor.planDataUrl) {
    try {
      const img = await loadImage(floor.planDataUrl);
      ctx.globalAlpha = settings.planOpacity;
      ctx.drawImage(img, 0, 0, imgW, imgH);
      ctx.globalAlpha = 1;
    } catch {
      // Plan missing — still draw contours/readings.
    }
  }

  renderTopo(ctx, floor, points, settings, areaTopos);

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
    scope,
    areaId,
    title,
    stats: statsFromTopos(areaTopos, settings),
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
  return composeReportTopoFigure({ floor, points, areaId });
}
