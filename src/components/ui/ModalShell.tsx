"use client";

/**
 * ModalShell — the scrim, the panel motion and the modality of every dialog
 * in the app, in one place.
 *
 * WHY IT EXISTS
 * -------------
 * `DrillDialog` had all of this and got it right. Two other dialogs — the
 * Overview hero's week drill-down and the Management matrix's — were written
 * before it and had none of it: they entered on `.rise-in` (the PAGE-LOAD
 * vocabulary, on an overlay), they left in a single frame with no exit at
 * all, their scrim was an inline `rgba()` that belonged to no token carrying
 * a `backdrop-filter: blur(4px)` that DrillDialog had already MEASURED as
 * halving the frame rate of this exact animation, they never trapped focus,
 * they never returned it, and one of them never locked the page behind it.
 *
 * A third hand-rolled copy would have been the wrong answer to that, so the
 * contract moved here and DrillDialog became its first caller. Nothing about
 * its rendered DOM changed: the panel still carries `data-drill-dialog` and
 * `data-check`, the scrim still carries `data-exiting`, and the deployed-page
 * gates still read all three.
 *
 * THE MOTION (APPLE_REF §6.2 "Dialog")
 * ------------------------------------
 *   scrim   opacity 0 → 1 over 200 ms, out in 150 ms
 *   panel   scale .96 → 1 + opacity on SPRING_UI (Apple response 0.35,
 *           damping 1.0 — no bounce; §6.2 gives bounce only to a flicked
 *           sheet), FROM THE TRIGGER'S OFFSET, out in a 150 ms tween along
 *           the same path
 *
 * Same values in and out, so the exit runs the entrance's path in reverse
 * (§6.1 #6) and an interrupted entrance reverses from wherever the panel has
 * got to. The TIMING is deliberately asymmetric: the arrival is what the
 * reader watches, the dismissal is something they have already decided
 * ("don't make people wait for an animation to complete").
 *
 * INTERRUPTIBLE, AND NOT LOCKED OUT. Both animations start from the
 * presentation value, so Escape mid-entrance and a re-tap mid-exit re-target
 * without a cut, and the physics spring carries the velocity through
 * (animations/springs.ts). Modality is released on PRESENCE, not on the
 * caller's `open` flag: the exit is 150 ms of motion, not 150 ms of modality
 * (§6.1 #3). The scrim stops hit-testing the moment a dismissal begins —
 * before this rule existed in DrillDialog, a full-viewport element kept
 * catching every click for ~500 ms, invisible for the last 350 of them.
 *
 * REDUCE MOTION: the panel keeps §6.2's 150 ms opacity fade and loses the
 * spring; the scale and the travel are snapped by `<MotionConfig
 * reducedMotion="user">` in the app shell.
 *
 * WHAT THIS DOES NOT OWN: the panel's contents, its width, or its header.
 * A caller passes `panelClassName` and children and keeps its own layout.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, useIsPresent, useReducedMotion } from "framer-motion";
import { EASE_OUT, SPRING_UI } from "@/components/animations/springs";

/**
 * Where the dialog comes from: the trigger's centre, as an offset from the
 * viewport centre, clamped so a tile at the far edge still arrives from
 * nearby rather than flying in. Apple's spatial-consistency rule — a panel
 * emerges from the element that opened it and returns there.
 */
export type DialogOrigin = { x: number; y: number };

const ORIGIN_REACH = 160;

/** The origin for a dialog opened from `el`, or null when there is no viewport (SSR). */
export function dialogOriginFrom(el: Element): DialogOrigin | null {
  const r = el.getBoundingClientRect();
  return dialogOriginFromPoint(r.left + r.width / 2, r.top + r.height / 2);
}

/**
 * The origin for a dialog opened AT a point rather than from a box — a click
 * inside a chart, where the thing that was tapped is a coordinate and not an
 * element. Null when there is no viewport (SSR) or when the caller has no
 * point to offer (a keyboard activation), in which case the panel scales from
 * the middle of the screen, which is the honest answer to "it came from
 * nowhere in particular".
 */
export function dialogOriginFromPoint(x: number, y: number): DialogOrigin | null {
  if (typeof window === "undefined") return null;
  const clamp = (v: number) => Math.max(-ORIGIN_REACH, Math.min(ORIGIN_REACH, v));
  return { x: clamp(x - window.innerWidth / 2), y: clamp(y - window.innerHeight / 2) };
}

