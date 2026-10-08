/**
 * The Floor Survey topo view, hosted on a Report Builder slide.
 *
 * This is deliberately thin. It loads the level and its readings and hands them
 * to the real TopoTab -- the same component, the same canvas, the same drawing
 * code that produces the view in Floor Survey. Report Builder does not compose
 * a picture of a topo; it shows the topo.
 *
 * What it adds is only what a slide needs:
 *
 *  - the camera. The investigator scrolls and drags to frame the building, and
 *    that view is reported out so Report Builder can store it. A stored camera
 *    is put back on every other level's slide, so the plan sits in exactly the
 *    same place on every page. The camera is expressed against fit rather than
 *    in pixels, so the framing holds from this sheet to a 17 x 11 in page.
 *
 *  - the settings. Floor Survey keeps render settings in component state and
 *    never persists them, so nothing set there survives leaving the workspace.
 *    On a slide they belong to the report, so they are passed in and reported
 *    out, and Report Builder keeps them.
 *
 *  - the pill on a one-boundary level. Everything else about the chrome is
 *    Floor Survey's: the colour scale, the H/L/delta pill and the red and blue
 *    High and Low markers are drawn by TopoTab, dragged on the canvas the way
 *    they are in the field, and sized from the same rail controls. They were
 *    briefly rebuilt as placed boxes on the page; that was a reimplementation
 *    of code that already existed, and it is gone. The one thing the field
 *    app does differently is a lone surface, which it hands to the floating
 *    StatsChip -- that pill is positioned against the browser window and has
 *    nowhere to live on a page, so a slide asks for the canvas pill instead.
 *
 * Geometry still belongs to Floor Survey. Nothing here changes readings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listFloors, listPoints, saveFloor, setHostCustomerFileId } from "@/lib/db";
import { readPointStyle } from "@/lib/point-style";
import type { Floor, RenderSettings, SurveyPoint } from "@/lib/types";
import { defaultRenderSettings } from "@/lib/types";
import { withCorrectedValues } from "@/lib/transitions";
import { TopoTab } from "@/components/tabs/TopoTab";
import type { PlanCamera } from "@/components/PlanCanvas";

export type ReportTopoWorkspaceProps = {
  customerFileId: string;
  /** Which level this slide shows. */
  canvasId: string;
  /** null = Combined (every closed boundary). */
  areaId?: string | null;
  /** The book's camera, if one has been locked. */
  camera?: PlanCamera | null;
  /** The book's render settings, if any have been set. */
  settings?: Partial<RenderSettings> | null;
  /** Locked slides are shown, not steered. */
  locked?: boolean;
  /** The rail: the controls, stacked, with no canvas. */
  controlsOnly?: boolean;
  onCameraChange?: (camera: PlanCamera) => void;
  onSettingsChange?: (settings: RenderSettings) => void;
  onReady?: (info: {
    levelName: string;
    areaCount: number;
    /** The plan image's own proportion, so the slide can give the frame the
     *  same shape and the drawing fills it instead of sitting in white. */
    planWidth: number;
    planHeight: number;
  }) => void;
};

const EMPTY_POINTS: SurveyPoint[] = [];

