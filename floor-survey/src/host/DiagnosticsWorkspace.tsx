/**
 * Diagnostics workbench around the existing Floor Survey 3D view.
 * The mesh, camera, and in-view controls stay in ThreeDTab.
 * Opening this workspace does not write Floor Survey or Diagnostics records.
 * Add to Report is the only write, and it stores a figure for Report Builder.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getProject, listFloors, listPoints, setHostCustomerFileId } from "@/lib/db";
import type { Floor, SurveyPoint } from "@/lib/types";
import { defaultRenderSettings } from "@/lib/types";
import { withCorrectedValues } from "@/lib/transitions";

const ThreeDTab = lazy(() =>
  import("@/components/ThreeDTab").then((m) => ({ default: m.ThreeDTab })),
);

export type DiagnosticsWorkspaceProps = {
  customerFileId: string;
  onBack: () => void;
};

type CaptureApi = {
  addFigure: (input: {
    customerFileId: string;
    canvasId: string;
    canvasName: string;
    dataUrl: string;
  }) => Promise<{ figure?: { id?: string } }>;
};

const PLACEHOLDERS: Array<{ group: string; id: string; label: string }> = [
  { group: "View", id: "plan", label: "Plan" },
  { group: "View", id: "section", label: "Section" },
  { group: "Imaging", id: "levels", label: "Levels" },
  { group: "Imaging", id: "palette", label: "Palette" },
  { group: "Plots", id: "profile", label: "Profile" },
  { group: "Epochs", id: "compare", label: "Compare" },
];

const WORKBENCH_CSS = `
.dx-workbench {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: #0b0b0b;
  color: #f4f0e8;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.dx-ribbon {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 52px;
  background: #161616;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  flex-wrap: wrap;
  overflow: hidden;
}
.dx-ribbon__back {
  z-index: 2;
  flex: 0 0 auto;
  align-self: stretch;
  margin: 0;
  border: 0;
  border-right: 1px solid rgba(255,255,255,0.14);
  background: #161616;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
}
.dx-ribbon__group {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 4px 10px 5px;
  border-right: 1px solid rgba(255,255,255,0.12);
}
.dx-ribbon__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.46);
}
.dx-ribbon__tools {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dx-ribbon__btn {
  min-height: 28px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.06);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}
.dx-ribbon__btn[aria-pressed="true"] {
  background: #f4f0e8;
  border-color: #f4f0e8;
  color: #111;
}
.dx-ribbon__btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.dx-ribbon__btn--capture:not(:disabled) {
  background: #c65332;
  border-color: #c65332;
  color: #fff;
}
.dx-status {
  flex: 0 0 auto;
  margin: 0;
  padding: 4px 12px 5px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(255,255,255,0.72);
  background: #111;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.dx-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dx-stage > * {
  flex: 1 1 auto;
  min-height: 0;
}
.dx-stage-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.6);
  font-size: 13px;
}
`;

function captureApi(): CaptureApi | null {
  const api = (window as unknown as { ToolboxDiagnostics?: CaptureApi }).ToolboxDiagnostics;
  if (!api || typeof api.addFigure !== "function") return null;
  return api;
}

function readCanvasPng(stage: HTMLElement | null): { dataUrl: string } | { error: string } {
  if (!stage) return { error: "The 3D view is not ready to capture." };
  const text = stage.innerText || "";
  if (/could not start/i.test(text)) return { error: "3D view could not start on this device." };
  if (/Need at least 3 survey points|Boundary is missing|Building surface/i.test(text)) {
    return { error: "The 3D view is not ready to capture." };
  }
  const canvas = stage.querySelector("canvas");
  if (!canvas || canvas.width < 2 || canvas.height < 2) {
    return { error: "The 3D view is not ready to capture." };
  }
  try {
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl || dataUrl.indexOf("data:image/png") !== 0) {
      return { error: "This view could not be captured." };
    }
    return { dataUrl };
  } catch (err) {
    console.error(err);
    return { error: "This view could not be captured." };
  }
}

function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="dx-ribbon__group" role="group" aria-label={label}>
      <span className="dx-ribbon__label">{label}</span>
      <div className="dx-ribbon__tools">{children}</div>
    </div>
  );
}

export function DiagnosticsWorkspace({ customerFileId, onBack }: DiagnosticsWorkspaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(
    "3D elevation is the current view. Other tools are not available yet.",
  );

  useEffect(() => {
    setHostCustomerFileId(customerFileId);
    let cancelled = false;
    (async () => {
      try {
        const project = await getProject(customerFileId);
        if (!project) {
          if (!cancelled) {
            setMissing(true);
            setLoading(false);
          }
          return;
        }
        const nextFloors = await listFloors(customerFileId);
        if (cancelled) return;
        setFloors(nextFloors);
        setActiveFloorId(nextFloors[0]?.id ?? null);
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setMissing(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      setHostCustomerFileId(null);
    };
  }, [customerFileId]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? null,
    [floors, activeFloorId],
  );

  useEffect(() => {
    if (!activeFloor) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    setPoints([]);
    (async () => {
      const pts = await listPoints(activeFloor.id);
      if (!cancelled) setPoints(pts);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFloor]);

  const correctedPoints = useMemo(
    () =>
      withCorrectedValues(
        points,
        activeFloor?.transitions,
        activeFloor?.transitionGroupAverages,
      ),
    [points, activeFloor?.transitions, activeFloor?.transitionGroupAverages],
  );

  const levels = useMemo(
    () => floors.map((floor) => ({ id: floor.id, name: floor.name })),
    [floors],
  );

  useEffect(() => {
    if (!activeFloor) {
      setCanCapture(false);
      return;
    }
    const tick = () => {
      const shot = readCanvasPng(stageRef.current);
      setCanCapture("dataUrl" in shot);
    };
    tick();
    const timer = window.setInterval(tick, 400);
    return () => window.clearInterval(timer);
  }, [activeFloor]);

  async function addToReport() {
    if (saving || !activeFloor) return;
    const shot = readCanvasPng(stageRef.current);
    if (!("dataUrl" in shot)) {
      setStatus(shot.error);
      setCanCapture(false);
      return;
    }
    const api = captureApi();
    if (!api) {
      setStatus("Add to Report is not available in this session.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.addFigure({
        customerFileId,
        canvasId: activeFloor.id,
        canvasName: activeFloor.name,
        dataUrl: shot.dataUrl,
      });
      const id = saved && saved.figure && saved.figure.id ? saved.figure.id : "this view";
      setStatus(
        "Added to Report (" +
          id +
          "). Reserved figure space on a Diagnostics sheet. No conclusion was written.",
      );
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "";
      setStatus(message || "Add to Report did not save. Floor Survey was not changed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] bg-neutral-950 text-white/60 flex items-center justify-center text-sm">
        Loading 3D…
      </div>
    );
  }
  if (missing) {
    return (
      <div className="p-6 text-sm">
        <p className="mb-3">Customer File not found.</p>
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

  const placeholders = (group: string) =>
    PLACEHOLDERS.filter((item) => item.group === group).map((item) => (
      <button
        key={item.id}
        type="button"
        className="dx-ribbon__btn"
        disabled
        data-diagnostics-placeholder={item.id}
        title="Not available yet"
      >
        {item.label}
      </button>
    ));

  return (
    <div className="dx-workbench" data-diagnostics-workbench>
      <style>{WORKBENCH_CSS}</style>
      <div className="dx-ribbon" role="toolbar" aria-label="Diagnostics tools" data-diagnostics-ribbon>
        <button
          type="button"
          className="dx-ribbon__back"
          data-diagnostics-back
          onClick={onBack}
        >
          ‹ Customer File
        </button>
        <RibbonGroup label="View">
          <button
            type="button"
            className="dx-ribbon__btn"
            data-diagnostics-view="3d"
            aria-pressed="true"
            title="Current view"
          >
            3D
          </button>
          {placeholders("View")}
        </RibbonGroup>
        <RibbonGroup label="Capture">
          <button
            type="button"
            className="dx-ribbon__btn dx-ribbon__btn--capture"
            data-diagnostics-add-report
            disabled={!canCapture || saving}
            title={
              canCapture
                ? "Store this 3D view for Report Builder. Does not write a conclusion."
                : "The 3D view is not ready to capture."
            }
            onClick={addToReport}
          >
            {saving ? "Adding…" : "Add to Report"}
          </button>
        </RibbonGroup>
        <RibbonGroup label="Imaging">{placeholders("Imaging")}</RibbonGroup>
        <RibbonGroup label="Plots">{placeholders("Plots")}</RibbonGroup>
        <RibbonGroup label="Epochs">{placeholders("Epochs")}</RibbonGroup>
      </div>
      <p className="dx-status" data-diagnostics-status aria-live="polite">
        {status}
      </p>
      <div className="dx-stage" ref={stageRef}>
        <Suspense
          fallback={<div className="dx-stage-fallback">Loading 3D…</div>}
        >
          <ThreeDTab
            frame="fill"
            floor={activeFloor}
            points={correctedPoints}
            settings={defaultRenderSettings}
            onClose={onBack}
            levels={levels}
            onLevelChange={setActiveFloorId}
          />
        </Suspense>
      </div>
    </div>
  );
}
