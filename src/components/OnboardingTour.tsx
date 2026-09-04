"use client";
/**
 * OnboardingTour — first-time user guided tour with spotlight overlay.
 * Shows automatically on first login (localStorage flag "hse_tour_done").
 * Uses Framer Motion for smooth step transitions and spotlight animation.
 * Steps are keyed by data-tour attributes on DOM elements.
 */
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { useSidebarCollapse } from "./SidebarCollapseContext";
import { Button } from "./ui/Button";

/* ─────────────────────────── tour steps ────────────────────────────── */
const STEPS = [
  {
    id:       "welcome",
    title:    "Welcome to HSE Hub",
    body:     "Your all-in-one analytics and operations portal for Health & Safety Experts GmbH. Let us show you around — it takes about 45 seconds.",
    target:   null, // no spotlight for welcome
    position: "center",
  },
  {
    id:       "overview",
    title:    "Business Overview",
    body:     "Your executive dashboard. Live billable utilisation, hours at risk, open tasks, and a trend chart — all synced from Asana, TrackingTime, and Factorial every few minutes.",
    target:   "tour-overview",
    position: "right",
  },
  {
    id:       "team-lead",
    title:    "Team Lead View",
    body:     "Workload booking board for the current 4-week window. Approve or reject time entries, spot over-allocated people at a glance, and take action before the week closes.",
    target:   "tour-teamlead",
    position: "right",
  },
  {
    id:       "people",
    title:    "People Directory",
    body:     "Every person in the org with their active assignments, qualifications, and utilisation rate. Click any row to see the full profile.",
    target:   "tour-people",
    position: "right",
  },
  {
    id:       "projects",
    title:    "Project Ledger",
    body:     "All active projects with contract hours, billable hours logged, consumption %, and delivery timeline. Drill into any project to see task breakdowns.",
    target:   "tour-projects",
    position: "right",
  },
  {
    id:       "timesheets",
    title:    "Timesheets",
    body:     "Your personal weekly timesheet view — log hours, review past entries, and export. Data syncs back to TrackingTime automatically.",
    target:   "tour-timesheets",
    position: "right",
  },
  {
    id:       "sync",
    title:    "Live Sync Status",
    body:     "The sync bar at the top shows how fresh each data source is. Green = synced within minutes. RETRY means we're re-attempting a failed pull — nothing for you to do.",
    target:   "tour-sync",
    position: "bottom",
  },
  {
    id:       "done",
    title:    "You're all set",
    body:     "HSE Hub updates every few minutes in the background. You can replay this tour any time from the Help menu in the sidebar. Happy analysing!",
    target:   null,
    position: "center",
  },
] as const;

/* ─────────────────────── spotlight rect helper ─────────────────────── */
interface Rect { top: number; left: number; width: number; height: number }

