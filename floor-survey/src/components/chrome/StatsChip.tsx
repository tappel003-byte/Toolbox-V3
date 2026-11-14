import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { patchCaptureSizes } from "@/lib/capture-sizes";

/**
 * Default chip height when nothing is stored for this Customer File yet.
 * Capture starts from screen-class defaults (see capture-sizes.ts); this is
 * the middle tablet-class value used as a fallback constant.
 *
 * Capture adjustments are per Customer File on this device. Report Builder
 * must not read this key — report pill size lives in floorLayout.pillLock.
 */
export const DEFAULT_STATS_CHIP_SIZE = 32;

/** @deprecated Device-global key. Capture now uses stats-chip-size:<customerFileId>. */
export const STATS_CHIP_SIZE_KEY = "stats-chip-size";
export const STATS_CHIP_SIZE_EVENT = "stats-chip-size-change";
/**
 * How small and how large the pill may be set.
 *
 * These are the ends of the stepper, not a judgement about what is readable.
 * Tim, with the stepper sitting on its old floor of 20 and the minus greyed
 * out: "I do not need to be limited to change the pill size to the size that
 * I want." A dense plan wants a smaller pill than a sparse one, and a pill on
 * a printed sheet is not the pill on a phone, so the range is as wide as the
 * stepper can usefully be and the choice is his.
 */
export const STATS_CHIP_MIN = 8;
export const STATS_CHIP_MAX = 120;

function chipKey(customerFileId?: string | null): string {
  return customerFileId ? `stats-chip-size:${customerFileId}` : STATS_CHIP_SIZE_KEY;
}

/** Read the capture chip height for this Customer File on this device. */
export function getStatsChipSize(customerFileId?: string | null): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(chipKey(customerFileId)) ??
      (customerFileId ? window.localStorage.getItem(STATS_CHIP_SIZE_KEY) : null);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Persist a capture chip height for this Customer File on this device.
 * Does not write Report Builder state. Report paths must not listen to this
 * as a source of sheet size.
 */
export function setStatsChipSize(px: number, customerFileId?: string | null) {
  const n = Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(px)));
  try {
    if (customerFileId) {
      window.localStorage.setItem(chipKey(customerFileId), String(n));
    } else {
      // Avoid widening the old device-global key; callers should pass an id.
      window.localStorage.setItem(STATS_CHIP_SIZE_KEY, String(n));
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(STATS_CHIP_SIZE_EVENT, {
      detail: { size: n, customerFileId: customerFileId || null },
    }),
  );
}


import { defaultRenderSettings, type SurveyPoint } from "@/lib/types";
import { STATS_PILL_COLORS, statsPillFont, statsPillPad, statsPillText } from "@/lib/stats-pill";

interface Props {
  points: SurveyPoint[];
  storageKey?: string;
  /** Capture size scope: this Customer File on this device. */
  customerFileId?: string;
  /** Optional area name shown as a leading segment (combined multi-area view). */
  label?: string;
  /** Vertical stacking slot so multiple pills don't overlap. */
  stackIndex?: number;
  /** Digits after the point. Follows the level's render settings so this chip
   *  and the pill drawn on the plan cannot read differently. */
  decimals?: number;
}

interface PlanArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The plan area the chip lives over: the <main data-plan-area> the host puts the plan in, so
 * the chip is placed against the plan and not against the screen. Falls back to the viewport
 * below the top chrome when there is no such element (older hosts).
 */
function planArea(): PlanArea {
  if (typeof document !== "undefined") {
    const el = document.querySelector("[data-plan-area]");
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
  }
  const top = topChromeHeight();
  return { left: 0, top, width: window.innerWidth, height: Math.max(0, window.innerHeight - top) };
}

/**
 * Where the chip sits, kept as a distance from the nearest side and the nearest top or bottom of
 * the plan area, in pixels. A chip put 190 px in from the left and 20 px up from the bottom is
 * still 190 px in and 20 px up after the screen turns, so a corner stays a corner and a chip put
 * beside a fixed control (the Data / Topo pill, in the lower left) stays beside it.
 *   h: "l" = from the left, "r" = from the right, "c" = from the middle (a chip put in the middle
 *      of the screen stays in the middle). v: "t" = from the top, "b" = from the bottom.
 * (Tim, Nov 14, 2026: "The H/L/Δ pill I had moved next to the Data/Topo pill. It moved.")
 */
interface ChipAnchor {
  h: "l" | "c" | "r";
  dx: number;
  v: "t" | "b";
  dy: number;
}

