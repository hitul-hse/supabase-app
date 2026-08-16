"use client";
/**
 * DemoPageV4 — HSE Hub marketing showcase
 * Skills applied: high-end-visual-design · apple-design · impeccable/typeset
 *                 stitch-design-taste · emilkowalski/animate
 *
 * Typography:
 *   Display  — Clash Display (variable, 300–700) — editorial punch for the hero
 *   UI/Body  — Plus Jakarta Sans (variable) — modern grotesk, replaces plain Poppins
 *   Mono     — JetBrains Mono — feature numbers, metadata
 *
 * Layout archetype: Asymmetric Bento (stitch-design-taste §6)
 * Vibe archetype:   Ethereal Glass on deep OLED + HSE teal (high-end-visual-design §3A)
 * Nav:              Floating pill island, detached from top (high-end-visual-design §5A)
 * Cards:            Double-bezel nested architecture (high-end-visual-design §4A)
 * CTAs:             Button-in-button trailing icon (high-end-visual-design §4B)
 * Motion:           transform+opacity only, cubic-bezier(0.23,1,0.32,1), springs bounce:0
 * Tracking:         Size-specific — display tight (-0.04em), UI zero, body +0.01em
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

/* ─── Brand tokens ──────────────────────────────────────────────────── */
const T = {
  bg0:         "#0a1012",        // OLED deep — near-black, teal-undertone
  bg1:         "#111a1c",        // raised surface / card fill
  bg2:         "#162022",        // hover / inner core
  bg3:         "#1c2a2d",        // active / selected

  teal:        "#91C2B7",        // HSE primary — extracted from hs-experts.com
  tealDeep:    "#29474B",
  tealLight:   "#B8D8D2",
  tealSubtle:  "rgba(145,194,183,0.09)",
  tealBorder:  "rgba(145,194,183,0.18)",
  tealGlow:    "rgba(145,194,183,0.22)",

  text0:       "#EEF3F2",        // warm white with teal tint
  text1:       "#7FA09C",        // secondary
  text2:       "#3E5E5B",        // muted / metadata

  border:      "rgba(145,194,183,0.07)",
  borderMid:   "rgba(145,194,183,0.13)",
  borderStrong:"rgba(145,194,183,0.20)",

  green:       "#4ade80",
  amber:       "#fbbf24",
} as const;

/* ─── Motion primitives ─────────────────────────────────────────────── */
// Size-specific cubic-bezier (apple-design §11)
const EASE  = [0.23, 1, 0.32, 1] as const;
const EASE2 = [0.32, 0.72, 0, 1]  as const;   // snappier for small UI elements
const SP    = { type: "spring", bounce: 0, duration: 0.4 } as const;
const SP_SOFT = { type: "spring", bounce: 0.12, duration: 0.5 } as const;

const fadeUp = {
  hidden: { opacity: 0, transform: "translateY(22px) scale(0.97)" },
  show:   { opacity: 1, transform: "translateY(0px)  scale(1)",
            transition: { ease: EASE, duration: 0.65 } },
};

const stagger = (s = 0.07) => ({
  hidden: {},
  show:   { transition: { staggerChildren: s } },
});

/* ─── Typography ────────────────────────────────────────────────────── */
// Cormorant Garamond: editorial serif display — cinematic weight for hero headlines
// Plus Jakarta Sans: UI labels, body, nav — modern grotesk with optical balance
// JetBrains Mono: numbers, badges, metadata
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, 'Times New Roman', serif";
const FONT_UI      = "'Plus Jakarta Sans', system-ui, sans-serif";
const FONT_MONO    = "'JetBrains Mono', 'Fira Code', monospace";

