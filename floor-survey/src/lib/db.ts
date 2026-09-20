/**
 * Toolbox host persistence for Floor Survey.
 *
 * Customer File (toolbox IDB) is the job + plan identity.
 * Floor Survey–specific data lives on record.floorSurvey (byCanvasId[canvasId]).
 * Plan bytes are never stored here — hydrated from ToolboxDB media for render only.
 */
import type { Bp1Gps, Floor, ProjectMeta, SurveyPoint } from "./types";

declare global {
  interface Window {
    ToolboxDB: {
      getCustomerFile(id: string): Promise<any>;
      saveCustomerFile(record: any): Promise<any>;
      getMedia(id: string): Promise<string | null>;
    };
    ToolboxPlanSetup: {
      ensurePlanSetup(record: any): boolean;
      ensureFloorSurvey(record: any): boolean;
      ensureFloorSurveyCanvasRef(record: any, canvasId: string): boolean;
      canvasById(record: any, canvasId: string): any;
    };
    ToolboxApp?: {
      customerIdentity?: {
        displayName(record: any): string;
        displayAddress(record: any): string;
      };
    };
  }
}

type FloorLayer = {
  canvasId: string;
  boundary: Array<{ x: number; y: number }>;
  areas?: Floor["areas"];
  scale?: Floor["scale"];
  createdAt: number;
  updatedAt: number;
  highPinDx?: number;
  highPinDy?: number;
  lowPinDx?: number;
  lowPinDy?: number;
  notes?: Floor["notes"];
  transitions?: Floor["transitions"];
  transitionGroupAverages?: Floor["transitionGroupAverages"];
  exclusions?: Floor["exclusions"];
  planTransform?: Floor["planTransform"];
  points: SurveyPoint[];
  /** GPS captured at BP1 establishment — for Report Builder later. */
  bp1Gps?: Bp1Gps;
};

type FloorSurveyRoot = {
  id: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  byCanvasId: Record<string, FloorLayer>;
  inspectionDate?: string;
  surveyNotes?: string;
  customSurfaces?: string[];
  lastExportedAt?: number;
};

let activeCustomerFileId: string | null = null;

export function setHostCustomerFileId(id: string | null) {
  activeCustomerFileId = id;
}

export function getHostCustomerFileId() {
  return activeCustomerFileId;
}

function requireCfId(explicit?: string) {
  const id = explicit || activeCustomerFileId;
  if (!id) throw new Error("Floor Survey host: no Customer File id");
  return id;
}

async function loadRecord(cfId: string) {
  const record = await window.ToolboxDB.getCustomerFile(cfId);
  if (!record) throw new Error("Customer File not found");
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  return record;
}

async function saveRecord(record: any) {
  record.updatedAt = new Date().toISOString();
  if (record.floorSurvey) {
    record.floorSurvey.updatedAt = record.updatedAt;
  }
  await window.ToolboxDB.saveCustomerFile(record);
  return record;
}

function displayName(record: any) {
  if (window.ToolboxApp?.customerIdentity?.displayName) {
    return window.ToolboxApp.customerIdentity.displayName(record);
  }
  const name = ((record.firstName || "") + " " + (record.lastName || "")).trim();
  return name || "Customer File";
}

function displayAddress(record: any) {
  if (window.ToolboxApp?.customerIdentity?.displayAddress) {
    return window.ToolboxApp.customerIdentity.displayAddress(record);
  }
  return (record.propertyAddress || "").trim();
}

function ensureLayer(record: any, canvasId: string): FloorLayer {
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(record, canvasId);
  const fs = record.floorSurvey as FloorSurveyRoot;
  let layer = fs.byCanvasId[canvasId];
  if (!layer || typeof layer !== "object") {
    const now = Date.now();
    layer = {
      canvasId,
      boundary: [],
      points: [],
      createdAt: now,
      updatedAt: now,
    };
    fs.byCanvasId[canvasId] = layer;
  }
  if (!Array.isArray(layer.boundary)) layer.boundary = [];
  if (!Array.isArray(layer.points)) layer.points = [];
  if (typeof layer.createdAt !== "number") layer.createdAt = Date.now();
  if (typeof layer.updatedAt !== "number") layer.updatedAt = Date.now();
  layer.canvasId = canvasId;
  return layer;
}

function layerToFloor(
  record: any,
  canvas: any,
  layer: FloorLayer,
  planDataUrl: string | undefined,
  order: number,
): Floor {
  const plan = canvas.plan;
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
    createdAt: layer.createdAt,
    updatedAt: layer.updatedAt,
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

function persistFloorFields(layer: FloorLayer, floor: Floor) {
  layer.boundary = floor.boundary || [];
  layer.areas = floor.areas;
  layer.scale = floor.scale;
  layer.highPinDx = floor.highPinDx;
  layer.highPinDy = floor.highPinDy;
  layer.lowPinDx = floor.lowPinDx;
  layer.lowPinDy = floor.lowPinDy;
  layer.notes = floor.notes;
  layer.transitions = floor.transitions;
  layer.transitionGroupAverages = floor.transitionGroupAverages;
  layer.exclusions = floor.exclusions;
  layer.planTransform = floor.planTransform;
  layer.bp1Gps = floor.bp1Gps;
  layer.updatedAt = Date.now();
  // Never persist planDataUrl / dimensions — CF canvas owns the plan.
}

export function uid(prefix?: string) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID();
  }
  const bare = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return prefix ? `${prefix}-${bare}` : bare;
}

