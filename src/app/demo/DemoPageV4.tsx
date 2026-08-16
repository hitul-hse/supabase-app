"use client";
/**
 * /demo — Cinematic product showcase for HSE Hub.
 * Goldsmith theme (black/gold), Framer Motion, full-screen video hero.
 * Public route — no auth required. Share freely.
 * Design: ux-theme-library Goldsmith preset + ux-design-system discipline.
 * v4 — complete cinematic rebuild with Apple-grade animations.
 */

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  motion,
  AnimatePresence,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import Link from "next/link";

/* ─── Design tokens (Goldsmith preset) ─────────────────────────────────────── */
const G = {
  bg0: "#0c0c0d",
  bg1: "#161617",
  bg2: "#1f1f20",
  bg3: "#28282a",
  border: "rgba(212,175,55,0.13)",
  borderStrong: "rgba(212,175,55,0.26)",
  text0: "#f5f3ef",
  text1: "#a8a29e",
  text2: "#78716c",
  gold: "#d4af37",
  goldHover: "#e8c659",
  goldDim: "rgba(212,175,55,0.08)",
  goldDimHover: "rgba(212,175,55,0.14)",
};

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const STATS = [
  { value: 41,  suffix: "",   label: "Active people",      gold: true  },
  { value: 27,  suffix: "",   label: "Live projects",       gold: false },
  { value: 4,   suffix: "×",  label: "Systems integrated", gold: false },
  { value: 24,  suffix: "",   label: "Permissions",         gold: true  },
  { value: 99,  suffix: "%",  label: "Data freshness",      gold: false },
  { value: 60,  suffix: "s",  label: "Remotion ad video",   gold: false },
];

const FEATURES = [
  { num: "01", title: "Executive Overview",  tag: "Real-time",     desc: "Live KPIs, billable trend chart, and project health aggregated from four external systems in one authoritative view." },
  { num: "02", title: "Team Lead Board",     tag: "RBAC-gated",    desc: "Weekly workload bookings, utilisation heatmaps, and one-click approval decisions with full audit trail." },
  { num: "03", title: "People Directory",    tag: "Identity-aware",desc: "Full roster with qualifications, assignments, and cross-system identity resolution via canonical person_id." },
  { num: "04", title: "Project Tracker",     tag: "Asana sync",    desc: "Timeline view, Gantt-style task breakdown, and live progress bars pulled directly from Asana." },
  { num: "05", title: "Timesheet Grid",      tag: "TrackingTime",  desc: "Per-employee weekly view — logged hours, billable split, and approval workflow with mobile card layout." },
  { num: "06", title: "Role Permissions",    tag: "Admin",         desc: "Full RBAC matrix — toggle 24 permissions per role live. No deploy needed, instant effect." },
];

const STACK = [
  { icon: "▲", name: "Next.js App Router",  desc: "Server components, streaming SSR, edge-ready" },
  { icon: "⚡", name: "Supabase + RLS",      desc: "Row-level security, fine-grained auth" },
  { icon: "🌐", name: "Vercel Edge",         desc: "Global CDN, preview deploys on every PR" },
  { icon: "🔄", name: "4-system pipeline",   desc: "Asana · TrackingTime · Samdock · Factorial" },
  { icon: "🎬", name: "Remotion video",      desc: "React-rendered 60-second marketing video" },
  { icon: "✅", name: "GitHub Actions CI",   desc: "Lint → TS → Build → DB tests on every push" },
];

const CONNECTORS = ["Asana", "TrackingTime", "Samdock", "Factorial", "Supabase", "Vercel"];

/* ─── Hooks ─────────────────────────────────────────────────────────────────── */
function useCountUp(target: number, duration = 1600, active = false) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, active]);
  return v;
}

function useMagneticTilt(strength = 10) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [strength, -strength]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-strength, strength]), { stiffness: 200, damping: 20 });
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  }, [x, y]);
  const onLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);
  return { rotateX, rotateY, onMove, onLeave };
}

