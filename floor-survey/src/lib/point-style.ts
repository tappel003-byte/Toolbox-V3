/**
 * The investigator's reading dot size and colour.
 *
 * Capture: chosen in Floor Survey (Data entry front door, Control panel →
 * Readings → Accessories back door) and saved per Customer File on this device
 * (`dpp-size` / capture-sizes). Use readCapturePointStyle for field work.
 *
 * Report: sheet defaults on RenderSettings.readingPointSize / readingPointColor
 * — never read capture localStorage, or a field adjustment rewrites the
 * deliverable and the print. Report Builder Accessories is the door into those
 * report-owned values.
 *
 * TopoTab's own fallback is 6; the field default is 2. Always pass an explicit
 * size into report/composer paths.
 */
export const DEFAULT_POINT_SIZE = 2;
export const DEFAULT_POINT_COLOR = "#dc2626";
export const POINT_SIZE_MIN = 1;
export const POINT_SIZE_MAX = 8;

/** Same swatches as Data entry — both doors share one palette. */
export const POINT_COLOR_PRESETS = [
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#111827",
] as const;

export function clampPointSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_POINT_SIZE;
  return Math.max(POINT_SIZE_MIN, Math.min(POINT_SIZE_MAX, Math.round(n)));
}

/** Capture-only. Do not call from Report Builder or print/compose. */
export function readCapturePointStyle(customerFileId: string | undefined | null): {
  pointSize: number;
  pointColor: string;
} {
  let pointSize = DEFAULT_POINT_SIZE;
  let pointColor = DEFAULT_POINT_COLOR;
  if (!customerFileId) return { pointSize, pointColor };
  try {
    const raw = localStorage.getItem(`dpp-size:${customerFileId}`);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 8) pointSize = n;
    pointColor = localStorage.getItem(`dpp-color:${customerFileId}`) || pointColor;
  } catch {
    /* storage unavailable — the defaults are the field app's own */
  }
  return { pointSize, pointColor };
}

/**
 * Report / print / compose — from report settings when present, else sheet
 * defaults. Never capture prefs.
 */
export function reportPointStyle(from?: {
  readingPointSize?: number;
  readingPointColor?: string;
} | null): {
  pointSize: number;
  pointColor: string;
} {
  return {
    pointSize:
      from?.readingPointSize != null
        ? clampPointSize(from.readingPointSize)
        : DEFAULT_POINT_SIZE,
    pointColor:
      typeof from?.readingPointColor === "string" && from.readingPointColor
        ? from.readingPointColor
        : DEFAULT_POINT_COLOR,
  };
}

/** @deprecated Use readCapturePointStyle or reportPointStyle. */
export function readPointStyle(customerFileId: string | undefined | null): {
  pointSize: number;
  pointColor: string;
} {
  return readCapturePointStyle(customerFileId);
}