/** What Tab can land on inside the panel. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({
  label,
  onDismiss,
  origin = null,
  returnFocusTo = null,
  initialFocusTo = null,
  panelClassName = "",
  panelProps,
  children,
}: {
  /** The dialog's accessible name. */
  label: string;
  onDismiss: () => void;
  /** The trigger's centre relative to the viewport centre; absent, it scales from the middle. */
  origin?: DialogOrigin | null;
  /**
   * Where focus goes when the dialog closes. A trigger component passes its
   * button; a caller that opens the dialog from its own state may leave this
   * out, and the element that was active when the dialog mounted is used.
   */
  returnFocusTo?: RefObject<HTMLElement | null> | null;
  /**
   * What takes focus on open — the Close button, by convention. Left out,
   * the panel itself takes it, which still keeps a keyboard user inside.
   */
  initialFocusTo?: RefObject<HTMLElement | null> | null;
  panelClassName?: string;
  /** Extra attributes for the panel: `data-*` handles the gates read, mostly. */
  panelProps?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  /*
    False from the moment the caller dismisses until AnimatePresence has
    finished the exit. Everything that makes the dialog OWN the page -- the
    scrim's hit-testing, the scroll lock, Escape, focusability -- is released
    on this flag, not on unmount. True when rendered outside an
    AnimatePresence, so nothing here depends on one.
  */
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();

  /*
    FOCUS, TRAPPED AND RETURNED (APPLE_REF §5.8 "Dialog"; WAI-ARIA modal
    dialog).

    The opener is captured on the open transition (`present` true), BEFORE
    the initial-focus target takes focus -- a Close button must not carry
    `autoFocus`, because React focuses an autoFocus child during commit,
    ahead of this component's effects, and the capture would then read the
    dialog's own button. The capture is IDEMPOTENT: with reactStrictMode
    (next.config.ts) the effect runs twice on mount, and the second run finds
    activeElement on the button the first run just focused. A capture that
    overwrote the ref on every run therefore returned focus to a button that
    was about to be inert. Now `returnFocusTo` always wins, otherwise the ref
    is written once, and never with an element inside the panel. Every
    dismissal (Escape, a Close button, a tap on the scrim) goes through
    `dismiss`, which hands focus back synchronously, before the exit starts
    and `inert` would drop it to <body>. The effect's cleanup is the fallback
    for a caller that closes the dialog from its own state: a frame later, if
    the panel is gone or inert and focus is on <body> or still inside the
    panel, it goes to the opener. (Deferred and conditioned on the panel,
    because StrictMode also runs the cleanup once while the dialog is very
    much open.)

    The trap is the Tab handler on the panel: Tab from the last focusable
    wraps to the first, Shift+Tab from the first to the last, and a Tab from
    anywhere outside (a screen reader's virtual cursor) re-enters at the
    first. Only while `present`: a closing dialog is not a place to be.

    THE TRAP HAS TO HOLD ON A CLICK, TOO. The panel carries tabIndex -1, so a
    click on its non-focusable text (the title, a figure, a row without a
    link) focuses the panel itself instead of dropping focus to <body> --
    from <body>, Shift+Tab walked out to the page behind the scrim
    (measured). Browsers that would not focus the container on click get the
    same result from the pointerdown handler, which checks a frame later and
    focuses the panel if focus landed outside it.
  */
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    onDismiss();
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
  }, [onDismiss]);

  useEffect(() => {
    if (!present) return;
    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    const outside =
      active && active !== document.body && !(panel?.contains(active) ?? false) ? active : null;
    if (returnFocusTo?.current) openerRef.current = returnFocusTo.current;
    else if (!openerRef.current) openerRef.current = outside;
    (initialFocusTo?.current ?? panel)?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      setTimeout(() => {
        // Still open: StrictMode's simulated unmount, or nothing to do.
        if (panel?.isConnected && !panel.hasAttribute("inert")) return;
        const a = document.activeElement;
        const lost = a === document.body || (panel !== null && a instanceof Node && panel.contains(a));
        if (lost && opener?.isConnected) opener.focus();
      }, 0);
    };
  }, [present, returnFocusTo, initialFocusTo]);

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !present) return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    // -1: focus is on the panel itself (after a click on its text) or outside
    // it; either way the next Tab re-enters at an end.
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const wrap = e.shiftKey ? idx <= 0 : idx === -1 || idx === items.length - 1;
    if (wrap) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  };

  const onPanelPointerDown = () => {
    // mousedown (and its default focus move) follows pointerdown; check after it.
    setTimeout(() => {
      const panel = panelRef.current;
      if (!present || !panel) return;
      const a = document.activeElement;
      if (!(a instanceof Node) || !panel.contains(a)) panel.focus({ preventScroll: true });
    }, 0);
  };

  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the dialog owns the viewport.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [dismiss, present]);

  /*
    The panel's resting pose and its off-stage pose: the same values in and
    out, so the exit runs the entrance's path in reverse.
  */
  const offstage = { opacity: 0, scale: 0.96, x: origin?.x ?? 0, y: origin?.y ?? 0 };
  const exitTween = { duration: 0.15, ease: EASE_OUT };

  return (
    <motion.div
      // `.scrim` (globals.css) owns the dim -- and only the dim: APPLE_REF
      // §4.2 gives M5 no blur, and the 4 px one this shell's predecessors had
      // halved the frame rate of this very animation (measured; see the
      // class). It replaces an inline rgba() that belonged to no token.
      //
      // HIT-TESTABLE ONLY WHILE PRESENT: a dismissal that has begun no longer
      // owns the page, and `data-exiting` is readable by a deployed check.
      className="scrim fixed inset-0 z-50 flex items-center justify-center p-4 data-[exiting]:pointer-events-none"
      data-exiting={present ? undefined : ""}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={dismiss}
      role="presentation"
    >
      <motion.div
        {...panelProps}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        onPointerDown={onPanelPointerDown}
        initial={offstage}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ ...offstage, transition: exitTween }}
        // Reduce Motion: MotionConfig already snaps the transform; the
        // opacity keeps §6.2's 150 ms fade rather than a 350 ms spring.
        transition={reduceMotion ? { duration: 0.15 } : SPRING_UI}
        // A dialog on its way out is neither a tab stop nor a target: inert
        // also drops it from the a11y tree, so a screen reader is not read a
        // dialog that is closing.
        inert={!present}
        aria-hidden={!present}
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
