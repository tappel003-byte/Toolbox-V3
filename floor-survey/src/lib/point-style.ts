/**
 * The investigator's reading dot size and colour.
 *
 * These are chosen in Floor Survey and saved per Customer File. Every renderer
 * that draws readings has to ask for them the same way, because the fallback
 * built into TopoTab is 6 while the field app's own default is 2 -- so any
 * renderer that forgets to pass them draws every reading three times the size
 * the investigator is looking at. That is what the report figure composer did,
 * and it is why a composed topo never matched the drawing it came from.
 *
 * One function, so there is one answer.
 */
export const DEFAULT_POINT_SIZE = 2;
export const DEFAULT_POINT_COLOR = "#dc2626";

export function readPointStyle(customerFileId: string | undefined | null): {
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
