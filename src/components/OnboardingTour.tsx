"use client";
/**
 * OnboardingTour — first-time user guided tour with spotlight overlay.
 * Shows automatically on first login (localStorage flag "hse_tour_done").
 * Uses Framer Motion for smooth step transitions and spotlight animation.
 * Steps are keyed by data-tour attributes on DOM elements.
 */
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";

/* ─────────────────────────── tour steps ────────────────────────────── */
const STEPS = [
  {
    id:       "welcome",
    title:    "Welcome to HSE Hub 👋",
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
    title:    "You're all set! 🚀",
    body:     "HSE Hub updates every few minutes in the background. You can replay this tour any time from the Help menu in the sidebar. Happy analysing!",
    target:   null,
    position: "center",
  },
] as const;

type Step = typeof STEPS[number];

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
  const rAF = useRef<number>(0);

  // Show tour only on first login
  useEffect(() => {
    const done = localStorage.getItem("hse_tour_done");
    if (!done) {
      // Small delay so the page renders first
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  // Update spotlight rect when step changes
  useEffect(() => {
    if (!visible) return;
    const current = STEPS[step];
    if (!current.target) { setRect(null); return; }

    const update = () => {
      const r = getTargetRect(current.target as string);
      setRect(r);
    };

    update();
    // Re-measure on resize
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [step, visible]);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      localStorage.setItem("hse_tour_done", "1");
      setVisible(false);
    }
  }, [step]);

  const skip = useCallback(() => {
    localStorage.setItem("hse_tour_done", "1");
    setVisible(false);
  }, []);

  if (!visible) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;

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
            {rect && (
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
                    boxShadow: "0 0 0 2px #d4a843, 0 0 20px rgba(212,168,67,0.4)",
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
              rect && current.position !== "center"
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
              className="pointer-events-auto bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 w-[340px] max-w-[90vw]"
              style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,168,67,0.15)" }}
            >
              {/* Progress dots */}
              <div className="flex gap-1.5 mb-4">
                {STEPS.map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      width:   i === step ? 20 : 6,
                      opacity: i <= step ? 1 : 0.25,
                    }}
                    transition={{ duration: 0.3 }}
                    className="h-1.5 rounded-full bg-[#d4a843]"
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
                  <h3 className="text-white font-bold text-lg mb-2 leading-snug">
                    {current.title}
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {current.body}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Actions */}
              <div className="flex items-center justify-between mt-5 pt-4 border-t border-zinc-800">
                <button
                  onClick={skip}
                  className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
                >
                  {isFirst ? "Skip tour" : "End tour"}
                </button>

                <div className="flex gap-2">
                  {step > 0 && !isFirst && (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setStep(s => s - 1)}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 transition-colors"
                    >
                      Back
                    </motion.button>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{  scale: 0.97 }}
                    onClick={next}
                    className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#d4a843] text-zinc-900 hover:bg-[#e0b84a] transition-colors shadow-md"
                  >
                    {isLast ? "Finish 🎉" : isFirst ? "Start tour →" : "Next →"}
                  </motion.button>
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
