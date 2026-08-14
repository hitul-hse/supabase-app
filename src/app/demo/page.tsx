"use client";
/**
 * /demo — Animated product showcase for HSE Hub.
 * Auto-cycles through feature screens with smooth Framer Motion transitions.
 * No auth required — shareable link for stakeholders.
 */
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";

/* ── Feature slides ── */
const FEATURES = [
  {
    tag:      "EXECUTIVE DASHBOARD",
    title:    "Real-time business overview",
    body:     "Live billable utilisation, hours at risk, open tasks and trend charts — all synced from Asana, TrackingTime, Factorial and Samdock every few minutes.",
    accent:   "#d4a843",
    stat:     "73.4%",
    statLabel:"BILLABLE UTILISATION",
    statSub:  "+2.1 pts vs last quarter",
    bars: [
      { label: "Engineering",       pct: 81, color: "#d4a843" },
      { label: "Safety consulting", pct: 76, color: "#d4a843" },
      { label: "Training",          pct: 69, color: "#d4a843" },
      { label: "Lab & measurement", pct: 58, color: "#6b7280" },
    ],
  },
  {
    tag:      "TEAM LEAD VIEW",
    title:    "Workload board & approvals",
    body:     "Four-week rolling booking board. Spot over-allocated people instantly, approve or reject time entries, and get flags when anyone hits 105% capacity.",
    accent:   "#ef4444",
    stat:     "7",
    statLabel:"PENDING APPROVALS",
    statSub:  "6 people over capacity in W32",
    bars: [
      { label: "Anna Schmidt",    pct: 108, color: "#ef4444" },
      { label: "Max Müller",      pct: 95,  color: "#d4a843" },
      { label: "Julia Weber",     pct: 82,  color: "#22c55e" },
      { label: "Tom Fischer",     pct: 61,  color: "#6b7280" },
    ],
  },
  {
    tag:      "PEOPLE DIRECTORY",
    title:    "Your org at a glance",
    body:     "Every employee with active project assignments, qualifications, and live utilisation rate. Cross-referenced across all four systems with zero manual matching.",
    accent:   "#3b82f6",
    stat:     "41",
    statLabel:"ACTIVE PEOPLE",
    statSub:  "Across 5 departments",
    bars: [
      { label: "Back office",       pct: 100, color: "#3b82f6" },
      { label: "Engineering",       pct: 85,  color: "#3b82f6" },
      { label: "Safety consulting", pct: 70,  color: "#3b82f6" },
      { label: "Training",          pct: 55,  color: "#3b82f6" },
    ],
  },
  {
    tag:      "PROJECT LEDGER",
    title:    "Contract hours, consumed hours",
    body:     "Every project's contract hours, billable hours logged, and burn rate. Colour-coded consumption bars warn you before projects hit 90% budget.",
    accent:   "#22c55e",
    stat:     "27",
    statLabel:"ACTIVE PROJECTS",
    statSub:  "4 projects past 90% budget",
    bars: [
      { label: "Safety programme",  pct: 62, color: "#22c55e" },
      { label: "Risk assessment",   pct: 88, color: "#d4a843" },
      { label: "Compliance audit",  pct: 94, color: "#ef4444" },
      { label: "Training rollout",  pct: 45, color: "#22c55e" },
    ],
  },
  {
    tag:      "ROLE-BASED ACCESS",
    title:    "Granular RBAC, zero config",
    body:     "Four roles — Exec, Dept Head, Project Manager, Employee. Each with a fine-grained permission matrix you can toggle in the admin panel. No code changes needed.",
    accent:   "#a855f7",
    stat:     "24",
    statLabel:"CONFIGURABLE PERMISSIONS",
    statSub:  "Per role, per resource, per action",
    bars: [
      { label: "projects:read_all",   pct: 100, color: "#a855f7" },
      { label: "people:view_salary",  pct: 25,  color: "#6b7280" },
      { label: "timesheets:export",   pct: 75,  color: "#a855f7" },
      { label: "admin:users",         pct: 25,  color: "#6b7280" },
    ],
  },
] as const;

const INTERVAL = 4500;

