/**
 * Diagnostics hosts the existing Floor Survey 3D view.
 * Read-only: opening it does not write Floor Survey or Diagnostics records.
 * The current 3D appearance is the donor engine, not a finished Diagnostics design.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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

export function DiagnosticsWorkspace({ customerFileId, onBack }: DiagnosticsWorkspaceProps) {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

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

  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[60] bg-neutral-950 text-white/60 flex items-center justify-center text-sm">
          Loading 3D…
        </div>
      }
    >
      <ThreeDTab
        floor={activeFloor}
        points={correctedPoints}
        settings={defaultRenderSettings}
        onClose={onBack}
        levels={levels}
        onLevelChange={setActiveFloorId}
      />
    </Suspense>
  );
}