/* ─── Shared primitives ─────────────────────────────────────────────────────── */
function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100] opacity-[0.028]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        backgroundSize: "128px",
        mixBlendMode: "overlay",
      }}
    />
  );
}

function Glow({ size = 600, op = 0.12, x = "50%", y = "50%" }: { size?: number; op?: number; x?: string; y?: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{ width: size, height: size, left: x, top: y, transform: "translate(-50%,-50%)", background: "radial-gradient(circle, #d4af37 0%, transparent 70%)", opacity: op, filter: "blur(90px)" }}
    />
  );
}

function GridLines({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,${opacity}) 1px,transparent 1px)`, backgroundSize: "64px 64px" }}
    />
  );
}

function Particles({ count = 20 }: { count?: number }) {
  const pts = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 2 + 1, dur: Math.random() * 8 + 6, delay: Math.random() * 4,
  })), [count]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pts.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: G.gold }}
          animate={{ y: [0, -40, 0], opacity: [0, 0.55, 0] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* Character-by-character reveal */
function RevealText({ text, delay = 0, gold = false, className = "" }: { text: string; delay?: number; gold?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  return (
    <span ref={ref} className={className} aria-label={text}>
      {text.split("").map((ch, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 18 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: delay + i * 0.03, duration: 0.4, ease: EASE_OUT }}
          style={{
            display: "inline-block",
            ...(gold ? { background: "linear-gradient(135deg,#d4af37 0%,#f5c842 50%,#d4af37 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" } : {}),
          }}
        >
          {ch === " " ? "\u00a0" : ch}
        </motion.span>
      ))}
    </span>
  );
}

/* ─── Stat tile ──────────────────────────────────────────────────────────────── */
function StatTile({ value, suffix, label, gold, index, active }: { value: number; suffix: string; label: string; gold: boolean; index: number; active: boolean }) {
  const count = useCountUp(value, 1400, active);
  const { rotateX, rotateY, onMove, onLeave } = useMagneticTilt(6);
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.95 }}
      animate={active ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ delay: index * 0.07, duration: 0.6, ease: EASE_OUT }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 600, borderColor: G.border, background: G.bg1 } as React.CSSProperties}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative overflow-hidden rounded-2xl border p-6 text-center"
    >
      <div className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: `radial-gradient(ellipse at center,${G.goldDimHover} 0%,transparent 65%)` }} />
      <div className="relative z-10">
        <div className="mb-1 text-4xl font-black tracking-tight tabular-nums sm:text-5xl" style={{ color: gold ? G.gold : G.text0 }}>
          {count}{suffix}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: G.text2 }}>{label}</div>
      </div>
    </motion.div>
  );
}

/* ─── Feature row ────────────────────────────────────────────────────────────── */
function FeatureRow({ f, index }: { f: typeof FEATURES[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-5% 0px" });
  const [hovered, setHov] = useState(false);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ delay: index * 0.06, duration: 0.55, ease: EASE_OUT }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="group flex items-start gap-6 border-b py-8 last:border-b-0"
      style={{ borderColor: hovered ? G.borderStrong : G.border, transition: "border-color 0.3s" }}
    >
      <span className="min-w-[3rem] font-mono text-sm font-semibold transition-colors duration-300" style={{ color: hovered ? G.gold : G.text2 }}>{f.num}</span>
      <div className="flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-3">
          <h3 className="text-xl font-bold transition-colors duration-200" style={{ color: hovered ? G.text0 : "#d6d3d1" }}>{f.title}</h3>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium" style={{ background: hovered ? G.goldDimHover : G.goldDim, color: G.gold, borderColor: hovered ? G.borderStrong : G.border, transition: "all 0.3s" }}>{f.tag}</span>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: G.text1 }}>{f.desc}</p>
      </div>
      <motion.div animate={{ x: hovered ? 4 : 0, opacity: hovered ? 1 : 0 }} transition={{ duration: 0.2 }} style={{ color: G.gold }} className="mt-1 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </motion.div>
    </motion.div>
  );
}

/* ─── Video player ───────────────────────────────────────────────────────────── */
function VideoPlayer() {
  const vRef = useRef<HTMLVideoElement>(null);
  const cRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(0);
  const [ctrl, setCtrl] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [buffering, setBuf] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const togglePlay = useCallback(() => { const v = vRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }, []);
  const bump = useCallback(() => {
    setCtrl(true);
    clearTimeout(timer.current);
    if (playing) timer.current = setTimeout(() => setCtrl(false), 3200);
  }, [playing]);
  useEffect(() => { if (!playing) setCtrl(true); }, [playing]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = vRef.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  }, []);
  const toggleFS = useCallback(() => {
    const el = cRef.current;
    if (!el) return;
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
  }, []);

  return (
    <div
      ref={cRef}
      className="group relative w-full overflow-hidden rounded-2xl bg-black"
      style={{ aspectRatio: "16/9", boxShadow: `0 0 0 1px ${G.border}, 0 0 100px 0 rgba(212,175,55,0.18), 0 40px 80px 0 rgba(0,0,0,0.6)` }}
      onMouseMove={bump}
      onMouseEnter={bump}
      onClick={togglePlay}
    >
      <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl" style={{ boxShadow: `inset 0 0 0 1px ${G.borderStrong}` }} />
      <video
        ref={vRef}
        src="/hse-hub-ad.mp4"
        className="h-full w-full object-cover"
        muted={muted}
        playsInline
        preload="metadata"
        onTimeUpdate={() => { const v = vRef.current; if (v?.duration) setProgress(v.currentTime / v.duration); }}
        onLoadedMetadata={e => { setDur((e.target as HTMLVideoElement).duration); setLoaded(true); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onWaiting={() => setBuf(true)}
        onPlaying={() => setBuf(false)}
      />
      {/* Loading */}
      {!loaded && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4" style={{ background: G.bg0 }}>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="h-12 w-12 rounded-full border-4 border-t-transparent" style={{ borderColor: `${G.gold} transparent ${G.gold} ${G.gold}` }} />
          <p className="text-sm" style={{ color: G.text1 }}>Loading video…</p>
        </div>
      )}
      {/* Buffering */}
      <AnimatePresence>
        {buffering && loaded && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} className="h-10 w-10 rounded-full border-4 border-t-transparent" style={{ borderColor: `${G.gold} transparent ${G.gold} ${G.gold}` }} />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Big play */}
      <AnimatePresence>
        {!playing && loaded && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            onClick={e => { e.stopPropagation(); togglePlay(); }}
            className="absolute left-1/2 top-1/2 z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, boxShadow: `0 0 0 10px rgba(212,175,55,0.12),0 0 60px rgba(212,175,55,0.4)` }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill={G.bg0}><path d="M5 3l14 9-14 9V3z"/></svg>
          </motion.button>
        )}
      </AnimatePresence>
      {/* Controls */}
      <AnimatePresence>
        {ctrl && loaded && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 to-transparent px-4 pb-4 pt-16"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 h-1 w-full cursor-pointer rounded-full bg-white/15 transition-all duration-200 hover:h-1.5" onClick={seek}>
              <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: `linear-gradient(90deg,${G.gold},${G.goldHover})` }} />
            </div>
            <div className="flex items-center gap-3 text-white">
              <button onClick={togglePlay} className="opacity-80 transition hover:opacity-100">
                {playing
                  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>}
              </button>
              <button onClick={() => setMuted(m => !m)} className="opacity-80 transition hover:opacity-100">
                {muted
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>}
              </button>
              <span className="flex-1 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{fmt(progress * dur)} / {fmt(dur)}</span>
              <button onClick={toggleFS} className="opacity-80 transition hover:opacity-100">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Stack card ─────────────────────────────────────────────────────────────── */
function StackCard({ s, index }: { s: typeof STACK[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const { rotateX, rotateY, onMove, onLeave } = useMagneticTilt(8);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 18 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.06, duration: 0.5, ease: EASE_OUT }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 800, borderColor: G.border, background: G.bg1 } as React.CSSProperties}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative flex items-start gap-4 rounded-xl border p-5 transition-all duration-300"
    >
      <div className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:border-[rgba(212,175,55,0.26)]" style={{ background: `radial-gradient(ellipse at top left,${G.goldDim} 0%,transparent 60%)` }} />
      <span className="relative z-10 mt-0.5 text-xl">{s.icon}</span>
      <div className="relative z-10">
        <p className="font-semibold" style={{ color: G.text0 }}>{s.name}</p>
        <p className="mt-0.5 text-sm" style={{ color: G.text1 }}>{s.desc}</p>
      </div>
    </motion.div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function DemoPage() {
  const statsRef = useRef<HTMLDivElement>(null);
  const statsVisible = useInView(statsRef, { once: true, margin: "-10% 0px" });

  return (
    <div
      className="relative min-h-screen antialiased selection:bg-[#d4af3730] selection:text-[#d4af37]"
      style={{ background: G.bg0, color: G.text0, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}
    >
      <GrainOverlay />

      {/* Nav */}
      <motion.nav
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-2xl"
        style={{ borderBottom: `1px solid ${G.border}`, background: "rgba(12,12,13,0.88)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black" style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, color: G.bg0 }}>HSE</div>
          <span className="text-sm font-semibold tracking-wide" style={{ color: G.text0 }}>HSE HUB</span>
          <span className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: G.goldDim, color: G.gold, border: `1px solid ${G.border}` }}>Demo</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#video" className="hidden text-sm transition-colors sm:block" style={{ color: G.text1 }}>Watch video</a>
          <Link href="/auth/login" className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80" style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, color: G.bg0 }}>Sign in →</Link>
        </div>
      </motion.nav>

      {/* Hero */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-20 text-center">
        <div className="pointer-events-none absolute inset-0">
          <Glow size={900} op={0.1} x="40%" y="35%" />
          <Glow size={600} op={0.06} x="72%" y="68%" />
          <GridLines opacity={0.033} />
          <Particles count={22} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE_OUT }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm"
          style={{ borderColor: G.border, background: G.goldDim, color: G.gold }}
        >
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full" style={{ background: G.gold }} />
          Live in production · 4 systems connected
        </motion.div>

        <h1 className="relative z-10 mb-6 text-6xl font-black leading-[1.05] tracking-tight sm:text-7xl lg:text-[96px]">
          <span className="block" style={{ color: G.text0 }}>
            <RevealText text="Operations." delay={0.2} />
          </span>
          <span className="block">
            <RevealText text="Unified." delay={0.5} gold />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.7, ease: EASE_OUT }}
          className="relative z-10 mx-auto mb-10 max-w-2xl text-xl leading-relaxed"
          style={{ color: G.text1 }}
        >
          One portal. Four systems. Real-time sync.<br className="hidden sm:block" />
          {" "}Role-based access from executive to employee.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.05, duration: 0.6, ease: EASE_OUT }}
          className="relative z-10 flex flex-wrap items-center justify-center gap-4"
        >
          <a href="#video" className="flex items-center gap-2 rounded-xl px-8 py-4 text-base font-bold transition-all duration-200 hover:scale-[1.03]"
            style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, color: G.bg0, boxShadow: `0 8px 32px rgba(212,175,55,0.35)` }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
            Watch the demo
          </a>
          <Link href="/auth/login" className="rounded-xl border px-8 py-4 text-base font-semibold transition-all duration-200 hover:scale-[1.02]"
            style={{ borderColor: G.border, color: G.text0 }}>
            Open portal →
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.35, duration: 0.8 }}
          className="relative z-10 mt-14 flex flex-wrap items-center justify-center gap-3"
        >
          <span className="text-xs uppercase tracking-widest" style={{ color: G.text2 }}>Integrates with</span>
          {CONNECTORS.map((c, i) => (
            <motion.span key={c} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.45 + i * 0.06, duration: 0.4, ease: EASE_OUT }}
              className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: G.border, color: G.text1, background: "rgba(255,255,255,0.02)" }}>
              {c}
            </motion.span>
          ))}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 }}
          className="absolute bottom-10 flex flex-col items-center gap-2 text-xs" style={{ color: G.text2 }}>
          <span className="uppercase tracking-widest">Scroll</span>
          <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </motion.div>
        </motion.div>
      </section>

      {/* Video */}
      <section id="video" className="relative px-4 py-24 sm:px-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <Glow size={1000} op={0.07} x="50%" y="50%" />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: G.gold }}>Product demo</motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1, duration: 0.6, ease: EASE_OUT }}
              className="text-4xl font-black sm:text-5xl" style={{ color: G.text0 }}>See it in action</motion.h2>
            <motion.p initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
              className="mx-auto mt-4 max-w-xl" style={{ color: G.text1 }}>
              A 60-second cinematic walkthrough built with Remotion — executive overview to granular role permissions.
            </motion.p>
          </div>
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: EASE_OUT }}>
            <VideoPlayer />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
            className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a href="/hse-hub-ad.mp4" download="HSE-Hub-Demo.mp4"
              className="flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm transition-all duration-200 hover:border-[rgba(212,175,55,0.26)]"
              style={{ borderColor: G.border, color: G.text1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Download MP4
            </a>
            <span className="text-xs" style={{ color: G.text2 }}>H264 · 1920×1080 · 30fps · faststart</span>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-4 py-20 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div ref={statsRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STATS.map((s, i) => <StatTile key={s.label} {...s} index={i} active={statsVisible} />)}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-24 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-14">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: G.gold }}>What&apos;s inside</motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1, duration: 0.6, ease: EASE_OUT }}
              className="text-4xl font-black sm:text-5xl" style={{ color: G.text0 }}>
              Every feature<br /><span style={{ color: G.gold }}>you need.</span>
            </motion.h2>
          </div>
          <div className="divide-y" style={{ borderColor: G.border }}>
            {FEATURES.map((f, i) => <FeatureRow key={f.num} f={f} index={i} />)}
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="px-4 py-24 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: G.gold }}>Built on</motion.p>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1, duration: 0.6, ease: EASE_OUT }}
              className="text-3xl font-black sm:text-4xl" style={{ color: G.text0 }}>Production-grade stack</motion.h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map((s, i) => <StackCard key={s.name} s={s} index={i} />)}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden px-6 py-40 text-center">
        <div className="pointer-events-none absolute inset-0">
          <Glow size={1000} op={0.09} x="50%" y="50%" />
          <GridLines opacity={0.025} />
        </div>
        <div className="relative z-10 mx-auto max-w-2xl">
          <motion.h2 initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: EASE_OUT }}
            className="mb-6 text-5xl font-black tracking-tight sm:text-6xl" style={{ color: G.text0 }}>
            Ready to{" "}
            <span style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>connect?</span>
          </motion.h2>
          <motion.p initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 }}
            className="mb-12 text-lg leading-relaxed" style={{ color: G.text1 }}>
            Deployed on Vercel · Powered by Supabase · Syncs every few minutes
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 }}
            className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/auth/login" className="rounded-xl px-10 py-4 text-lg font-bold transition-all duration-200 hover:scale-[1.03] hover:opacity-90"
              style={{ background: `linear-gradient(135deg,${G.gold},${G.goldHover})`, color: G.bg0, boxShadow: `0 12px 48px rgba(212,175,55,0.35)` }}>
              Sign in to the portal →
            </Link>
            <a href="https://github.com/hitul-hse/supabase-app" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border px-8 py-4 font-semibold transition-all duration-200 hover:scale-[1.02]"
              style={{ borderColor: G.border, color: G.text1 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
              GitHub
            </a>
          </motion.div>
          <p className="mt-10 text-sm" style={{ color: G.text2 }}>hseportal.hs-experts.com</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8 text-center" style={{ borderColor: G.border }}>
        <p className="text-sm" style={{ color: G.text2 }}>
          © 2026 HSE Health &amp; Safety Experts GmbH <span style={{ color: G.border }}>·</span> Built with <span style={{ color: G.gold }}>V3Code</span> &amp; Claude
        </p>
      </footer>
    </div>
  );
}
