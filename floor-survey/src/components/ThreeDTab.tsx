import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X, Camera, Loader2 } from "lucide-react";
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
  ctx.fillStyle = "#0b0b0b";
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

const EXAGGERATION_MIN = 0.1;
const EXAGGERATION_MAX = 8;
const SLIDER_MIN = 0.5;
const SLIDER_MAX = 4;

function clampExaggeration(value: number) {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(EXAGGERATION_MAX, Math.max(EXAGGERATION_MIN, value));
  return Math.round(clamped * 10) / 10;
}

const READOUT_CSS = `
.dx-readout {
  position: absolute;
  z-index: 2;
  left: 8px;
  top: 8px;
  width: min(248px, calc(100% - 276px));
  max-height: calc(100% - 16px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(10,10,10,0.84);
  color: #f7f4ee;
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
  height: 76px;
  border: 1px solid rgba(255,255,255,0.75);
  border-radius: 2px;
}
.dx-readout__notice,
.dx-readout__evidence {
  margin: 0;
  padding: 6px 10px 7px;
  border-top: 1px solid rgba(255,255,255,0.12);
  font-size: 10px;
  line-height: 1.3;
  color: rgba(247,244,238,0.78);
}
@media (max-width: 760px) {
  .dx-readout {
    top: auto;
    bottom: 8px;
    width: calc(100% - 16px);
    max-height: 36%;
  }
  .dx-readout__bar { height: 48px; }
}
`;

