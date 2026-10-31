/**
 * The investigator's reading dot size and colour.
 *
 * Capture: chosen in Floor Survey and saved per Customer File on this device
 * (`dpp-size` / capture-sizes). Use readCapturePointStyle for field work.
 *
 * Report: sheet defaults only — never read capture localStorage, or a field
 * adjustment rewrites the deliverable and the print.
 *
 * TopoTab's own fallback is 6; the field default is 2. Always pass an explicit
 * size into report/composer paths.
 */
export const DEFAULT_POINT_SIZE = 2;
export const DEFAULT_POINT_COLOR = "#dc2626";

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

/** Report / print / compose — sheet defaults, never capture prefs. */
export function reportPointStyle(): {
  pointSize: number;
  pointColor: string;
} {
  return { pointSize: DEFAULT_POINT_SIZE, pointColor: DEFAULT_POINT_COLOR };
}

/** @deprecated Use readCapturePointStyle or reportPointStyle. */
export function readPointStyle(customerFileId: string | undefined | null): {
  pointSize: number;
  pointColor: string;
} {
  return readCapturePointStyle(customerFileId);
}
