/**
 * Menu — the M2 "raised" material as a menu, in classes (APPLE_REF §4.2 M2,
 * §5.8 "Popover / menu").
 *
 * PANEL: opaque `--surface-raised` (one step lighter than the card layer in
 * dark, so it reads as floating above it), `--border-strong` rim, the
 * `card-elev-raised` shadow class, radius `--radius-lg` (8). Both elevation
 * mechanisms ship; dark leans on fill + rim, light on the shadow (§4.2 rule 4).
 *
 * ITEMS: 32 px tall (the `md` control height, §3.2), hover `--surface-hover`,
 * radius `--radius-sm`. Concentric with the panel: the panel insets its
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
  "flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left t-callout text-[var(--text-primary)] transition-[color,background-color] duration-150 hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent";

export function MenuSeparator() {
  return <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-[var(--border)]" />;
}
