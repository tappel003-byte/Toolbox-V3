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
 *   Customer File on this device; plan pills use the same size. Press-and-hold
 *   also opens unitless −/+ next to this chip.
 * - Position persists per storageKey and clamps to viewport on resize/rotate.
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  });

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

  const HOLD_MS = 350;
  const [sizeHud, setSizeHud] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  useEffect(() => {
    return () => clearHold();
  }, []);
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSizeHud(false);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      pointerId: e.pointerId,
      moved: false,
    };
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      // Hold still → size −/+. Drag is cancelled so release does not move.
      drag.current = null;
      setSizeHud(true);
    }, HOLD_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    clearHold();
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    const top = topChromeHeight();
    const x = Math.min(Math.max(4, d.originX + dx), window.innerWidth - w - 4);
    const y = Math.min(Math.max(top, d.originY + dy), window.innerHeight - h - 4);
    setPos({ x, y });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    clearHold();
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

  const chipTop = pos.y + stackIndex * (height + 6);
  return (
    <>
      <div
        ref={ref}
        className="fixed z-40 flex items-stretch rounded-full bg-white/95 backdrop-blur shadow-sm border border-gray-300 overflow-hidden font-medium select-none touch-none cursor-grab active:cursor-grabbing"
        style={{
          left: pos.x,
          top: chipTop,
          height,
          fontSize: fontPx,
          lineHeight: 1,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e)}
        aria-label="Elevation stats — press and move to place; press and hold for size"
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
          className="fixed z-50 flex items-center gap-1 rounded-full border bg-white/95 px-1.5 py-1 shadow-md backdrop-blur"
          style={{
            left: Math.min(Math.max(8, pos.x), window.innerWidth - 180),
            top: Math.max(8, chipTop - 48),
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
            className="flex h-9 w-9 items-center justify-center rounded-full border hover:bg-muted disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="px-1 text-[10px] font-medium text-muted-foreground select-none">
            H/L/Δ size
          </span>
          <button
            type="button"
            onClick={() => {
              const n = Math.min(STATS_CHIP_MAX, height + 2);
              setStatsChipSize(n, customerFileId);
              if (customerFileId) patchCaptureSizes(customerFileId, { statsPillSize: n });
            }}
            disabled={height >= STATS_CHIP_MAX}
            aria-label="Increase H/L/Δ size"
            className="flex h-9 w-9 items-center justify-center rounded-full border hover:bg-muted disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSizeHud(false)}
            aria-label="Close size"
            className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
