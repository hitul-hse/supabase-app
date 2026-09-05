/**
 * The two springs this app animates with. Plain constants, no "use client":
 * both server and client modules may import them.
 *
 * Apple's designer-facing spring API is (damping ratio, response). Motion's
 * `bounce` + `visualDuration` maps onto it directly: `bounce: 0` is a damping
 * ratio of 1.0 (critically damped, no overshoot), and `visualDuration` is the
 * time the value takes to VISUALLY reach its target -- Apple's "response",
 * not the mathematical settle time. framer-motion 13 supports both keys
 * (motion-dom's spring generator reads `visualDuration`).
 *
 * Two, deliberately, and no third:
 *
 *   SPRING_UI    damping 1.0 / response 0.3  -- Apple's "default UI" spring.
 *                Dialogs, sheets, tour cards: anything that appears.
 *   SPRING_MOVE  damping 1.0 / response 0.4  -- Apple's "move / reposition".
 *                The sidebar collapsing, anything that changes size or place.
 *
 * No bounce anywhere. DESIGN.md: "No bounce on data tables, form fields, or
 * navigation" -- and on an operations console that is everything. Physicality
 * comes from interruptibility and velocity hand-off (a spring re-targets from
 * its current value and carries its velocity), not from overshoot.
 */
import type { Transition } from "framer-motion";

export const SPRING_UI: Transition = { type: "spring", bounce: 0, visualDuration: 0.3 };

export const SPRING_MOVE: Transition = { type: "spring", bounce: 0, visualDuration: 0.4 };
