/**
 * The springs this app animates with. Plain constants, no "use client":
 * both server and client modules may import them.
 *
 * APPLE'S PARAMETERS, MOTION'S PHYSICS. Apple's designer-facing spring API is
 * (response, damping ratio): response is the undamped period in seconds and
 * the damping ratio is 1.0 for no overshoot (SwiftUI `Spring(response:
 * dampingRatio:)`; WWDC18 803 "Designing Fluid Interfaces"). That maps onto a
 * mass/stiffness/damping spring exactly:
 *
 *   stiffness = (2π / response)²          damping = 2 · ratio · √stiffness
 *
 * and `appleSpring()` below writes the constants in that form, on purpose.
 *
 * WHY NOT `bounce` + `visualDuration` (the form these constants used to have).
 * motion-dom 13.0.0 (`animation/generators/spring.mjs`, getSpringOptions)
 * treats any spring that names `bounce` or `duration` without stiffness/
 * damping/mass as "time-defined" and sets `velocity = 0` before it reads
 * `visualDuration` -- so a drag released at 1,000 px/s restarted its spring
 * from rest, and the `velocity` option MobileSidebar passed was discarded.
 * Measured with the generator itself: `{ bounce: 0, visualDuration: 0.3,
 * velocity: 1500 }` starts at 0 px/s; the physics form starts at 1,500. A
 * physics spring also has no fixed duration, which is what lets a re-target
 * mid-flight continue from the presentation value and velocity (APPLE_REF
 * §6.1 #3, apple-design §3, §5).
 *
 * Note that neither Motion key was Apple's number anyway: `visualDuration` v
 * gives ω = 2π / (1.2 · v) (a response of 1.2 v), and `duration` d solves for
 * the settle time (a response of roughly d / 1.5). DESIGN.md's `{ bounce: 0,
 * duration: 0.4 }` and the old `visualDuration: 0.4` were two different
 * springs.
 *
 * The values are APPLE_REF §6.2's table, one constant per row:
 *
 *   SPRING_POPOVER  response 0.28  popovers, menus, dropdowns (`.smooth` shape)
 *   SPRING_UI       response 0.35  dialogs and anything that appears in place
 *   SPRING_MOVE     response 0.40  the mobile sheet; anything that changes
 *                                  place after a slow release
 *   SPRING_FLICK    response 0.40  the sheet after a FLICK only: damping 0.85
 *   damping 0.85                   (bounce 0.15, Apple's "80% damping when the
 *                                  gesture carried momentum"; `.snappy`)
 *
 * Critically damped everywhere else: "No bounce on data tables, form fields,
 * or navigation" (DESIGN.md) and "when you're not sure, use a spring with
 * bounce 0" (WWDC23 10158). Physicality comes from interruptibility and the
 * velocity hand-off, not from overshoot.
 *
 * Reduced motion: these do NOT consult the OS setting themselves. Declarative
 * `motion.*` props inherit it from the app shell's
 * `<MotionConfig reducedMotion="user">` (transforms become instant, opacity
 * cross-fades stay). An imperative `animate(value, …)` does not go through
 * MotionConfig -- a caller that animates a MotionValue by hand must branch on
 * `useReducedMotion()` itself (MobileSidebar does).
 */
import type { Transition } from "framer-motion";

/** Apple's `Spring(response:dampingRatio:)` as Motion physics; mass 1. */
export function appleSpring(response: number, dampingRatio = 1): Transition {
  const stiffness = (2 * Math.PI / response) ** 2;
  return { type: "spring", mass: 1, stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness) };
}

export const SPRING_POPOVER: Transition = appleSpring(0.28);

export const SPRING_UI: Transition = appleSpring(0.35);

export const SPRING_MOVE: Transition = appleSpring(0.4);

export const SPRING_FLICK: Transition = appleSpring(0.4, 0.85);

/**
 * The one easing every CSS transition in the shell shares (`--ease-out` in
 * globals.css), for the few framer tweens that must match a CSS neighbour.
 */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
