"use client";
/**
 * /video — Standalone cinematic video showcase for HSE Hub.
 * Beautiful full-screen video player with animated sections.
 * No auth required — share freely with stakeholders.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import Link from "next/link";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Feature {
  icon: string;
  title: string;
  desc: string;
  accent: string;
}

interface Stat {
  value: number;
  suffix: string;
  label: string;
  accent: string;
}

/* ─── Data ────────────────────────────────────────────────────────────────── */
const STATS: Stat[] = [
  { value: 41,  suffix: "",  label: "Active people",        accent: "#d4a843" },
  { value: 27,  suffix: "",  label: "Live projects",         accent: "#3b82f6" },
  { value: 4,   suffix: "",  label: "Integrated systems",    accent: "#22c55e" },
  { value: 24,  suffix: "",  label: "Granular permissions",  accent: "#a855f7" },
];

const FEATURES: Feature[] = [
  { icon: "📊", title: "Executive Overview",   desc: "Live KPIs, billable trends, and project health — real-time from four source systems in one glance.",              accent: "#d4a843" },
  { icon: "👥", title: "Team Lead Board",      desc: "Weekly workload booking, utilisation heatmap, and pending approvals with one-click decisions.",                   accent: "#3b82f6" },
  { icon: "🧑‍💼", title: "People Directory",   desc: "Full team roster with qualifications, active assignments, and cross-system identity resolution.",                 accent: "#22c55e" },
  { icon: "📁", title: "Project Tracker",      desc: "Timeline view, Gantt-style task breakdown, and live progress bars pulled directly from Asana.",                   accent: "#f59e0b" },
  { icon: "⏱️", title: "Timesheet Grid",       desc: "Weekly timesheet view per employee — logged hours, billable split, and approval workflow.",                        accent: "#ec4899" },
  { icon: "🔐", title: "Role Permissions",     desc: "Full RBAC matrix — define exactly what each role can access. Toggle live, no deploy needed.",                     accent: "#a855f7" },
];

const CONNECTORS = ["Asana", "TrackingTime", "Samdock", "Factorial", "Supabase", "Vercel"];

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function useCountUp(target: number, duration = 1800, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * ease));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, start]);
  return count;
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */
function GoldGlow({ size = 600, opacity = 0.15 }: { size?: number; opacity?: number }) {
  return (
    <div
      className="pointer-events-none absolute rounded-full"
      style={{
        width: size, height: size,
        background: "radial-gradient(circle, #d4a843 0%, transparent 70%)",
        opacity,
        filter: "blur(80px)",
        transform: "translate(-50%, -50%)",
      }}
    />
  );
}

function StatCard({ stat, index, visible }: { stat: Stat; index: number; visible: boolean }) {
  const count = useCountUp(stat.value, 1600, visible);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center gap-2 rounded-2xl border p-6 text-center backdrop-blur-sm"
      style={{ borderColor: stat.accent + "30", background: stat.accent + "08" }}
    >
      <span className="text-5xl font-bold tracking-tight" style={{ color: stat.accent }}>
        {count}{stat.suffix}
      </span>
      <span className="text-sm text-slate-400">{stat.label}</span>
    </motion.div>
  );
}