export default function DemoPage() {
  const [current, setCurrent] = useState(0);
  const [paused,  setPaused]  = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setCurrent(c => (c + 1) % FEATURES.length), INTERVAL);
    return () => clearInterval(t);
  }, [paused]);

  const f = FEATURES[current];

  return (
    <div className="min-h-screen bg-[#080a0c] text-white flex flex-col">

      {/* ── Top nav ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/8">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hse-logo.png" alt="HSE" className="h-6 w-6 object-contain" />
          <span className="font-bold text-sm tracking-wide">HSE HUB</span>
          <span className="font-mono text-[9px] text-white/30 tracking-[0.14em] mt-0.5">PRODUCT TOUR</span>
        </div>
        <Link
          href="/auth/login"
          className="px-4 py-2 rounded-lg bg-[#d4a843] text-zinc-900 text-sm font-semibold hover:bg-[#e0b84a] transition-colors"
        >
          Sign in →
        </Link>
      </header>

      {/* ── Hero ── */}
      <section className="flex flex-col items-center text-center px-6 pt-16 pb-10 gap-4">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="px-3 py-1 rounded-full border border-[#d4a843]/30 text-[#d4a843] text-[11px] font-mono tracking-widest"
        >
          HSE HEALTH & SAFETY EXPERTS GMBH
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="text-4xl sm:text-5xl font-bold leading-tight max-w-2xl"
        >
          Your operations,
          <br />
          <span className="text-[#d4a843]">fully connected.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.6 }}
          className="text-white/50 text-base max-w-lg leading-relaxed"
        >
          HSE Hub aggregates Asana, TrackingTime, Factorial and Samdock into one
          real-time analytics console — with role-based access and live sync.
        </motion.p>
      </section>

      {/* ── Feature showcase ── */}
      <section
        className="flex-1 px-4 sm:px-8 pb-12 max-w-5xl mx-auto w-full"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Tab strip */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
          {FEATURES.map((feat, i) => (
            <button
              key={feat.tag}
              onClick={() => { setCurrent(i); setPaused(true); }}
              className="relative flex-none px-3 py-1.5 rounded-lg text-[11px] font-mono tracking-wide transition-colors"
              style={{ color: i === current ? feat.accent : "rgba(255,255,255,0.35)" }}
            >
              {feat.tag}
              {i === current && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute inset-0 rounded-lg border"
                  style={{ borderColor: feat.accent + "55", background: feat.accent + "11" }}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Main feature card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{    opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* Left: copy */}
            <div className="flex flex-col justify-center gap-5">
              <div>
                <p className="font-mono text-[10px] tracking-[0.16em] mb-3" style={{ color: f.accent }}>
                  {f.tag}
                </p>
                <h2 className="text-2xl sm:text-3xl font-bold leading-snug mb-3">
                  {f.title}
                </h2>
                <p className="text-white/50 text-sm leading-relaxed">
                  {f.body}
                </p>
              </div>

              {/* Big stat */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1,   opacity: 1 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 300 }}
                className="inline-flex flex-col gap-1 p-5 rounded-xl border"
                style={{ borderColor: f.accent + "33", background: f.accent + "0d" }}
              >
                <span className="text-4xl font-bold tabular-nums" style={{ color: f.accent }}>
                  {f.stat}
                </span>
                <span className="font-mono text-[10px] tracking-widest text-white/40">
                  {f.statLabel}
                </span>
                <span className="text-[12px] text-white/35">{f.statSub}</span>
              </motion.div>
            </div>

            {/* Right: animated bar chart */}
            <div className="flex flex-col justify-center gap-4 bg-white/[0.03] rounded-2xl border border-white/8 p-6">
              <p className="font-mono text-[10px] text-white/30 tracking-widest">LIVE DATA</p>
              <div className="flex flex-col gap-4">
                {f.bars.map((bar, bi) => (
                  <div key={bar.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-white/60">{bar.label}</span>
                      <span className="font-mono text-[11px]" style={{ color: bar.color }}>
                        {bar.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(bar.pct, 100)}%` }}
                        transition={{ delay: bi * 0.08 + 0.2, duration: 0.7, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: bar.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Progress bar */}
        <div className="mt-8 flex gap-2 justify-center">
          {FEATURES.map((_, i) => (
            <button key={i} onClick={() => { setCurrent(i); setPaused(true); }}>
              <motion.div
                animate={{ width: i === current ? 32 : 8, opacity: i === current ? 1 : 0.25 }}
                transition={{ duration: 0.3 }}
                className="h-1 rounded-full"
                style={{ background: FEATURES[i].accent }}
              />
            </button>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="border-t border-white/8 px-6 py-12 flex flex-col items-center gap-4 text-center">
        <h3 className="text-xl font-bold">Ready to connect your operations?</h3>
        <p className="text-white/40 text-sm max-w-sm">
          Deployed on Vercel · Powered by Supabase · Syncs every few minutes
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Link
            href="/auth/login"
            className="px-6 py-3 rounded-xl bg-[#d4a843] text-zinc-900 font-semibold text-sm hover:bg-[#e0b84a] transition-colors shadow-lg"
          >
            Open the portal →
          </Link>
          <a
            href="https://github.com/hitul-hse/supabase-app"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 rounded-xl border border-white/15 text-white/60 font-medium text-sm hover:border-white/30 hover:text-white transition-colors"
          >
            View on GitHub
          </a>
        </div>

        {/* Connector logos row */}
        <div className="flex items-center gap-6 mt-4 opacity-30">
          {["ASANA", "TRACKINGTIME", "FACTORIAL", "SAMDOCK"].map(name => (
            <span key={name} className="font-mono text-[10px] tracking-widest">{name}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