export function ReportTopoWorkspace({
  customerFileId,
  canvasId,
  areaId = null,
  camera = null,
  settings: settingsProp = null,
  locked = false,
  controlsOnly = false,
  onCameraChange,
  onSettingsChange,
  onReady,
}: ReportTopoWorkspaceProps) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [points, setPoints] = useState<SurveyPoint[]>(EMPTY_POINTS);
  const [settings, setSettings] = useState<RenderSettings>({
    ...defaultRenderSettings,
    ...(settingsProp || {}),
  });
  const [loading, setLoading] = useState(true);

  // The investigator's own dot size and colour, saved per Customer File. Read
  // through the shared helper so the slide, the figure composer and the field
  // export cannot drift apart -- they did, and a composed figure drew readings
  // three times the size of the slide it came from.
  const { pointSize, pointColor } = useMemo(
    () => readPointStyle(customerFileId),
    [customerFileId],
  );

  // A camera arriving from the report is applied once per change. The nonce is
  // what tells the canvas to take it, and it must not fire on every render or
  // the investigator could never pan away from the locked view.
  const [cameraRequest, setCameraRequest] = useState<(PlanCamera & { nonce: number }) | null>(null);
  const cameraKeyRef = useRef<string>("");
  useEffect(() => {
    if (!camera) return;
    const key = `${camera.cx}:${camera.cy}:${camera.zoom}`;
    if (cameraKeyRef.current === key) return;
    cameraKeyRef.current = key;
    setCameraRequest({ ...camera, nonce: Date.now() });
  }, [camera]);

  useEffect(() => {
    let cancelled = false;
    setHostCustomerFileId(customerFileId);
    (async () => {
      setLoading(true);
      const floors = await listFloors(customerFileId);
      if (cancelled) return;
      const match = floors.find((f) => f.id === canvasId) || null;
      setFloor(match);
      if (match) {
        const pts = await listPoints(match.id);
        if (cancelled) return;
        setPoints(pts);
        onReady?.({
          levelName: match.name || "",
          areaCount: Array.isArray(match.areas) ? match.areas.length : 0,
          planWidth: match.planWidth || 1000,
          planHeight: match.planHeight || 750,
        });
      } else {
        setPoints(EMPTY_POINTS);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerFileId, canvasId]);

  // Settings handed down replace what is held here, so Lock on one slide is
  // what every other slide opens with.
  useEffect(() => {
    if (!settingsProp) return;
    setSettings((prev) => ({ ...prev, ...settingsProp }));
  }, [settingsProp]);

  const corrected = useMemo(
    () => withCorrectedValues(points, floor?.transitions, floor?.transitionGroupAverages),
    [points, floor?.transitions, floor?.transitionGroupAverages],
  );

  const handleSettings = useCallback(
    (next: RenderSettings) => {
      setSettings(next);
      onSettingsChange?.(next);
    },
    [onSettingsChange],
  );

  const handleCamera = useCallback(
    (next: PlanCamera) => {
      onCameraChange?.(next);
    },
    [onCameraChange],
  );

  // Where the colour scale, the pill and the High/Low markers sit is kept on
  // the level itself -- area.legendDx/legendDy, area.pillDx/pillDy and the
  // floor's highPinDx/lowPinDx. That is Floor Survey's own storage, and the
  // drag handlers in TopoTab report a moved piece by handing back a changed
  // level. This was stubbed out, so a drag on a slide rendered while the
  // pointer was down and snapped back on release: drawn, but not movable.
  // Saving it puts the piece where it was dropped, on this slide and in the
  // field app, because there is one placement per boundary, not two.
  const handleFloor = useCallback((next: Floor) => {
    setFloor(next);
    void saveFloor(next);
  }, []);

  if (loading) {
    return <div className="rtw-note">Loading the Floor Survey level…</div>;
  }
  if (!floor) {
    return <div className="rtw-note">That level is not in this Customer File.</div>;
  }

  return (
    <div className={"rtw-root" + (locked ? " rtw-root--locked" : "") + (controlsOnly ? " rtw-root--controls" : "")}>
      <TopoTab
        floor={floor}
        points={corrected}
        // Readings are Floor Survey's. A slide shows them; it does not edit
        // them, so this is deliberately inert. Where the chrome sits is not a
        // reading, so that one is live.
        onPointsChange={() => {}}
        onFloorChange={handleFloor}
        settings={settings}
        onSettingsChange={handleSettings}
        pointSize={pointSize}
        pointColor={pointColor}
        selectedAreaId={areaId}
        onSelectedAreaIdChange={() => {}}
        onCamera={handleCamera}
        cameraRequest={cameraRequest}
        statsPillForSingleBoundary
        presentation
        locked={locked}
        settingsOwnedByHost
        chromeless
        controlsOnly={controlsOnly}
        resizeCorners={!controlsOnly}
      />
    </div>
  );
}
