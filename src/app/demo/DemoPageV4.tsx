"use client";
/**
 * DemoPageV4 — HSE Hub marketing showcase
 * Skills: high-end-visual-design · apple-design · impeccable/typeset
 *         stitch-design-taste · emilkowalski/animate
 *
 * Layout fixes (v5):
 *  - All sections share one consistent max-w-5xl centred container
 *  - Stack grid moved OUT of Section wrapper (Section is stagger-only, never a grid)
 *  - Features heading left-aligned with grid, hero centred — clear intent per section
 *  - Stats strip border logic corrected for both mobile (2-col) and desktop (4-col)
 *  - CTA section constrained to max-w-2xl for text, max-w-5xl for section padding
 *  - Uniform section vertical rhythm: pt-32 pb-24 on all interior sections
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

/* ─── Brand tokens ───────────────────────────────────────────────────── */
const T = {
  bg0:          "#0a1012",
  bg1:          "#111a1c",
  bg2:          "#162022",

  teal:         "#91C2B7",
  tealDeep:     "#29474B",
  tealLight:    "#B8D8D2",
  tealSubtle:   "rgba(145,194,183,0.08)",
  tealBorder:   "rgba(145,194,183,0.18)",
  tealGlow:     "rgba(145,194,183,0.22)",

  text0:        "#EEF3F2",
  text1:        "#7FA09C",
  text2:        "#3E5E5B",

  border:       "rgba(145,194,183,0.07)",
  borderMid:    "rgba(145,194,183,0.13)",
  borderStrong: "rgba(145,194,183,0.22)",

  green:        "#4ade80",
} as const;

/* ─── Motion ─────────────────────────────────────────────────────────── */
const EASE     = [0.23, 1, 0.32, 1] as const;
const EASE2    = [0.32, 0.72, 0, 1] as const;
const SP       = { type: "spring", bounce: 0, duration: 0.4 } as const;
const SP_SOFT  = { type: "spring", bounce: 0.12, duration: 0.5 } as const;

const fadeUp = {
  hidden: { opacity: 0, transform: "translateY(20px) scale(0.97)" },
  show:   { opacity: 1, transform: "translateY(0px) scale(1)",
            transition: { ease: EASE, duration: 0.6 } },
};

const stagger = (s = 0.07) => ({
  hidden: {},
  show:   { transition: { staggerChildren: s } },
});

/* ─── Fonts ──────────────────────────────────────────────────────────── */
const FONT_DISPLAY = "var(--font-cormorant), 'Playfair Display', Georgia, serif";
const FONT_UI      = "var(--font-jakarta), system-ui, sans-serif";
const FONT_MONO    = "var(--font-jetbrains), 'Fira Code', monospace";

/* ─── Layout constants ───────────────────────────────────────────────── */
// All content shares the same horizontal container for visual alignment
const CONTAINER = "w-full max-w-5xl mx-auto px-6 sm:px-10";
const SECTION_Y = "py-28 sm:py-36"; // uniform vertical rhythm

/* ─── Particle ───────────────────────────────────────────────────────── */
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

/* ─── TiltCard ───────────────────────────────────────────────────────── */
function TiltCard({
  children, className = "", style,
}: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref   = useRef<HTMLDivElement>(null);
  const rotX  = useSpring(0, { stiffness: 180, damping: 24, bounce: 0 });
  const rotY  = useSpring(0, { stiffness: 180, damping: 24, bounce: 0 });
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top)  / r.height;
    rotX.set((cy - 0.5) * -6);
    rotY.set((cx - 0.5) *  6);
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

/* ─── CountUp ────────────────────────────────────────────────────────── */
function CountUp({ to }: { to: number }) {
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

  return <span ref={ref}>{val}</span>;
}

/* ─── Reveal wrapper — stagger only, never a grid ───────────────────── */
function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
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

/* ─── Eyebrow ────────────────────────────────────────────────────────── */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] font-semibold"
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

