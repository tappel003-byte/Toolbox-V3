import { useEffect, useRef } from "react";
import { isRealSurveyDate } from "./AppTopBar";

/**
 * One slim line under the top bar while the survey has no date and the first point is
 * down. It does not block capture and does not go away until a date is set. Tim,
 * Nov 12, 2026: the survey date has been missed in the field, and he needs it in the report.
 * There is no silent "today": the investigator picks a date or taps Today.
 */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function SurveyDateBar({ onPick }: { onPick: (isoDate: string) => void }) {
  const pending = useRef<number | null>(null);
  useEffect(() => () => {
    if (pending.current) window.clearTimeout(pending.current);
  }, []);
  return (
    <div
      data-fs-survey-date-bar
      role="status"
      className="flex items-center gap-2 px-2 h-9 text-xs border-b bg-amber-50 text-amber-950"
    >
      <span className="font-semibold">Survey date not set</span>
      <input
        id="fs-survey-date-bar"
        type="date"
        aria-label="Survey date"
        className="h-7 min-w-[9.5rem] rounded border bg-background px-1 text-xs"
        defaultValue=""
        onChange={(e) => {
          // Commit once typing has paused; a date picked from the calendar lands right away.
          const v = e.target.value;
          if (pending.current) window.clearTimeout(pending.current);
          if (!isRealSurveyDate(v)) return;
          pending.current = window.setTimeout(() => onPick(v), 900);
        }}
      />
      <button
        type="button"
        className="h-7 rounded border border-amber-700/40 bg-white px-2 font-semibold hover:bg-amber-100"
        onClick={() => onPick(todayIso())}
      >
        Today
      </button>
    </div>
  );
}
