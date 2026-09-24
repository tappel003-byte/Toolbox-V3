/**
 * Hosted Floor Survey workspace — proven ProjectWorkspace adapted for Toolbox.
 * No TanStack route; Customer File id is the project id; onBack returns to CF home.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deletePoint,
  getProject,
  listFloors,
  listPoints,
  persistFloorSurveyRecoveryPdf,
  savePoint,
  saveFloor,
  saveProject,
  setHostCustomerFileId,
} from "@/lib/db";
import { blobToDataUrl, recoveryCanvasToPdfBlob, renderRecoveryForSave } from "@/lib/recovery-pdf";
import type { Floor, ProjectMeta, RenderSettings, SurveyPoint } from "@/lib/types";
import { defaultRenderSettings } from "@/lib/types";
import { SetupTab } from "@/components/tabs/SetupTab";
import { FieldTab } from "@/components/tabs/FieldTab";
import { ReviewTab } from "@/components/tabs/ReviewTab";
import { TopoTab } from "@/components/tabs/TopoTab";
import { AppTopBar } from "@/components/chrome/AppTopBar";
import { ModeToggle } from "@/components/chrome/ModeToggle";
import { DataPointsPanel } from "@/components/DataPointsPanel";
import { StatsChip } from "@/components/chrome/StatsChip";
import { AveragedCorrectionsChip } from "@/components/chrome/AveragedCorrectionsChip";
import { TransitionsSheet } from "@/components/TransitionsSheet";
import { useFloorHistory, useUndoRedoEvents, type FloorSnapshot } from "@/lib/useFloorHistory";
import { withCorrectedValues, migrateSurfaceName, transitionGroupKey } from "@/lib/transitions";
import { computeExclusionMap } from "@/lib/exclusions";
import { closedAreas, getAreas, pointsInAnyArea } from "@/lib/areas";

type Mode = "setup" | "field" | "review" | "topo";

export type HostWorkspaceProps = {
  customerFileId: string;
  onBack: () => void;
};

export function HostWorkspace({ customerFileId, onBack }: HostWorkspaceProps) {
  const id = customerFileId;
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [mode, setMode] = useState<Mode>("field");
  const [settings, setSettings] = useState<RenderSettings>(defaultRenderSettings);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [topoHighlightIds, setTopoHighlightIds] = useState<Set<string>>(new Set());
  const [topoExcludedIds, setTopoExcludedIds] = useState<Set<string>>(new Set());
  const [topoAreaId, setTopoAreaId] = useState<string | null>(null);
  useEffect(() => {
    setTopoExcludedIds(new Set());
    setTopoAreaId(null);
  }, [activeFloorId]);
  useEffect(() => {
    if (mode !== "topo") setTopoExcludedIds(new Set());
  }, [mode]);
  const [focusRequest, setFocusRequest] = useState<
    { x: number; y: number; nonce: number } | undefined
  >(undefined);
  const [pointSize, setPointSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(`dpp-size:${id}`);
      const n = raw ? Number(raw) : 2;
      return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 2;
    } catch {
      return 2;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`dpp-size:${id}`, String(pointSize));
    } catch {
      /* ignore */
    }
  }, [pointSize, id]);
  const [pointColor, setPointColor] = useState<string>(() => {
    try {
      return localStorage.getItem(`dpp-color:${id}`) || "#dc2626";
    } catch {
      return "#dc2626";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`dpp-color:${id}`, pointColor);
    } catch {
      /* ignore */
    }
  }, [pointColor, id]);

  useEffect(() => {
    setHostCustomerFileId(id);
    (async () => {
      try {
        const p = await getProject(id);
        if (!p) {
          setMissing(true);
          setLoading(false);
          return;
        }
        setProject(p);
        const fs = await listFloors(id);
        const migrated = fs.map((f) => {
          let changed = false;
          let nextAreas = f.areas;
          if (nextAreas?.length) {
            const renamed = nextAreas.map((a) =>
              /^Area \d+$/.test(a.name)
                ? { ...a, name: a.name.replace(/^Area /, "Boundary ") }
                : a,
            );
            if (renamed.some((a, i) => a !== nextAreas![i])) {
              changed = true;
              nextAreas = renamed;
            }
          }
          if (!f.transitions?.length) {
            if (!changed) return f;
            const nf = { ...f, areas: nextAreas };
            void saveFloor(nf);
            return nf;
          }
          let nextT = f.transitions.map((t) => {
            const a2 = migrateSurfaceName(t.surfaceA);
            const b2 = migrateSurfaceName(t.surfaceB);
            if (a2 !== t.surfaceA || b2 !== t.surfaceB) {
              changed = true;
              return { ...t, surfaceA: a2, surfaceB: b2 };
            }
            return t;
          });
          let nextAvgs = f.transitionGroupAverages;
          if (nextAvgs && Object.keys(nextAvgs).length) {
            const rekeyed: Record<string, number> = {};
            for (const t of nextT) {
              const legacyPairKey = `${t.surfaceA}→${t.surfaceB}`;
              const v = nextAvgs[transitionGroupKey(t)] ?? nextAvgs[legacyPairKey];
              if (v !== undefined) rekeyed[transitionGroupKey(t)] = v;
            }
            const oldKeys = Object.keys(nextAvgs).sort().join("|");
            const newKeys = Object.keys(rekeyed).sort().join("|");
            if (oldKeys !== newKeys) {
              changed = true;
              nextAvgs = Object.keys(rekeyed).length ? rekeyed : undefined;
            }
          }
          if (nextAvgs) {
            const avgs = nextAvgs;
            nextT = nextT.map((t) => {
              const hasAvg = avgs[transitionGroupKey(t)] !== undefined;
              if (hasAvg && t.useGroupAverage === undefined) {
                changed = true;
                return { ...t, useGroupAverage: true };
              }
              return t;
            });
          }
          if (!changed) return f;
          const nf = { ...f, areas: nextAreas, transitions: nextT, transitionGroupAverages: nextAvgs };
          void saveFloor(nf);
          return nf;
        });
        setFloors(migrated);
        if (migrated[0]) setActiveFloorId(migrated[0].id);
        // CF supplies the plan. Equivalent proven point after Plan step:
        // Setup → Topo boundary, ready to draw. If a closed boundary already
        // exists (returning to an in-progress survey), open Field like proven.
        const hasPlan = migrated.some((f) => !!f.planDataUrl);
        const hasClosedBoundary = migrated.some((f) =>
          getAreas(f).some((a) => a.polygon.length >= 3),
        );
        if (!hasPlan || !hasClosedBoundary) setMode("setup");
        else setMode("field");
        setLoading(false);
      } catch (err) {
        console.error(err);
        setMissing(true);
        setLoading(false);
      }
    })();
    return () => setHostCustomerFileId(null);
  }, [id]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? null,
    [floors, activeFloorId],
  );

  const history = useFloorHistory(activeFloorId);

  useEffect(() => {
    if (!activeFloor) return;
    (async () => {
      const pts = await listPoints(activeFloor.id);
      setPoints(pts);
      history.seed({ points: pts });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloor?.id]);

  const applySnapshot = useCallback(
    async (snap: FloorSnapshot) => {
      if (!activeFloor) return;
      const nextIds = new Set(snap.points.map((p) => p.id));
      for (const p of points) {
        if (!nextIds.has(p.id)) await deletePoint(p.id);
      }
      for (const p of snap.points) await savePoint(p);
      setPoints(snap.points);
    },
    [activeFloor, points],
  );

  const undoActive = mode === "field" || mode === "review" || mode === "topo";
  const onUndo = useCallback(() => {
    if (!undoActive) return;
    const snap = history.undo();
    if (snap) void applySnapshot(snap);
  }, [undoActive, history, applySnapshot]);
  const onRedo = useCallback(() => {
    if (!undoActive) return;
    const snap = history.redo();
    if (snap) void applySnapshot(snap);
  }, [undoActive, history, applySnapshot]);
  useUndoRedoEvents(onUndo, onRedo);

  const correctedPoints = useMemo(
    () =>
      withCorrectedValues(
        points,
        activeFloor?.transitions,
        activeFloor?.transitionGroupAverages,
      ),
    [points, activeFloor?.transitions, activeFloor?.transitionGroupAverages],
  );

  const exclusionMap = useMemo(
    () => computeExclusionMap(correctedPoints, activeFloor?.exclusions),
    [correctedPoints, activeFloor?.exclusions],
  );
  const nonExcludedPoints = useMemo(
    () => correctedPoints.filter((p) => !exclusionMap.has(p.id)),
    [correctedPoints, exclusionMap],
  );
  const floorAreas = useMemo(
    () => (activeFloor ? closedAreas(activeFloor) : []),
    [activeFloor],
  );
  const statsPoints = useMemo(
    () => pointsInAnyArea(nonExcludedPoints, floorAreas),
    [nonExcludedPoints, floorAreas],
  );

  const [transitionsSheetOpen, setTransitionsSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<"ok" | "err" | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveLock = useRef(false);
  const showSaveStatus = useCallback((text: string, tone: "ok" | "err") => {
    setSaveStatus(text);
    setSaveTone(tone);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveStatus(null);
      setSaveTone(null);
    }, 3200);
  }, []);
  const handleSave = useCallback(async () => {
    if (saveLock.current || !activeFloor) return;
    saveLock.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaving(true);
    setSaveStatus(null);
    setSaveTone(null);
    try {
      await saveFloor(activeFloor);
      for (const point of points) await savePoint(point);
    } catch (err) {
      console.error(err);
      showSaveStatus("Save failed", "err");
      setSaving(false);
      saveLock.current = false;
      return;
    }
    try {
      const canvas = await renderRecoveryForSave({
        floor: activeFloor,
        points,
        viewport: null,
      });
      const dataUrl = await blobToDataUrl(recoveryCanvasToPdfBlob(canvas));
      await persistFloorSurveyRecoveryPdf(activeFloor.id, dataUrl);
    } catch (err) {
      console.error(err);
      showSaveStatus("Survey saved · Recovery PDF not updated", "err");
      setSaving(false);
      saveLock.current = false;
      return;
    }
    showSaveStatus("Saved · Recovery PDF updated.", "ok");
    setSaving(false);
    saveLock.current = false;
  }, [activeFloor, points, showSaveStatus]);
  const handleFloorChange = useCallback((f: Floor) => {
    setFloors((prev) => prev.map((p) => (p.id === f.id ? f : p)));
  }, []);
  const handleFloorAveragesChange = useCallback(
    async (f: Floor) => {
      await saveFloor(f);
      handleFloorChange(f);
    },
    [handleFloorChange],
  );

  const handleAddCustomSurface = useCallback(async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setProject((prev) => {
      if (!prev) return prev;
      const existing = prev.customSurfaces ?? [];
      if (existing.some((s) => s.toLowerCase() === clean.toLowerCase())) return prev;
      const next = { ...prev, customSurfaces: [...existing, clean] };
      void saveProject(next);
      return next;
    });
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading Floor Survey…</div>;
  }
  if (missing || !project) {
    return (
      <div className="p-6">
        <p className="text-sm mb-3">Customer File not found.</p>
        <button type="button" className="text-primary underline" onClick={onBack}>
          Back to Customer File
        </button>
      </div>
    );
  }
  if (!activeFloor) {
    return (
      <div className="p-6 text-sm">
        No floor plans on this Customer File yet. Edit the Customer File to add a plan, then return
        here.
        <div className="mt-3">
          <button type="button" className="text-primary underline" onClick={onBack}>
            Back to Customer File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppTopBar
        projectName={project.name}
        floorName={activeFloor.name}
        onBack={onBack}
        onOpenSetup={() => setMode("setup")}
        onOpenReview={() => setMode("review")}
        onOpenTransitions={() => setTransitionsSheetOpen(true)}
        undoEnabled={undoActive && history.canUndo}
        redoEnabled={undoActive && history.canRedo}
        onSave={handleSave}
        saving={saving}
        saveStatus={saveStatus}
        saveTone={saveTone}
      />

      {floors.length > 1 && (
        <div
          data-floor-selector
          className="flex items-center gap-2 px-2 h-7 text-xs border-b bg-background/70"
        >
          <span className="text-muted-foreground">Floor</span>
          <select
            value={activeFloor.id}
            onChange={(e) => setActiveFloorId(e.target.value)}
            className="rounded border px-1.5 py-0.5 text-xs bg-background max-w-[10rem] truncate"
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-hidden relative">
        {mode === "setup" && (
          <SetupTab
            project={project}
            floors={floors}
            activeFloor={activeFloor}
            onProjectChange={setProject}
            onFloorsChange={(fs) => {
              setFloors(fs);
              if (!fs.find((f) => f.id === activeFloorId)) setActiveFloorId(fs[0]?.id ?? null);
            }}
            onActiveFloorChange={setActiveFloorId}
            onStartSurveying={() => setMode("field")}
            initialTab={activeFloor.planDataUrl ? "areas" : "details"}
            planLocked
          />
        )}
        {mode === "field" && (
          <FieldTab
            projectId={project.id}
            customSurfaces={project.customSurfaces}
            onAddCustomSurface={handleAddCustomSurface}
            floor={activeFloor}
            points={points}
            onPointsChange={setPoints}
            onFloorChange={(f) => setFloors((prev) => prev.map((p) => (p.id === f.id ? f : p)))}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            pointSize={pointSize}
            pointColor={pointColor}
            labelFontSize={settings.pointLabelFontSize}
            focusRequest={focusRequest}
            onCommit={(snap) => history.commit(snap)}
          />
        )}
        {mode === "review" && (
          <ReviewTab
            floor={activeFloor}
            points={points}
            correctedById={new Map(correctedPoints.map((p) => [p.id, p.value]))}
            zoneLabelById={
              new Map(
                Array.from(exclusionMap.entries()).map(([id, z]) => [id, z.label ?? ""]),
              )
            }
            onPointsChange={setPoints}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onClose={() => setMode("field")}
            onCommit={(pts) => history.commit({ points: pts })}
          />
        )}
        {mode === "topo" && (
          <TopoTab
            floor={activeFloor}
            points={correctedPoints}
            onPointsChange={setPoints}
            onFloorChange={(f) => setFloors((prev) => prev.map((p) => (p.id === f.id ? f : p)))}
            settings={settings}
            onSettingsChange={setSettings}
            pointSize={pointSize}
            pointColor={pointColor}
            selectedIds={topoHighlightIds}
            excludedIds={topoExcludedIds}
            onExcludedIdsChange={setTopoExcludedIds}
            selectedAreaId={topoAreaId}
            onSelectedAreaIdChange={setTopoAreaId}
            onHighlight={(p) => setTopoHighlightIds(new Set([p.id]))}
          />
        )}
      </main>

      {(mode === "field" || mode === "topo") && (
        <>
          <ModeToggle
            mode={mode === "topo" ? "topo" : "data"}
            onChange={(m) => setMode(m === "topo" ? "topo" : "field")}
          />
          {mode === "field" && (
            <StatsChip
              storageKey={`stats-chip-pos:${activeFloor.id}:solo`}
              points={statsPoints}
              onHighlight={(p) => {
                setSelectedIds(new Set([p.id]));
                setFocusRequest({ x: p.x, y: p.y, nonce: Date.now() });
              }}
            />
          )}
        </>
      )}
      {mode === "field" && (
        <DataPointsPanel
          hasFloorSelector={floors.length > 1}
          projectId={project.id}
          points={points}
          correctedById={new Map(correctedPoints.map((p) => [p.id, p.value]))}
          floor={activeFloor}
          selectedIds={selectedIds}
          pointSize={pointSize}
          onPointSizeChange={setPointSize}
          pointColor={pointColor}
          onPointColorChange={setPointColor}
          labelFontSize={settings.pointLabelFontSize}
          onLabelFontSizeChange={(n) => setSettings((s) => ({ ...s, pointLabelFontSize: n }))}
          onPointsChange={setPoints}
          onCommit={(pts) => history.commit({ points: pts })}
          onSelect={(pid, additive) => {
            if (additive) {
              const next = new Set(selectedIds);
              if (next.has(pid)) next.delete(pid);
              else next.add(pid);
              setSelectedIds(next);
            } else {
              setSelectedIds(new Set([pid]));
              const p = points.find((pt) => pt.id === pid);
              if (p) setFocusRequest({ x: p.x, y: p.y, nonce: Date.now() });
            }
          }}
        />
      )}

      {(mode === "field" || mode === "topo") && (
        <AveragedCorrectionsChip
          floor={activeFloor}
          storageKey={`avg-chip:${activeFloor.id}:${mode}`}
          onManage={() => setTransitionsSheetOpen(true)}
        />
      )}
      <TransitionsSheet
        open={transitionsSheetOpen}
        floor={activeFloor}
        points={points}
        onClose={() => setTransitionsSheetOpen(false)}
        onFloorChange={handleFloorAveragesChange}
      />
    </div>
  );
}