/* ─── Section heading block ──────────────────────────────────────────── */
function SectionHead({
  eyebrow, title, subtitle, center = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={`mb-14 ${center ? "text-center flex flex-col items-center" : ""}`}>
      <motion.div variants={fadeUp} className={`mb-4 ${center ? "flex justify-center" : ""}`}>
        <Eyebrow>{eyebrow}</Eyebrow>
      </motion.div>
      <motion.h2
        variants={fadeUp}
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: "clamp(30px, 4.5vw, 58px)",
          letterSpacing: "-0.02em",
          lineHeight: 1.08,
          color: T.text0,
          maxWidth: center ? "640px" : undefined,
        }}
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          variants={fadeUp}
          className="mt-4 text-base leading-relaxed"
          style={{
            color: T.text1,
            fontFamily: FONT_UI,
            letterSpacing: "0.005em",
            maxWidth: center ? "440px" : "520px",
          }}
        >
          {subtitle}
        </motion.p>
      )}
    </Reveal>
  );
}

/* ─── Video player ───────────────────────────────────────────────────── */
function VideoPlayer() {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [showCtrl, setShowCtrl] = useState(true);
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended",      onEnd);
    };
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  };

  return (
    /* Outer shell */
    <div
      className="p-[7px] rounded-[1.5rem]"
      style={{
        background: "rgba(145,194,183,0.04)",
        border: `1px solid ${T.borderMid}`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px ${T.border}`,
      }}
    >
      {/* Inner core */}
      <div
        className="relative rounded-[calc(1.5rem-0.5rem)] overflow-hidden cursor-pointer"
        style={{ background: T.bg0 }}
        onMouseMove={revealCtrl}
        onClick={toggle}
      >
        {/* Inset ring */}
        <div
          className="absolute inset-0 pointer-events-none z-10 rounded-[inherit]"
          style={{ boxShadow: `inset 0 0 0 1px ${T.tealBorder}` }}
        />
        <video
          ref={videoRef}
          src="/hse-hub-ad.mp4"
          className="w-full aspect-video object-cover block"
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
              className="absolute inset-0 z-20 flex flex-col justify-between p-6"
              style={{
                background:
                  "linear-gradient(to top, rgba(10,16,18,0.9) 0%, transparent 40%, transparent 65%, rgba(10,16,18,0.45) 100%)",
              }}
            >
              {/* Top label */}
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: T.green }}
                  animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span
                  className="text-[10px] font-semibold tracking-[0.16em] uppercase"
                  style={{ color: "rgba(238,243,242,0.5)", fontFamily: FONT_UI }}
                >
                  HSE Health &amp; Safety Experts · Product Demo
                </span>
              </div>

              {/* Centre play button */}
              <div className="flex items-center justify-center flex-1">
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.93 }}
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
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(145,194,183,0.12)" }}
                  >
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

              {/* Scrubber + meta */}
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
                  <span
                    className="text-[10px]"
                    style={{ color: "rgba(238,243,242,0.35)", fontFamily: FONT_MONO }}
                  >
                    60s · Remotion H264 1080p
                  </span>
                  <a
                    href="/hse-hub-ad.mp4"
                    download
                    className="text-[10px] font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-60"
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
    </div>
  );
}

/* ─── Features ───────────────────────────────────────────────────────── */
const features = [
  {
    num: "01", title: "Live Dashboard",
    desc: "Billable utilisation, headcount, and active project counts — no manual collation. Refreshes every sync cycle.",
    tags: ["Real-time", "Exec + Dept Head"],
    color: T.teal, span: "lg:col-span-2",
  },
  {
    num: "02", title: "Fine-grained RBAC",
    desc: "24 permissions across 7 resource groups. Toggle per role — enforced at database level via Row-Level Security.",
    tags: ["24 permissions", "Zero code changes"],
    color: "#60a5fa", span: "lg:col-span-1",
  },
  {
    num: "03", title: "Identity Resolution",
    desc: "One person in Asana, TrackingTime, and FactorialHR — three IDs, one canonical map. Zero duplicates.",
    tags: ["Zero duplicates", "Effective-dated"],
    color: "#4ade80", span: "lg:col-span-1",
  },
  {
    num: "04", title: "Workload Booking",
    desc: "Team leads book 4-week rolling workloads. Executives and dept heads approve or reject — all logged.",
    tags: ["4-week rolling", "Approval workflow"],
    color: "#a78bfa", span: "lg:col-span-1",
  },
  {
    num: "05", title: "Timesheet Grid",
    desc: "Weekly entry grid synced from TrackingTime. Billable vs non-billable, project attribution, weekly totals.",
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

function FeatureCard({ f, i }: { f: typeof features[number]; i: number }) {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      className={`${f.span}`}
      initial={{ opacity: 0, transform: "translateY(24px) scale(0.97)" }}
      animate={inView ? { opacity: 1, transform: "translateY(0) scale(1)" } : {}}
      transition={{ ease: EASE, duration: 0.6, delay: i * 0.06 }}
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
            className="h-full p-7 rounded-[calc(1.5rem-0.375rem)] flex flex-col"
            style={{
              background: T.bg1,
              boxShadow: "inset 0 1px 1px rgba(145,194,183,0.07), inset 0 -1px 1px rgba(0,0,0,0.25)",
              minHeight: 200,
            }}
          >
            {/* Number row */}
            <div className="flex items-center justify-between mb-6">
              <span
                className="text-xs font-medium"
                style={{ color: f.color, opacity: 0.7, fontFamily: FONT_MONO, letterSpacing: "0.05em" }}
              >
                {f.num}
              </span>
              {/* Animated line that grows on hover */}
              <motion.div
                className="h-[1px] origin-right"
                style={{ background: f.color, opacity: 0.5 }}
                initial={{ width: 0 }}
                whileHover={{ width: 32 }}
                transition={{ ease: EASE2, duration: 0.3 }}
              />
            </div>

            <h3
              className="text-[15px] font-semibold mb-3 leading-snug"
              style={{ color: T.text0, letterSpacing: "-0.02em", fontFamily: FONT_UI }}
            >
              {f.title}
            </h3>
            <p
              className="text-sm leading-relaxed mb-5 flex-1"
              style={{ color: T.text1, fontFamily: FONT_UI, lineHeight: 1.65 }}
            >
              {f.desc}
            </p>

            <div className="flex flex-wrap gap-1.5 mt-auto">
              {f.tags.map(t => (
                <span
                  key={t}
                  className="text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase"
                  style={{
                    background: `${f.color}12`,
                    color: f.color,
                    border: `1px solid ${f.color}22`,
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

/* ─── Stack ──────────────────────────────────────────────────────────── */
const stackItems = [
  { label: "Next.js 16",     sub: "App Router · Server Components · Streaming SSR", icon: "▲", color: T.text0 },
  { label: "Supabase",       sub: "PostgreSQL · Row-Level Security · Auth",          icon: "⚡", color: T.teal },
  { label: "Vercel Edge",    sub: "Global CDN · Preview deployments · OIDC",         icon: "◈", color: "#60a5fa" },
  { label: "Framer Motion",  sub: "Springs · Layout animations · Gesture physics",   icon: "◎", color: "#a78bfa" },
  { label: "GitHub Actions", sub: "lint → tsc → build → db-tests on every PR",       icon: "◆", color: "#4ade80" },
  { label: "Remotion",       sub: "React-rendered 60s H264 1080p product video",     icon: "▶", color: "#fb923c" },
] as const;

/* ─── Logo mark ──────────────────────────────────────────────────────── */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }}>
      <Image src="/hse-logo.png" alt="HSE Logo" fill style={{ objectFit: "contain" }} />
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────── */
export default function DemoPageV4() {
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="demo-page isolate min-h-[100dvh] relative"
      style={{ background: T.bg0, color: T.text0, fontFamily: FONT_UI }}
    >

      {/* ── Ambient ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }} aria-hidden>
        <div className="absolute" style={{ top: "-10%", left: "10%", width: 760, height: 760,
          background: "radial-gradient(circle, rgba(145,194,183,0.045) 0%, transparent 70%)",
          filter: "blur(90px)" }} />
        <div className="absolute" style={{ bottom: "8%", right: "4%", width: 520, height: 520,
          background: "radial-gradient(circle, rgba(41,71,75,0.18) 0%, transparent 70%)",
          filter: "blur(110px)" }} />
        <div className="absolute" style={{ top: "42%", left: "58%", width: 320, height: 320,
          background: "radial-gradient(circle, rgba(145,194,183,0.035) 0%, transparent 70%)",
          filter: "blur(70px)" }} />
        <div className="absolute inset-0">
          {Array.from({ length: 24 }, (_, i) => <Particle key={i} index={i} />)}
        </div>
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(${T.border} 1px, transparent 1px), linear-gradient(90deg, ${T.border} 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
        }} />
      </div>

      {/* ── NAV — floating pill ── */}
      <div className="fixed top-0 inset-x-0 z-50 flex justify-center pt-5 px-4">
        <motion.nav
          initial={{ opacity: 0, transform: "translateY(-16px) scale(0.97)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          transition={SP_SOFT}
          className="flex items-center justify-between gap-6 px-5 h-12 w-full max-w-3xl rounded-full"
          style={{
            background: navScrolled ? "rgba(10,16,18,0.92)" : "rgba(10,16,18,0.75)",
            backdropFilter: "blur(24px) saturate(180%)",
            border: `1px solid ${navScrolled ? T.borderMid : T.border}`,
            boxShadow: navScrolled
              ? `0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(145,194,183,0.06)`
              : `0 4px 16px rgba(0,0,0,0.3)`,
            transition: "background 0.3s, border-color 0.3s, box-shadow 0.3s",
          }}
        >
          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <LogoMark size={22} />
            <span
              className="text-xs font-bold tracking-[0.12em] uppercase hidden sm:block"
              style={{ color: T.teal, fontFamily: FONT_UI }}
            >
              HSE HUB
            </span>
          </div>

          {/* Links */}
          <div
            className="hidden sm:flex items-center gap-5 text-[11px] font-semibold"
            style={{ color: T.text2, fontFamily: FONT_UI, letterSpacing: "0.04em" }}
          >
            {["Features", "Video", "Stack"].map(l => (
              <motion.a
                key={l}
                href={`#${l.toLowerCase()}`}
                whileHover={{ color: T.text0, y: -1 }}
                transition={SP}
                className="uppercase tracking-widest"
              >
                {l}
              </motion.a>
            ))}
          </div>

          {/* CTA — button-in-button */}
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

      {/* ══════════════════════════════════════════════════════════════════
          HERO — full viewport, all content centred in max-w-5xl
      ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative z-10 flex flex-col items-center justify-center text-center"
        style={{ minHeight: "100dvh", paddingTop: "7rem", paddingBottom: "5rem" }}
      >
        {/* Use the shared container for consistent edge alignment */}
        <div className={CONTAINER + " flex flex-col items-center"}>

          {/* Live badge */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(12px) scale(0.95)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            transition={{ ease: EASE, duration: 0.55, delay: 0.1 }}
            className="inline-flex items-center gap-2.5 px-4 py-[7px] rounded-full text-[10px] font-semibold mb-10 uppercase tracking-[0.15em]"
            style={{ background: T.tealSubtle, border: `1px solid ${T.tealBorder}`, color: T.teal, fontFamily: FONT_UI }}
          >
            <motion.span
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ background: T.green }}
              animate={{ opacity: [1, 0.25, 1], scale: [1, 1.4, 1] }}
              transition={{ duration: 2.2, repeat: Infinity }}
            />
            Live · 4 systems · hseportal.hs-experts.com
          </motion.div>

          {/* Headline */}
          <div className="mb-8 w-full max-w-4xl">
            <motion.div
              initial={{ opacity: 0, transform: "translateY(36px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ ease: EASE, duration: 0.85, delay: 0.2 }}
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 300, fontStyle: "italic",
                fontSize: "clamp(36px, 7vw, 96px)",
                letterSpacing: "-0.02em", lineHeight: 1.06, color: T.text0,
              }}
            >
              If nothing happens,
            </motion.div>
            <motion.div
              initial={{ opacity: 0, transform: "translateY(36px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={{ ease: EASE, duration: 0.85, delay: 0.33 }}
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 700,
                fontSize: "clamp(36px, 7vw, 96px)",
                letterSpacing: "-0.03em", lineHeight: 1.0,
                background: `linear-gradient(135deg, ${T.teal} 0%, ${T.tealLight} 55%, ${T.teal} 100%)`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}
            >
              we&apos;ve done our job.
            </motion.div>
          </div>

          {/* Company mark */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(10px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.5, delay: 0.48 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg mb-8"
            style={{ background: T.tealSubtle, border: `1px solid ${T.border}` }}
          >
            <LogoMark size={14} />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: T.teal, fontFamily: FONT_UI }}
            >
              HSE Health &amp; Safety Experts GmbH
            </span>
          </motion.div>

          {/* Body copy */}
          <motion.p
            initial={{ opacity: 0, transform: "translateY(10px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.55, delay: 0.56 }}
            className="text-base sm:text-lg leading-[1.72] mb-10 max-w-lg"
            style={{ color: T.text1, fontFamily: FONT_UI, fontWeight: 400, letterSpacing: "0.005em" }}
          >
            The internal operations portal connecting Asana, TrackingTime,
            Samdock CRM, and FactorialHR into one role-gated intelligence layer.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, transform: "translateY(10px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ease: EASE, duration: 0.5, delay: 0.68 }}
            className="flex flex-wrap items-center justify-center gap-3 mb-16"
          >
            <motion.a
              href="#video"
              whileHover={{ scale: 1.04, y: -2, boxShadow: `0 14px 40px rgba(145,194,183,0.28)` }}
              whileTap={{ scale: 0.97 }}
              transition={SP}
              className="btn-primary flex items-center gap-3 pl-6 pr-2 py-2 rounded-full text-[13px] font-bold"
              style={{ fontFamily: FONT_UI, letterSpacing: "0.01em", boxShadow: `0 6px 24px rgba(145,194,183,0.16)` }}
            >
              Watch demo
              <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(10,16,18,0.2)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                  <path d="M5 3l14 9-14 9V3z"/>
                </svg>
              </span>
            </motion.a>
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
            transition={{ ease: EASE, duration: 0.65, delay: 0.84 }}
            className="w-full max-w-2xl"
          >
            <div
              className="p-[5px] rounded-2xl"
              style={{ background: "rgba(145,194,183,0.03)", border: `1px solid ${T.borderMid}` }}
            >
              <div
                className="rounded-[calc(1rem-0.375rem)] overflow-hidden"
                style={{ background: T.bg1, boxShadow: "inset 0 1px 1px rgba(145,194,183,0.06)" }}
              >
                {/* 4-column grid — borders only between items, not on last */}
                <div className="grid grid-cols-2 sm:grid-cols-4">
                  {[
                    { val: 41, label: "Active people" },
                    { val: 27, label: "Live projects" },
                    { val: 4,  label: "Systems synced" },
                    { val: 24, label: "RBAC permissions" },
                  ].map((s, i) => (
                    <div
                      key={s.label}
                      className="flex flex-col items-center justify-center py-7 px-4"
                      style={{
                        borderRight: (i === 1 || i < 3) ? `1px solid ${T.border}` : undefined,
                        borderBottom: i < 2 ? `1px solid ${T.border}` : undefined,
                      }}
                    >
                      <div
                        className="text-2xl font-bold mb-1"
                        style={{ color: T.teal, fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: "-0.03em" }}
                      >
                        <CountUp to={s.val} />
                      </div>
                      <div
                        className="text-[10px] font-medium uppercase tracking-[0.08em]"
                        style={{ color: T.text2, fontFamily: FONT_UI }}
                      >
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          VIDEO SECTION
      ══════════════════════════════════════════════════════════════════ */}
      <section id="video" className={`relative z-10 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionHead
            eyebrow="60-second Remotion-rendered · H264 1080p"
            title={<>See it <span style={{ fontStyle: "italic" }}>in action</span></>}
            subtitle="A full walkthrough of every module — built frame-by-frame with Remotion, encoded as H264 MP4."
            center
          />
          <motion.div
            initial={{ opacity: 0, transform: "translateY(36px) scale(0.97)" }}
            whileInView={{ opacity: 1, transform: "translateY(0) scale(1)" }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ ease: EASE, duration: 0.75 }}
          >
            <VideoPlayer />
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          FEATURES BENTO
      ══════════════════════════════════════════════════════════════════ */}
      <section id="features" className={`relative z-10 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          {/* Left-aligned heading for bento grids — matches card left edges */}
          <Reveal className="mb-14">
            <motion.div variants={fadeUp} className="mb-4">
              <Eyebrow>What it does</Eyebrow>
            </motion.div>
            <motion.h2
              variants={fadeUp}
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 600,
                fontSize: "clamp(30px, 4.5vw, 58px)",
                letterSpacing: "-0.02em", lineHeight: 1.08, color: T.text0,
              }}
            >
              Every module,<br />
              <span style={{
                fontStyle: "italic",
                background: `linear-gradient(135deg, ${T.teal}, ${T.tealLight})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                explained.
              </span>
            </motion.h2>
          </Reveal>

          {/* Asymmetric bento: 2+1 / 1+1 / 2 pattern */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {features.map((f, i) => <FeatureCard key={f.num} f={f} i={i} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          STACK — 3-col grid OUTSIDE the Reveal wrapper
      ══════════════════════════════════════════════════════════════════ */}
      <section id="stack" className={`relative z-10 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionHead
            eyebrow="Production stack"
            title={<span style={{ fontStyle: "italic" }}>Built to last.</span>}
            center
          />
          {/* Grid is a plain div — NOT inside the Reveal stagger wrapper */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {stackItems.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, transform: "translateY(20px) scale(0.97)" }}
                whileInView={{ opacity: 1, transform: "translateY(0) scale(1)" }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ ease: EASE, duration: 0.5, delay: i * 0.07 }}
              >
                <TiltCard className="h-full">
                  <div
                    className="h-full p-[5px] rounded-[1.25rem]"
                    style={{ background: "rgba(145,194,183,0.03)", border: `1px solid ${T.borderMid}` }}
                  >
                    <div
                      className="h-full p-6 rounded-[calc(1.25rem-0.375rem)] flex flex-col gap-3"
                      style={{
                        background: T.bg1,
                        boxShadow: "inset 0 1px 1px rgba(145,194,183,0.07), inset 0 -1px 1px rgba(0,0,0,0.25)",
                        minHeight: 128,
                      }}
                    >
                      <div className="text-xl" style={{ color: s.color }}>{s.icon}</div>
                      <div
                        className="text-sm font-semibold"
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
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          CTA
      ══════════════════════════════════════════════════════════════════ */}
      <section className={`relative z-10 ${SECTION_Y} overflow-hidden`}>
        {/* Radial glow behind the CTA */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(145,194,183,0.055) 0%, transparent 70%)" }}
        />
        <div className={CONTAINER}>
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, transform: "translateY(16px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0)" }}
              viewport={{ once: true }}
              transition={{ ease: EASE, duration: 0.5 }}
              className="mb-8"
            >
              <LogoMark size={48} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, transform: "translateY(12px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0)" }}
              viewport={{ once: true }}
              transition={{ ease: EASE, duration: 0.5, delay: 0.08 }}
              className="mb-5"
            >
              <Eyebrow>Ready to connect your operations?</Eyebrow>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, transform: "translateY(16px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0)" }}
              viewport={{ once: true }}
              transition={{ ease: EASE, duration: 0.65, delay: 0.14 }}
              className="mb-5 max-w-2xl"
              style={{
                fontFamily: FONT_DISPLAY, fontWeight: 300,
                fontSize: "clamp(32px, 5vw, 72px)",
                letterSpacing: "-0.02em", lineHeight: 1.05, color: T.text0,
              }}
            >
              One portal.{" "}
              <span style={{
                fontWeight: 700, fontStyle: "italic",
                background: `linear-gradient(135deg, ${T.teal}, ${T.tealLight})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                All the data.
              </span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, transform: "translateY(10px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0)" }}
              viewport={{ once: true }}
              transition={{ ease: EASE, duration: 0.5, delay: 0.2 }}
              className="text-base mb-12 max-w-md leading-relaxed"
              style={{ color: T.text1, fontFamily: FONT_UI, letterSpacing: "0.005em" }}
            >
              Log in at hseportal.hs-experts.com — or download the 60-second Remotion demo.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, transform: "translateY(10px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0)" }}
              viewport={{ once: true }}
              transition={{ ease: EASE, duration: 0.5, delay: 0.26 }}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              <motion.a
                href="/auth/login"
                whileHover={{ scale: 1.04, y: -2, boxShadow: `0 18px 52px rgba(145,194,183,0.3)` }}
                whileTap={{ scale: 0.97 }}
                transition={SP}
                className="btn-primary flex items-center gap-3 pl-7 pr-2 py-2 rounded-full font-bold text-[13px]"
                style={{ fontFamily: FONT_UI, letterSpacing: "0.01em", boxShadow: `0 8px 28px rgba(145,194,183,0.2)` }}
              >
                Open portal
                <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(10,16,18,0.2)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </span>
              </motion.a>
              <motion.a
                href="/hse-hub-ad.mp4"
                download
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={SP}
                className="btn-secondary flex items-center gap-2 px-7 py-[11px] rounded-full font-semibold text-[13px]"
                style={{ border: `1px solid ${T.borderStrong}`, fontFamily: FONT_UI, letterSpacing: "0.01em" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download MP4
              </motion.a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        className="relative z-10 py-10"
        style={{ borderTop: `1px solid ${T.border}` }}
      >
        <div className={CONTAINER + " flex flex-col sm:flex-row items-center justify-between gap-5"}>
          <div className="flex items-center gap-3">
            <LogoMark size={20} />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: T.teal, fontFamily: FONT_UI }}>
                HSE HUB
              </span>
              <span className="text-[10px]" style={{ color: T.text2, fontFamily: FONT_UI }}>
                © {new Date().getFullYear()} HSE Health &amp; Safety Experts GmbH
              </span>
            </div>
          </div>
          <div
            className="flex items-center gap-5 text-[11px] font-medium"
            style={{ color: T.text2, fontFamily: FONT_UI, letterSpacing: "0.03em" }}
          >
            {[
              { label: "Portal",         href: "/auth/login" },
              { label: "hs-experts.com", href: "https://www.hs-experts.com", external: true },
              { label: "GitHub",         href: "https://github.com/hitul-hse/supabase-app", external: true },
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
            <span style={{ color: T.teal }}>hseportal.hs-experts.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
