import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, Undo2, Redo2 } from "lucide-react";

type Props = {
  projectName: string;
  floorName: string;
  onBack?: () => void;
  onReturnToReport?: () => void;
  onOpenSetup: () => void;
  /** ⋯ label for setup — integrated host uses Boundary & exclusions (CF owns plan). */
  setupMenuLabel?: string;
  onOpenReview: () => void;
  onOpenExport?: () => void;
  onOpenTransitions?: () => void;
  onOpen3D?: () => void;
  /** Topo: exclude points from contour math (session-only). Parked in ⋯ — not a corner pill. */
  onOpenDiagnosticPoints?: () => void;
  
  /** ISO date the survey was taken ("" when never set). Shown first in ⋯ so it is never buried. */
  surveyDate?: string;
  /** When given, ⋯ offers "Survey date" at any time and flags it while it is empty. */
  onSetSurveyDate?: (isoDate: string) => void | Promise<void>;
  undoEnabled?: boolean;
  redoEnabled?: boolean;
  onSave?: () => void | Promise<void>;
  /** Done taking points on this level: saves, and files the contour. */
  onDone?: () => void | Promise<void>;
  doneBusy?: boolean;
  saving?: boolean;
  saveStatus?: string | null;
  saveTone?: "ok" | "err" | null;
};



/**
 * Shared top strip: back · title · Undo · Redo · ⋯
 * Undo/Redo dispatch window events so any active tool can subscribe
 * without a global store change.
 */
export function AppTopBar({
  projectName,
  floorName,
  onBack,
  onReturnToReport,
  onOpenSetup,
  setupMenuLabel = "Setup",
  onOpenReview,
  onOpenExport,
  onOpenTransitions,
  onOpen3D,
  onOpenDiagnosticPoints,
  surveyDate = "",
  onSetSurveyDate,

  undoEnabled = true,
  redoEnabled = true,
  onSave,
  onDone,
  doneBusy = false,
  saving = false,
  saveStatus = null,
  saveTone = null,
}: Props) {


  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("touchstart", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("touchstart", close);
    };
  }, [menuOpen]);

  const fire = (name: "app:undo" | "app:redo") => window.dispatchEvent(new CustomEvent(name));

  return (
    <header
      className="sticky top-0 z-50 bg-background/85 backdrop-blur border-b pt-[env(safe-area-inset-top)] landscape-short:pt-[max(env(safe-area-inset-top),1.5rem)] landscape-short:pl-[env(safe-area-inset-left)] landscape-short:pr-[env(safe-area-inset-right)]"
    >
      <div className="flex items-center gap-1 px-2 h-9 text-xs">
        <button
          type="button"
          onClick={() => {
            if (onBack) onBack();
            else window.location.hash = "#/";
          }}
          className="inline-flex items-center h-8 w-8 justify-center text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Back to Customer File"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {onReturnToReport ? (
          <button
            type="button"
            onClick={onReturnToReport}
            className="inline-flex items-center h-8 px-1.5 shrink-0 text-[11px] font-semibold text-primary hover:bg-accent rounded"
            data-return-to-report
          >
            Back to Report Builder
          </button>
        ) : null}
        <div
          className="flex-1 min-w-0 truncate"
          role="status"
          aria-live="polite"
          data-save-status={saveStatus || ""}
          data-save-tone={saveTone || ""}
        >
          {saveStatus ? (
            <span
              className={
                saveTone === "err"
                  ? "font-medium text-amber-900"
                  : saveTone === "ok"
                    ? "font-medium text-emerald-900"
                    : "text-muted-foreground"
              }
              title={saveStatus}
            >
              {saveStatus}
            </span>
          ) : (
            <>
              <span className="font-medium">{projectName}</span>
              <span className="text-muted-foreground"> · {floorName}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (saving || !onSave) return;
            void onSave();
          }}
          disabled={saving || !onSave}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-muted-foreground hover:text-foreground hover:bg-accent text-base disabled:opacity-40"
          aria-label="Save"
          title="Save"
          aria-busy={saving}
        >
          {saveTone === "ok" ? "✅" : "💾"}
        </button>
        {/*
          Done taking points.

          A survey had a beginning and no end: the first point asks whether it
          is BP1 and takes the GPS, and the last point asks nothing, so there
          was nowhere for the work after it to hang. Tim: "If we had a
          complete -- I'm done taking points -- generate the contour
          immediately... next to the Save button there should be a pill of a
          button that says Done. I hit Done and it's done."

          It is a button, not a state: press it again after adding points
          tomorrow and the contour is drawn again. Nothing is locked.
        */}
        {onDone && (
          <button
            type="button"
            onClick={() => {
              if (doneBusy || saving) return;
              void onDone();
            }}
            disabled={doneBusy || saving}
            className="inline-flex items-center justify-center h-7 shrink-0 rounded-full border border-emerald-700/40 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"
            aria-label="Done taking points"
            title="Done taking points — saves and draws the contour"
            aria-busy={doneBusy}
            data-floor-done
          >
            {doneBusy ? "Working…" : "Done"}
          </button>
        )}
        <button
          type="button"
          onClick={() => undoEnabled && fire("app:undo")}
          disabled={!undoEnabled}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => redoEnabled && fire("app:redo")}
          disabled={!redoEnabled}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="relative inline-flex items-center justify-center h-8 w-8 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="More"
            aria-expanded={menuOpen}
            data-survey-date-missing={onSetSurveyDate && !surveyDate ? "true" : undefined}
          >
            <MoreHorizontal className="h-4 w-4" />
            {onSetSurveyDate && !surveyDate && (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-background"
              />
            )}
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 min-w-[10rem] rounded-md border bg-popover shadow-lg z-50 py-1 text-sm"
            >
              {onSetSurveyDate && (
                <SurveyDateMenuItem
                  surveyDate={surveyDate}
                  onPick={(iso) => {
                    setMenuOpen(false);
                    void onSetSurveyDate(iso);
                  }}
                />
              )}
              <MenuItem
                label="Review"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenReview();
                }}
              />
              <MenuItem
                label={setupMenuLabel}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSetup();
                }}
              />
              {onOpenTransitions && (
                <MenuItem
                  label="Transitions"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenTransitions();
                  }}
                />
              )}
              {onOpenDiagnosticPoints && (
                <MenuItem
                  label="Diagnostic points"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenDiagnosticPoints();
                  }}
                />
              )}
              {onOpen3D && (
                <MenuItem
                  label="3D"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen3D();
                  }}
                />
              )}
              {onOpenExport && (
                <MenuItem
                  label="Export"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenExport();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  label,
  onClick,
  destructive,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        "w-full text-left px-3 py-1.5 hover:bg-accent " + (destructive ? "text-destructive" : "")
      }
    >
      {label}
    </button>
  );
}