function getTargetRect(tourId: string): Rect | null {
  const el = document.querySelector(`[data-tour="${tourId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 };
}

/* ─────────────────────────── component ─────────────────────────────── */
export default function OnboardingTour() {
  const [step,    setStep]    = useState(0);
  const [rect,    setRect]    = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  /*
    THE STEPS THIS PARTICULAR USER CAN ACTUALLY BE SHOWN.

    STEPS is written for a reader who has every nav item. Nobody does: the
    Team Lead step spotlights `tour-teamlead`, which NAV_GROUPS gates to exec
    and dept_head, so an employee's first login has always narrated a feature
    beside an empty patch of sidebar -- getTargetRect() returns null, the
    spotlight is skipped, and the card explains a page that is not there. A
    role restricted to a single route (nav-access.ts) turns that from one odd
    step into five.

    Filtered by whether the target is IN THE DOM rather than by role: the
    sidebar has already decided who sees what, and asking the rendered result
    means this component never has to hold a second, drifting copy of that
    rule.
  */
  const [steps,   setSteps]   = useState<(typeof STEPS)[number][]>([...STEPS]);
  const { setForcedOpen } = useSidebarCollapse();

  /*
    Hold the sidebar open for the duration of the tour.

    Five of the eight steps spotlight a sidebar nav link via its `data-tour`
    attribute.

    This used to be about the elements not existing: the sidebar collapsed to
    width 0, so `getTargetRect` returned a 0x0 box and five steps narrated
    navigation that was not on screen. The rail fixed that -- the links are
    now always mounted and measurable -- but the force is still right for a
    different reason: in the rail those targets are 40px unlabelled icons, so
    a first-run tour would spotlight a wordless glyph while the card explains
    a feature by name. Someone learning the app should see the labels.

    This does NOT overwrite the stored preference: the provider layers
    `forcedOpen` on top, so a collapsed sidebar springs back shut when the
    tour finishes.
  */
  useEffect(() => {
    if (!visible) return;
    setForcedOpen(true);
    return () => setForcedOpen(false);
  }, [visible, setForcedOpen]);

  // Show tour only on first login
  useEffect(() => {
    const done = localStorage.getItem("hse_tour_done");
    if (!done) {
      // Small delay so the page renders first
      const t = setTimeout(() => {
        // Resolved HERE, at the moment the tour opens, because that is the
        // first instant the sidebar is guaranteed mounted. The two targetless
        // steps (welcome, done) always survive, so the tour can never filter
        // itself down to nothing.
        setSteps(
          STEPS.filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`)),
        );
        setVisible(true);
      }, 800);
      return () => clearTimeout(t);
    }
  }, []);

  // Update spotlight rect when step changes. useLayoutEffect (not useEffect):
  // this reads live DOM geometry and must set state before the browser paints,
  // or the spotlight visibly jumps from the previous step's position.
  useLayoutEffect(() => {
    if (!visible) return;
    const current = steps[step];
    // No target for this step: leave `rect` as-is rather than clearing it
    // here (that would be a direct setState call in the effect body).
    // Render already gates the spotlight/card on `current.target`, so a
    // stale rect from the previous step is never shown.
    if (!current.target) return;

    const update = () => {
      const r = getTargetRect(current.target as string);
      setRect(r);
    };

    update();
    /*
      Re-measure after the sidebar's 220ms open animation as well as on resize.
      The first measurement can land while the panel is still sliding out, which
      would pin the spotlight to a half-open position and leave it there.
    */
    const settle = setTimeout(update, 260);
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("resize", update);
    };
  }, [step, visible, steps]);

  const next = useCallback(() => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      localStorage.setItem("hse_tour_done", "1");
      setVisible(false);
    }
  }, [step, steps.length]);

  const skip = useCallback(() => {
    localStorage.setItem("hse_tour_done", "1");
    setVisible(false);
  }, []);

  if (!visible) return null;

  const current = steps[step];
  const isFirst = step === 0;
  const isLast  = step === steps.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9000] pointer-events-none"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(1px)" }}
          >
            {/* Spotlight cutout using SVG clip */}
            {current.target && rect && (
              <motion.div
                key={current.id + "-spot"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0"
                style={{ pointerEvents: "none" }}
              >
                <svg width="100%" height="100%" className="absolute inset-0">
                  <defs>
                    <mask id="spotlight-mask">
                      <rect width="100%" height="100%" fill="white" />
                      <motion.rect
                        key={current.id}
                        initial={{ opacity: 0 }}
                        animate={{
                          opacity: 1,
                          x: rect.left,
                          y: rect.top,
                          width: rect.width,
                          height: rect.height,
                        }}
                        transition={{ type: "spring", stiffness: 300, damping: 35 }}
                        rx="10"
                        fill="black"
                      />
                    </mask>
                  </defs>
                  <rect
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.72)"
                    mask="url(#spotlight-mask)"
                  />
                </svg>

                {/* Glowing border around spotlight */}
                <motion.div
                  key={current.id + "-glow"}
                  animate={{
                    top:    rect.top,
                    left:   rect.left,
                    width:  rect.width,
                    height: rect.height,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 35 }}
                  className="absolute rounded-xl"
                  style={{
                    /*
                     * Brand accent, not the old gold. DESIGN.md names #d4a843
                     * "the previous placeholder palette, not the real brand",
                     * and this tour is the FIRST thing a new colleague sees —
                     * it was introducing the product in a colour the product
                     * does not use anywhere else.
                     */
                    boxShadow:
                      "0 0 0 2px var(--accent), 0 0 20px var(--accent-wash)",
                    pointerEvents: "none",
                  }}
                />
              </motion.div>
            )}
          </motion.div>

          {/* ── Tour card ── */}
          <div
            className="fixed inset-0 z-[9001] flex items-center justify-center pointer-events-none"
            style={
              // A step with a target is never positioned "center" (only the
              // targetless welcome/done steps are), so this is exhaustive.
              current.target && rect
                ? getCardStyle(rect, current.position as "right" | "bottom")
                : {}
            }
          >
            <motion.div
              key={current.id}
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1,    y: 0 }}
              exit={{    opacity: 0, scale: 0.95,  y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="pointer-events-auto w-[340px] max-w-[90vw] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-6"
              /*
               * A real offset + blur, not a zero-offset halo: craft-floor is
               * explicit that a glow with no offset is decoration rather than
               * depth. This card floats above the whole app, so it earns the
               * largest shadow in the product.
               */
              style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)" }}
            >
              {/* Progress dots */}
              <div className="flex gap-1.5 mb-4">
                {steps.map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      width:   i === step ? 20 : 6,
                      opacity: i <= step ? 1 : 0.25,
                    }}
                    transition={{ duration: 0.3 }}
                    className="h-1.5 rounded-full bg-[var(--accent)]"
                  />
                ))}
              </div>

              {/* Content */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id + "-text"}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{    opacity: 0, x: -12 }}
                  transition={{ duration: 0.22 }}
                >
                  <h3 className="mb-2 text-[17px] font-semibold leading-snug text-[var(--text-primary)]">
                    {current.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                    {current.body}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Actions */}
              <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4">
                <Button variant="ghost" size="md" onClick={skip}>
                  {isFirst ? "Skip tour" : "End tour"}
                </Button>

                <div className="flex gap-2">
                  {step > 0 && !isFirst && (
                    <Button variant="secondary" size="md" onClick={() => setStep((s) => s - 1)}>
                      Back
                    </Button>
                  )}
                  {/*
                    "Finish", not "Finish 🎉": craft-floor bans emoji standing
                    in for an icon system, and this one sat next to two arrows
                    that are also not from any icon set. Plain words are the
                    honest version at this size.
                  */}
                  <Button variant="primary" size="md" onClick={next}>
                    {isLast ? "Finish" : isFirst ? "Start tour" : "Next"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Position the card next to the spotlight target ── */
function getCardStyle(rect: Rect, position: "right" | "bottom"): React.CSSProperties {
  if (position === "right") {
    return {
      alignItems:     "flex-start",
      justifyContent: "flex-start",
      paddingLeft:    `${rect.left + rect.width + 20}px`,
      paddingTop:     `${Math.max(20, rect.top)}px`,
    };
  }
  return {
    alignItems:    "flex-end",
    paddingBottom: `${window.innerHeight - rect.top + 16}px`,
  };
}
