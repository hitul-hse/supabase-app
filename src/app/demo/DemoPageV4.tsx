"use client";
/**
 * DemoPageV4 — HSE Hub marketing/demo page
 * Brand: HSE Health & Safety Experts GmbH
 * Typography: Poppins (real brand font from hs-experts.com)
 * Palette: HSE Teal #91C2B7 · Dark Teal #29474B · Near-black #0e1517
 * Motion: emilkowalski principles — transform+opacity only, cubic-bezier(0.23,1,0.32,1), springs bounce:0
 */

import Image from "next/image";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  AnimatePresence,
} from "framer-motion";

/* ─── Brand tokens ─────────────────────────────────────────────── */
const T = {
  // Backgrounds
  bg0: "#0e1517",        // deepest — near-black with teal undertone
  bg1: "#141d1f",        // cards / raised surface
  bg2: "#1a2628",        // hover
  bg3: "#203032",        // active / selected

  // HSE Teal
  teal:      "#91C2B7",  // primary brand accent (from hs-experts.com h1)
  tealDeep:  "#29474B",  // dark teal — link color from site
  tealLight: "#B0D4CC",  // highlight
  tealMuted: "rgba(145,194,183,0.12)",
  tealBorder:"rgba(145,194,183,0.22)",
  tealGlow:  "0 0 40px rgba(145,194,183,0.2)",

  // Text
  text0: "#F0F4F3",      // warm white with teal tint — headings
  text1: "#8FA8A5",      // secondary
  text2: "#5A7470",      // muted / metadata

  // Borders
  border:      "rgba(145,194,183,0.08)",
  borderStrong:"rgba(145,194,183,0.16)",

  // Status
  green: "#4ade80",
  amber: "#fbbf24",
  red:   "#f87171",
} as const;

const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const;

/* ─── Motion variants ───────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, transform: "translateY(20px) scale(0.98)" },
  show: {
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    transition: { ease: EASE, duration: 0.6 },
  },
};

const stagger = (s = 0.07) => ({
  hidden: {},
  show: { transition: { staggerChildren: s } },
});

/* ─── Particle ─────────────────────────────────────────────────── */
function Particle({ index }: { index: number }) {
  const x = (index * 137.5) % 100;
  const y = (index * 97.3) % 100;
  const size = 1.5 + (index % 3) * 0.8;
  const dur = 10 + (index % 6) * 2.5;
  const delay = (index * 0.5) % 5;
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: `${x}%`, top: `${y}%`,
        width: size, height: size,
        background: `rgba(145,194,183,${0.15 + (index % 4) * 0.1})`,
      }}
      animate={{
        transform: [
          "translateY(0px) translateX(0px)",
          `translateY(-${14 + (index % 8) * 4}px) translateX(${(index % 2 === 0 ? 1 : -1) * (8 + (index % 5) * 3)}px)`,
          "translateY(0px) translateX(0px)",
        ],
        opacity: [0.2, 0.7, 0.2],
      }}
      transition={{ duration: dur, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ─── TiltCard ─────────────────────────────────────────────────── */
function TiltCard({
  children, className = "", style,
}: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const rotX = useSpring(0, { stiffness: 200, damping: 28, bounce: 0 });
  const rotY = useSpring(0, { stiffness: 200, damping: 28, bounce: 0 });
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top) / r.height;
    rotX.set((cy - 0.5) * -8);
    rotY.set((cx - 0.5) * 8);
    glowX.set(cx * 100);
    glowY.set(cy * 100);
  }, [rotX, rotY, glowX, glowY]);

  const onLeave = useCallback(() => {
    rotX.set(0); rotY.set(0); glowX.set(50); glowY.set(50);
  }, [rotX, rotY, glowX, glowY]);

  return (
    <motion.div
      ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ rotateX: rotX, rotateY: rotY, transformStyle: "preserve-3d", ...style }}
      className={`relative overflow-hidden ${className}`}
    >
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{ background: `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(145,194,183,0.07) 0%, transparent 60%)` }}
      />
      {children}
    </motion.div>
  );
}

/* ─── CountUp ──────────────────────────────────────────────────── */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / 1800, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

