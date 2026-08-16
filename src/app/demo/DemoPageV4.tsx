"use client";
// DemoPageV4 — HSE Hub marketing/demo page
// Persuade mode · Goldsmith design system · emilkowalski animation principles
// Motion: transform+opacity only, cubic-bezier(0.23,1,0.32,1), springs bounce:0

import { useEffect, useRef, useState, useCallback } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  AnimatePresence,
} from "framer-motion";

const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING_UI = { type: "spring", bounce: 0, duration: 0.4 } as const;

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

function Particle({ index }: { index: number }) {
  const x = (index * 137.5) % 100;
  const y = (index * 97.3) % 100;
  const size = 1.5 + (index % 3) * 0.8;
  const dur = 8 + (index % 6) * 2;
  const delay = (index * 0.4) % 4;
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, background: `rgba(212,168,67,${0.2 + (index % 4) * 0.12})` }}
      animate={{
        transform: [
          "translateY(0px) translateX(0px)",
          `translateY(-${12 + (index % 8) * 4}px) translateX(${(index % 2 === 0 ? 1 : -1) * (6 + (index % 5) * 3)}px)`,
          "translateY(0px) translateX(0px)",
        ],
        opacity: [0.3, 0.8, 0.3],
      }}
      transition={{ duration: dur, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function TiltCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const rotX = useSpring(0, { stiffness: 200, damping: 25, bounce: 0 });
  const rotY = useSpring(0, { stiffness: 200, damping: 25, bounce: 0 });
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    rotX.set((cy - 0.5) * -10);
    rotY.set((cx - 0.5) * 10);
    glowX.set(cx * 100);
    glowY.set(cy * 100);
  }, [rotX, rotY, glowX, glowY]);
  const onLeave = useCallback(() => {
    rotX.set(0); rotY.set(0); glowX.set(50); glowY.set(50);
  }, [rotX, rotY, glowX, glowY]);
  return (
    <motion.div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ rotateX: rotX, rotateY: rotY, transformStyle: "preserve-3d", ...style }}
      className={`relative overflow-hidden ${className}`}>
      <motion.div className="absolute inset-0 pointer-events-none rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(212,168,67,0.08) 0%, transparent 60%)` }} />
      {children}
    </motion.div>
  );
}

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

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} variants={stagger(0.08)} initial="hidden" animate={inView ? "show" : "hidden"} className={className}>
      {children}
    </motion.div>
  );
}

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
    <div className="relative rounded-2xl overflow-hidden cursor-pointer"
      style={{ background: "#0a0a0b", boxShadow: "0 0 80px rgba(212,168,67,0.15), 0 32px 64px rgba(0,0,0,0.6)" }}
      onMouseMove={revealCtrl} onClick={toggle}>
      <div className="absolute inset-0 rounded-2xl pointer-events-none z-10"
        style={{ boxShadow: "inset 0 0 0 1px rgba(212,168,67,0.2)" }} />
      <video ref={videoRef} src="/hse-hub-ad.mp4" className="w-full aspect-video object-cover" playsInline preload="metadata" />
      <AnimatePresence>
        {showCtrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="absolute inset-0 z-20 flex flex-col justify-between p-6"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.3) 100%)" }}>
            <div className="flex items-center gap-2">
              <motion.div className="w-2 h-2 rounded-full" style={{ background: "#4ade80" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.7)" }}>
                HSE Hub · Product Demo
              </span>
            </div>
            <div className="flex items-center justify-center flex-1">
              <motion.button
                whileHover={{ transform: "scale(1.08)" }} whileTap={{ transform: "scale(0.95)" }} transition={SPRING_UI}
                className="w-20 h-20 rounded-full flex items-center justify-center backdrop-blur-md"
                style={{ background: "rgba(212,168,67,0.15)", border: "1px solid rgba(212,168,67,0.4)", boxShadow: "0 0 40px rgba(212,168,67,0.25)", color: "#d4a843" }}
                onClick={e => { e.stopPropagation(); toggle(); }}>
                {playing
                  ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}><path d="M5 3l14 9-14 9V3z"/></svg>
                }
              </motion.button>
            </div>
            <div className="space-y-3">
              <div className="h-1 rounded-full cursor-pointer overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}
                onClick={e => { e.stopPropagation(); seek(e); }}>
                <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#d4a843,#f0c060)" }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>60s · Remotion H264</span>
                <a href="/hse-hub-ad.mp4" download className="text-xs font-medium flex items-center gap-1 hover:opacity-80 transition-opacity"
                  style={{ color: "#d4a843" }} onClick={e => e.stopPropagation()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

const features = [
  { num: "01", title: "Live Dashboard", desc: "Billable utilisation, headcount, active project counts — no spreadsheets. Data refreshes every sync cycle across all four connected systems.", tags: ["Real-time", "Exec + Dept Head"], color: "#d4a843" },
  { num: "02", title: "Role-gated RBAC", desc: "Fine-grained permission matrix. Executives toggle each permission per role — no code deploy required. Enforced at database level via RLS.", tags: ["24 permissions", "Zero code changes"], color: "#60a5fa" },
  { num: "03", title: "Identity Resolution", desc: "One person exists in Asana, TrackingTime, and FactorialHR with different IDs. The identity map canonicalises them — cross-system joins always accurate.", tags: ["Zero duplicates", "Effective-dated"], color: "#4ade80" },
  { num: "04", title: "Workload Booking", desc: "Team leads book 4-week rolling workloads per person. Executives and department heads approve or reject — all logged with audit trail.", tags: ["4-week rolling", "Approval workflow"], color: "#a78bfa" },
  { num: "05", title: "Timesheet Grid", desc: "Weekly entry grid per employee, synced from TrackingTime. Billable vs non-billable breakdown, project attribution, and weekly totals at a glance.", tags: ["TrackingTime sync", "Billable %"], color: "#f87171" },
  { num: "06", title: "4-System Pipeline", desc: "Asana tasks → projects. FactorialHR → people & leave. TrackingTime → hours. Samdock → clients. One unified schema.", tags: ["Asana", "Factorial", "TrackingTime", "Samdock"], color: "#fb923c" },
];

const stackItems = [
  { label: "Next.js 16", sub: "App Router · Server Components · Streaming", icon: "▲" },
  { label: "Supabase", sub: "PostgreSQL · RLS · Auth · Realtime", icon: "⚡" },
  { label: "Vercel Edge", sub: "Global CDN · Preview deploys · OIDC", icon: "◈" },
  { label: "Framer Motion", sub: "Springs · Layout animations · Gestures", icon: "◎" },
  { label: "GitHub Actions", sub: "Lint → tsc → build → db-tests on every PR", icon: "◆" },
  { label: "Remotion", sub: "React-rendered 60s H264 product video", icon: "▶" },
];

export default function DemoPageV4() {
  return (
    <div className="min-h-screen" style={{ background: "#0c0c0d", color: "#f5f5f0" }}>
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute" style={{ top: "-20%", left: "20%", width: 600, height: 600, background: "radial-gradient(circle, rgba(212,168,67,0.06) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div className="absolute" style={{ bottom: "10%", right: "10%", width: 400, height: 400, background: "radial-gradient(circle, rgba(96,165,250,0.04) 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="absolute inset-0">{Array.from({ length: 20 }, (_, i) => <Particle key={i} index={i} />)}</div>
        <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
      </div>

      {/* NAV */}
      <motion.nav initial={{ opacity: 0, transform: "translateY(-12px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ ease: EASE, duration: 0.5 }}
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14"
        style={{ background: "rgba(12,12,13,0.85)", backdropFilter: "blur(20px) saturate(180%)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="h-6 px-2.5 rounded-md flex items-center text-xs font-bold tracking-widest"
            style={{ background: "linear-gradient(135deg,#d4a843,#b8922e)", color: "#0c0c0d" }}>HSE HUB</div>
          <span className="hidden sm:block text-xs font-medium" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>PRODUCT DEMO</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://github.com/hitul-hse/supabase-app" target="_blank"
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium hover:opacity-70 transition-opacity"
            style={{ color: "rgba(255,255,255,0.45)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.66-.22.66-.48v-1.7C6.73 19.91 6.14 18 6.14 18c-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 7.82c.85.004 1.7.115 2.5.337 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48C19.14 20.16 22 16.42 22 12c0-5.52-4.48-10-10-10z"/>
            </svg>GitHub
          </a>
          <motion.a href="/auth/login" whileHover={{ transform: "scale(1.03)" }} whileTap={{ transform: "scale(0.97)" }}
            transition={SPRING_UI} className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{ background: "linear-gradient(135deg,#d4a843,#b8922e)", color: "#0c0c0d" }}>
            Sign in →
          </motion.a>
        </div>
      </motion.nav>

      {/* HERO */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center">
        <motion.div initial={{ opacity: 0, transform: "translateY(8px) scale(0.97)" }} animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          transition={{ ease: EASE, duration: 0.5, delay: 0.1 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-10"
          style={{ background: "rgba(212,168,67,0.1)", border: "1px solid rgba(212,168,67,0.25)", color: "#d4a843" }}>
          <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }}
            animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
          Live · 4 systems connected · hseportal.hs-experts.com
        </motion.div>

        <div className="max-w-4xl mx-auto">
          <motion.h1 className="font-bold leading-none mb-6" style={{ fontSize: "clamp(48px,8vw,96px)", letterSpacing: "-0.04em" }}>
            {["Operations.", "Unified."].map((w, i) => (
              <motion.div key={w} initial={{ opacity: 0, transform: "translateY(24px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ ease: EASE, duration: 0.7, delay: 0.2 + i * 0.12 }}
                style={i === 1 ? {
                  background: "linear-gradient(135deg,#d4a843 0%,#f0c060 40%,#b8922e 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", display: "block"
                } : { display: "block", color: "#f5f5f0" }}>{w}
              </motion.div>
            ))}
          </motion.h1>
          <motion.p initial={{ opacity: 0, transform: "translateY(16px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.6, delay: 0.45 }}
            className="text-lg leading-relaxed max-w-2xl mx-auto mb-12" style={{ color: "#a0a09a", letterSpacing: "-0.01em" }}>
            HSE Hub connects Asana, TrackingTime, Samdock CRM, and FactorialHR into one
            role-gated intelligence layer — built for HSE Health &amp; Safety Experts GmbH.
          </motion.p>
          <motion.div initial={{ opacity: 0, transform: "translateY(12px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.5, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-4">
            <motion.a href="#video" whileHover={{ transform: "scale(1.04) translateY(-1px)" }} whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING_UI} className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold"
              style={{ background: "linear-gradient(135deg,#d4a843,#b8922e)", color: "#0c0c0d", boxShadow: "0 8px 32px rgba(212,168,67,0.3)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: -2 }}><path d="M5 3l14 9-14 9V3z"/></svg>
              Watch the demo
            </motion.a>
            <motion.a href="/auth/login" whileHover={{ transform: "scale(1.02) translateY(-1px)" }} whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING_UI} className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold"
              style={{ background: "transparent", color: "#f5f5f0", border: "1px solid rgba(255,255,255,0.14)" }}>
              Open portal →
            </motion.a>
          </motion.div>
        </div>

        {/* Stats strip */}
        <motion.div initial={{ opacity: 0, transform: "translateY(20px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.6, delay: 0.75 }}
          className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden max-w-2xl w-full"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {[{ val: 41, label: "Active people" }, { val: 27, label: "Live projects" }, { val: 4, label: "Systems synced" }, { val: 24, label: "Permissions" }].map(s => (
            <div key={s.label} className="flex flex-col items-center justify-center py-5 px-4" style={{ background: "#0c0c0d" }}>
              <div className="text-2xl font-bold mb-0.5" style={{ color: "#d4a843", letterSpacing: "-0.02em" }}>
                <CountUp to={s.val} />
              </div>
              <div className="text-xs" style={{ color: "#6b6b65" }}>{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2" style={{ transform: "translateX(-50%)" }}>
          <motion.div animate={{ transform: ["translateY(0px)", "translateY(6px)", "translateY(0px)"] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center gap-1 opacity-30">
            <span className="text-xs tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>Scroll</span>
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"><path d="M1 1l7 7 7-7"/></svg>
          </motion.div>
        </div>
      </section>

      {/* VIDEO */}
      <section id="video" className="relative px-6 py-24 max-w-5xl mx-auto">
        <Section className="mb-12 text-center">
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-5"
            style={{ background: "rgba(212,168,67,0.08)", border: "1px solid rgba(212,168,67,0.2)", color: "#d4a843" }}>
            60-second Remotion-rendered video
          </motion.div>
          <motion.h2 variants={fadeUp} className="text-4xl font-bold mb-4" style={{ letterSpacing: "-0.03em", color: "#f5f5f0" }}>See it in action</motion.h2>
          <motion.p variants={fadeUp} className="text-base max-w-lg mx-auto" style={{ color: "#a0a09a" }}>
            A 60-second walkthrough of every module — rendered frame-by-frame with Remotion, encoded as H264 MP4.
          </motion.p>
        </Section>
        <motion.div initial={{ opacity: 0, transform: "translateY(32px) scale(0.97)" }}
          whileInView={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          viewport={{ once: true, margin: "-60px" }} transition={{ ease: EASE, duration: 0.7 }}>
          <VideoPlayer />
        </motion.div>
      </section>

      {/* FEATURES */}
      <section className="px-6 py-24 max-w-4xl mx-auto">
        <Section className="mb-4">
          <motion.p variants={fadeUp} className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "#d4a843" }}>What it does</motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-2" style={{ letterSpacing: "-0.03em" }}>Every module, explained</motion.h2>
        </Section>
        <div>
          {features.map((f, i) => {
            const ref = useRef<HTMLDivElement>(null);
            const inView = useInView(ref, { once: true, margin: "-40px" });
            return (
              <motion.div key={f.num} ref={ref}
                initial={{ opacity: 0, transform: "translateX(-16px)" }}
                animate={inView ? { opacity: 1, transform: "translateX(0px)" } : {}}
                transition={{ ease: EASE, duration: 0.5, delay: i * 0.05 }}
                className="group flex items-start gap-8 py-8 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <span className="text-xs font-mono pt-1 shrink-0 w-8" style={{ color: f.color, opacity: 0.7 }}>{f.num}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold mb-2" style={{ color: "#f5f5f0", letterSpacing: "-0.01em" }}>{f.title}</h3>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: "#a0a09a" }}>{f.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.tags.map(t => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${f.color}18`, color: f.color, border: `1px solid ${f.color}28` }}>{t}</span>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* STACK */}
      <section className="px-6 py-24 max-w-5xl mx-auto">
        <Section className="mb-12 text-center">
          <motion.p variants={fadeUp} className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "#d4a843" }}>Production stack</motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold" style={{ letterSpacing: "-0.03em" }}>Built to last</motion.h2>
        </Section>
        <Section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stackItems.map((s, i) => (
            <motion.div key={s.label} variants={{
              hidden: { opacity: 0, transform: "translateY(16px) scale(0.97)" },
              show: { opacity: 1, transform: "translateY(0px) scale(1)", transition: { ease: EASE, duration: 0.5, delay: i * 0.06 } },
            }}>
              <TiltCard className="group p-5 rounded-xl" style={{ background: "#141415", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-2xl mb-3">{s.icon}</div>
                <div className="text-sm font-semibold mb-1" style={{ color: "#f5f5f0", letterSpacing: "-0.01em" }}>{s.label}</div>
                <div className="text-xs leading-relaxed" style={{ color: "#6b6b65" }}>{s.sub}</div>
              </TiltCard>
            </motion.div>
          ))}
        </Section>
      </section>

      {/* CTA */}
      <section className="px-6 py-32 text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(212,168,67,0.06) 0%, transparent 70%)" }} />
        <Section>
          <motion.p variants={fadeUp} className="text-xs font-medium tracking-widest uppercase mb-6" style={{ color: "#d4a843" }}>Ready to connect your operations?</motion.p>
          <motion.h2 variants={fadeUp} className="font-bold mb-4 max-w-2xl mx-auto"
            style={{ fontSize: "clamp(36px,5vw,64px)", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
            One portal.{" "}
            <span style={{ background: "linear-gradient(135deg,#d4a843,#f0c060)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              All the data.
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base mb-12 max-w-md mx-auto" style={{ color: "#a0a09a" }}>
            Log in to the live portal at hseportal.hs-experts.com — or watch the 60-second demo above.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-4">
            <motion.a href="/auth/login" whileHover={{ transform: "scale(1.04) translateY(-2px)" }} whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING_UI} className="px-8 py-4 rounded-xl text-sm font-bold"
              style={{ background: "linear-gradient(135deg,#d4a843,#b8922e)", color: "#0c0c0d", boxShadow: "0 12px 40px rgba(212,168,67,0.35)" }}>
              Open portal →
            </motion.a>
            <motion.a href="/hse-hub-ad.mp4" download whileHover={{ transform: "scale(1.02) translateY(-1px)" }} whileTap={{ transform: "scale(0.97)" }}
              transition={SPRING_UI} className="flex items-center gap-2 px-8 py-4 rounded-xl text-sm font-semibold"
              style={{ background: "transparent", color: "#f5f5f0", border: "1px solid rgba(255,255,255,0.12)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download MP4
            </motion.a>
          </motion.div>
        </Section>
      </section>

      {/* FOOTER */}
      <footer className="px-6 py-10 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-5 px-2 rounded text-xs font-bold tracking-widest flex items-center"
              style={{ background: "linear-gradient(135deg,#d4a843,#b8922e)", color: "#0c0c0d" }}>HSE HUB</div>
            <span className="text-xs" style={{ color: "#6b6b65" }}>© {new Date().getFullYear()} HSE Health & Safety Experts GmbH</span>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: "#6b6b65" }}>
            <a href="/auth/login" className="hover:opacity-80 transition-opacity">Portal</a>
            <a href="https://github.com/hitul-hse/supabase-app" target="_blank" className="hover:opacity-80 transition-opacity">GitHub</a>
            <span style={{ color: "#d4a843" }}>hseportal.hs-experts.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