/**
 * Standalone 3D visualization: rotatable colored elevation mesh built from
 * the same TPS grid used by Topo. Free-orbit camera, height exaggeration
 * slider, optional survey-point spheres, PNG screenshot export. View state
 * is session-only; nothing persists to the Floor.
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
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pointsGroupRef = useRef<THREE.Group | null>(null);
  const baseZRef = useRef<Float32Array | null>(null);
  const zScaleRef = useRef<number>(1);

  const [exaggeration, setExaggeration] = useState<number>(frame === "fill" ? 1 : 3);
  const [showPoints, setShowPoints] = useState<boolean>(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtFor, setBuiltFor] = useState<string | null>(null);
  const composeRef = useRef<(() => DiagnosticCapture | null) | null>(null);

  const viewKey = `${floor.id}|${points.map((point) => `${point.id}:${point.value}`).join(",")}`;
  const meshReady = ready && builtFor === viewKey && !error;

  const palette = settings.palette;
  const reverse = settings.reversePalette;

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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch (err) {
      console.error(err);
      setError("3D view could not start on this device.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0b0b, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(0, -1.2, 0.9);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(1, 1, 2);
    scene.add(key);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
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
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      scene.clear();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    setBuiltFor(null);
    setReady(false);

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }
    if (pointsGroupRef.current) {
      scene.remove(pointsGroupRef.current);
      pointsGroupRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
      pointsGroupRef.current = null;
    }

    if (!grid) {
      setReady(false);
      setBuiltFor(null);
      setError((floor.boundary?.length ?? 0) < 3 ? "Boundary is missing." : "Need at least 3 survey points.");
      return;
    }
    setError(null);

    const { width: cols, height: rows, values, mask, minValue, maxValue, x0, y0, step } = grid;

    const planW = cols * step;
    const planH = rows * step;
    const planScale = 1 / Math.max(planW, planH);
    const zRange = Math.max(0.001, maxValue - minValue);
    const baseZScale = ((Math.min(planW, planH) * planScale) * 0.15) / zRange;
    zScaleRef.current = baseZScale;

    const vertIndex = new Int32Array(cols * rows).fill(-1);
    const positions: number[] = [];
    const colors: number[] = [];
    const baseZ: number[] = [];
    const cx = x0 + planW / 2;
    const cy = y0 + planH / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!mask[idx] || !isFinite(values[idx])) continue;
        const px = x0 + c * step;
        const py = y0 + r * step;
        const v = values[idx];
        const wx = (px - cx) * planScale;
        const wy = -(py - cy) * planScale;
        const wz = (v - minValue) * baseZScale * exaggeration;
        vertIndex[idx] = positions.length / 3;
        positions.push(wx, wy, wz);
        baseZ.push((v - minValue) * baseZScale);

        const t = clampValue(v, minValue, maxValue);
        const rgb = paletteColor(t, palette, reverse);
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
        if (m) {
          colors.push(+m[1] / 255, +m[2] / 255, +m[3] / 255);
        } else {
          colors.push(1, 1, 1);
        }
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
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }

    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions);
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    baseZRef.current = new Float32Array(baseZ);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    meshRef.current = mesh;

    controls.target.set(0, 0, 0);
    camera.position.set(0.6, -0.9, 0.7);
    controls.update();

    setBuiltFor(viewKey);
    setReady(true);

    const group = new THREE.Group();
    const sphereGeom = new THREE.SphereGeometry(planScale * step * 1.5, 12, 10);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.2,
    });
    for (const p of activePoints) {
      const s = new THREE.Mesh(sphereGeom, sphereMat);
      const wx = (p.x - cx) * planScale;
      const wy = -(p.y - cy) * planScale;
      const wz = (p.value - minValue) * baseZScale * exaggeration + planScale * step * 1.5;
      s.position.set(wx, wy, wz);
      group.add(s);
    }
    group.visible = showPoints;
    scene.add(group);
    pointsGroupRef.current = group;
  }, [grid, palette, reverse, activePoints, viewKey, floor.boundary]);

  useEffect(() => {
    const mesh = meshRef.current;
    const baseZ = baseZRef.current;
    if (!mesh || !baseZ) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < baseZ.length; i++) {
      pos.setZ(i, baseZ[i] * exaggeration);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();

    const group = pointsGroupRef.current;
    if (group && grid) {
      const { minValue, step, x0, y0, width, height } = grid;
      const planW = width * step;
      const planH = height * step;
      const planScale = 1 / Math.max(planW, planH);
      const cx = x0 + planW / 2;
      const cy = y0 + planH / 2;
      const baseZScale = zScaleRef.current;
      const bump = planScale * step * 1.5;
      let i = 0;
      for (const p of activePoints) {
        const s = group.children[i++] as THREE.Mesh | undefined;
        if (!s) break;
        const wx = (p.x - cx) * planScale;
        const wy = -(p.y - cy) * planScale;
        const wz = (p.value - minValue) * baseZScale * exaggeration + bump;
        s.position.set(wx, wy, wz);
      }
    }
  }, [exaggeration, grid, activePoints]);

  useEffect(() => {
    if (pointsGroupRef.current) pointsGroupRef.current.visible = showPoints;
  }, [showPoints]);

  // Legend ends are the measured usable high and low. buildGrid clamps every
  // interpolated cell to that same measured range, so the mesh palette does
  // not extend past the readings named on the legend.
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
    return value.toFixed(2) + " in";
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
    const dataUrl = bare
      ? source.toDataURL("image/png")
      : paintDiagnosticPng(
          source,
          readoutLines || [],
          legendColors,
          formatReading(readingSummary?.high),
          formatReading(readingSummary?.low),
        );
    if (!dataUrl || dataUrl.indexOf("data:image/png") !== 0) return null;
    return {
      dataUrl,
      exaggeration,
      legendColors,
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

  return (
    <div
      className={
        frame === "fill"
          ? "relative z-0 min-h-0 w-full flex-1 bg-neutral-950 text-white flex flex-col"
          : "fixed inset-0 z-[60] bg-neutral-950 text-white flex flex-col"
      }
    >
      <div className="flex items-center gap-2 px-3 h-11 border-b border-white/10 bg-black/40 backdrop-blur">
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-white/10"
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
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExport}
            disabled={!meshReady}
            className="h-8"
          >
            <Camera className="h-4 w-4 mr-1.5" />
            Export image
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={mountRef} className="absolute inset-0" />

        {!meshReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building surface…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70 text-center px-6">
            {error}
          </div>
        )}

        {readingSummary !== undefined && (
          <div
            className="dx-readout"
            data-diagnostics-readout
            data-surface={readingSummary?.surface || ""}
            data-exaggeration={exaggeration.toFixed(1)}
          >
            <style>{READOUT_CSS}</style>
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
              {legendColors.length > 0 && readingSummary && (
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
              {readingSummary?.scaleNotice || "Not to scale — for illustration purposes only"}
            </p>
            {readingSummary?.evidenceMessage && (
              <p className="dx-readout__evidence" data-diagnostics-evidence>
                {readingSummary.evidenceMessage}
              </p>
            )}
          </div>
        )}

        <div
          className="absolute top-3 right-3 w-52 rounded-md bg-black/70 backdrop-blur border border-white/10 p-3 text-xs space-y-2"
          data-diagnostics-height
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-white/80 text-xs" htmlFor="dx-vertical-exaggeration">
                Vertical exaggeration
              </Label>
              <input
                id="dx-vertical-exaggeration"
                type="number"
                data-diagnostics-z
                aria-label="Vertical exaggeration"
                min={EXAGGERATION_MIN}
                max={EXAGGERATION_MAX}
                step={0.1}
                value={exaggeration.toFixed(1)}
                onChange={(event) => setExaggeration(clampExaggeration(Number(event.target.value)))}
                className="h-7 w-16 rounded border border-white/25 bg-black/40 px-1 text-right text-xs text-white"
              />
            </div>
            <Slider
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={0.1}
              value={[Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, exaggeration))]}
              onValueChange={([v]) => setExaggeration(clampExaggeration(v))}
              className="mt-2"
              aria-label="Vertical exaggeration slider"
            />
            <p className="mt-1 text-[10px] text-white/55 leading-snug">
              Not to scale — for illustration purposes only
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-white/80 text-xs">Show survey points</Label>
            <Switch checked={showPoints} onCheckedChange={setShowPoints} />
          </div>
          <div className="text-[10px] text-white/50 leading-snug">
            Drag to orbit · scroll to zoom · drag to pan
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThreeDTab;