function FeatureCard({ f, index, visible }: { f: Feature; index: number; visible: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.02, y: -4 }}
      className="group relative overflow-hidden rounded-2xl border p-6 backdrop-blur-sm transition-shadow hover:shadow-2xl"
      style={{ borderColor: f.accent + "25", background: "#0f1420" }}
    >
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at top left, ${f.accent}10 0%, transparent 60%)` }}
      />
      <div className="relative z-10">
        <div className="mb-3 text-3xl">{f.icon}</div>
        <h3 className="mb-2 text-lg font-semibold text-white">{f.title}</h3>
        <p className="text-sm leading-relaxed text-slate-400">{f.desc}</p>
      </div>
      <div
        className="absolute bottom-0 left-0 h-0.5 w-0 transition-all duration-500 group-hover:w-full"
        style={{ background: `linear-gradient(90deg, ${f.accent}, transparent)` }}
      />
    </motion.div>
  );
}

/* ─── Video Player ────────────────────────────────────────────────────────── */
function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Just drive the element; onPlay/onPause/onEnded below are the single
  // source of truth for `playing` (they also fire for e.g. spacebar or the
  // browser's own media-key controls, not only this button).
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress(v.currentTime / v.duration);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    v.currentTime = ratio * v.duration;
  }, []);

  const showCtrl = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimeout.current);
    if (playing) hideTimeout.current = setTimeout(() => setShowControls(false), 3000);
  }, [playing]);

  const toggleFullscreen = useCallback(() => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) { el.requestFullscreen(); setFullscreen(true); }
    else { document.exitFullscreen(); setFullscreen(false); }
  }, []);

  return (
    <div
      className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl"
      style={{ boxShadow: "0 0 80px 0 #d4a84340" }}
      onMouseMove={showCtrl}
      onMouseEnter={showCtrl}
    >
      {/* Gold border glow */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset" style={{ boxShadow: "inset 0 0 0 1px #d4a84340" }} />

      {/* Loading skeleton */}
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0d14]">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#d4a843] border-t-transparent" />
          <p className="text-sm text-slate-400">Loading video…</p>
        </div>
      )}

      <video
        ref={videoRef}
        src="/hse-hub-ad.mp4"
        className="h-full w-full object-cover"
        muted={muted}
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => { setDuration((e.target as HTMLVideoElement).duration); setLoaded(true); }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); setShowControls(true); }}
        onEnded={() => { setPlaying(false); setProgress(0); setShowControls(true); }}
        onClick={togglePlay}
      />

      {/* Big play button when paused */}
      <AnimatePresence>
        {!playing && loaded && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            onClick={togglePlay}
            className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            style={{ background: "#d4a843", boxShadow: "0 0 40px #d4a84380" }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Controls bar */}
      <AnimatePresence>
        {showControls && loaded && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12"
          >
            {/* Progress bar */}
            <div
              className="mb-3 h-1 w-full cursor-pointer rounded-full bg-white/20"
              onClick={handleSeek}
            >
              <div
                className="h-full rounded-full transition-none"
                style={{ width: `${progress * 100}%`, background: "#d4a843" }}
              />
            </div>

            {/* Buttons row */}
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button onClick={togglePlay} className="text-white/80 transition hover:text-white">
                {playing ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                )}
              </button>

              {/* Mute */}
              <button onClick={() => setMuted(m => !m)} className="text-white/80 transition hover:text-white">
                {muted ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  </svg>
                )}
              </button>

              {/* Time */}
              <span className="flex-1 text-xs text-white/60">
                {fmt(progress * duration)} / {fmt(duration)}
              </span>

              {/* Fullscreen */}
              <button onClick={toggleFullscreen} className="text-white/80 transition hover:text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {fullscreen
                    ? <path d="M8 3v5H3M21 3l-5 5M3 21l5-5M16 21v-5h5"/>
                    : <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  }
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Section wrapper with scroll-triggered reveal ────────────────────────── */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function VideoPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  const [statsVisible, setStatsVisible] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsVisible(true); }, { threshold: 0.3 });
    if (statsRef.current) obs.observe(statsRef.current);
    return () => obs.disconnect();
  }, []);

  const [featuresVisible, setFeaturesVisible] = useState(false);
  const featRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setFeaturesVisible(true); }, { threshold: 0.1 });
    if (featRef.current) obs.observe(featRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "#070a10", color: "#f1f5f9", fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif' }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-xl"
        style={{ borderBottom: "1px solid #ffffff0a", background: "#070a10cc" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#d4a843" }}>
            <span className="text-xs font-black text-black">HSE</span>
          </div>
          <span className="text-sm font-semibold tracking-wide text-white/90">HSE HUB</span>
          <span className="ml-1 rounded-full px-2 py-0.5 text-xs" style={{ background: "#d4a84320", color: "#d4a843" }}>Demo</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/demo" className="text-sm text-white/50 transition hover:text-white/90">Full showcase</Link>
          <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
            style={{ background: "#d4a843" }}>
            Sign in →
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
        {/* Background glows */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/4 top-1/4" style={{ transform: "translate(-50%,-50%)" }}>
            <GoldGlow size={700} opacity={0.12} />
          </div>
          <div className="absolute right-1/4 bottom-1/3" style={{ transform: "translate(50%, 50%)" }}>
            <GoldGlow size={500} opacity={0.07} />
          </div>
          {/* Grid pattern */}
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(#ffffff06 1px, transparent 1px), linear-gradient(90deg, #ffffff06 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }} />
        </div>

        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 max-w-4xl">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm"
            style={{ borderColor: "#d4a84340", background: "#d4a84310", color: "#d4a843" }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            HSE Hub — Production Preview
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 text-6xl font-black leading-none tracking-tight sm:text-7xl lg:text-8xl"
          >
            <span className="text-white">Operations.</span>
            <br />
            <span style={{ background: "linear-gradient(135deg, #d4a843 0%, #f5c842 50%, #d4a843 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Unified.
            </span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.7 }}
            className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-slate-400"
          >
            One portal. Four systems. Real-time sync. Role-based access from executive to employee.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <a href="#video" className="flex items-center gap-2 rounded-xl px-8 py-3.5 text-base font-semibold text-black shadow-lg transition hover:opacity-90 hover:shadow-xl"
              style={{ background: "linear-gradient(135deg, #d4a843, #f5c842)", boxShadow: "0 8px 32px #d4a84340" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
              Watch the demo
            </a>
            <Link href="/login" className="rounded-xl border px-8 py-3.5 text-base font-semibold text-white/90 transition hover:bg-white/5"
              style={{ borderColor: "#ffffff20" }}>
              Open portal →
            </Link>
          </motion.div>

          {/* Connector badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            <span className="text-xs text-slate-500 uppercase tracking-widest">Connected to</span>
            {CONNECTORS.map((c) => (
              <span key={c} className="rounded-full border px-3 py-1 text-xs text-slate-400"
                style={{ borderColor: "#ffffff12", background: "#ffffff06" }}>
                {c}
              </span>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.6 }}
          className="absolute bottom-8 flex flex-col items-center gap-2 text-xs text-slate-500"
        >
          <span>Scroll</span>
          <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7"/>
            </svg>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Video Section ───────────────────────────────────────────────────── */}
      <section id="video" className="relative px-6 py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <GoldGlow size={900} opacity={0.06} />
          </div>
        </div>

        <div className="relative z-10 mx-auto max-w-6xl">
          {/* Section heading */}
          <div className="mb-12 text-center">
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="mb-3 text-sm uppercase tracking-widest" style={{ color: "#d4a843" }}
            >
              Product demo
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="text-4xl font-bold text-white sm:text-5xl"
            >
              See it in action
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="mx-auto mt-4 max-w-xl text-slate-400"
            >
              A full walkthrough — from the executive overview to granular role permissions.
            </motion.p>
          </div>

          {/* Player */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <VideoPlayer />
          </motion.div>

          {/* Download row */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-wrap items-center justify-center gap-4"
          >
            <a
              href="/hse-hub-ad.mp4"
              download="HSE-Hub-Demo.mp4"
              className="flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
              style={{ borderColor: "#ffffff15" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download MP4
            </a>
            <span className="text-xs text-slate-500">H264 · 1920×1080 · 30fps · ~3MB</span>
          </motion.div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <section className="px-6 py-20" ref={statsRef}>
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STATS.map((s, i) => (
              <StatCard key={s.label} stat={s} index={i} visible={statsVisible} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="px-6 py-24" ref={featRef}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-sm uppercase tracking-widest" style={{ color: "#d4a843" }}>What&apos;s inside</p>
            <h2 className="text-4xl font-bold text-white sm:text-5xl">Every feature you need</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">
              Purpose-built for HSE operations — not a generic BI tool.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} f={f} index={i} visible={featuresVisible} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech Stack ──────────────────────────────────────────────────────── */}
      <Section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <p className="mb-3 text-sm uppercase tracking-widest" style={{ color: "#d4a843" }}>Built on</p>
            <h2 className="text-3xl font-bold text-white">Production-grade stack</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "⚡", name: "Next.js 15 App Router",  desc: "Server components, streaming SSR, edge-ready" },
              { icon: "🔐", name: "Supabase + RLS",          desc: "Row-level security, 24 fine-grained permissions" },
              { icon: "🚀", name: "Vercel Edge Network",     desc: "Global CDN, preview deploys on every PR" },
              { icon: "🔄", name: "Live Sync Pipeline",      desc: "4 external systems, star-schema warehouse" },
              { icon: "🎯", name: "Identity Resolution",     desc: "Canonical person_id via effective-dated maps" },
              { icon: "✅", name: "GitHub Actions CI/CD",   desc: "Lint → TS → Build → DB tests on every push" },
            ].map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="flex gap-4 rounded-xl border p-5"
                style={{ borderColor: "#ffffff0e", background: "#0f1420" }}
              >
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <p className="font-semibold text-white">{t.name}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{t.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-32 text-center">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <GoldGlow size={800} opacity={0.1} />
          </div>
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(#ffffff04 1px, transparent 1px), linear-gradient(90deg, #ffffff04 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }} />
        </div>
        <div className="relative z-10 mx-auto max-w-2xl">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-4 text-5xl font-black tracking-tight text-white sm:text-6xl"
          >
            Ready to{" "}
            <span style={{ background: "linear-gradient(135deg, #d4a843, #f5c842)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              connect?
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="mb-10 text-lg text-slate-400"
          >
            Deployed on Vercel · Powered by Supabase · Syncs every few minutes
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <Link href="/login"
              className="rounded-xl px-10 py-4 text-lg font-bold text-black shadow-lg transition hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #d4a843, #f5c842)", boxShadow: "0 12px 40px #d4a84350" }}>
              Sign in to the portal →
            </Link>
            <a href="https://github.com/hitul-hse/supabase-app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border px-8 py-4 text-white/80 transition hover:bg-white/5"
              style={{ borderColor: "#ffffff20" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              GitHub
            </a>
          </motion.div>
          <p className="mt-8 text-sm text-slate-500">hseportal.hs-experts.com</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t px-6 py-8 text-center" style={{ borderColor: "#ffffff0a" }}>
        <p className="text-sm text-slate-500">
          © 2026 HSE Health &amp; Safety Experts GmbH · Built with{" "}
          <span style={{ color: "#d4a843" }}>V3Code</span> &amp; Claude
        </p>
      </footer>
    </div>
  );
}
