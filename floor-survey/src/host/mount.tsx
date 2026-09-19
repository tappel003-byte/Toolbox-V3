import { createRoot, type Root } from "react-dom/client";
import { HostWorkspace } from "./HostWorkspace";
import "../styles.css";

export type MountOptions = {
  customerFileId: string;
  onBack: () => void;
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
    <HostWorkspace customerFileId={options.customerFileId} onBack={options.onBack} />,
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
    };
  }
}

window.ToolboxFloorSurvey = { mount, unmount };
