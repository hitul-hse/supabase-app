"use client";

/**
 * One MotionConfig for the app shell.
 *
 * `reducedMotion="user"` is what makes framer-motion honour the operating
 * system's reduce-motion setting. It does NOT do so by default -- the default
 * is "never" (measured: with the OS preference on, every JS spring still ran
 * at full amplitude while every CSS entrance was correctly disabled). DESIGN.md
 * used to claim the opposite; it is corrected alongside this file.
 *
 * Under "user", transform and layout animations become instant and opacity
 * cross-fades stay, which is exactly the reduced-motion contract the CSS side
 * already keeps (globals.css kills entrances outright, keeps colour changes).
 *
 * A client component so the server layout can wrap its tree without becoming
 * a client boundary itself.
 */
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
