/**
 * The Floor Survey colour scale, as a picture a report sheet can place.
 *
 * Tim, Oct 17, looking at a Floor Survey sheet in the report: "the Legend is
 * not right and it does not lock the size, its different than the FS legend",
 * and "the legend contour was incorrect."
 *
 * All three were the same thing. The sheet drew a colour scale of its own, in
 * HTML, from the band colours the live view happened to report: no tick values
 * at the contour lines, the high and the low where those values belong, ELEV.
 * at the top instead of the foot, and every dimension in screen pixels, so its
 * size on the paper changed with the size of the window.
 *
 * So the sheet shows the real one. This paints `drawLegend` -- the Floor
 * Survey screen's own colour scale, from the same grid, the same contour
 * thresholds and the same palette -- into a picture, which the page places and
 * sizes like any other piece. One colour scale, one implementation.
 */
import { listFloors, listPoints, setHostCustomerFileId } from "@/lib/db";
import { withCorrectedValues } from "@/lib/transitions";
import { buildAreaTopos, drawLegend, LEGEND_SHAPE } from "@/components/tabs/TopoTab";
import { defaultRenderSettings, type RenderSettings } from "@/lib/types";

/** The scale's proportion: it is this shape whatever size it is drawn. */
export const topoLegendShape = { width: LEGEND_SHAPE.w, height: LEGEND_SHAPE.h };

export type TopoLegendImage = {
  dataUrl: string;
  width: number;
  height: number;
  /** Which boundary's scale this is, so a caller can label it. */
  areaId: string;
  name: string;
};

/**
 * Paint one boundary's colour scale.
 *
 * `height` is in device pixels and decides the drawing's own resolution; the
 * page sizes the picture it gets back in whatever units the sheet uses. A
 * boundary is named either by `areaId` or by its place in the list, which is
 * the order a slide's readings come in.
 */
export async function renderTopoLegendImage(options: {
  customerFileId: string;
  canvasId: string;
  areaId?: string | null;
  statsIndex?: number;
  settings?: Partial<RenderSettings> | null;
  height?: number;
}): Promise<TopoLegendImage | null> {
  const customerFileId = options.customerFileId || "";
  const canvasId = options.canvasId || "";
  if (!customerFileId || !canvasId) return null;
  setHostCustomerFileId(customerFileId);
  const floors = await listFloors(customerFileId);
  const floor = floors.find((item) => item.id === canvasId) || null;
  if (!floor) return null;
  const points = await listPoints(floor.id);
  const settings: RenderSettings = { ...defaultRenderSettings, ...(options.settings || {}) };
  const corrected = withCorrectedValues(
    points,
    floor.transitions,
    floor.transitionGroupAverages,
  );
  const topos = buildAreaTopos(floor, corrected, settings, options.areaId ?? null);
  if (!topos.length) return null;
  const at = topos[Math.max(0, Math.min(topos.length - 1, options.statsIndex ?? 0))];
  if (!at) return null;

  const height = Math.max(120, Math.round(options.height || 1500));
  const width = Math.max(44, Math.round((height * LEGEND_SHAPE.w) / LEGEND_SHAPE.h));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Transparent behind it: the scale draws its own box, and the page decides
  // what is underneath.
  ctx.clearRect(0, 0, width, height);
  // Half a pixel in, so the box's own one-pixel border is not drawn off the
  // edge of the picture.
  drawLegend(ctx, settings, at.grid, null, false, {
    x: 0.5,
    y: 0.5,
    w: width - 1,
    h: height - 1,
    scale: height / LEGEND_SHAPE.h,
  });
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    areaId: at.area.id,
    name: at.area.name || "Boundary",
  };
}
