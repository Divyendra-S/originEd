"use client";

/**
 * Which page the preview is showing. Top right, next to the status pill, because
 * it is true of the project rather than of the page — the same argument that
 * keeps Browse/Select and the viewport switcher down on the preview's own bar
 * (§10).
 *
 * Every option renders something: there is no "all pages" entry, because
 * stacking two unrelated designs in one scroll is what the switcher exists to
 * stop.
 *
 * This was a native `<select>`, on the argument that the platform already does
 * focus and arrow keys. The cost was that it is the platform's LOOK too: a
 * white, system-font, square-cornered menu dropping out of a near-black bar,
 * with no way to reach it — `<option>` takes almost no styling in any browser,
 * and none at all for the popup itself. One control in the whole editor rendered
 * by a different design system reads as unfinished, so the menu is ours now and
 * the keyboard contract is re-implemented deliberately: arrows wrap (`menu.ts`),
 * Home/End jump, Enter and Space choose, Escape closes and hands focus back to
 * the trigger, and Tab out closes on the way.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Layers } from "lucide-react";
import { nextIndex } from "./menu";

export interface PageOption {
  slug: string;
  label: string;
}

export function PageSwitcher({
  pages,
  value,
  onChange,
}: {
  pages: readonly PageOption[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Where the keyboard is. Only meaningful while open. */
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();

  const selected = pages.findIndex((p) => p.slug === value);
  const label = pages[selected]?.label ?? value;

  /** `focus` only when the keyboard opened it — a mouse user's cursor is already there. */
  const close = useCallback((focus: boolean) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);

  const openAt = useCallback(
    (index: number) => {
      setActive(Math.max(0, Math.min(index, pages.length - 1)));
      setOpen(true);
    },
    [pages.length],
  );

  const choose = useCallback(
    (slug: string) => {
      onChange(slug);
      close(true);
    },
    [close, onChange],
  );

  // Focus follows `active` so the browser's own focus ring does the work and
  // screen readers announce each option as it is reached — the alternative,
  // `aria-activedescendant`, means reimplementing both.
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus();
  }, [open, active]);

  // A click anywhere else dismisses. `pointerdown` rather than `click` so the
  // menu is gone before the thing underneath reacts, and captured so a handler
  // that stops propagation cannot leave the menu stranded open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative flex items-center"
      // Tab out of the last option, and the menu should not be left hanging.
      // Movement BETWEEN the trigger and the options keeps focus inside the
      // root, so this never fires on our own `focus()` calls.
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Page shown in the preview"
        title="Switch which page you are editing"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openAt(selected))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAt(selected);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(pages.length - 1);
          }
        }}
        className={`flex h-7 items-center gap-1.5 rounded-chip border pr-1.5 pl-2 text-ui-xs transition-colors ${
          open
            ? "border-oe-border-strong bg-oe-raised text-oe-text"
            : "border-oe-border text-oe-muted hover:border-oe-border-strong hover:text-oe-text"
        }`}
      >
        <Layers className="size-3.5 shrink-0 text-oe-faint" strokeWidth={1.75} aria-hidden />
        {label}
        <ChevronDown
          className={`size-3 shrink-0 text-oe-faint transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listId}
            role="listbox"
            aria-label="Page shown in the preview"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            onKeyDown={(e) => {
              const next = nextIndex(e.key, active, pages.length);
              if (next !== null) {
                e.preventDefault();
                setActive(next);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                close(true);
              }
            }}
            className="absolute top-[calc(100%+6px)] right-0 z-50 min-w-44 rounded-control border border-oe-border-strong bg-oe-raised p-1 shadow-[0_16px_40px_rgb(0_0_0/0.55)]"
          >
            {pages.map((page, index) => {
              const isSelected = page.slug === value;
              return (
                <button
                  key={page.slug}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => choose(page.slug)}
                  // Pointing at an option IS moving to it, so the mouse and the
                  // arrow keys cannot end up disagreeing about which row is lit.
                  onPointerEnter={() => setActive(index)}
                  className={`flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-ui-xs transition-colors outline-none ${
                    index === active ? "bg-oe-border text-oe-text" : "text-oe-muted"
                  }`}
                >
                  <Check
                    className={`size-3 shrink-0 ${isSelected ? "text-oe-accent" : "text-transparent"}`}
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  <span className="truncate">{page.label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
