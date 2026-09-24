import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, Undo2, Redo2 } from "lucide-react";

type Props = {
  projectName: string;
  floorName: string;
  onBack?: () => void;
  onOpenSetup: () => void;
  onOpenReview: () => void;
  onOpenExport: () => void;
  onOpenTransitions?: () => void;
  onOpen3D?: () => void;
  
  undoEnabled?: boolean;
  redoEnabled?: boolean;
  onSave?: () => void | Promise<void>;
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
  onOpenSetup,
  onOpenReview,
  onOpenExport,
  onOpenTransitions,
  onOpen3D,
  
  undoEnabled = true,
  redoEnabled = true,
  onSave,
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
            className="inline-flex items-center justify-center h-8 w-8 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="More"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 min-w-[10rem] rounded-md border bg-popover shadow-lg z-50 py-1 text-sm"
            >
              <MenuItem
                label="Review"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenReview();
                }}
              />
              <MenuItem
                label="Setup"
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
              {onOpen3D && (
                <MenuItem
                  label="3D"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen3D();
                  }}
                />
              )}
              <MenuItem
                label="Export"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenExport();
                }}
              />


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
