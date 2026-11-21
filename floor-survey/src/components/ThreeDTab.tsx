import { readingText } from "@/lib/reading";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X, Camera, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { buildGrid, clampValue, TOPO_GRID_TARGET_COLS } from "@/lib/topo";
import { computeExclusionMap } from "@/lib/exclusions";
import { paletteColor } from "@/components/tabs/TopoTab";
import type { Floor, RenderSettings, SurveyPoint } from "@/lib/types";

export type DiagnosticReadingSummary = {
  levelName?: string;
  surveyDate?: string | null;
  usablePointCount?: number;
  surface?: string;
  surfaceMessage?: string | null;
  high?: number | null;
  low?: number | null;
  range?: number | null;
  unit?: string | null;
  referenceMessage?: string;
  scaleNotice?: string;
  evidenceMessage?: string;
};

interface Props {
  floor: Floor;
  points: SurveyPoint[];
  settings: RenderSettings;
  onClose: () => void;
  /** When more than one level is supplied, the existing header can switch floors. */
  levels?: Array<{ id: string; name: string }>;
  onLevelChange?: (id: string) => void;
  /**
   * overlay = full-screen (Floor Survey route).
   * fill = occupy the Diagnostics workbench stage. Rendering is unchanged.
   */
  frame?: "overlay" | "fill";
  /**
   * Truthful reading context for the Diagnostics workbench.
   * undefined hides the readout. null means the summary could not be built.
   */
  readingSummary?: DiagnosticReadingSummary | null;
  onCaptureReady?: (capture: (() => DiagnosticCapture | null) | null) => void;
  onViewReady?: (ready: boolean) => void;
}

export type DiagnosticCapture = {
  dataUrl: string;
  exaggeration: number;
  legendColors: string[];
  palette: RenderSettings["palette"];
  reversePalette: boolean;
};

type DiagnosticsApi = {
  contextLines?: (summary: DiagnosticReadingSummary, exaggeration: number) => string[];
  captureContext?: (summary: DiagnosticReadingSummary, extras: Record<string, unknown>) => unknown;
  formatInches?: (value: number) => string;
};

function diagnosticsApi(): DiagnosticsApi | null {
  const api = (window as unknown as { ToolboxDiagnostics?: DiagnosticsApi }).ToolboxDiagnostics;
  return api || null;
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const rows: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? current + " " + word : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) rows.push(current);
  return rows.length ? rows : [text];
}

function paintDiagnosticPng(
  source: HTMLCanvasElement,
  lines: string[],
  legendColors: string[],
  highLabel: string,
  lowLabel: string,
): string | null {
  const fontSize = Math.max(15, Math.round(source.width / 46));
  const lineHeight = Math.round(fontSize * 1.38);
  const pad = Math.round(fontSize * 0.85);
  const measure = document.createElement("canvas").getContext("2d");
  // A missing 2D context must not become a bare mesh PNG. Add to Report
  // refuses a null result instead of storing a figure that lost its legend.
  if (!measure) return null;
  measure.font = `600 ${fontSize}px sans-serif`;
  const legendGutter = legendColors.length ? Math.round(fontSize * 6.2) : 0;
  const maxText = Math.max(40, source.width - pad * 2 - legendGutter);
  const rows = lines.flatMap((line) => wrapLine(measure, line, maxText));
  const bandHeight = pad * 2 + lineHeight * Math.max(1, rows.length);
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height + bandHeight;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, source.height);
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = "#f7f4ee";
  ctx.fillRect(0, source.height, out.width, bandHeight);
  ctx.fillStyle = "#1c1915";
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  rows.forEach((row, index) => {
    ctx.fillText(row, pad, source.height + pad + index * lineHeight);
  });
  if (legendColors.length) {
    const barW = Math.max(18, Math.round(fontSize));
    const labelSize = Math.max(12, Math.round(fontSize * 0.78));
    const barX = out.width - pad - barW - Math.round(labelSize * 5.2);
    const barY = source.height + pad;
    const barH = Math.max(lineHeight, bandHeight - pad * 2);
    const slice = barH / legendColors.length;
    legendColors.forEach((color, index) => {
      ctx.fillStyle = legendColors[legendColors.length - 1 - index];
      ctx.fillRect(barX, barY + index * slice, barW, slice + 0.75);
    });
    ctx.strokeStyle = "#1c1915";
    ctx.lineWidth = Math.max(1, fontSize / 14);
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
    ctx.fillStyle = "#1c1915";
    ctx.font = `600 ${labelSize}px sans-serif`;
    ctx.fillText(highLabel, barX + barW + 8, barY);
    ctx.textBaseline = "bottom";
    ctx.fillText(lowLabel, barX + barW + 8, barY + barH);
  }
  try {
    const painted = out.toDataURL("image/png");
    if (!painted || painted.indexOf("data:image/png") !== 0 || painted === source.toDataURL("image/png")) {
      return null;
    }
    return painted;
  } catch (err) {
    console.error(err);
    return null;
  }
}