/** A chip whose middle is within this share of the plan width of its middle counts as centred. */
const CENTER_BAND = 0.08;
/** A chip whose left edge is left of this share of the plan width hangs from the left. */
const LEFT_SIDE = 0.55;

const num = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const clampTo = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function anchorToPx(a: ChipAnchor, area: PlanArea, w: number, h: number) {
  const roomX = Math.max(0, area.width - w);
  const roomY = Math.max(0, area.height - h);
  const x = a.h === "l" ? a.dx : a.h === "r" ? roomX - a.dx : roomX / 2 + a.dx;
  const y = a.v === "t" ? a.dy : roomY - a.dy;
  return { x: area.left + clampTo(x, 0, roomX), y: area.top + clampTo(y, 0, roomY) };
}

function pxToAnchor(x: number, y: number, area: PlanArea, w: number, h: number): ChipAnchor {
  const roomX = Math.max(0, area.width - w);
  const roomY = Math.max(0, area.height - h);
  const relX = clampTo(x - area.left, 0, roomX);
  const relY = clampTo(y - area.top, 0, roomY);
  const round = (n: number) => Math.round(n * 10) / 10;
  let hh: ChipAnchor["h"];
  let dx: number;
  if (Math.abs(relX + w / 2 - area.width / 2) <= area.width * CENTER_BAND) {
    hh = "c";
    dx = relX - roomX / 2;
  } else if (relX < area.width * LEFT_SIDE) {
    hh = "l";
    dx = relX;
  } else {
    hh = "r";
    dx = roomX - relX;
  }
  const top = relY + h / 2 < area.height / 2;
  return { h: hh, dx: round(dx), v: top ? "t" : "b", dy: round(top ? relY : roomY - relY) };
}

type Saved = {
  anchor: ChipAnchor | null;
  /** An older save: pixels, or a share of the plan area. Read once and converted. */
  legacyPx: { x: number; y: number } | null;
  legacyShare: { fx: number; fy: number } | null;
};

function readSavedAnchor(key: string): Saved {
  const none: Saved = { anchor: null, legacyPx: null, legacyShare: null };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return none;
    const v = JSON.parse(raw);
    if (v && (v.h === "l" || v.h === "c" || v.h === "r") && (v.v === "t" || v.v === "b")) {
      return { ...none, anchor: { h: v.h, dx: num(v.dx), v: v.v, dy: num(v.dy) } };
    }
    if (v && typeof v.fx === "number" && typeof v.fy === "number") {
      return { ...none, legacyShare: { fx: v.fx, fy: v.fy } };
    }
    if (v && typeof v.x === "number" && typeof v.y === "number") {
      return { ...none, legacyPx: { x: v.x, y: v.y } };
    }
  } catch {
    /* ignore */
  }
  return none;
}

/** Height in px of the top chrome (header + optional floor selector) plus a gap. */
function topChromeHeight() {
  const header = document.querySelector("header");
  const selector = document.querySelector("[data-floor-selector]");
  const h =
    (header?.getBoundingClientRect().height ?? 0) + (selector?.getBoundingClientRect().height ?? 0);
  return h + 4; // 4px gap below chrome
}

/**
 * Floating pill: High / Low / Delta.
 * - Drag anywhere on the chip to move it (5px threshold).
 * - A tap does nothing. Tapping the High or the Low reading used to highlight
 *   that point on the plan. Tim, looking at it: "if you click the numbers on
 *   the high low pills it highlights the high or the low on the top -- I don't
 *   think I want that." The pill is a readout and a thing to drag out of the
 *   way, not a control.
 * - Size is the one set in Control panel → Readings → Accessories, kept per
 *   Customer File on this device; plan pills use the same size. Tap opens a
 *   blue −/+ way above this chip (press-and-move still only moves).
 * - Position persists per storageKey and is pinned to the PLAN AREA as a distance from the nearest
 *   side and the nearest top or bottom, so where you put it (a corner, beside the Data / Topo pill)
 *   is where it stays when the screen turns or the window changes shape. Turning the screen only
 *   changes where it is drawn; it never rewrites what was saved. (Tim, Nov 13, 2026: "I just wanted
 *   to stay wherever I move it. If I move it to lower left corner it needs to pin." Nov 14: "I had
 *   moved it next to the Data/Topo pill. It moved.")
 */
