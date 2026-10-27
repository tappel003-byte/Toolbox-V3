/**
 * Floor Survey capture size ownership.
 *
 * Capture adjustments are per Customer File on this device. They must never
 * become Report Builder preferences. Report sizes live in the Customer File
 * report component only.
 *
 * Starting values come from usable screen space when nothing is stored yet.
 * Pinch/zoom drawing rules are unchanged (screen-anchored in the field).
 */

import { defaultRenderSettings } from "@/lib/types";

/** Keep in sync with StatsChip.tsx — avoid importing the React module here. */
const DEFAULT_STATS_CHIP_SIZE = 32;
const STATS_CHIP_MIN = 8;
const STATS_CHIP_MAX = 120;

export type CaptureSizes = {
  pointLabelFontSize: number;
  highLowPinSize: number;
  legendScale: number;
  legendX: number;
  legendY: number;
  statsPillSize: number;
  pointSize: number;
};

const STORAGE_PREFIX = "fs-capture-sizes:";

/** Screen-class starts from the short viewport side. No brand detection. */
export function screenCaptureDefaults(): CaptureSizes {
  const short =
    typeof window !== "undefined"
      ? Math.min(window.innerWidth || 390, window.innerHeight || 844)
      : 390;
  // Phone, small tablet / iPad mini class, larger tablet / desktop.
  if (short < 500) {
    return {
      pointLabelFontSize: 10,
      highLowPinSize: 10,
      legendScale: 1.3,
      legendX: defaultRenderSettings.legendX,
      legendY: defaultRenderSettings.legendY,
      statsPillSize: 28,
      pointSize: 2,
    };
  }
  if (short < 850) {
    return {
      pointLabelFontSize: 11,
      highLowPinSize: 11,
      legendScale: 1.5,
      legendX: defaultRenderSettings.legendX,
      legendY: defaultRenderSettings.legendY,
      statsPillSize: DEFAULT_STATS_CHIP_SIZE,
      pointSize: 2,
    };
  }
  return {
    pointLabelFontSize: 12,
    highLowPinSize: 12,
    legendScale: 1.6,
    legendX: defaultRenderSettings.legendX,
    legendY: defaultRenderSettings.legendY,
    statsPillSize: 36,
    pointSize: 2,
  };
}

function clampPill(n: number): number {
  return Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(n)));
}

function clampFont(n: number): number {
  return Math.max(6, Math.min(28, Math.round(n)));
}

function clampPin(n: number): number {
  return Math.max(7, Math.min(28, Math.round(n)));
}

function clampLegend(n: number): number {
  return Math.max(0.4, Math.min(4, Math.round(n * 10) / 10));
}

function clampDot(n: number): number {
  return Math.max(1, Math.min(8, Math.round(n)));
}

export function captureSizesKey(customerFileId: string): string {
  return STORAGE_PREFIX + customerFileId;
}

export function statsChipSizeKey(customerFileId: string): string {
  return `stats-chip-size:${customerFileId}`;
}

export function legendStorageKey(customerFileId: string): string {
  return `topo.legend.v1:${customerFileId}`;
}

/** Load capture sizes for this Customer File on this device. */
export function loadCaptureSizes(customerFileId: string): CaptureSizes {
  const defaults = screenCaptureDefaults();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(captureSizesKey(customerFileId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CaptureSizes>;
      return normalizeCaptureSizes(parsed, defaults);
    }
  } catch {
    /* fall through */
  }
  // One-time bridge from older per-key stores so existing jobs keep adjustments.
  try {
    const fontRaw = window.localStorage.getItem(`dpp-font:${customerFileId}`);
    const font = fontRaw ? Number(fontRaw) : NaN;
    const sizeRaw = window.localStorage.getItem(`dpp-size:${customerFileId}`);
    const dot = sizeRaw ? Number(sizeRaw) : NaN;
    const pillRaw = window.localStorage.getItem(statsChipSizeKey(customerFileId));
    const pillLegacy = window.localStorage.getItem("stats-chip-size");
    const pill = Number(pillRaw ?? pillLegacy);
    const legendRaw = window.localStorage.getItem(legendStorageKey(customerFileId));
    const legendLegacy = window.localStorage.getItem("topo.legend.v1");
    let legend: { scale?: number; x?: number; y?: number } | null = null;
    try {
      legend = JSON.parse(legendRaw || legendLegacy || "null");
    } catch {
      legend = null;
    }
    const merged: Partial<CaptureSizes> = {};
    if (Number.isFinite(font)) merged.pointLabelFontSize = font;
    if (Number.isFinite(dot)) merged.pointSize = dot;
    if (Number.isFinite(pill) && pill > 0) merged.statsPillSize = pill;
    if (legend && typeof legend.scale === "number") merged.legendScale = legend.scale;
    if (legend && typeof legend.x === "number") merged.legendX = legend.x;
    if (legend && typeof legend.y === "number") merged.legendY = legend.y;
    if (Object.keys(merged).length) {
      const next = normalizeCaptureSizes(merged, defaults);
      saveCaptureSizes(customerFileId, next);
      return next;
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

function normalizeCaptureSizes(
  partial: Partial<CaptureSizes>,
  defaults: CaptureSizes,
): CaptureSizes {
  return {
    pointLabelFontSize: clampFont(
      partial.pointLabelFontSize ?? defaults.pointLabelFontSize,
    ),
    highLowPinSize: clampPin(partial.highLowPinSize ?? defaults.highLowPinSize),
    legendScale: clampLegend(partial.legendScale ?? defaults.legendScale),
    legendX:
      typeof partial.legendX === "number" ? partial.legendX : defaults.legendX,
    legendY:
      typeof partial.legendY === "number" ? partial.legendY : defaults.legendY,
    statsPillSize: clampPill(partial.statsPillSize ?? defaults.statsPillSize),
    pointSize: clampDot(partial.pointSize ?? defaults.pointSize),
  };
}

export function saveCaptureSizes(
  customerFileId: string,
  sizes: CaptureSizes,
): void {
  if (typeof window === "undefined") return;
  const next = normalizeCaptureSizes(sizes, screenCaptureDefaults());
  try {
    window.localStorage.setItem(
      captureSizesKey(customerFileId),
      JSON.stringify(next),
    );
    // Keep the dedicated keys in sync for older readers (Data panel / point-style).
    window.localStorage.setItem(
      `dpp-font:${customerFileId}`,
      String(next.pointLabelFontSize),
    );
    window.localStorage.setItem(
      `dpp-size:${customerFileId}`,
      String(next.pointSize),
    );
    window.localStorage.setItem(
      statsChipSizeKey(customerFileId),
      String(next.statsPillSize),
    );
    window.localStorage.setItem(
      legendStorageKey(customerFileId),
      JSON.stringify({
        scale: next.legendScale,
        x: next.legendX,
        y: next.legendY,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

export function patchCaptureSizes(
  customerFileId: string,
  patch: Partial<CaptureSizes>,
): CaptureSizes {
  const next = normalizeCaptureSizes(
    { ...loadCaptureSizes(customerFileId), ...patch },
    screenCaptureDefaults(),
  );
  saveCaptureSizes(customerFileId, next);
  return next;
}