// ---- Projects (Customer File as job identity) ----

export async function listProjects(): Promise<ProjectMeta[]> {
  // Host mode has no project list.
  return [];
}
export async function listTrashedProjects(): Promise<ProjectMeta[]> {
  return [];
}
export async function trashProject(_id: string) {}
export async function restoreProject(_id: string) {}
export async function deleteProject(_id: string) {}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  const record = await loadRecord(id);
  const fs = record.floorSurvey as FloorSurveyRoot;
  return {
    id: record.id,
    name: displayName(record),
    address: displayAddress(record),
    client: "",
    inspector: "",
    inspectionDate: fs.inspectionDate || "",
    notes: fs.surveyNotes || "",
    createdAt: Date.parse(record.createdAt) || Date.now(),
    updatedAt: Date.parse(record.updatedAt) || Date.now(),
    lastExportedAt: fs.lastExportedAt,
    customSurfaces: fs.customSurfaces,
  };
}

export async function saveProject(p: ProjectMeta) {
  const record = await loadRecord(p.id);
  const fs = record.floorSurvey as FloorSurveyRoot;
  fs.inspectionDate = p.inspectionDate || "";
  fs.surveyNotes = p.notes || "";
  fs.customSurfaces = p.customSurfaces;
  if (p.lastExportedAt != null) fs.lastExportedAt = p.lastExportedAt;
  await saveRecord(record);
}

export async function markProjectExported(id: string) {
  const record = await loadRecord(id);
  (record.floorSurvey as FloorSurveyRoot).lastExportedAt = Date.now();
  await saveRecord(record);
}

// ---- Floors (CF canvases) ----

export async function listFloors(projectId: string): Promise<Floor[]> {
  const record = await loadRecord(projectId);
  const canvases = record.planSetup?.canvases || [];
  const floors: Floor[] = [];
  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    if (!canvas?.id) continue;
    const layer = ensureLayer(record, canvas.id);
    let planDataUrl: string | undefined;
    if (canvas.plan?.id) {
      planDataUrl = (await window.ToolboxDB.getMedia(canvas.plan.id)) || undefined;
    }
    floors.push(layerToFloor(record, canvas, layer, planDataUrl, i));
  }
  // Do not saveRecord here — avoiding a read/modify/write clobber if Customer
  // File canvases change while Floor Survey is hydrating plan media.
  // Empty layers persist on the first saveFloor / savePoint.
  return floors;
}

export async function saveFloor(f: Floor) {
  const record = await loadRecord(f.projectId || requireCfId());
  if (!window.ToolboxPlanSetup.canvasById(record, f.id)) {
    // Do not create CF canvases from Floor Survey.
    console.warn("Floor Survey: refusing to save unknown canvas", f.id);
    return;
  }
  const layer = ensureLayer(record, f.id);
  persistFloorFields(layer, f);
  await saveRecord(record);
}

export async function deleteFloor(_id: string) {
  // Customer File owns canvases — Floor Survey must not delete levels.
  console.warn("Floor Survey host: canvas delete is owned by Customer File");
}

// ---- Points ----

export async function listPoints(floorId: string): Promise<SurveyPoint[]> {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const layer = ensureLayer(record, floorId);
  return (layer.points || []).slice().sort((a, b) => a.index - b.index);
}

export async function savePoint(p: SurveyPoint) {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const layer = ensureLayer(record, p.floorId);
  const idx = layer.points.findIndex((x) => x.id === p.id);
  if (idx >= 0) layer.points[idx] = p;
  else layer.points.push(p);
  layer.updatedAt = Date.now();
  await saveRecord(record);
}

/** Persist GPS captured at BP1 / base station (field tap). Report Builder reads later. */
export async function saveBp1Gps(floorId: string, gps: Bp1Gps) {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const layer = ensureLayer(record, floorId);
  layer.bp1Gps = gps;
  layer.updatedAt = Date.now();
  await saveRecord(record);
}

export async function deletePoint(id: string) {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const fs = record.floorSurvey as FloorSurveyRoot;
  let changed = false;
  for (const canvasId of Object.keys(fs.byCanvasId || {})) {
    const layer = fs.byCanvasId[canvasId];
    if (!layer?.points) continue;
    const before = layer.points.length;
    layer.points = layer.points.filter((p) => p.id !== id);
    if (layer.points.length !== before) {
      layer.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) await saveRecord(record);
}

/** Reassign sequential indexes (1..N) to points on a floor, ordered by current index. */
export async function reindexFloorPoints(floorId: string): Promise<SurveyPoint[]> {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const layer = ensureLayer(record, floorId);
  const all = (layer.points || []).slice().sort((a, b) => a.index - b.index);
  const updated: SurveyPoint[] = all.map((p, i) => ({ ...p, index: i + 1 }));
  layer.points = updated;
  layer.updatedAt = Date.now();
  await saveRecord(record);
  return updated;
}

export async function deletePointsForFloor(floorId: string) {
  const cfId = requireCfId();
  const record = await loadRecord(cfId);
  const layer = ensureLayer(record, floorId);
  layer.points = [];
  layer.updatedAt = Date.now();
  await saveRecord(record);
}
