import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The chip's height until someone sets one.
 *
 * It used to be three heights picked from `window.innerWidth` -- 24 on a
 * phone, 32 on a tablet, 40 on a desktop. That made the same Customer File
 * render at three different sizes depending on what you opened it on, and on a
 * report slide it meant the pill's size depended on the browser window rather
 * than on the page it was printed to. One number instead: the middle of the
 * three, which is what a tablet showed.
 *
 * What survived that change for a while was an "Auto" idea and a "Use Auto
 * size for this screen" link, which by then only cleared the chosen size back
 * to this number. Tim: "I don't think I'll ever use that setting because it's
 * always wrong -- you just adjust it to the size that you want and it stays
 * that size." So there is no Auto: the size is the last one set, kept on this
 * device and used by every job on it, and this is only where it starts.
 */
export const DEFAULT_STATS_CHIP_SIZE = 32;

/** localStorage key holding the user's chosen chip height in px. */
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

/** Read the user's chosen chip height, or null when unset (auto). */
export function getStatsChipSize(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATS_CHIP_SIZE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Persist a chip height and notify any mounted chip immediately. */
export function setStatsChipSize(px: number) {
  const n = Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(px)));
  try {
    window.localStorage.setItem(STATS_CHIP_SIZE_KEY, String(n));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(STATS_CHIP_SIZE_EVENT, { detail: n }));
}


import { defaultRenderSettings, type SurveyPoint } from "@/lib/types";
import { STATS_PILL_COLORS, statsPillFont, statsPillPad, statsPillText } from "@/lib/stats-pill";

interface Props {
  points: SurveyPoint[];
  storageKey?: string;
  /** Optional area name shown as a leading segment (combined multi-area view). */
  label?: string;
  /** Vertical stacking slot so multiple pills don't overlap. */
  stackIndex?: number;
  /** Digits after the point. Follows the level's render settings so this chip
   *  and the pill drawn on the plan cannot read differently. */
  decimals?: number;
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
 * - Size is the one set in Topo → Labels & layers → "Stats pill size", kept on
 *   this device; the pills drawn on the plan take the same size.
 * - Position persists per storageKey and clamps to viewport on resize/rotate.
 */
export function StatsChip({
  points,
  storageKey = "stats-chip-pos",
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  });

  // The size last set on this device, until someone sets another. Nothing
  // watches the window: the size does not depend on the screen, so turning the
  // phone or dragging a window cannot change it.
  const [userSize, setUserSize] = useState<number | null>(null);
  useEffect(() => {
    setUserSize(getStatsChipSize());
    const onSize = (e: Event) => {
      const detail = (e as CustomEvent<number | null>).detail;
      setUserSize(typeof detail === "number" ? detail : null);
    };
    window.addEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    return () => {
      window.removeEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    };
  }, []);

  // The same type and air as the pills drawn on the plan, with no floor of
  // its own. This chip used to hold its type at 9px and its padding at 4px
  // however small the pill was set, so a level set to 14px showed two small
  // pills on the drawing and one that had stopped shrinking. Tim: "the sizing
  // did not apply to all three pills." One size setting, three pills, one
  // size.
  const height = userSize ?? DEFAULT_STATS_CHIP_SIZE;
  const fontPx = Math.round(statsPillFont(height));
  const padPx = Math.round(statsPillPad(height));

  // Default: bottom center, above the bottom pill row. Persisted position wins.
  useEffect(() => {
    if (pos) return;
    const w = ref.current?.offsetWidth ?? 180;
    const h = ref.current?.offsetHeight ?? 24;
    const top = topChromeHeight();
    setPos({
      x: Math.max(8, window.innerWidth / 2 - w / 2),
      y: Math.max(top, window.innerHeight - h - 80),
    });
  }, [pos]);

  // Clamp on resize / rotation.
  useEffect(() => {
    const clamp = () => {
      setPos((p) => {
        if (!p || !ref.current) return p;
        const w = ref.current.offsetWidth;
        const h = ref.current.offsetHeight;
        const top = topChromeHeight();
        const x = Math.min(Math.max(4, p.x), window.innerWidth - w - 4);
        const y = Math.min(Math.max(top, p.y), window.innerHeight - h - 60);
        return x === p.x && y === p.y ? p : { x, y };
      });
    };
    window.addEventListener("resize", clamp);
    window.addEventListener("orientationchange", clamp);
    return () => {
      window.removeEventListener("resize", clamp);
      window.removeEventListener("orientationchange", clamp);
    };
  }, []);

  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      pointerId: e.pointerId,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    const top = topChromeHeight();
    const x = Math.min(Math.max(4, d.originX + dx), window.innerWidth - w - 4);
    const y = Math.min(Math.max(top, d.originY + dy), window.innerHeight - h - 4);
    setPos({ x, y });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  };

  if (!stats || !pos) {
    return (
      <div
        ref={ref}
        className="fixed pointer-events-none opacity-0"
        style={{ left: -9999, top: -9999 }}
      />
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-40 flex items-stretch rounded-full bg-white/95 backdrop-blur shadow-sm border border-gray-300 overflow-hidden font-medium select-none touch-none cursor-grab active:cursor-grabbing"
      style={{
        left: pos.x,
        top: pos.y + stackIndex * (height + 6),
        height,
        fontSize: fontPx,
        lineHeight: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      aria-label="Elevation stats — drag to move"
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
  );
}
