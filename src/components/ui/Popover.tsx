"use client";

/**
 * PopoverPanel — the one arrival and departure every dropdown in the app
 * shares.
 *
 * WHY IT EXISTS
 * -------------
 * Four surfaces open a panel under a trigger — `SearchableSelect` (the form
 * combobox), `CustomerMultiSelect` (/projects), the people picker in
 * `TeamLeadExplorer`, and `UserMenu` — and three of them were `{open && (
 * <div …/> )}`: the panel appeared in one frame and vanished in one frame. A
 * popup that has no exit reads as a rendering fault rather than a dismissal,
 * because the eye never sees where it went. `UserMenu` had already been given
 * the correct motion by hand; this is that same motion, extracted, so the
 * fourth copy is a component rather than a paste.
 *
 * THE MOTION (APPLE_REF §6.2 "Popover / menu / dropdown")
 * ------------------------------------------------------
 * `scale .96 → 1` + opacity on SPRING_POPOVER (Apple response 0.28, damping
 * 1.0 — no bounce, because §6.2 gives bounce only to a flicked sheet), from a
 * `transform-origin` AT THE TRIGGER: the panel grows out of the control that
 * opened it (§6.1 #6 spatial consistency; apple-design §7 anchored origins).
 * It leaves along the same path in a 120 ms fade — the arrival is what a
 * reader watches, the dismissal is something they have already decided
 * ("don't make people wait for an animation to complete").
 *
 * INTERRUPTIBLE AND NOT MODAL. `AnimatePresence` keeps the panel mounted for
 * those 120 ms, so re-opening mid-exit re-targets the running spring from the
 * presentation value instead of restarting from 0.96 (§6.1 #3). During the
 * exit it stops hit-testing and goes `inert`: a dropdown on its way out must
 * not swallow the click that dismissed it, and must not be a tab stop.
 *
 * REDUCE MOTION: a 150 ms opacity cross-fade and nothing else. The scale is
 * snapped by `<MotionConfig reducedMotion="user">` in the app shell, and the
 * spring is replaced here rather than merely shortened (§6.1 #9).
 *
 * WHAT THIS IS NOT: a positioning primitive. Every caller already positions
 * its own panel (`absolute left-0 mt-1`, or a measured `fixed` for a
 * portalled menu) and keeps its own outside-click, keyboard and focus
 * behaviour. This owns the arrival, the departure and the modality of the
 * departure — nothing else.
 */

import type { ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { EASE_OUT, SPRING_POPOVER } from "@/components/animations/springs";

/**
 * Which corner the panel grows from. It must match where the panel is pinned:
 * a menu that hangs below-left of its trigger has to expand from its top-left
 * corner, or it appears to slide sideways out of nothing.
 */
export type PopoverOrigin = "top left" | "top right" | "bottom left" | "bottom right";

function Panel({
  origin,
  className,
  children,
}: {
  origin: PopoverOrigin;
  className: string;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12, ease: EASE_OUT } }}
      transition={reduceMotion ? { duration: 0.15 } : SPRING_POPOVER}
      style={{ transformOrigin: origin }}
      // Leaving is not a state you can interact with, but it IS a state the
      // eye still sees: the panel keeps painting and stops responding.
      inert={!present}
      aria-hidden={!present}
      className={`${className}${present ? "" : " pointer-events-none"}`}
    >
      {children}
    </motion.div>
  );
}

export function PopoverPanel({
  open,
  origin = "top left",
  className = "",
  children,
}: {
  open: boolean;
  origin?: PopoverOrigin;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <Panel key="popover" origin={origin} className={className}>
          {children}
        </Panel>
      )}
    </AnimatePresence>
  );
}
