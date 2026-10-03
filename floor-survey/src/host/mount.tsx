import { createRoot, type Root } from "react-dom/client";
import { DiagnosticsWorkspace } from "./DiagnosticsWorkspace";
import { HostWorkspace } from "./HostWorkspace";
import { ReportTopoWorkspace } from "./ReportTopoWorkspace";
import type { PlanCamera } from "@/components/PlanCanvas";
import type { RenderSettings } from "@/lib/types";
import { recoveryPdfMediaIdFor } from "@/lib/db";
import {
  recoveryCanvasSize,
  recoveryReadingLabel,
  renderFloorSurveyRecoveryCanvas,
  setRecoveryRendererForTests,
} from "@/lib/recovery-pdf";
import {
  composeReportTopoFigure,
  composeReportTopoFigureForPage,
  listReportTopoPageSpecs,
  reportTopoDataExtent,
  reportTopoExtentForPage,
} from "@/lib/report-topo-figure";
import "../styles.css";

export type MountOptions = {
  customerFileId: string;
  onBack: () => void;
  /** Shown only when the investigator arrived from Report Builder. */
  onReturnToReport?: () => void;
  /** survey = Floor Survey field capture. diagnostics = workbench around the
   *  existing 3D view. report-topo = the same topo view, hosted on a Report
   *  Builder slide. */
  workspace?: "survey" | "diagnostics" | "report-topo" | "report-topo-controls";
  /** report-topo only: which level and boundary the slide shows, the book's
   *  camera and settings, and the way back out. */
  canvasId?: string;
  areaId?: string | null;
  camera?: PlanCamera | null;
  settings?: Partial<RenderSettings> | null;
  locked?: boolean;
  onCameraChange?: (camera: PlanCamera) => void;
  onSettingsChange?: (settings: RenderSettings) => void;
  onReady?: (info: { levelName: string; areaCount: number }) => void;
};

let root: Root | null = null;
let hostEl: HTMLElement | null = null;

// Report Builder mounts two of these at once: the drawing on the slide and the
// controls in the rail. The original pair of module-level variables made this a
// singleton -- every mount tore down the previous one, so the slide went blank
// the moment the rail appeared. Report workspaces therefore keep their own
// root, keyed by their host element. The field and diagnostics workspaces still
// use the single root they have always used.
const reportRoots = new Map<HTMLElement, Root>();

export function mount(el: HTMLElement, options: MountOptions) {
  const isReport =
    options.workspace === "report-topo" || options.workspace === "report-topo-controls";
  // Only the field and diagnostics workspaces own the single shared root, and
  // only they get the full-height flex host: the rail's controls are a column
  // that sizes to its contents.
  if (!isReport) unmount();
  if (!isReport) hostEl = el;
  el.classList.add("floor-survey-host");
  if (!isReport || options.workspace === "report-topo") {
    el.style.height = "100%";
    el.style.minHeight = "0";
    el.style.display = "flex";
    el.style.flexDirection = "column";
  }
  if (!isReport) root = createRoot(el);
  if (options.workspace === "report-topo" || options.workspace === "report-topo-controls") {
    const own = reportRoot(el);
    // The slide and the rail are two roots looking at one set of settings,
    // which Report Builder owns. Re-rendering with new props is how a change
    // made in the rail reaches the drawing, so the mount can be updated rather
    // than only created.
    let current = options;
    const draw = () => {
      own.render(
        <ReportTopoWorkspace
          customerFileId={current.customerFileId}
          canvasId={current.canvasId || ""}
          areaId={current.areaId ?? null}
          camera={current.camera ?? null}
          settings={current.settings ?? null}
          locked={!!current.locked}
          controlsOnly={current.workspace === "report-topo-controls"}
          onCameraChange={current.onCameraChange}
          onSettingsChange={current.onSettingsChange}
          onReady={current.onReady}
        />,
      );
    };
    draw();
    return {
      unmount() {
        releaseReportRoot(el);
      },
      update(next: Partial<MountOptions>) {
        current = { ...current, ...next };
        draw();
      },
    };
  }
  root?.render(
    options.workspace === "diagnostics" ? (
      <DiagnosticsWorkspace
        customerFileId={options.customerFileId}
        onBack={options.onBack}
        onReturnToReport={options.onReturnToReport}
      />
    ) : (
      <HostWorkspace
        customerFileId={options.customerFileId}
        onBack={options.onBack}
        onReturnToReport={options.onReturnToReport}
      />
    ),
  );
  return {
    unmount,
  };
}

function reportRoot(el: HTMLElement): Root {
  const existing = reportRoots.get(el);
  if (existing) return existing;
  const next = createRoot(el);
  reportRoots.set(el, next);
  return next;
}

function releaseReportRoot(el: HTMLElement) {
  const found = reportRoots.get(el);
  if (!found) return;
  reportRoots.delete(el);
  // React forbids unmounting while it is rendering, which is exactly when a
  // slide change can ask for this.
  setTimeout(() => {
    try { found.unmount(); } catch { /* already gone */ }
  }, 0);
}

export function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
  if (hostEl) {
    hostEl.classList.remove("floor-survey-host");
    hostEl = null;
  }
}

declare global {
  interface Window {
    ToolboxFloorSurvey?: {
      mount: typeof mount;
      unmount: typeof unmount;
      renderFloorSurveyRecoveryCanvas: typeof renderFloorSurveyRecoveryCanvas;
      recoveryCanvasSize: typeof recoveryCanvasSize;
      recoveryReadingLabel: typeof recoveryReadingLabel;
      recoveryPdfMediaIdFor: typeof recoveryPdfMediaIdFor;
      setRecoveryRendererForTests: typeof setRecoveryRendererForTests;
      composeReportTopoFigure: typeof composeReportTopoFigure;
      composeReportTopoFigureForPage: typeof composeReportTopoFigureForPage;
      listReportTopoPageSpecs: typeof listReportTopoPageSpecs;
      reportTopoDataExtent: typeof reportTopoDataExtent;
      reportTopoExtentForPage: typeof reportTopoExtentForPage;
    };
    ToolboxDB?: {
      getMedia?: (id: string) => Promise<string | null>;
      [key: string]: unknown;
    };
  }
}

window.ToolboxFloorSurvey = {
  mount,
  unmount,
  renderFloorSurveyRecoveryCanvas,
  recoveryCanvasSize,
  recoveryReadingLabel,
  recoveryPdfMediaIdFor,
  setRecoveryRendererForTests,
  composeReportTopoFigure,
  composeReportTopoFigureForPage,
  listReportTopoPageSpecs,
  reportTopoDataExtent,
  reportTopoExtentForPage,
};

// Vite's IIFE assigns this module's exports onto the ToolboxFloorSurvey global
// after the window assignment above. Export the Save helpers so that overwrite
// keeps them.
export {
  renderFloorSurveyRecoveryCanvas,
  recoveryCanvasSize,
  recoveryReadingLabel,
  recoveryPdfMediaIdFor,
  setRecoveryRendererForTests,
  composeReportTopoFigure,
  composeReportTopoFigureForPage,
  listReportTopoPageSpecs,
  reportTopoDataExtent,
  reportTopoExtentForPage,
};
