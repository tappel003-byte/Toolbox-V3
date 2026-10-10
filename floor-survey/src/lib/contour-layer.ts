/**
 * The contour layer: a black-and-white contour of one level, written so
 * Distress Survey can show the damage pins on top of it.
 *
 * Why it lines up for free. Distress and Floor Survey read the same plan
 * picture for a level, and both measure in that picture's pixels -- a distress
 * pin is stored in plan pixels, and the topo base pass draws in plan
 * coordinates. So a contour drawn across the plan's whole extent, at one
 * uniform scale, puts every contour line exactly where it sits on the plan.
 * Nothing is registered, warped or matched up.
 *
 * Why it is a picture and not a live render. Distress capture has to work on a
 * phone in a crawlspace with no signal, and building contours from the
 * readings there is the kind of work that locks a tablet up. The picture is
 * made once, at a desk or in the truck, and after that it is just another
 * layer on the level -- it syncs as bytes and costs nothing to show.
 *
 * Why it is transparent. A layer that is painted on white can only replace the
 * plan, which makes it not a layer. Transparent means the investigator can
 * show the plan, the contour, or both at once -- contour lines over the real
 * floor plan with the pins on it, which is the one that tells an owner the
 * story.
 *
 * See DECISIONS.md "Layers and levels".
 */
import { composeReportTopoFigure } from "./report-topo-figure";
import type { Floor, RenderSettings, SurveyPoint } from "./types";

export type ContourLayerResult = {
  dataUrl: string;
  /** The picture's own pixels. Well above plan resolution, so it holds up on
   *  paper; it is stretched back into the extent below wherever it is shown. */
  width: number;
  height: number;
  /** The plan region the layer covers, in plan pixels — always the level's
   *  whole plan. This is the number that says it lines up with the plan, and
   *  it is what gets stored on the level. */
  extent: { x: number; y: number; w: number; h: number };
  pointCount: number;
  /** The boundary this covers, or "Combined" — so the field can see what it
   *  is looking at instead of inferring it from the shape. */
  areaName: string;
};

/**
 * The settings that turn a topo drawing into a backdrop.
 *
 * Everything else is the investigator's own: the contour interval, the line
 * thickness, whether the lines carry their elevations. What the backdrop
 * fixes is only what would stop it being one -- the wall plan is off because
 * Distress draws the real plan underneath, and the readings are off because
 * the pins go where they would be. Tim: no data, stripped down, just contour.
 */
function backdropSettings(settings: RenderSettings): Partial<RenderSettings> {
  return {
    ...settings,
    mode: "contour-bw",
    showContours: true,
    showPlan: false,
    showPoints: false,
  };
}

/**
 * Draw the contour layer for one level.
 *
 * The extent is the plan's own, never the data's: a figure crops to the
 * readings so the page is not mostly white, but a layer that is going to sit
 * under the pins has to cover the same ground as the plan or it will not line
 * up with it.
 *
 * Returns null when the level has nothing to draw — no closed boundary, or no
 * readings inside one — which is also what hides the action in the rail.
 */
export async function composeContourLayer(options: {
  floor: Floor;
  points: SurveyPoint[];
  settings: RenderSettings;
  /**
   * The boundary showing on screen, or null for all of them.
   *
   * Separate surfaces are separate: a garage is sloped to drain, so its
   * contours are the steepest thing on the sheet and say nothing about the
   * house. Tim: "Two separate levels should not necessarily show the same
   * thing, plus that's a garage, it's sloped for drainage." Choosing the
   * boundary in the rail before sending is how that garage stays out, and it
   * needs no control of its own -- it is the same what-you-see-is-what-you-send
   * rule as the B&W gate.
   */
  areaId?: string | null;
}): Promise<ContourLayerResult | null> {
  const floor = options.floor;
  const points = Array.isArray(options.points) ? options.points : [];
  const planW = Math.max(1, Math.round(floor.planWidth || 1000));
  const planH = Math.max(1, Math.round(floor.planHeight || 750));
  const extent = { x: 0, y: 0, w: planW, h: planH };

  const composed = await composeReportTopoFigure({
    floor,
    points,
    areaId: options.areaId ?? null,
    settings: backdropSettings(options.settings),
    extent,
    background: "transparent",
  });
  if (!composed) return null;

  return {
    dataUrl: composed.dataUrl,
    width: composed.width,
    height: composed.height,
    extent: composed.extent,
    pointCount: points.length,
    areaName: composed.title || "Combined",
  };
}