/* ─── Particle ──────────────────────────────────────────────────────── */
function Particle({ index }: { index: number }) {
  const x    = (index * 137.508) % 100;
  const y    = (index * 97.3)    % 100;
  const size = 1.2 + (index % 4) * 0.6;
  const dur  = 12 + (index % 7) * 2.2;
  const delay = (index * 0.6) % 6;
  const tx   = (index % 2 === 0 ? 1 : -1) * (6 + (index % 5) * 3);

  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: `${x}%`, top: `${y}%`,
        width: size, height: size,
        background: `rgba(145,194,183,${0.12 + (index % 4) * 0.08})`,
        filter: "blur(0.3px)",
      }}
      animate={{
        transform: [
          "translateY(0px) translateX(0px)",
          `translateY(-${12 + (index % 8) * 4}px) translateX(${tx}px)`,
          "translateY(0px) translateX(0px)",
        ],
        opacity: [0.15, 0.55, 0.15],
      }}
      transition={{ duration: dur, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ─── Double-bezel card (high-end-visual-design §4A) ───────────────── */
// Outer shell: subtle bg + hairline border + padding + large radius
// Inner core: own bg, inset highlight, mathematically smaller radius
function BezelCard({
  children, className = "", style, outerRadius = "1.75rem",
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  outerRadius?: string;
}) {
  const innerR = `calc(${outerRadius} - 0.375rem)`;
  return (
    <div
      className={`p-[6px] ${className}`}
      style={{
        background: "rgba(145,194,183,0.04)",
        border: `1px solid ${T.borderMid}`,
        borderRadius: outerRadius,
        ...style,
      }}
    >
      <div
        className="w-full h-full"
        style={{
          background: T.bg1,
          borderRadius: innerR,
          boxShadow: "inset 0 1px 1px rgba(145,194,183,0.08), inset 0 -1px 1px rgba(0,0,0,0.3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── TiltCard with glow tracking ──────────────────────────────────── */
function TiltCard({
  children, className = "", style,
}: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref  = useRef<HTMLDivElement>(null);
  const rotX = useSpring(0, { stiffness: 180, damping: 24, bounce: 0 });
  const rotY = useSpring(0, { stiffness: 180, damping: 24, bounce: 0 });
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top)  / r.height;
    rotX.set((cy - 0.5) * -7);
    rotY.set((cx - 0.5) *  7);
    glowX.set(cx * 100);
    glowY.set(cy * 100);
  }, [rotX, rotY, glowX, glowY]);

  const onLeave = useCallback(() => {
    rotX.set(0); rotY.set(0);
    glowX.set(50); glowY.set(50);
  }, [rotX, rotY, glowX, glowY]);

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX: rotX, rotateY: rotY, transformStyle: "preserve-3d", ...style }}
      className={`relative overflow-hidden ${className}`}
    >
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{
          background: `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(145,194,183,0.09) 0%, transparent 55%)`,
        }}
      />
      {children}
    </motion.div>
  );
}

/* ─── CountUp ───────────────────────────────────────────────────────── */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref    = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const tick  = (now: number) => {
      const p     = Math.min((now - start) / 1800, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, to]);

  return <span ref={ref}>{val}{suffix}</span>;
}

/* ─── Section reveal ────────────────────────────────────────────────── */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
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

