import { createRoot, type Root } from "react-dom/client";
import { DiagnosticsWorkspace } from "./DiagnosticsWorkspace";
import { HostWorkspace } from "./HostWorkspace";
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
} from "@/lib/report-topo-figure";
import "../styles.css";

export type MountOptions = {
  customerFileId: string;
  onBack: () => void;
  /** Shown only when the investigator arrived from Report Builder. */
  onReturnToReport?: () => void;
  /** survey = Floor Survey field capture. diagnostics = workbench around the existing 3D view. */
  workspace?: "survey" | "diagnostics";
};

let root: Root | null = null;
let hostEl: HTMLElement | null = null;

export function mount(el: HTMLElement, options: MountOptions) {
  unmount();
  hostEl = el;
  el.classList.add("floor-survey-host");
  el.style.height = "100%";
  el.style.minHeight = "0";
  el.style.display = "flex";
  el.style.flexDirection = "column";
  root = createRoot(el);
  root.render(
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
};