export function isRealSurveyDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const year = Number(v.slice(0, 4));
  return year >= 1990 && year <= 2100;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function prettyDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * First item in ⋯: the date the survey was taken. Tim, Nov 12, 2026: it has been
 * missed in the field and could not be added afterwards, so it is always here,
 * says "not set" in amber while empty, and takes a date (or "Today") in one step.
 */
function SurveyDateMenuItem({
  surveyDate,
  onPick,
}: {
  surveyDate: string;
  onPick: (isoDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<number | null>(null);
  useEffect(() => () => {
    if (pending.current) window.clearTimeout(pending.current);
  }, []);
  return (
    <div role="none" data-fs-survey-date-menu>
      <button
        type="button"
        role="menuitem"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center justify-between gap-3"
      >
        <span>Survey date</span>
        <span className={surveyDate ? "text-xs text-muted-foreground" : "text-xs font-semibold text-amber-700"}>
          {surveyDate ? prettyDate(surveyDate) : "not set"}
        </span>
      </button>
      {open && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <input
            id="fs-survey-date-menu"
            type="date"
            aria-label="Survey date"
            className="h-8 min-w-[9.5rem] rounded border bg-background px-1 text-xs"
            defaultValue={surveyDate}
            onChange={(e) => {
              // Typing passes through half-typed dates (year 0002, month 1 before 10).
              // Commit once the field has been still for a moment; a picked date lands at once.
              const v = e.target.value;
              if (pending.current) window.clearTimeout(pending.current);
              if (!isRealSurveyDate(v)) return;
              pending.current = window.setTimeout(() => onPick(v), 900);
            }}
          />
          <button
            type="button"
            className="h-8 rounded border px-2 text-xs font-semibold hover:bg-accent"
            onClick={() => onPick(todayIso())}
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}