/* ─── Eyebrow pill ──────────────────────────────────────────────────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] font-semibold mb-5"
      style={{
        background: T.tealSubtle,
        border: `1px solid ${T.tealBorder}`,
        color: T.teal,
        fontFamily: FONT_UI,
      }}
    >
      {children}
    </span>
  );
}

/* ─── Video player ──────────────────────────────────────────────────── */
function VideoPlayer() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying]   = useState(false);
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
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
    const onEnd  = () => { setPlaying(false); setShowCtrl(true); };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended",      onEnd);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("ended", onEnd); };
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  };

  // Double-bezel wrapping the video
  return (
    <BezelCard outerRadius="1.25rem" style={{ padding: "7px" }}>
      <div
        className="relative rounded-[calc(1.25rem-0.5rem)] overflow-hidden cursor-pointer"
        style={{ background: T.bg0 }}
        onMouseMove={revealCtrl}
        onClick={toggle}
      >
        {/* Inset border glow */}
        <div className="absolute inset-0 pointer-events-none z-10 rounded-[inherit]"
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-0 z-20 flex flex-col justify-between p-5"
              style={{
                background: "linear-gradient(to top, rgba(10,16,18,0.9) 0%, transparent 40%, transparent 65%, rgba(10,16,18,0.45) 100%)",
              }}
            >
              {/* Top bar */}
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-2 h-2 rounded-full"
                  style={{ background: T.green }}
                  animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[10px] font-semibold tracking-[0.18em] uppercase"
                  style={{ color: "rgba(238,243,242,0.55)", fontFamily: FONT_UI }}>
                  HSE Health &amp; Safety Experts · Product Demo
                </span>
              </div>

              {/* Play/pause — button-in-button style */}
              <div className="flex items-center justify-center flex-1">
                <motion.button
                  whileHover={{ transform: "scale(1.08)" }}
                  whileTap={{ transform: "scale(0.93)" }}
                  transition={SP}
                  className="rounded-full flex items-center justify-center"
                  style={{
                    width: 76, height: 76,
                    background: "rgba(145,194,183,0.10)",
                    border: `1px solid ${T.tealBorder}`,
                    boxShadow: `0 0 48px rgba(145,194,183,0.18), inset 0 1px 1px rgba(255,255,255,0.08)`,
                    color: T.teal,
                    backdropFilter: "blur(14px) saturate(160%)",
                  }}
                  onClick={e => { e.stopPropagation(); toggle(); }}
                >
                  {/* inner icon wrapper — button-in-button */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(145,194,183,0.12)" }}>
                    {playing
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6"  y="4" width="4" height="16" rx="1.5"/>
                          <rect x="14" y="4" width="4" height="16" rx="1.5"/>
                        </svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                          <path d="M5 3l14 9-14 9V3z"/>
                        </svg>
                    }
                  </div>
                </motion.button>
              </div>

              {/* Scrubber */}
              <div className="space-y-3">
                <div
                  className="h-[3px] rounded-full cursor-pointer overflow-hidden"
                  style={{ background: "rgba(145,194,183,0.14)" }}
                  onClick={e => { e.stopPropagation(); seek(e); }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${progress}%`,
                      background: `linear-gradient(90deg, ${T.teal}, ${T.tealLight})`,
                      transition: "none",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: "rgba(238,243,242,0.35)", fontFamily: FONT_MONO }}>
                    60s · Remotion H264 1080p
                  </span>
                  <a
                    href="/hse-hub-ad.mp4"
                    download
                    className="text-[10px] font-semibold flex items-center gap-1 transition-opacity hover:opacity-60"
                    style={{ color: T.teal, fontFamily: FONT_UI }}
                    onClick={e => e.stopPropagation()}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
    </BezelCard>
  );
}

/* ─── Feature bento items ───────────────────────────────────────────── */
const features = [
  {
    num: "01", title: "Live Dashboard",
    desc: "Billable utilisation, headcount, and active project counts — no manual collation. Refreshes every sync cycle.",
    tags: ["Real-time", "Exec + Dept Head"],
    color: T.teal, span: "lg:col-span-2",
  },
  {
    num: "02", title: "Fine-grained RBAC",
    desc: "24 permissions across 7 resource groups. Toggle per role from the admin panel — enforced at database level via Row-Level Security.",
    tags: ["24 permissions", "Zero code changes"],
    color: "#60a5fa", span: "lg:col-span-1",
  },
  {
    num: "03", title: "Identity Resolution",
    desc: "One person in Asana, TrackingTime, and FactorialHR — three different IDs. The canonical identity map joins them accurately.",
    tags: ["Zero duplicates", "Effective-dated"],
    color: "#4ade80", span: "lg:col-span-1",
  },
  {
    num: "04", title: "Workload Booking",
    desc: "Team leads book 4-week rolling workloads. Executives and department heads approve or reject — all decisions logged.",
    tags: ["4-week rolling", "Approval workflow"],
    color: "#a78bfa", span: "lg:col-span-1",
  },
  {
    num: "05", title: "Timesheet Grid",
    desc: "Weekly entry grid synced from TrackingTime. Billable vs non-billable breakdown, project attribution, weekly totals.",
    tags: ["TrackingTime sync", "Billable %"],
    color: "#fb923c", span: "lg:col-span-1",
  },
  {
    num: "06", title: "4-System Pipeline",
    desc: "Asana · FactorialHR · TrackingTime · Samdock. One unified Postgres schema, one portal.",
    tags: ["Asana", "Factorial", "TrackingTime", "Samdock"],
    color: T.tealLight, span: "lg:col-span-2",
  },
] as const;

function BentoFeature({ f, i }: { f: typeof features[number]; i: number }) {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, transform: "translateY(24px) scale(0.97)" }}
      animate={inView ? { opacity: 1, transform: "translateY(0px) scale(1)" } : {}}
      transition={{ ease: EASE, duration: 0.6, delay: i * 0.06 }}
      className={`${f.span}`}
    >
      <TiltCard className="group h-full">
        {/* Outer shell */}
        <div
          className="h-full p-[6px] rounded-[1.5rem]"
          style={{
            background: "rgba(145,194,183,0.035)",
            border: `1px solid ${T.borderMid}`,
          }}
        >
          {/* Inner core */}
          <div
            className="h-full p-6 rounded-[calc(1.5rem-0.375rem)]"
            style={{
              background: T.bg1,
              boxShadow: "inset 0 1px 1px rgba(145,194,183,0.07), inset 0 -1px 1px rgba(0,0,0,0.25)",
              minHeight: 200,
            }}
          >
            {/* Feature number */}
            <div className="flex items-start justify-between mb-5">
              <span
                className="text-xs font-medium"
                style={{ color: f.color, opacity: 0.7, fontFamily: FONT_MONO, letterSpacing: "0.05em" }}
              >
                {f.num}
              </span>
              <motion.div
                className="w-0 h-[1px] group-hover:w-8 origin-left"
                style={{ background: f.color }}
                transition={{ ease: EASE2, duration: 0.35 }}
              />
            </div>

            <h3
              className="text-base font-semibold mb-2 leading-snug"
              style={{ color: T.text0, letterSpacing: "-0.02em", fontFamily: FONT_UI }}
            >
              {f.title}
            </h3>
            <p
              className="text-sm leading-relaxed mb-4"
              style={{ color: T.text1, fontFamily: FONT_UI, lineHeight: 1.65 }}
            >
              {f.desc}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {f.tags.map(t => (
                <span
                  key={t}
                  className="text-[10px] px-2.5 py-[3px] rounded-full font-semibold tracking-wide uppercase"
                  style={{
                    background: `${f.color}12`,
                    color: f.color,
                    border: `1px solid ${f.color}24`,
                    fontFamily: FONT_UI,
                    letterSpacing: "0.06em",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </TiltCard>
    </motion.div>
  );
}

/* ─── Stack items ───────────────────────────────────────────────────── */
const stackItems = [
  { label: "Next.js 16",      sub: "App Router · Server Components · Streaming SSR", icon: "▲", color: T.text0 },
  { label: "Supabase",        sub: "PostgreSQL · Row-Level Security · Auth",          icon: "⚡", color: T.teal },
  { label: "Vercel Edge",     sub: "Global CDN · Preview deployments · OIDC",         icon: "◈", color: "#60a5fa" },
  { label: "Framer Motion",   sub: "Springs · Layout animations · Gesture physics",   icon: "◎", color: "#a78bfa" },
  { label: "GitHub Actions",  sub: "lint → tsc → build → db-tests on every PR",       icon: "◆", color: "#4ade80" },
  { label: "Remotion",        sub: "React-rendered 60s H264 1080p product video",     icon: "▶", color: "#fb923c" },
] as const;

/* ─── Logo mark ─────────────────────────────────────────────────────── */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }}>
      <Image src="/hse-logo.png" alt="HSE Logo" fill style={{ objectFit: "contain" }} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────── */
export default function DemoPageV4() {
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="min-h-[100dvh]"
      style={{ background: T.bg0, color: T.text0, fontFamily: FONT_UI }}
    >
      {/* ── Fonts: Cormorant Garamond + Plus Jakarta Sans + JetBrains Mono ── */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; }
        ::selection { background: rgba(145,194,183,0.22); color: ${T.text0}; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: ${T.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${T.tealDeep}; border-radius: 3px; }

        /* Button hover fix — prevent Framer Motion from clobbering background */
        .btn-primary { background: ${T.teal} !important; color: #0a1012 !important; }
        .btn-primary:hover { background: ${T.tealLight} !important; }
        .btn-secondary { background: transparent !important; color: ${T.text0} !important; }
      `}</style>

      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,600;1,700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      />

      {/* ── Ambient layer (fixed, pointer-events-none) ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }} aria-hidden>
        {/* Glow orbs */}
        <div className="absolute" style={{
          top: "-10%", left: "10%",
          width: 760, height: 760,
          background: "radial-gradient(circle, rgba(145,194,183,0.045) 0%, transparent 70%)",
          filter: "blur(90px)",
        }} />
        <div className="absolute" style={{
          bottom: "8%", right: "4%",
          width: 520, height: 520,
          background: "radial-gradient(circle, rgba(41,71,75,0.18) 0%, transparent 70%)",
          filter: "blur(110px)",
        }} />
        <div className="absolute" style={{
          top: "42%", left: "58%",
          width: 320, height: 320,
          background: "radial-gradient(circle, rgba(145,194,183,0.035) 0%, transparent 70%)",
          filter: "blur(70px)",
        }} />

        {/* Particles */}
        <div className="absolute inset-0">
          {Array.from({ length: 24 }, (_, i) => <Particle key={i} index={i} />)}
        </div>

        {/* 72px grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(${T.border} 1px, transparent 1px), linear-gradient(90deg, ${T.border} 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
        }} />

        {/* Film grain — fixed pseudo-element via inline style */}
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E")`,
          opacity: 0.4,
        }} />
      </div>

      {/* ── FLOATING PILL NAV (high-end-visual-design §5A) ── */}
      <div className="fixed top-0 inset-x-0 z-50 flex justify-center pt-5 px-4">
        <motion.nav
          initial={{ opacity: 0, transform: "translateY(-16px) scale(0.97)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          transition={SP_SOFT}
          className="flex items-center justify-between gap-6 px-5 h-12 w-full max-w-3xl rounded-full"
          style={{
            background: navScrolled
              ? "rgba(10,16,18,0.92)"
              : "rgba(10,16,18,0.75)",
            backdropFilter: "blur(24px) saturate(180%)",
            border: `1px solid ${navScrolled ? T.borderMid : T.border}`,
            boxShadow: navScrolled
              ? `0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(145,194,183,0.06)`
              : `0 4px 16px rgba(0,0,0,0.3)`,
            transition: "background 0.3s, border-color 0.3s, box-shadow 0.3s",
          }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <LogoMark size={22} />
            <span
              className="text-xs font-bold tracking-[0.12em] uppercase hidden sm:block"
              style={{ color: T.teal, fontFamily: FONT_UI }}
            >
              HSE HUB
            </span>
          </div>

          {/* Nav links */}
          <div
            className="hidden sm:flex items-center gap-5 text-[11px] font-semibold"
            style={{ color: T.text2, fontFamily: FONT_UI, letterSpacing: "0.04em" }}
          >
            {["Features", "Video", "Stack"].map(l => (
              <motion.a
                key={l}
                href={`#${l.toLowerCase()}`}
                whileHover={{ color: T.text0, transform: "translateY(-1px)" }}
                transition={SP}
                className="uppercase tracking-widest"
              >
                {l}
              </motion.a>
            ))}
          </div>

          {/* Sign in — button-in-button pill (high-end-visual-design §4B) */}
          <motion.a
            href="/auth/login"
            whileHover={{ scale: 1.04, boxShadow: `0 6px 24px rgba(145,194,183,0.28)` }}
            whileTap={{ scale: 0.96 }}
            transition={SP}
            className="btn-primary flex items-center gap-2 pl-4 pr-1 py-1 rounded-full text-[11px] font-bold shrink-0"
            style={{ fontFamily: FONT_UI, letterSpacing: "0.03em" }}
          >
            Sign in
            <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(10,16,18,0.18)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </span>
          </motion.a>
        </motion.nav>
      </div>

      {/* ── HERO ── */}
      <section
        className="relative flex flex-col items-center justify-center px-6 text-center"
        style={{ minHeight: "100dvh", paddingTop: "7rem", paddingBottom: "5rem" }}
      >
        {/* Live badge */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(12px) scale(0.95)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          transition={{ ease: EASE, duration: 0.55, delay: 0.12 }}
          className="inline-flex items-center gap-2.5 px-4 py-[7px] rounded-full text-[10px] font-semibold mb-10 uppercase tracking-[0.15em]"
          style={{
            background: T.tealSubtle,
            border: `1px solid ${T.tealBorder}`,
            color: T.teal,
            fontFamily: FONT_UI,
          }}
        >
          <motion.span
            className="w-[6px] h-[6px] rounded-full"
            style={{ background: T.green }}
            animate={{ opacity: [1, 0.25, 1], scale: [1, 1.4, 1] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          />
          Live · 4 systems · hseportal.hs-experts.com
        </motion.div>

        {/* Headline — Clash Display, size-specific tracking */}
        <div className="max-w-5xl mx-auto mb-6">
          {/* Line 1 — roman weight, warm white */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(36px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.85, delay: 0.22 }}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 300,
              fontStyle: "italic",
              fontSize: "clamp(38px, 7.5vw, 100px)",
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              color: T.text0,
            }}
          >
            If nothing happens,
          </motion.div>
          {/* Line 2 — bold weight, teal accent */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(36px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.85, delay: 0.36 }}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: "clamp(38px, 7.5vw, 100px)",
              letterSpacing: "-0.03em",
              lineHeight: 1.0,
              background: `linear-gradient(135deg, ${T.teal} 0%, ${T.tealLight} 55%, ${T.teal} 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            we&apos;ve done our job.
          </motion.div>
        </div>

        {/* Company mark */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(10px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.5, delay: 0.52 }}
          className="flex items-center justify-center gap-2 mb-7"
        >
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ background: T.tealSubtle, border: `1px solid ${T.border}` }}
          >
            <LogoMark size={14} />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: T.teal, fontFamily: FONT_UI }}
            >
              HSE Health &amp; Safety Experts GmbH
            </span>
          </div>
        </motion.div>

        {/* Sub-headline — Plus Jakarta Sans, comfortable leading */}
        <motion.p
          initial={{ opacity: 0, transform: "translateY(10px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.55, delay: 0.6 }}
          className="text-base sm:text-lg leading-[1.7] max-w-xl mx-auto mb-10"
          style={{
            color: T.text1,
            fontFamily: FONT_UI,
            fontWeight: 400,
            letterSpacing: "0.005em",      // near-zero for body (apple-design §15)
          }}
        >
          The internal operations portal connecting Asana, TrackingTime, Samdock CRM, and
          FactorialHR into one role-gated intelligence layer.
        </motion.p>

        {/* CTAs — button-in-button pattern on primary */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(10px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.5, delay: 0.72 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          {/* Primary — button-in-button */}
          <motion.a
            href="#video"
            whileHover={{ scale: 1.04, y: -2, boxShadow: `0 14px 40px rgba(145,194,183,0.28)` }}
            whileTap={{ scale: 0.97 }}
            transition={SP}
            className="btn-primary flex items-center gap-3 pl-6 pr-2 py-2 rounded-full text-[13px] font-bold"
            style={{ fontFamily: FONT_UI, letterSpacing: "0.01em", boxShadow: `0 6px 24px rgba(145,194,183,0.18)` }}
          >
            Watch demo
            <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(10,16,18,0.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                <path d="M5 3l14 9-14 9V3z"/>
              </svg>
            </span>
          </motion.a>

          {/* Secondary */}
          <motion.a
            href="/auth/login"
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={SP}
            className="btn-secondary flex items-center gap-2 px-6 py-[11px] rounded-full text-[13px] font-semibold"
            style={{ border: `1px solid ${T.borderStrong}`, fontFamily: FONT_UI, letterSpacing: "0.01em" }}
          >
            Open portal
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </motion.a>
        </motion.div>

        {/* Stats strip — double-bezel */}
        <motion.div
          initial={{ opacity: 0, transform: "translateY(28px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ease: EASE, duration: 0.65, delay: 0.88 }}
          className="mt-16 w-full max-w-xl"
        >
          {/* Outer shell */}
          <div
            className="p-[5px] rounded-2xl"
            style={{
              background: "rgba(145,194,183,0.03)",
              border: `1px solid ${T.borderMid}`,
            }}
          >
            {/* Inner core */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4 divide-x rounded-[calc(1rem-0.375rem)] overflow-hidden"
              style={{
                background: T.bg1,
                boxShadow: "inset 0 1px 1px rgba(145,194,183,0.06)",
                // divide color
                ['--tw-divide-opacity' as string]: "1",
              }}
            >
              {[
                { val: 41,  label: "Active people"      },
                { val: 27,  label: "Live projects"       },
                { val: 4,   label: "Systems synced"      },
                { val: 24,  label: "RBAC permissions"    },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className="flex flex-col items-center justify-center py-6 px-4"
                  style={{
                    borderColor: T.border,
                    borderRight: i < 3 ? `1px solid ${T.border}` : undefined,
                    borderBottom: i < 2 ? `1px solid ${T.border}` : undefined,
                  }}
                >
                  <div
                    className="text-2xl font-bold mb-0.5"
                    style={{
                      color: T.teal,
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 700,
                      letterSpacing: "-0.03em",     // tight for large numerals
                    }}
                  >
                    <CountUp to={s.val} />
                  </div>
                  <div
                    className="text-[10px] font-medium tracking-wide uppercase"
                    style={{ color: T.text2, fontFamily: FONT_UI, letterSpacing: "0.08em" }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── VIDEO ── */}
      <section
        id="video"
        className="relative px-4 sm:px-6 max-w-5xl mx-auto"
        style={{ paddingTop: "6rem", paddingBottom: "6rem" }}
      >
        <Section className="mb-12 text-center">
          <motion.div variants={fadeUp} className="flex justify-center mb-5">
            <Eyebrow>60-second Remotion-rendered · H264 1080p</Eyebrow>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: "clamp(28px, 4.5vw, 56px)",
              letterSpacing: "-0.02em",
              color: T.text0,
              lineHeight: 1.08,
            }}
          >
            See it in action
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="text-base max-w-md mx-auto leading-relaxed"
            style={{ color: T.text1, fontFamily: FONT_UI, letterSpacing: "0.005em" }}
          >
            A full walkthrough of every module — built frame-by-frame with Remotion, encoded as H264 MP4.
          </motion.p>
        </Section>

        <motion.div
          initial={{ opacity: 0, transform: "translateY(36px) scale(0.97)" }}
          whileInView={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ease: EASE, duration: 0.75 }}
        >
          <VideoPlayer />
        </motion.div>
      </section>

      {/* ── FEATURES BENTO (asymmetric grid) ── */}
      <section
        id="features"
        className="px-4 sm:px-6 max-w-5xl mx-auto"
        style={{ paddingTop: "6rem", paddingBottom: "6rem" }}
      >
        <Section className="mb-12">
          <motion.div variants={fadeUp}>
            <Eyebrow>What it does</Eyebrow>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: "clamp(28px, 4.5vw, 56px)",
              letterSpacing: "-0.02em",
              color: T.text0,
              lineHeight: 1.1,
            }}
          >
            Every module,<br />
            <span style={{
              fontStyle: "italic",
              background: `linear-gradient(135deg, ${T.teal}, ${T.tealLight})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              explained.
            </span>
          </motion.h2>
        </Section>

        {/* Asymmetric bento: 2+1 / 1+1 / 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <BentoFeature key={f.num} f={f} i={i} />
          ))}
        </div>
      </section>

      {/* ── STACK ── */}
      <section
        id="stack"
        className="px-4 sm:px-6 max-w-5xl mx-auto"
        style={{ paddingTop: "6rem", paddingBottom: "6rem" }}
      >
        <Section className="mb-12 text-center">
          <motion.div variants={fadeUp} className="flex justify-center mb-5">
            <Eyebrow>Production stack</Eyebrow>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: "clamp(28px, 4vw, 52px)",
              letterSpacing: "-0.02em",
              color: T.text0,
              lineHeight: 1.08,
            }}
          >
            Built to last.
          </motion.h2>
        </Section>

        <Section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stackItems.map((s, i) => (
            <motion.div
              key={s.label}
              variants={{
                hidden: { opacity: 0, transform: "translateY(20px) scale(0.97)" },
                show: {
                  opacity: 1,
                  transform: "translateY(0px) scale(1)",
                  transition: { ease: EASE, duration: 0.5, delay: i * 0.06 },
                },
              }}
            >
              <TiltCard>
                {/* Double-bezel stack card */}
                <div
                  className="p-[5px] rounded-[1.25rem]"
                  style={{
                    background: "rgba(145,194,183,0.03)",
                    border: `1px solid ${T.borderMid}`,
                  }}
                >
                  <div
                    className="p-5 rounded-[calc(1.25rem-0.375rem)]"
                    style={{
                      background: T.bg1,
                      boxShadow: "inset 0 1px 1px rgba(145,194,183,0.07), inset 0 -1px 1px rgba(0,0,0,0.25)",
                      minHeight: 120,
                    }}
                  >
                    <div className="text-xl mb-3" style={{ color: s.color }}>{s.icon}</div>
                    <div
                      className="text-sm font-semibold mb-1"
                      style={{ color: T.text0, letterSpacing: "-0.015em", fontFamily: FONT_UI }}
                    >
                      {s.label}
                    </div>
                    <div
                      className="text-xs leading-relaxed"
                      style={{ color: T.text2, fontFamily: FONT_UI, lineHeight: 1.6 }}
                    >
                      {s.sub}
                    </div>
                  </div>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </Section>
      </section>

      {/* ── CTA ── */}
      <section
        className="px-4 sm:px-6 text-center relative overflow-hidden"
        style={{ paddingTop: "8rem", paddingBottom: "8rem" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 55% 45% at 50% 50%, rgba(145,194,183,0.05) 0%, transparent 70%)" }}
        />
        <Section>
          <motion.div variants={fadeUp} className="flex justify-center mb-8">
            <LogoMark size={44} />
          </motion.div>
          <motion.div variants={fadeUp} className="flex justify-center mb-6">
            <Eyebrow>Ready to connect your operations?</Eyebrow>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            className="mb-5 max-w-2xl mx-auto"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 300,
              fontSize: "clamp(32px, 5vw, 72px)",
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              color: T.text0,
            }}
          >
            One portal.{" "}
            <span style={{
              fontWeight: 700,
              fontStyle: "italic",
              background: `linear-gradient(135deg, ${T.teal}, ${T.tealLight})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              All the data.
            </span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="text-base mb-12 max-w-md mx-auto leading-relaxed"
            style={{ color: T.text1, fontFamily: FONT_UI, letterSpacing: "0.005em" }}
          >
            Log in at hseportal.hs-experts.com — or download the 60-second Remotion demo.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            {/* Primary — button-in-button */}
            <motion.a
              href="/auth/login"
              whileHover={{ scale: 1.04, y: -2, boxShadow: `0 18px 52px rgba(145,194,183,0.3)` }}
              whileTap={{ scale: 0.97 }}
              transition={SP}
              className="btn-primary flex items-center gap-3 pl-7 pr-2 py-2 rounded-full font-bold"
              style={{ fontFamily: FONT_UI, fontSize: 13, letterSpacing: "0.01em", boxShadow: `0 8px 28px rgba(145,194,183,0.2)` }}
            >
              Open portal
              <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(10,16,18,0.2)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </span>
            </motion.a>

            {/* Secondary */}
            <motion.a
              href="/hse-hub-ad.mp4"
              download
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={SP}
              className="btn-secondary flex items-center gap-2 px-7 py-[11px] rounded-full font-semibold"
              style={{ border: `1px solid ${T.borderStrong}`, fontFamily: FONT_UI, fontSize: 13, letterSpacing: "0.01em" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download MP4
            </motion.a>
          </motion.div>
        </Section>
      </section>

      {/* ── FOOTER ── */}
      <footer
        className="px-6 py-10 border-t"
        style={{ borderColor: T.border }}
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <LogoMark size={20} />
            <div className="flex flex-col leading-tight">
              <span
                className="text-[11px] font-bold tracking-[0.12em] uppercase"
                style={{ color: T.teal, fontFamily: FONT_UI }}
              >
                HSE HUB
              </span>
              <span
                className="text-[10px]"
                style={{ color: T.text2, fontFamily: FONT_UI }}
              >
                © {new Date().getFullYear()} HSE Health &amp; Safety Experts GmbH
              </span>
            </div>
          </div>

          <div
            className="flex items-center gap-5 text-[11px] font-medium"
            style={{ color: T.text2, fontFamily: FONT_UI, letterSpacing: "0.03em" }}
          >
            {[
              { label: "Portal",          href: "/auth/login" },
              { label: "hs-experts.com",  href: "https://www.hs-experts.com", external: true },
              { label: "GitHub",          href: "https://github.com/hitul-hse/supabase-app", external: true },
            ].map(link => (
              <motion.a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                whileHover={{ color: T.teal }}
                transition={{ duration: 0.15 }}
              >
                {link.label}
              </motion.a>
            ))}
            <span style={{ color: T.teal }}>{`hseportal.hs-experts.com`}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