export function StatsChip({
  points,
  storageKey = "stats-chip-pos",
  customerFileId,
  label,
  stackIndex = 0,
  decimals = defaultRenderSettings.decimalPlaces,
}: Props) {
  const stats = useMemo(() => {
    if (points.length === 0) return null;
    let hi = points[0];
    let lo = points[0];
    for (const p of points) {
      if (p.value > hi.value) hi = p;
      if (p.value < lo.value) lo = p;
    }
    return { hi, lo, delta: hi.value - lo.value };
  }, [points]);

  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<ChipAnchor | null>(() => readSavedAnchor(storageKey).anchor);
  // Bumped whenever the plan area changes shape or place, so the chip is drawn against the new one.
  const [, setLayoutTick] = useState(0);

  // Size last set for this Customer File on this device. Window resize must
  // not change it; only the Control panel stepper does.
  const [userSize, setUserSize] = useState<number | null>(null);
  useEffect(() => {
    setUserSize(getStatsChipSize(customerFileId));
    const onSize = (e: Event) => {
      const detail = (e as CustomEvent<number | { size: number; customerFileId?: string | null }>).detail;
      if (typeof detail === "number") {
        setUserSize(detail);
        return;
      }
      if (!detail || typeof detail.size !== "number") return;
      if (
        customerFileId &&
        detail.customerFileId &&
        detail.customerFileId !== customerFileId
      ) {
        return;
      }
      setUserSize(detail.size);
    };
    window.addEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    return () => {
      window.removeEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    };
  }, [customerFileId]);

  // The same type and air as the pills drawn on the plan, with no floor of
  // its own. This chip used to hold its type at 9px and its padding at 4px
  // however small the pill was set, so a level set to 14px showed two small
  // pills on the drawing and one that had stopped shrinking. Tim: "the sizing
  // did not apply to all three pills." One size setting, three pills, one
  // size.
  const height = userSize ?? DEFAULT_STATS_CHIP_SIZE;
  const fontPx = Math.round(statsPillFont(height));
  const padPx = Math.round(statsPillPad(height));

  // The chip is drawn once it has stats and a place; until then there is nothing to measure. When it
  // appears (and whenever its own size changes, e.g. the size − / +), redraw against its real size so
  // a corner is exactly a corner.
  const chipReady = !!stats && !!anchor;
  useEffect(() => {
    const el = ref.current;
    if (!el || !chipReady || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    ro.observe(el);
    setLayoutTick((n) => n + 1);
    return () => ro.disconnect();
  }, [chipReady]);

  // First placement: an older saved position (pixels, or a share of the plan area) is converted once;
  // otherwise the default, bottom centre above the bottom pill row. A saved position always wins.
  useEffect(() => {
    if (anchor) return;
    const w = ref.current?.offsetWidth ?? 180;
    const h = ref.current?.offsetHeight ?? 24;
    const area = planArea();
    const saved = readSavedAnchor(storageKey);
    let next: ChipAnchor;
    if (saved.legacyShare || saved.legacyPx) {
      const roomX = Math.max(0, area.width - w);
      const roomY = Math.max(0, area.height - h);
      const px = saved.legacyShare
        ? { x: area.left + Math.min(1, Math.max(0, saved.legacyShare.fx)) * roomX, y: area.top + Math.min(1, Math.max(0, saved.legacyShare.fy)) * roomY }
        : saved.legacyPx!;
      next = pxToAnchor(px.x, px.y, area, w, h);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    } else {
      next = { h: "c", dx: 0, v: "b", dy: 80 };
    }
    setAnchor(next);
  }, [anchor, storageKey]);

  // The plan area changes shape (rotation, window size, the floor selector appearing): redraw the
  // chip against it. This never changes the saved position.
  useEffect(() => {
    const redraw = () => setLayoutTick((n) => n + 1);
    window.addEventListener("resize", redraw);
    window.addEventListener("orientationchange", redraw);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", redraw);
    const el = typeof document !== "undefined" ? document.querySelector("[data-plan-area]") : null;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(redraw);
      ro.observe(el);
    }
    redraw();
    return () => {
      window.removeEventListener("resize", redraw);
      window.removeEventListener("orientationchange", redraw);
      vv?.removeEventListener("resize", redraw);
      ro?.disconnect();
    };
  }, []);

  /** Way above the chip so −/+ does not sit on the drag target. */
  const SIZE_HUD_ABOVE_PX = 112;
  const [sizeHud, setSizeHud] = useState(false);
  // Outside press dismisses; −/+ on the HUD stay usable.
  useEffect(() => {
    if (!sizeHud) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest("[data-accessory-size-hud]")) return;
      setSizeHud(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sizeHud]);
  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  /** The chip's top-left in screen pixels, from where it is saved against the plan area now. */
  function currentPx() {
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    return anchor ? anchorToPx(anchor, planArea(), w, h) : null;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const px = currentPx();
    if (!px) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: px.x,
      originY: px.y,
      pointerId: e.pointerId,
      moved: false,
    };
  };

  /** Where a drag puts the chip, kept inside the plan area, as an anchor. */
  function anchorFromDrag(d: NonNullable<typeof drag.current>, clientX: number, clientY: number): ChipAnchor {
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    return pxToAnchor(d.originX + (clientX - d.startX), d.originY + (clientY - d.startY), planArea(), w, h);
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setSizeHud(false);
    setAnchor(anchorFromDrag(d, e.clientX, e.clientY));
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      // Tap → blue size −/+ way above. Move is press-and-drag only.
      setSizeHud(true);
      return;
    }
    // Persist from the pointer + drag origin — not React state, which can still be the
    // pre-drag value when pointerup races the last setAnchor (chip then snaps back on
    // Clean / Data↔Topo remount).
    const next = anchorFromDrag(d, e.clientX, e.clientY);
    setAnchor(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const px = currentPx();
  if (!stats || !anchor || !px) {
    return (
      <div
        ref={ref}
        className="fixed pointer-events-none opacity-0"
        style={{ left: -9999, top: -9999 }}
      />
    );
  }

  const chipTop = px.y + stackIndex * (height + 6);
  return (
    <>
      <div
        ref={ref}
        className="fixed z-40 flex w-max whitespace-nowrap items-stretch rounded-full bg-white/95 backdrop-blur shadow-sm border border-gray-300 overflow-hidden font-medium select-none touch-none cursor-grab active:cursor-grabbing"
        style={{
          left: px.x,
          top: chipTop,
          height,
          fontSize: fontPx,
          lineHeight: 1,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e)}
        aria-label="Elevation stats — press and move to place; tap for size"
      >
        {label && (
          <div
            className="flex items-center border-r border-gray-200 max-w-[8rem] truncate"
            style={{ paddingLeft: padPx, paddingRight: padPx, color: STATS_PILL_COLORS.label }}
          >
            {label}
          </div>
        )}
        {/* Reading and letter in one colour, as the shipped decks set them.
            Tabular figures in the interface face, not a monospace: a
            monospaced 1 hangs air on both sides, which is most of what made
            this read loose beside the deck. */}
        <div
          className="flex items-center font-semibold"
          style={{ paddingLeft: padPx, paddingRight: padPx, color: STATS_PILL_COLORS.hi }}
        >
          {statsPillText("H", stats.hi.value.toFixed(decimals))}
        </div>
        <div
          className="flex items-center border-l border-gray-200 font-semibold"
          style={{ paddingLeft: padPx, paddingRight: padPx, color: STATS_PILL_COLORS.lo }}
        >
          {statsPillText("L", stats.lo.value.toFixed(decimals))}
        </div>
        <div
          className="flex items-center border-l border-gray-200 font-semibold"
          style={{ paddingLeft: padPx, paddingRight: padPx, color: STATS_PILL_COLORS.delta }}
        >
          {statsPillText("Δ", stats.delta.toFixed(decimals))}
        </div>
      </div>
      {sizeHud && (
        <div
          data-accessory-size-hud=""
          className="fixed z-50 flex h-7 items-stretch overflow-hidden rounded-full border shadow-md"
          style={{
            left: Math.min(Math.max(8, px.x), window.innerWidth - 88),
            top: Math.max(8, chipTop - SIZE_HUD_ABOVE_PX),
            background: "#07283d",
            borderColor: "#07283d",
          }}
          role="group"
          aria-label="H/L/Δ size"
        >
          <button
            type="button"
            onClick={() => {
              const n = Math.max(STATS_CHIP_MIN, height - 2);
              setStatsChipSize(n, customerFileId);
              if (customerFileId) patchCaptureSizes(customerFileId, { statsPillSize: n });
            }}
            disabled={height <= STATS_CHIP_MIN}
            aria-label="Decrease H/L/Δ size"
            className="flex w-7 items-center justify-center text-white/95 hover:bg-white/10 disabled:opacity-40"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-px self-stretch bg-white/25" aria-hidden />
          <button
            type="button"
            onClick={() => {
              const n = Math.min(STATS_CHIP_MAX, height + 2);
              setStatsChipSize(n, customerFileId);
              if (customerFileId) patchCaptureSizes(customerFileId, { statsPillSize: n });
            }}
            disabled={height >= STATS_CHIP_MAX}
            aria-label="Increase H/L/Δ size"
            className="flex w-7 items-center justify-center text-white/95 hover:bg-white/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setSizeHud(false)}
            aria-label="Close size"
            className="flex w-6 items-center justify-center border-l border-white/25 text-white/80 hover:bg-white/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );
}
