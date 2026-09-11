/**
 * Menu — the M2 "raised" material as a menu, in classes (APPLE_REF §4.2 M2,
 * §5.8 "Popover / menu").
 *
 * PANEL: opaque `--surface-raised` (one step lighter than the card layer in
 * dark, so it reads as floating above it), `--border-strong` rim, the
 * `card-elev-raised` shadow class, radius `--radius-lg` (8). Both elevation
 * mechanisms ship; dark leans on fill + rim, light on the shadow (§4.2 rule 4).
 *
 * ITEMS: 32 px tall (the `md` control height, §3.2) on a fine pointer and
 * 44 px on a coarse one (`pointer-coarse:h-11`; §3.2 "touch 44", §8 #19) --
 * below `sm` the language and theme rows ARE the phone's overflow for two
 * bar buttons that were 44 x 44, and a row that shrank them to 32 gave the
 * thumb less than the bar had (measured 190 x 32 at 390). Hover
 * `--surface-hover`, radius `--radius-sm`. Concentric with the panel: the panel insets its
 * children by 4 px (`p-1`), so an inner radius of max(8 − 4, 2) = 4 is exactly
 * `--radius-sm` [Apple: WWDC25 356]. Keyboard focus tints the row the same way
 * hover does, because a menu's focused item IS its highlighted item; the ring
 * stays on top of that.
 *
 * Plain classes rather than components so `LogoutButton` / `TourReplayButton`
 * can be menu items without a component wrapping a component. Keep this file
 * free of any import from a menu (UserMenu imports the buttons, the buttons
 * import this) or the module graph goes circular.
 */

export const menuPanelClass =
  "z-50 min-w-[200px] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 card-elev-raised";

export const menuItemClass =
  "flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left t-callout pointer-coarse:h-11 text-[var(--text-primary)] transition-[color,background-color] duration-150 hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent";

export function MenuSeparator() {
  return <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-[var(--border)]" />;
}

/**
 * The chosen-item marker for a menu that offers a choice (APPLE_REF §5.8:
 * "chosen = `IconCheck` + `--text-primary`, NOT colour alone").
 *
 * The slot is 16 px whether or not the check is drawn, so the labels of a
 * choice list stay on one leading edge and the rows do not shift by the width
 * of a glyph when the choice moves. `aria-hidden`, because the row already
 * carries the fact in `aria-checked` / `aria-current` — an assistive reader
 * that heard both would hear it twice.
 *
 * Deliberately not imported from `nav-icons`: this file is the vocabulary the
 * menu rows share and must stay importable from anywhere without pulling the
 * whole icon set behind it.
 */
export function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="flex h-4 w-4 flex-none items-center justify-center">
      {checked && (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" className="text-[var(--text-primary)]">
          <path
            d="M3.25 8.5 6.25 11.5 12.75 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