const READOUT_CSS = `
.dx-readout {
  position: absolute;
  z-index: 2;
  right: 10px;
  top: 10px;
  width: 196px;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid #d4d0c8;
  background: rgba(255,255,255,0.94);
  color: #1c1915;
  pointer-events: auto;
}
.dx-readout__body {
  overflow: auto;
  padding: 8px 10px 4px;
  min-height: 0;
}
.dx-readout__line {
  margin: 0 0 3px;
  font-size: 11px;
  line-height: 1.3;
}
.dx-readout__scale {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin: 6px 0 2px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.dx-readout__bar {
  display: block;
  width: 18px;
  height: 96px;
  border: 1px solid #1c1915;
  border-radius: 2px;
}
.dx-readout__notice,
.dx-readout__evidence {
  margin: 0;
  padding: 6px 10px 7px;
  border-top: 1px solid #e3dfd6;
  font-size: 10px;
  line-height: 1.3;
  color: #5a554b;
}
.dx3-shell { display: flex; flex: 1 1 auto; min-height: 0; background: #fff; color: #1c1915; }
.dx3-side {
  flex: 0 0 252px; width: 252px; overflow-y: auto; border-right: 1px solid #d4d0c8; background: #f3f1ec;
  font-size: 12px;
}
.dx3-quick { padding: 10px 12px; border-bottom: 1px solid #d4d0c8; background: #ebe8e1; }
.dx3-page { border-bottom: 1px solid #e0dcd2; }
.dx3-page__head {
  width: 100%; display: flex; align-items: center; justify-content: space-between; text-align: left;
  padding: 8px 12px; font: inherit; font-weight: 700; color: #14263a; background: transparent; border: 0; cursor: pointer;
}
.dx3-page__head[aria-expanded="true"] { background: #e3e8ee; }
.dx3-page__body { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 10px; background: #fbfaf7; }
.dx3-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dx3-row label { font-size: 12px; color: #2b2a26; }
.dx3-field { display: flex; flex-direction: column; gap: 4px; }
.dx3-field > span { font-size: 11px; color: #5a554b; }
.dx3-select, .dx3-text { width: 100%; padding: 4px 6px; border: 1px solid #c9c4b8; border-radius: 4px; background: #fff; font: inherit; }
.dx3-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.dx3-btn { padding: 4px 9px; border: 1px solid #c9c4b8; border-radius: 4px; background: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.dx3-btn:hover { background: #eef2f6; }
.dx3-stage { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; background: #fff; }
.dx3-title {
  position: absolute; z-index: 1; left: 50%; top: 10px; transform: translateX(-50%); max-width: 60%;
  font-size: 16px; font-weight: 700; color: #14263a; text-align: center; pointer-events: none;
}
.dx3-toggle { display: none; }
.dx3-zoom { position: absolute; z-index: 3; right: 10px; bottom: 10px; display: flex; gap: 6px; }
.dx3-zoom button { min-width: 36px; height: 36px; padding: 0 10px; border: 1px solid #c9c4b8; border-radius: 6px; background: rgba(255,255,255,0.95); font-size: 16px; font-weight: 700; color: #14263a; cursor: pointer; }
.dx3-zoom button:hover { background: #eef2f6; }
@media (max-width: 900px) {
  .dx3-side { position: absolute; z-index: 5; left: 0; top: 0; bottom: 0; box-shadow: 4px 0 14px rgba(0,0,0,0.18); }
  .dx3-side.is-closed { display: none; }
  .dx3-toggle {
    display: inline-flex; position: absolute; z-index: 6; left: 8px; bottom: 8px; align-items: center; gap: 6px;
    padding: 6px 10px; border: 1px solid #c9c4b8; border-radius: 6px; background: #fff; font-size: 12px; font-weight: 700;
  }
  .dx-readout { top: auto; bottom: 8px; width: calc(100% - 20px); max-height: 36%; right: 10px; }
  .dx-readout__bar { height: 48px; }
}
`;

const PALETTES: Array<[RenderSettings["palette"], string]> = [
  ["brown", "Earth Tone"],
  ["rainbow", "Rainbow"],
  ["blue-red", "Blue → Red"],
  ["red-yellow-green", "Red → Green"],
  ["gray", "Grayscale"],
  ["ocean", "Ocean"],
  ["sunset", "Sunset"],
  ["forest", "Forest"],
  ["viridis", "Viridis"],
  ["topographic", "Topographic"],
  ["gray-amber", "Gray + Amber"],
  ["nm-sunset", "New Mexico Sunset"],
];

const INTERVALS = [0.05, 0.1, 0.2, 0.25, 0.5, 1];

type PageKey = "format" | "view" | "lighting" | "contours" | "color" | "base" | "axes" | "texture" | "title";

function Page({ k, label, open, onToggle, children }: { k: string; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="dx3-page" data-dx3-page={k}>
      <button type="button" className="dx3-page__head" aria-expanded={open} onClick={onToggle}>
        <span>{label}</span>
        <span aria-hidden>{open ? "–" : "+"}</span>
      </button>
      {open && <div className="dx3-page__body">{children}</div>}
    </div>
  );
}

function Slide({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="dx3-field">
      <span>{label} · {fmt ? fmt(value) : value}</span>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="dx3-row">
      <Label className="text-xs">{label}</Label>
      <Switch checked={on} onCheckedChange={set} />
    </div>
  );
}

// The height exaggeration is mostly wanted small -- single digits, and often under 1 -- so the slider is
// logarithmic from 0.1x to 10x: half its travel covers 0.1 to 1, half covers 1 to 10 (Tim, Nov 21, 2026).
const EX_MIN = 0.1;
const EX_MAX = 10;
const EX_STEPS = 1000;
function exToPos(v: number) {
  const c = Math.min(EX_MAX, Math.max(EX_MIN, v));
  return Math.round((Math.log(c / EX_MIN) / Math.log(EX_MAX / EX_MIN)) * EX_STEPS);
}
function exFromPos(pos: number) {
  const v = EX_MIN * Math.pow(EX_MAX / EX_MIN, pos / EX_STEPS);
  return Math.round(v * 100) / 100;
}

function niceStep(range: number, target: number) {
  const raw = Math.max(1e-6, range) / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nice * pow;
}