/* ─── Section wrapper ──────────────────────────────────────────── */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      variants={stagger(0.08)}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── VideoPlayer ──────────────────────────────────────────────── */
function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showCtrl, setShowCtrl] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const revealCtrl = () => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowCtrl(false), 3200);
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
    const onEnd = () => { setPlaying(false); setShowCtrl(true); };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnd);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("ended", onEnd); };
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  };

  return (
    <div
      className="relative rounded-2xl overflow-hidden cursor-pointer group"
      style={{
        background: T.bg0,
        boxShadow: `0 0 80px rgba(145,194,183,0.12), 0 32px 64px rgba(0,0,0,0.7)`,
      }}
      onMouseMove={revealCtrl}
      onClick={toggle}
    >
      {/* Teal border glow */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none z-10"
        style={{ boxShadow: `inset 0 0 0 1px ${T.tealBorder}` }} />

      <video
        ref={videoRef}
        src="/hse-hub-ad.mp4"
        className="w-full aspect-video object-cover"
        playsInline
        preload="metadata"
      />

      <AnimatePresence>
        {showCtrl && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-20 flex flex-col justify-between p-6"
            style={{ background: "linear-gradient(to top, rgba(14,21,23,0.85) 0%, transparent 40%, transparent 60%, rgba(14,21,23,0.4) 100%)" }}
          >
            {/* Top label */}
            <div className="flex items-center gap-2">
              <motion.div className="w-2 h-2 rounded-full" style={{ background: T.green }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-xs font-semibold tracking-widest uppercase"
                style={{ color: "rgba(240,244,243,0.6)", fontFamily: "Poppins, sans-serif" }}>
                HSE Health &amp; Safety Experts · Product Demo
              </span>
            </div>

            {/* Play/pause */}
            <div className="flex items-center justify-center flex-1">
              <motion.button
                whileHover={{ transform: "scale(1.1)" }}
                whileTap={{ transform: "scale(0.93)" }}
                transition={SPRING}
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(145,194,183,0.12)",
                  border: `1px solid ${T.tealBorder}`,
                  boxShadow: `0 0 40px rgba(145,194,183,0.2)`,
                  color: T.teal,
                  backdropFilter: "blur(12px)",
                }}
                onClick={e => { e.stopPropagation(); toggle(); }}
              >
                {playing
                  ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}><path d="M5 3l14 9-14 9V3z"/></svg>
                }
              </motion.button>
            </div>

            {/* Scrubber */}
            <div className="space-y-3">
              <div
                className="h-1 rounded-full cursor-pointer overflow-hidden"
                style={{ background: "rgba(145,194,183,0.15)" }}
                onClick={e => { e.stopPropagation(); seek(e); }}
              >
                <div className="h-full rounded-full transition-none"
                  style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${T.teal}, ${T.tealLight})` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "rgba(240,244,243,0.4)", fontFamily: "Poppins, sans-serif" }}>
                  60s · Remotion H264 1080p
                </span>
                <a
                  href="/hse-hub-ad.mp4" download
                  className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-70"
                  style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}
                  onClick={e => e.stopPropagation()}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  Download MP4
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Features data ─────────────────────────────────────────────── */
const features = [
  {
    num: "01", title: "Live Dashboard",
    desc: "Billable utilisation, headcount, and active project counts — no manual collation. Refreshes every sync cycle across all four connected systems.",
    tags: ["Real-time", "Exec + Dept Head"], color: T.teal,
  },
  {
    num: "02", title: "Fine-grained RBAC",
    desc: "24 permissions across 7 resource groups. Executives toggle each permission per role from the admin panel — enforced at database level via Row-Level Security.",
    tags: ["24 permissions", "Zero code changes"], color: "#60a5fa",
  },
  {
    num: "03", title: "Identity Resolution",
    desc: "One person in Asana, TrackingTime, and FactorialHR with three different IDs. The canonical identity map joins them — cross-system numbers always accurate.",
    tags: ["Zero duplicates", "Effective-dated"], color: "#4ade80",
  },
  {
    num: "04", title: "Workload Booking",
    desc: "Team leads book 4-week rolling workloads per person. Executives and department heads approve or reject — all decisions logged with full audit trail.",
    tags: ["4-week rolling", "Approval workflow"], color: "#a78bfa",
  },
  {
    num: "05", title: "Timesheet Grid",
    desc: "Weekly entry grid per employee, synced from TrackingTime. Billable vs non-billable breakdown, project attribution, and weekly totals at a glance.",
    tags: ["TrackingTime sync", "Billable %"], color: "#fb923c",
  },
  {
    num: "06", title: "4-System Pipeline",
    desc: "Asana → tasks & projects · FactorialHR → people & leave · TrackingTime → hours · Samdock → clients. One unified Postgres schema, one portal.",
    tags: ["Asana", "Factorial", "TrackingTime", "Samdock"], color: T.tealLight,
  },
];

function FeatureRow({ feature: f, index: i }: { feature: typeof features[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, transform: "translateX(-20px)" }}
      animate={inView ? { opacity: 1, transform: "translateX(0px)" } : {}}
      transition={{ ease: EASE, duration: 0.55, delay: i * 0.05 }}
      className="group flex items-start gap-8 py-8 border-b"
      style={{ borderColor: T.border }}
    >
      <span className="text-xs font-mono pt-1 shrink-0 w-8" style={{ color: f.color, opacity: 0.6, fontFamily: "'JetBrains Mono', monospace" }}>
        {f.num}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-base font-semibold" style={{ color: T.text0, letterSpacing: "-0.01em", fontFamily: "Poppins, sans-serif" }}>
            {f.title}
          </h3>
          <motion.div
            className="w-4 h-px opacity-0 group-hover:opacity-100"
            style={{ background: f.color }}
            initial={{ scaleX: 0, originX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ ease: EASE, duration: 0.3 }}
          />
        </div>
        <p className="text-sm leading-relaxed mb-3" style={{ color: T.text1, fontFamily: "Poppins, sans-serif" }}>{f.desc}</p>
        <div className="flex flex-wrap gap-1.5">
          {f.tags.map(t => (
            <span key={t} className="text-xs px-2.5 py-0.5 rounded-full font-medium"
              style={{
                background: `${f.color}14`,
                color: f.color,
                border: `1px solid ${f.color}28`,
                fontFamily: "Poppins, sans-serif",
              }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <motion.div
        className="shrink-0 opacity-0 group-hover:opacity-100 pt-1"
        transition={{ duration: 0.2 }}
        style={{ color: f.color }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </motion.div>
    </motion.div>
  );
}

/* ─── Stack items ──────────────────────────────────────────────── */
const stackItems = [
  { label: "Next.js 16", sub: "App Router · Server Components · Streaming SSR", icon: "▲", color: T.text0 },
  { label: "Supabase", sub: "PostgreSQL · Row-Level Security · Auth · Realtime", icon: "⚡", color: T.teal },
  { label: "Vercel Edge", sub: "Global CDN · Preview deployments · OIDC", icon: "◈", color: "#60a5fa" },
  { label: "Framer Motion", sub: "Springs · Layout animations · Gesture physics", icon: "◎", color: "#a78bfa" },
  { label: "GitHub Actions", sub: "lint → tsc → build → db-tests on every PR", icon: "◆", color: "#4ade80" },
  { label: "Remotion", sub: "React-rendered 60s H264 1080p product video", icon: "▶", color: "#fb923c" },
];

/* ─── HSE Logo mark (SVG inline fallback) ───────────────────────── */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }}>
      <Image src="/hse-logo.png" alt="HSE Logo" fill style={{ objectFit: "contain" }} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */
export default function DemoPageV4() {
  return (
    <div
      className="min-h-screen"
      style={{
        background: T.bg0,
        color: T.text0,
        fontFamily: "Poppins, system-ui, sans-serif",
      }}
    >
      {/* Google Fonts — Poppins */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        ::selection { background: rgba(145,194,183,0.25); color: ${T.text0}; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${T.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${T.tealDeep}; border-radius: 3px; }
      `}</style>

      {/* ── Ambient layer ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        {/* Teal glow blobs */}
        <div className="absolute" style={{ top: "-15%", left: "15%", width: 700, height: 700, background: `radial-gradient(circle, rgba(145,194,183,0.05) 0%, transparent 70%)`, filter: "blur(80px)" }} />
        <div className="absolute" style={{ bottom: "5%", right: "5%", width: 500, height: 500, background: `radial-gradient(circle, rgba(41,71,75,0.15) 0%, transparent 70%)`, filter: "blur(100px)" }} />
        <div className="absolute" style={{ top: "40%", left: "60%", width: 300, height: 300, background: `radial-gradient(circle, rgba(145,194,183,0.04) 0%, transparent 70%)`, filter: "blur(60px)" }} />
        {/* Particles */}
        <div className="absolute inset-0">
          {Array.from({ length: 22 }, (_, i) => <Particle key={i} index={i} />)}
        </div>
        {/* Subtle grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(${T.border} 1px, transparent 1px), linear-gradient(90deg, ${T.border} 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
        }} />
      </div>

      {/* ── NAV ── */}
      <motion.nav
        initial={{ opacity: 0, transform: "translateY(-14px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ ease: EASE, duration: 0.5 }}
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14"
        style={{
          background: `rgba(14,21,23,0.88)`,
          backdropFilter: "blur(20px) saturate(160%)",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        {/* Logo + name */}
        <div className="flex items-center gap-3">
          <LogoMark size={26} />
          <div className="flex flex-col leading-none">
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
              HSE HUB
            </span>
            <span className="hidden sm:block text-[10px] font-medium tracking-wider" style={{ color: T.text2 }}>
              Health &amp; Safety Experts GmbH
            </span>
          </div>
        </div>

        {/* Nav links */}
        <div className="hidden sm:flex items-center gap-6 text-xs font-medium" style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>
          {["Features", "Video", "Stack"].map(l => (
            <motion.a
              key={l} href={`#${l.toLowerCase()}`}
              whileHover={{ color: T.teal, transform: "translateY(-1px)" }}
              transition={SPRING}
              className="transition-colors"
            >{l}</motion.a>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <a href="https://github.com/hitul-hse/supabase-app" target="_blank"
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-60"
            style={{ color: T.text2 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.66-.22.66-.48v-1.7C6.73 19.91 6.14 18 6.14 18c-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 7.82c.85.004 1.7.115 2.5.337 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48C19.14 20.16 22 16.42 22 12c0-5.52-4.48-10-10-10z"/>
            </svg>
            GitHub
          </a>
          <motion.a
            href="/auth/login"
            whileHover={{ transform: "scale(1.04) translateY(-1px)", boxShadow: `0 8px 24px rgba(145,194,183,0.25)` }}
            whileTap={{ transform: "scale(0.96)" }}
            transition={SPRING}
            className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{
              background: T.teal,
              color: "#0e1517",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            Sign in →
          </motion.a>
        </div>
      </motion.nav>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center">

        {/* Live badge */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(10px) scale(0.96)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          transition={{ ease: EASE, duration: 0.5, delay: 0.1 }}
          className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold mb-12"
          style={{
            background: T.tealMuted,
            border: `1px solid ${T.tealBorder}`,
            color: T.teal,
            fontFamily: "Poppins, sans-serif",
            letterSpacing: "0.03em",
          }}
        >
          <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: T.green }}
            animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }} />
          Live · 4 systems connected · hseportal.hs-experts.com
        </motion.div>

        {/* Headline */}
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 overflow-hidden">
            {[
              { text: "If nothing happens,", style: { color: T.text0 } },
              {
                text: "we've done our job.",
                style: {
                  background: `linear-gradient(135deg, ${T.teal} 0%, ${T.tealLight} 50%, ${T.teal} 100%)`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                },
              },
            ].map(({ text, style }, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, transform: "translateY(32px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ ease: EASE, duration: 0.8, delay: 0.2 + i * 0.14 }}
                className="font-extrabold leading-tight block"
                style={{
                  fontSize: "clamp(40px, 7vw, 88px)",
                  letterSpacing: "-0.03em",
                  fontFamily: "Poppins, sans-serif",
                  ...style,
                }}
              >
                {text}
              </motion.div>
            ))}
          </div>

          {/* Sub — real tagline from hs-experts.com */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.6, delay: 0.5 }}
            className="mb-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md mb-6"
              style={{ background: T.tealMuted, border: `1px solid ${T.border}` }}>
              <LogoMark size={16} />
              <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
                HSE Health &amp; Safety Experts GmbH
              </span>
            </div>
            <p className="text-lg leading-relaxed max-w-2xl mx-auto"
              style={{ color: T.text1, letterSpacing: "-0.01em", fontFamily: "Poppins, sans-serif" }}>
              The internal operations portal that connects Asana, TrackingTime, Samdock CRM, and FactorialHR
              into one role-gated intelligence layer — replacing hours of manual consolidation every week.
            </p>
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.5, delay: 0.65 }}
            className="flex flex-wrap items-center justify-center gap-4 mt-10"
          >
            <motion.a
              href="#video"
              whileHover={{ transform: "scale(1.04) translateY(-2px)", boxShadow: `0 12px 40px rgba(145,194,183,0.3)` }}
              whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING}
              className="flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-sm font-bold"
              style={{
                background: T.teal,
                color: "#0e1517",
                fontFamily: "Poppins, sans-serif",
                boxShadow: `0 8px 28px rgba(145,194,183,0.2)`,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: -2 }}><path d="M5 3l14 9-14 9V3z"/></svg>
              Watch the demo
            </motion.a>
            <motion.a
              href="/auth/login"
              whileHover={{ transform: "scale(1.02) translateY(-1px)", borderColor: T.tealBorder }}
              whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING}
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold transition-colors"
              style={{
                background: "transparent",
                color: T.text0,
                border: `1px solid ${T.borderStrong}`,
                fontFamily: "Poppins, sans-serif",
              }}
            >
              Open portal →
            </motion.a>
          </motion.div>
        </div>

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(24px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.6, delay: 0.8 }}
          className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden max-w-2xl w-full"
          style={{ background: T.border, border: `1px solid ${T.border}` }}
        >
          {[
            { val: 41, label: "Active people" },
            { val: 27, label: "Live projects" },
            { val: 4,  label: "Systems synced" },
            { val: 24, label: "RBAC permissions" },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center justify-center py-6 px-4"
              style={{ background: T.bg0 }}>
              <div className="text-2xl font-bold mb-0.5"
                style={{ color: T.teal, letterSpacing: "-0.02em", fontFamily: "Poppins, sans-serif" }}>
                <CountUp to={s.val} />
              </div>
              <div className="text-xs font-medium" style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>
                {s.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2" style={{ transform: "translateX(-50%)" }}>
          <motion.div
            animate={{ transform: ["translateY(0px)", "translateY(7px)", "translateY(0px)"] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center gap-1.5 opacity-25"
          >
            <span className="text-[10px] tracking-widest uppercase" style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>Scroll</span>
            <svg width="14" height="9" viewBox="0 0 14 9" fill="none" stroke={T.text2} strokeWidth="1.5">
              <path d="M1 1l6 6 6-6"/>
            </svg>
          </motion.div>
        </div>
      </section>

      {/* ── VIDEO ── */}
      <section id="video" className="relative px-6 py-24 max-w-5xl mx-auto">
        <Section className="mb-12 text-center">
          <motion.div variants={fadeUp}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6"
            style={{ background: T.tealMuted, border: `1px solid ${T.tealBorder}`, color: T.teal, fontFamily: "Poppins, sans-serif" }}>
            60-second Remotion-rendered · H264 1080p
          </motion.div>
          <motion.h2 variants={fadeUp} className="text-4xl font-bold mb-4"
            style={{ letterSpacing: "-0.03em", color: T.text0, fontFamily: "Poppins, sans-serif" }}>
            See it in action
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base max-w-lg mx-auto"
            style={{ color: T.text1, fontFamily: "Poppins, sans-serif" }}>
            A full walkthrough of every module — built frame-by-frame with Remotion, encoded as H264 MP4.
          </motion.p>
        </Section>

        <motion.div
          initial={{ opacity: 0, transform: "translateY(32px) scale(0.97)" }}
          whileInView={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ease: EASE, duration: 0.7 }}
        >
          <VideoPlayer />
        </motion.div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="px-6 py-24 max-w-4xl mx-auto">
        <Section className="mb-4">
          <motion.p variants={fadeUp}
            className="text-xs font-semibold tracking-widest uppercase mb-4"
            style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
            What it does
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-2"
            style={{ letterSpacing: "-0.03em", fontFamily: "Poppins, sans-serif" }}>
            Every module, explained
          </motion.h2>
        </Section>
        <div>
          {features.map((f, i) => (
            <FeatureRow key={f.num} feature={f} index={i} />
          ))}
        </div>
      </section>

      {/* ── STACK ── */}
      <section id="stack" className="px-6 py-24 max-w-5xl mx-auto">
        <Section className="mb-12 text-center">
          <motion.p variants={fadeUp}
            className="text-xs font-semibold tracking-widest uppercase mb-4"
            style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
            Production stack
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold"
            style={{ letterSpacing: "-0.03em", fontFamily: "Poppins, sans-serif" }}>
            Built to last
          </motion.h2>
        </Section>
        <Section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stackItems.map((s, i) => (
            <motion.div key={s.label} variants={{
              hidden: { opacity: 0, transform: "translateY(18px) scale(0.97)" },
              show: { opacity: 1, transform: "translateY(0px) scale(1)", transition: { ease: EASE, duration: 0.5, delay: i * 0.06 } },
            }}>
              <TiltCard
                className="group p-5 rounded-xl"
                style={{ background: T.bg1, border: `1px solid ${T.border}` }}
              >
                <div className="text-2xl mb-3" style={{ color: s.color }}>{s.icon}</div>
                <div className="text-sm font-semibold mb-1"
                  style={{ color: T.text0, letterSpacing: "-0.01em", fontFamily: "Poppins, sans-serif" }}>
                  {s.label}
                </div>
                <div className="text-xs leading-relaxed"
                  style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>
                  {s.sub}
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </Section>
      </section>

      {/* ── CTA ── */}
      <section className="px-6 py-32 text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 60% 50% at 50% 50%, rgba(145,194,183,0.05) 0%, transparent 70%)` }} />
        <Section>
          <motion.div variants={fadeUp} className="flex justify-center mb-8">
            <LogoMark size={48} />
          </motion.div>
          <motion.p variants={fadeUp}
            className="text-xs font-semibold tracking-widest uppercase mb-5"
            style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
            Ready to connect your operations?
          </motion.p>
          <motion.h2 variants={fadeUp}
            className="font-extrabold mb-5 max-w-2xl mx-auto"
            style={{
              fontSize: "clamp(32px,5vw,64px)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              fontFamily: "Poppins, sans-serif",
            }}>
            One portal.{" "}
            <span style={{
              background: `linear-gradient(135deg, ${T.teal}, ${T.tealLight})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              All the data.
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base mb-12 max-w-md mx-auto"
            style={{ color: T.text1, fontFamily: "Poppins, sans-serif" }}>
            Log in at hseportal.hs-experts.com — or download the 60-second demo video above.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-4">
            <motion.a
              href="/auth/login"
              whileHover={{ transform: "scale(1.04) translateY(-2px)", boxShadow: `0 16px 48px rgba(145,194,183,0.3)` }}
              whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING}
              className="px-8 py-4 rounded-xl text-sm font-bold"
              style={{
                background: T.teal,
                color: "#0e1517",
                fontFamily: "Poppins, sans-serif",
                boxShadow: `0 8px 28px rgba(145,194,183,0.2)`,
              }}
            >
              Open portal →
            </motion.a>
            <motion.a
              href="/hse-hub-ad.mp4" download
              whileHover={{ transform: "scale(1.02) translateY(-1px)", borderColor: T.tealBorder }}
              whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING}
              className="flex items-center gap-2 px-8 py-4 rounded-xl text-sm font-semibold"
              style={{
                background: "transparent",
                color: T.text0,
                border: `1px solid ${T.borderStrong}`,
                fontFamily: "Poppins, sans-serif",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download MP4
            </motion.a>
          </motion.div>
        </Section>
      </section>

      {/* ── FOOTER ── */}
      <footer className="px-6 py-10 border-t" style={{ borderColor: T.border }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogoMark size={22} />
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-bold tracking-wider" style={{ color: T.teal, fontFamily: "Poppins, sans-serif" }}>
                HSE HUB
              </span>
              <span className="text-xs" style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>
                © {new Date().getFullYear()} HSE Health &amp; Safety Experts GmbH
              </span>
            </div>
          </div>
          <div className="flex items-center gap-5 text-xs font-medium" style={{ color: T.text2, fontFamily: "Poppins, sans-serif" }}>
            <a href="/auth/login" className="hover:opacity-70 transition-opacity">Portal</a>
            <a href="https://www.hs-experts.com" target="_blank" className="hover:opacity-70 transition-opacity">hs-experts.com</a>
            <a href="https://github.com/hitul-hse/supabase-app" target="_blank" className="hover:opacity-70 transition-opacity">GitHub</a>
            <span style={{ color: T.teal }}>hseportal.hs-experts.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