function makeLabelSprite(text: string, color: string, heightWorld: number) {
  const cvs = document.createElement("canvas");
  cvs.width = 256;
  cvs.height = 80;
  const ctx = cvs.getContext("2d");
  if (ctx) {
    ctx.font = "700 46px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 11;
    ctx.strokeText(text, 128, 42);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 42);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(heightWorld * (256 / 80), heightWorld, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) {
      const withMap = mat as THREE.Material & { map?: THREE.Texture | null };
      if (withMap.map) withMap.map.dispose();
      mat.dispose();
    }
  });
}

/**
 * The 3D view: a rotatable elevation surface on a white canvas, with a settings list down the left in the
 * manner of 3DField (Format, View, Lighting, Contours, Color scale, Base, Axes, Texture, Title). Colours come
 * from the same TPS grid Topo uses. View state is session-only; nothing persists to the Floor.
 */
export function ThreeDTab({
  floor,
  points,
  settings,
  onClose,
  levels,
  onLevelChange,
  frame = "overlay",
  readingSummary,
  onCaptureReady,
  onViewReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const zGroupRef = useRef<THREE.Group | null>(null); // scaled in z by the exaggeration
  const overlayRef = useRef<THREE.Group | null>(null); // labels, points: positioned, not stretched
  const lightsRef = useRef<{ hemi: THREE.HemisphereLight; key: THREE.DirectionalLight } | null>(null);
  const partsRef = useRef<Record<string, THREE.Object3D | null>>({});
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const metaRef = useRef<{ zScale: number; zRange: number; planScale: number; cx: number; cy: number; step: number; minValue: number; maxValue: number; halfW: number; halfH: number } | null>(null);

  // Kept as the slider's own position, so stepping it never rounds its way back onto the same place.
  const [exPos, setExPos] = useState<number>(740); // about 3x (3.02)
  const exaggeration = exFromPos(exPos);
  const [showPoints, setShowPoints] = useState<boolean>(false);
  const [pointSize, setPointSize] = useState<number>(1);
  const [surfaceOn, setSurfaceOn] = useState(true);
  const [plain, setPlain] = useState(false);
  const [meshLines, setMeshLines] = useState(false);
  const [contoursOn, setContoursOn] = useState(true);
  const [interval, setIntervalValue] = useState<number>(0.2);
  const [labelsOn, setLabelsOn] = useState(true);
  const [labelSize, setLabelSize] = useState(1);
  const [lightLevel, setLightLevel] = useState(1);
  const [lightAz, setLightAz] = useState(40);
  const [lightEl, setLightEl] = useState(55);
  const [fov, setFov] = useState(45);
  const [palette, setPalette] = useState<RenderSettings["palette"]>(settings.palette);
  const [reverse, setReverse] = useState<boolean>(settings.reversePalette);
  const [legendOn, setLegendOn] = useState(true);
  const [baseOn, setBaseOn] = useState(true);
  const [baseDepth, setBaseDepth] = useState(0.25);
  const [baseColor, setBaseColor] = useState("#cdbba0");
  const [axesOn, setAxesOn] = useState(true);
  const [textureOn, setTextureOn] = useState(false);
  const [textureOpacity, setTextureOpacity] = useState(0.8);
  const [title, setTitle] = useState("");
  const [openPage, setOpenPage] = useState<PageKey | null>("format");
  const [sideClosed, setSideClosed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtFor, setBuiltFor] = useState<string | null>(null);
  const composeRef = useRef<(() => DiagnosticCapture | null) | null>(null);
  const exagRef = useRef(exaggeration);
  exagRef.current = exaggeration;

  const viewKey = `${floor.id}|${points.map((point) => `${point.id}:${point.value}`).join(",")}`;
  const meshReady = ready && builtFor === viewKey && !error;

  const activePoints = useMemo(() => {
    const exMap = computeExclusionMap(points, floor.exclusions ?? []);
    return points.filter((p) => !exMap.has(p.id));
  }, [points, floor.exclusions]);

  const grid = useMemo(() => {
    if (activePoints.length < 3 || floor.boundary.length < 3) return null;
    return buildGrid(
      activePoints,
      floor.boundary,
      TOPO_GRID_TARGET_COLS,
      (floor.exclusions ?? []).map((e) => e.polygon),
    );
  }, [activePoints, floor.boundary, floor.exclusions]);

  // ---- renderer, camera, lights (once) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (err) {
      console.error(err);
      setError("3D view could not start on this device.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const zGroup = new THREE.Group();
    const overlay = new THREE.Group();
    scene.add(zGroup);
    scene.add(overlay);
    zGroupRef.current = zGroup;
    overlayRef.current = overlay;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    camera.position.set(0.65, -1.2, 0.9);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    // A floor is a thing you move over, not a ball you spin: zoom toward the point under the pointer or
    // fingers, with limits so it can neither be lost far away nor pushed through the surface.
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1;
    controls.rotateSpeed = 0.8;
    controls.panSpeed = 1;
    controls.minDistance = 0.05;
    controls.maxDistance = 8;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controlsRef.current = controls;
    // The page must not take the pinch for itself (iPad Safari zooms the whole page otherwise).
    renderer.domElement.style.touchAction = "none";
    const stopGesture = (e: Event) => e.preventDefault();
    mount.addEventListener("gesturestart", stopGesture as EventListener);
    mount.addEventListener("gesturechange", stopGesture as EventListener);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b8c4, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 1, 2);
    scene.add(hemi);
    scene.add(key);
    lightsRef.current = { hemi, key };

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      // Read by tests: how far the camera is, and where it is looking.
      mount.dataset.camDist = camera.position.distanceTo(controls.target).toFixed(3);
      mount.dataset.camPos = `${camera.position.x.toFixed(3)},${camera.position.y.toFixed(3)},${camera.position.z.toFixed(3)}`;
      mount.dataset.camTarget = `${controls.target.x.toFixed(3)},${controls.target.y.toFixed(3)},${controls.target.z.toFixed(3)}`;
      raf = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      mount.removeEventListener("gesturestart", stopGesture as EventListener);
      mount.removeEventListener("gesturechange", stopGesture as EventListener);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      Object.values(partsRef.current).forEach((o) => o && disposeObject(o));
      partsRef.current = {};
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      scene.clear();
    };
  }, []);

  function setPart(name: string, obj: THREE.Object3D | null, parent: "z" | "overlay") {
    const group = parent === "z" ? zGroupRef.current : overlayRef.current;
    const prev = partsRef.current[name];
    if (prev) {
      prev.parent?.remove(prev);
      disposeObject(prev);
    }
    partsRef.current[name] = obj;
    if (obj && group) group.add(obj);
  }

  // ---- the surface itself ----
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!sceneRef.current || !camera || !controls) return;
    setBuiltFor(null);
    setReady(false);

    ["surface", "wire", "contours", "labels", "base", "axes", "ticks", "points", "texture"].forEach((n) =>
      setPart(n, null, "z"),
    );
    geomRef.current = null;

    if (!grid) {
      setError((floor.boundary?.length ?? 0) < 3 ? "Boundary is missing." : "Need at least 3 survey points.");
      return;
    }
    setError(null);

    const { width: cols, height: rows, values, mask, minValue, maxValue, x0, y0, step } = grid;
    const planW = cols * step;
    const planH = rows * step;
    const planScale = 1 / Math.max(planW, planH);
    const zRange = Math.max(0.001, maxValue - minValue);
    const zScale = ((Math.min(planW, planH) * planScale) * 0.15) / zRange;
    const cx = x0 + planW / 2;
    const cy = y0 + planH / 2;
    metaRef.current = { zScale, zRange, planScale, cx, cy, step, minValue, maxValue, halfW: (planW * planScale) / 2, halfH: (planH * planScale) / 2 };

    const vertIndex = new Int32Array(cols * rows).fill(-1);
    const positions: number[] = [];
    const colors: number[] = [];
    const vals: number[] = [];
    const plan: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!mask[idx] || !isFinite(values[idx])) continue;
        const px = x0 + c * step;
        const py = y0 + r * step;
        const v = values[idx];
        vertIndex[idx] = positions.length / 3;
        positions.push((px - cx) * planScale, -(py - cy) * planScale, (v - minValue) * zScale);
        vals.push(v);
        plan.push(px, py);
        const rgb = paletteColor(clampValue(v, minValue, maxValue), palette, reverse);
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
        colors.push(m ? +m[1] / 255 : 1, m ? +m[2] / 255 : 1, m ? +m[3] / 255 : 1);
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = vertIndex[r * cols + c];
        const b = vertIndex[r * cols + (c + 1)];
        const d = vertIndex[(r + 1) * cols + c];
        const e = vertIndex[(r + 1) * cols + (c + 1)];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    geomRef.current = geom;
    (geom as THREE.BufferGeometry & { userData: Record<string, unknown> }).userData = { vals, plan, indices };

    controls.target.set(0, 0, zRange * zScale);
    camera.position.set(0.65, -1.2, 0.9);
    controls.update();

    setBuiltFor(viewKey);
    setReady(true);
  }, [grid, palette, reverse, viewKey, floor.boundary]);

  // ---- parts that hang off the surface ----
  useEffect(() => {
    const geom = geomRef.current;
    const meta = metaRef.current;
    if (!geom || !meta || !meshReady) return;
    const { vals, plan, indices } = geom.userData as { vals: number[]; plan: number[]; indices: number[] };
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;

    // surface
    const surfaceMat = new THREE.MeshStandardMaterial({
      vertexColors: !plain,
      color: plain ? 0xf4f1ea : 0xffffff,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const surface = new THREE.Mesh(geom, surfaceMat);
    surface.visible = surfaceOn;
    setPart("surface", surface, "z");
    surface.geometry = geom; // shared; the part's disposal below must not free it twice
    surface.userData.sharedGeometry = true;

    // mesh lines
    if (meshLines) {
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geom),
        new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.35 }),
      );
      setPart("wire", wire, "z");
    } else setPart("wire", null, "z");

    // contours, drawn on the surface, and their value labels
    if (contoursOn) {
      const lo = meta.minValue;
      const hi = meta.maxValue;
      const first = Math.ceil((lo + 1e-6) / interval) * interval;
      const thresholds: number[] = [];
      for (let t = first; t <= hi + 1e-6; t += interval) thresholds.push(Math.round(t * 1000) / 1000);
      const seg: number[] = [];
      const byT = new Map<number, Array<[number, number, number]>>();
      const P = pos.array as Float32Array;
      const lift = 0.0006;
      for (let i = 0; i < indices.length; i += 3) {
        const ia = indices[i]; const ib = indices[i + 1]; const ic = indices[i + 2];
        const va = vals[ia]; const vb = vals[ib]; const vc = vals[ic];
        const tmin = Math.min(va, vb, vc); const tmax = Math.max(va, vb, vc);
        if (tmax < thresholds[0] || tmin > thresholds[thresholds.length - 1]) continue;
        for (let k = 0; k < thresholds.length; k++) {
          const t = thresholds[k];
          if (t < tmin || t >= tmax) continue;
          const pts: Array<[number, number]> = [];
          const edges: Array<[number, number]> = [[ia, ib], [ib, ic], [ic, ia]];
          for (const [u, w] of edges) {
            const vu = vals[u]; const vw = vals[w];
            if ((vu >= t) === (vw >= t)) continue;
            const f = (t - vu) / (vw - vu);
            pts.push([P[u * 3] + (P[w * 3] - P[u * 3]) * f, P[u * 3 + 1] + (P[w * 3 + 1] - P[u * 3 + 1]) * f]);
          }
          if (pts.length !== 2) continue;
          const z = (t - lo) * meta.zScale + lift;
          seg.push(pts[0][0], pts[0][1], z, pts[1][0], pts[1][1], z);
          let list = byT.get(t);
          if (!list) { list = []; byT.set(t, list); }
          list.push([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, z]);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
      setPart("contours", new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a })), "z");

      if (labelsOn) {
        const group = new THREE.Group();
        const placed: Array<[number, number]> = [];
        const minGap = 0.16;
        const decimals = interval < 0.1 ? 2 : interval < 1 ? 2 : 1;
        let count = 0;
        const entries = [...byT.entries()].sort((a, b) => a[0] - b[0]);
        for (const [t, list] of entries) {
          // Walk the segments of this level, spaced out, and label where nothing nearby already is.
          for (let i = 0; i < list.length && count < 90; i += 7) {
            const [x, y, z] = list[i];
            if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < minGap)) continue;
            placed.push([x, y]);
            const sprite = makeLabelSprite(t.toFixed(decimals), "#111111", 0.028 * labelSize);
            sprite.userData.baseZ = z;
            sprite.position.set(x, y, z * exagRef.current + 0.004);
            group.add(sprite);
            count += 1;
          }
        }
        setPart("labels", group, "overlay");
      } else setPart("labels", null, "overlay");
    } else {
      setPart("contours", null, "z");
      setPart("labels", null, "overlay");
    }

    // base slab: walls down to a flat bottom, following the survey outline
    if (baseOn) {
      const depth = baseDepth * meta.zRange * meta.zScale + 0.004;
      const bottom = -depth;
      const edgeCount = new Map<string, number>();
      const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
      for (let i = 0; i < indices.length; i += 3) {
        for (const [u, w] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
          const k = key(u, w);
          edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
        }
      }
      const bp: number[] = []; const bi: number[] = [];
      const P = pos.array as Float32Array;
      const used = new Map<number, number>();
      const topIndex = (v: number) => {
        let id = used.get(v);
        if (id === undefined) { id = bp.length / 3; bp.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); used.set(v, id); }
        return id;
      };
      const botIndex = (v: number) => {
        const k = v + 1e7;
        let id = used.get(k);
        if (id === undefined) { id = bp.length / 3; bp.push(P[v * 3], P[v * 3 + 1], bottom); used.set(k, id); }
        return id;
      };
      for (const [k, n] of edgeCount.entries()) {
        if (n !== 1) continue;
        const [a, b] = k.split("_").map(Number);
        const ta = topIndex(a); const tb = topIndex(b); const ba = botIndex(a); const bb = botIndex(b);
        bi.push(ta, tb, bb, ta, bb, ba);
      }
      for (let i = 0; i < indices.length; i += 3) {
        bi.push(botIndex(indices[i]), botIndex(indices[i + 2]), botIndex(indices[i + 1]));
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bp), 3));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      setPart("base", new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 0.4, roughness: 0.95, side: THREE.DoubleSide })), "z");
    } else setPart("base", null, "z");

    // box and axis ticks
    if (axesOn) {
      const zTop = meta.zRange * meta.zScale * 1.12;
      const zBot = baseOn ? -(baseDepth * meta.zRange * meta.zScale + 0.004) : 0;
      const hw = meta.halfW; const hh = meta.halfH;
      const c = [
        [-hw, -hh, zBot], [hw, -hh, zBot], [hw, hh, zBot], [-hw, hh, zBot],
        [-hw, -hh, zTop], [hw, -hh, zTop], [hw, hh, zTop], [-hw, hh, zTop],
      ];
      const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const lines: number[] = [];
      e.forEach(([a, b]) => lines.push(...c[a], ...c[b]));
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lines), 3));
      setPart("axes", new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7a8a7a, transparent: true, opacity: 0.8 })), "z");

      const ticks = new THREE.Group();
      // Height ticks (inches) along the front-left vertical edge.
      const zStep = niceStep(meta.zRange, 4);
      const zFirst = Math.ceil((meta.minValue + 1e-6) / zStep) * zStep;
      for (let v = zFirst; v <= meta.maxValue + 1e-6; v += zStep) {
        const s = makeLabelSprite(v.toFixed(zStep < 0.1 ? 2 : 1) + "\"", "#1b6b2a", 0.032);
        s.userData.baseZ = (v - meta.minValue) * meta.zScale;
        s.position.set(-hw - 0.05, -hh - 0.01, s.userData.baseZ * exagRef.current);
        ticks.add(s);
      }
      // Plan ticks in feet along the bottom front and left edges, when the floor has a scale.
      const sc = floor.scale;
      if (sc && sc.lengthInches > 0) {
        const pxLen = Math.hypot(sc.b.x - sc.a.x, sc.b.y - sc.a.y);
        if (pxLen > 1) {
          const inchesPerPx = sc.lengthInches / pxLen;
          const feetW = (meta.halfW * 2) / meta.planScale * inchesPerPx / 12;
          const feetH = (meta.halfH * 2) / meta.planScale * inchesPerPx / 12;
          const fStep = niceStep(Math.max(feetW, feetH), 5);
          for (let f = 0; f <= feetW + 1e-6; f += fStep) {
            const s = makeLabelSprite(`${Math.round(f)}'`, "#7a1f1f", 0.03);
            s.userData.baseZ = zBot;
            s.position.set(-hw + (f / feetW) * (hw * 2), -hh - 0.06, zBot * exagRef.current);
            ticks.add(s);
          }
          for (let f = fStep; f <= feetH + 1e-6; f += fStep) {
            const s = makeLabelSprite(`${Math.round(f)}'`, "#7a1f1f", 0.03);
            s.userData.baseZ = zBot;
            s.position.set(-hw - 0.06, -hh + (f / feetH) * (hh * 2), zBot * exagRef.current);
            ticks.add(s);
          }
        }
      }
      setPart("ticks", ticks, "overlay");
    } else {
      setPart("axes", null, "z");
      setPart("ticks", null, "overlay");
    }
    // The part replaced above is disposed when the next one lands; the surface geometry is shared with the
    // wire and texture parts, so it is released only when the surface itself is rebuilt.
    void plan;
  }, [meshReady, plain, surfaceOn, meshLines, contoursOn, interval, labelsOn, labelSize, baseOn, baseDepth, baseColor, axesOn, floor.scale]);

  // ---- survey points ----
  useEffect(() => {
    const meta = metaRef.current;
    if (!meta || !meshReady) return;
    const group = new THREE.Group();
    const r = meta.planScale * meta.step * 1.5 * pointSize;
    const geom = new THREE.SphereGeometry(r, 12, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.2 });
    for (const p of activePoints) {
      const s = new THREE.Mesh(geom, mat);
      const z = (p.value - meta.minValue) * meta.zScale;
      s.userData.baseZ = z;
      s.userData.lift = r;
      s.position.set((p.x - meta.cx) * meta.planScale, -(p.y - meta.cy) * meta.planScale, z * exagRef.current + r);
      group.add(s);
    }
    group.visible = showPoints;
    setPart("points", group, "overlay");
  }, [meshReady, activePoints, pointSize]);

  useEffect(() => {
    const g = partsRef.current.points;
    if (g) g.visible = showPoints;
  }, [showPoints]);

  // ---- the plan picture draped on the surface ----
  useEffect(() => {
    const geom = geomRef.current;
    const url = floor.planDataUrl;
    if (!geom || !meshReady || !textureOn || !url) {
      setPart("texture", null, "z");
      return;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(url, (tex) => {
      if (cancelled || geomRef.current !== geom) { tex.dispose(); return; }
      const { plan } = geom.userData as { plan: number[] };
      const iw = floor.planWidth || (tex.image as HTMLImageElement).width || 1;
      const ih = floor.planHeight || (tex.image as HTMLImageElement).height || 1;
      const uv = new Float32Array((plan.length / 2) * 2);
      for (let i = 0; i < plan.length / 2; i++) {
        uv[i * 2] = plan[i * 2] / iw;
        uv[i * 2 + 1] = 1 - plan[i * 2 + 1] / ih;
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", geom.getAttribute("position"));
      g2.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g2.setIndex(geom.getIndex());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: textureOpacity,
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      setPart("texture", new THREE.Mesh(g2, mat), "z");
    });
    return () => { cancelled = true; };
  }, [meshReady, textureOn, textureOpacity, floor.planDataUrl, floor.planWidth, floor.planHeight]);

  // ---- exaggeration, lights, field of view ----
  useEffect(() => {
    const zg = zGroupRef.current;
    if (zg) zg.scale.z = exaggeration;
    overlayRef.current?.traverse((o) => {
      if (o.userData && typeof o.userData.baseZ === "number") {
        o.position.z = o.userData.baseZ * exaggeration + (typeof o.userData.lift === "number" ? o.userData.lift : 0.004);
      }
    });
  }, [exaggeration, meshReady]);

  useEffect(() => {
    const l = lightsRef.current;
    if (!l) return;
    l.hemi.intensity = 1.15 * lightLevel;
    l.key.intensity = 0.9 * lightLevel;
    const az = (lightAz * Math.PI) / 180;
    const el = (lightEl * Math.PI) / 180;
    l.key.position.set(Math.cos(el) * Math.sin(az) * 3, -Math.cos(el) * Math.cos(az) * 3, Math.sin(el) * 3);
  }, [lightLevel, lightAz, lightEl]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [fov]);

  function zoomBy(factor: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
    offset.setLength(d);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  function viewPreset(kind: "top" | "front" | "side" | "angled") {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const meta = metaRef.current;
    if (!camera || !controls || !meta) return;
    const zMid = (meta.zRange * meta.zScale * exaggeration) / 2;
    const d = 1.7;
    controls.target.set(0, 0, zMid);
    if (kind === "top") camera.position.set(0, -0.0001, d + zMid);
    else if (kind === "front") camera.position.set(0, -d, zMid + 0.15);
    else if (kind === "side") camera.position.set(d, 0, zMid + 0.15);
    else camera.position.set(0.65, -1.2, 0.9 + zMid);
    controls.update();
  }

  // Legend ends are the measured usable high and low. buildGrid clamps every interpolated cell to that same
  // measured range, so the mesh palette does not extend past the readings named on the legend.
  const legendColors = useMemo(() => {
    if (!readingSummary || readingSummary.surface !== "ready" || readingSummary.unit !== "in") return [];
    const stops = 8;
    const colors: string[] = [];
    for (let i = 0; i < stops; i += 1) {
      colors.push(paletteColor(i / (stops - 1), palette, reverse));
    }
    return colors;
  }, [readingSummary, palette, reverse]);

  const readoutLines = useMemo(() => {
    if (!readingSummary) return null;
    const api = diagnosticsApi();
    if (!api || typeof api.contextLines !== "function") return null;
    return api.contextLines(readingSummary, exaggeration);
  }, [readingSummary, exaggeration]);

  const formatReading = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "";
    const api = diagnosticsApi();
    if (api && typeof api.formatInches === "function") return api.formatInches(value);
    return readingText(value) + " in";
  };

  composeRef.current = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || !meshReady) return null;
    renderer.render(scene, camera);
    const source = renderer.domElement;
    if (source.width < 2 || source.height < 2) return null;
    // Standalone Floor Survey export has no readout and keeps the bare view.
    // Diagnostics capture (readingSummary provided) must include the band.
    const bare = readingSummary === undefined;
    if (!bare && (!readingSummary || !readoutLines || !readoutLines.length)) return null;
    const lines = title.trim() ? [title.trim(), ...(readoutLines || [])] : readoutLines || [];
    const dataUrl = bare
      ? source.toDataURL("image/png")
      : paintDiagnosticPng(
          source,
          lines,
          legendOn ? legendColors : [],
          formatReading(readingSummary?.high),
          formatReading(readingSummary?.low),
        );
    if (!dataUrl || dataUrl.indexOf("data:image/png") !== 0) return null;
    return {
      dataUrl,
      exaggeration,
      legendColors: legendOn ? legendColors : [],
      palette,
      reversePalette: reverse,
    };
  };

  useEffect(() => {
    if (!onCaptureReady) return;
    onCaptureReady(() => composeRef.current?.() ?? null);
    return () => onCaptureReady(null);
  }, [onCaptureReady]);

  useEffect(() => {
    onViewReady?.(meshReady);
  }, [meshReady, onViewReady]);

  const handleExport = () => {
    const shot = composeRef.current?.();
    const dataUrl = shot?.dataUrl;
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${floor.name || "floor"}-3d.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const hasPlan = !!floor.planDataUrl;

  return (
    <div
      className={
        frame === "fill"
          ? "relative z-0 min-h-0 w-full flex-1 bg-white text-neutral-900 flex flex-col"
          : "fixed inset-0 z-[60] bg-white text-neutral-900 flex flex-col"
      }
    >
      <style>{READOUT_CSS}</style>
      <div className="flex items-center gap-2 px-3 h-11 border-b border-neutral-300 bg-neutral-100">
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-black/10"
          aria-label="Close 3D view"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium truncate min-w-0">
          {levels && levels.length > 1 && onLevelChange ? (
            <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
              <select
                aria-label="Floor"
                data-diagnostics-floor
                value={floor.id}
                onChange={(e) => onLevelChange(e.target.value)}
                className="max-w-[9rem] truncate bg-transparent text-sm font-medium"
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
              <span>· 3D</span>
            </span>
          ) : (
            <span>{floor.name} · 3D</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleExport} disabled={!meshReady} className="h-8">
            <Camera className="h-4 w-4 mr-1.5" />
            Export image
          </Button>
        </div>
      </div>

      <div className="dx3-shell">
        <div className={`dx3-side${sideClosed ? " is-closed" : ""}`} data-dx3-panel>
          <div className="dx3-quick" data-diagnostics-height>
            <div className="dx3-field">
              <span>Height exaggeration · {exaggeration.toFixed(2)}×</span>
              <Slider min={0} max={EX_STEPS} step={2} value={[exPos]} onValueChange={([v]) => setExPos(v)} />
            </div>
            <div className="dx3-row" style={{ marginTop: 8 }}>
              <Label className="text-xs">Show survey points</Label>
              <Switch checked={showPoints} onCheckedChange={setShowPoints} />
            </div>
            <div className="text-[10px] text-neutral-500 leading-snug mt-2">
              Drag to orbit · pinch / scroll to zoom · two-finger drag to pan
            </div>
          </div>

          <Page k="format" label="Format" open={openPage === "format"} onToggle={() => setOpenPage(openPage === "format" ? null : "format")}>
            <Toggle label="Surface" on={surfaceOn} set={setSurfaceOn} />
            <Toggle label="Elevation colors" on={!plain} set={(v) => setPlain(!v)} />
            <Toggle label="Mesh lines" on={meshLines} set={setMeshLines} />
            <Slide label="Point size" value={pointSize} min={0.4} max={3} step={0.1} onChange={setPointSize} fmt={(v) => `${v.toFixed(1)}×`} />
          </Page>
          <Page k="view" label="View" open={openPage === "view"} onToggle={() => setOpenPage(openPage === "view" ? null : "view")}>
            <div className="dx3-btns">
              <button type="button" className="dx3-btn" onClick={() => viewPreset("top")}>Top</button>
              <button type="button" className="dx3-btn" onClick={() => viewPreset("front")}>Front</button>
              <button type="button" className="dx3-btn" onClick={() => viewPreset("side")}>Side</button>
              <button type="button" className="dx3-btn" onClick={() => viewPreset("angled")}>Angled</button>
            </div>
            <Slide label="Perspective (field of view)" value={fov} min={15} max={80} step={1} onChange={setFov} fmt={(v) => `${v}°`} />
          </Page>
          <Page k="lighting" label="Lighting" open={openPage === "lighting"} onToggle={() => setOpenPage(openPage === "lighting" ? null : "lighting")}>
            <Slide label="Brightness" value={lightLevel} min={0.3} max={1.6} step={0.05} onChange={setLightLevel} fmt={(v) => v.toFixed(2)} />
            <Slide label="Direction" value={lightAz} min={-180} max={180} step={5} onChange={setLightAz} fmt={(v) => `${v}°`} />
            <Slide label="Height" value={lightEl} min={10} max={90} step={5} onChange={setLightEl} fmt={(v) => `${v}°`} />
          </Page>
          <Page k="contours" label="Contours" open={openPage === "contours"} onToggle={() => setOpenPage(openPage === "contours" ? null : "contours")}>
            <Toggle label="Contour lines" on={contoursOn} set={setContoursOn} />
            <div className="dx3-field">
              <span>Interval (inches)</span>
              <select className="dx3-select" value={interval} onChange={(e) => setIntervalValue(Number(e.target.value))} aria-label="Contour interval">
                {INTERVALS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <Toggle label="Value labels" on={labelsOn} set={setLabelsOn} />
            <Slide label="Label size" value={labelSize} min={0.5} max={2.5} step={0.1} onChange={setLabelSize} fmt={(v) => `${v.toFixed(1)}×`} />
          </Page>
          <Page k="color" label="Color scale" open={openPage === "color"} onToggle={() => setOpenPage(openPage === "color" ? null : "color")}>
            <Toggle label="Show color scale" on={legendOn} set={setLegendOn} />
            <div className="dx3-field">
              <span>Palette</span>
              <select className="dx3-select" value={palette} onChange={(e) => setPalette(e.target.value as RenderSettings["palette"])} aria-label="Palette">
                {PALETTES.map(([k, name]) => (
                  <option key={k} value={k}>{name}</option>
                ))}
              </select>
            </div>
            <Toggle label="Reverse" on={reverse} set={setReverse} />
          </Page>
          <Page k="base" label="Base" open={openPage === "base"} onToggle={() => setOpenPage(openPage === "base" ? null : "base")}>
            <Toggle label="Base slab" on={baseOn} set={setBaseOn} />
            <Slide label="Thickness" value={baseDepth} min={0.1} max={2} step={0.05} onChange={setBaseDepth} fmt={(v) => v.toFixed(2)} />
            <div className="dx3-row">
              <Label className="text-xs">Color</Label>
              <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} aria-label="Base color" />
            </div>
          </Page>
          <Page k="axes" label="Axes" open={openPage === "axes"} onToggle={() => setOpenPage(openPage === "axes" ? null : "axes")}>
            <Toggle label="Box and ticks" on={axesOn} set={setAxesOn} />
            <div className="text-[11px] text-neutral-500">Heights are in inches. Feet along the plan appear when the plan has a scale.</div>
          </Page>
          <Page k="texture" label="Texture" open={openPage === "texture"} onToggle={() => setOpenPage(openPage === "texture" ? null : "texture")}>
            <Toggle label="Floor plan on the surface" on={textureOn} set={setTextureOn} />
            {!hasPlan && <div className="text-[11px] text-neutral-500">This level has no plan picture.</div>}
            <Slide label="Strength" value={textureOpacity} min={0.1} max={1} step={0.05} onChange={setTextureOpacity} fmt={(v) => v.toFixed(2)} />
          </Page>
          <Page k="title" label="Map title" open={openPage === "title"} onToggle={() => setOpenPage(openPage === "title" ? null : "title")}>
            <input className="dx3-text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title shown on the view" aria-label="Map title" />
          </Page>
        </div>

        <div className="dx3-stage">
          <button type="button" className="dx3-toggle" onClick={() => setSideClosed(!sideClosed)} aria-label="Settings">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Settings
          </button>
          <div ref={mountRef} className="absolute inset-0" data-dx3-canvas />
          <div className="dx3-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.75)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.33)}>−</button>
            <button type="button" aria-label="Fit" onClick={() => viewPreset("angled")}>Fit</button>
          </div>
          {title.trim() && <div className="dx3-title">{title.trim()}</div>}

          {!meshReady && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building surface…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-600 text-center px-6">
              {error}
            </div>
          )}

          {readingSummary !== undefined && (
            <div
              className="dx-readout"
              data-diagnostics-readout
              data-surface={readingSummary?.surface || ""}
              data-exaggeration={exaggeration.toFixed(2)}
            >
              <div className="dx-readout__body">
                {readingSummary && readoutLines ? (
                  readoutLines
                    .filter((line) => line !== readingSummary.scaleNotice && line !== readingSummary.evidenceMessage)
                    .map((line, index) => (
                      <p key={index} className="dx-readout__line" data-diagnostics-line>
                        {line}
                      </p>
                    ))
                ) : (
                  <p className="dx-readout__line" data-diagnostics-line>
                    Diagnostic context is not available in this session.
                  </p>
                )}
                {legendOn && legendColors.length > 0 && readingSummary && (
                  <div
                    className="dx-readout__scale"
                    data-diagnostics-legend
                    data-legend-low={readingSummary.low ?? ""}
                    data-legend-high={readingSummary.high ?? ""}
                    data-palette={palette}
                    data-legend-colors={legendColors.join("|")}
                  >
                    <span>{formatReading(readingSummary.high)}</span>
                    <span
                      className="dx-readout__bar"
                      style={{ background: `linear-gradient(to top, ${legendColors.join(",")})` }}
                    />
                    <span>{formatReading(readingSummary.low)}</span>
                  </div>
                )}
              </div>
              <p className="dx-readout__notice" data-diagnostics-notice>
                {readingSummary?.scaleNotice || "Vertical exaggeration. Visualization is not to scale."}
              </p>
              {readingSummary?.evidenceMessage && (
                <p className="dx-readout__evidence" data-diagnostics-evidence>
                  {readingSummary.evidenceMessage}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThreeDTab;
