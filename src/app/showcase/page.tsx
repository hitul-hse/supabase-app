"use client";
/**
 * /showcase — Cinematic product video page for HSE Hub.
 * Full-screen immersive video player with animated sections.
 * No auth required — share with anyone.
 */
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import Link from "next/link";

/* ── tiny icon helpers ── */
const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const PlayIcon   = () => <Icon d="M5 3l14 9-14 9V3z" />;
const PauseIcon  = () => <Icon d="M6 4h4v16H6zM14 4h4v16h-4z" />;
const FullIcon   = () => <Icon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />;
const DlIcon     = () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />;
const MuteIcon   = () => <Icon d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />;
const UnmuteIcon = () => <Icon d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />;

/* ── stats ── */
const STATS = [
  { value: "41",    label: "Active people",       accent: "#d4a843" },
  { value: "27",    label: "Live projects",        accent: "#3b82f6" },
  { value: "73.4%", label: "Billable utilisation", accent: "#22c55e" },
  { value: "4",     label: "Systems unified",      accent: "#a855f7" },
];

/* ── feature cards ── */
const FEATURES = [
  {
    icon: "M3 3h18v18H3zM3 9h18M9 21V9",
    title: "Executive Dashboard",
    body: "Real-time billable utilisation, hours at risk, open tasks and trend charts — all synced every few minutes.",
    accent: "#d4a843",
    tag: "LIVE ANALYTICS",
  },
  {
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    title: "Team Lead Board",
    body: "Four-week rolling workload view. Spot over-allocated people instantly, approve time entries, get capacity alerts.",
    accent: "#ef4444",
    tag: "WORKLOAD MGMT",
  },
  {
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    title: "Granular RBAC",
    body: "24 configurable permissions across 7 resource groups. Toggle them per role from the admin panel — no code changes.",
    accent: "#a855f7",
    tag: "ENTERPRISE SECURITY",
  },
  {
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    title: "Real-time Sync",
    body: "Asana, TrackingTime, Factorial, and Samdock unified into one canonical identity — zero manual matching required.",
    accent: "#22c55e",
    tag: "4-SYSTEM PIPELINE",
  },
];

/* ── counter hook ── */
function useCounter(target: number, duration = 1800, start = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return val;
}

/* ── animated stat tile ── */
function StatTile({ value, label, accent, animate }: typeof STATS[0] & { animate: boolean }) {
  const isNum   = !isNaN(parseFloat(value));
  const numPart = parseFloat(value);
  const suffix  = value.replace(String(numPart), "");
  const counted = useCounter(isNum ? numPart : 0, 1600, animate);
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={animate ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col gap-1 p-5 rounded-2xl border"
      style={{ borderColor: accent + "30", background: accent + "0d" }}
    >
      <span className="text-3xl font-bold tabular-nums" style={{ color: accent }}>
        {isNum ? `${counted}${suffix}` : value}
      </span>
      <span className="text-[11px] font-mono tracking-widest text-white/40 uppercase">{label}</span>
    </motion.div>
  );
}

/* ── main page ── */
export default function ShowcasePage() {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const heroRef    = useRef<HTMLDivElement>(null);
  const statsRef   = useRef<HTMLDivElement>(null);

  const [playing,  setPlaying]  = useState(false);
  const [muted,    setMuted]    = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [statsVis, setStatsVis] = useState(false);
  const [hoverCtrl, setHoverCtrl] = useState(false);

  /* parallax hero */
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY     = useTransform(scrollYProgress, [0, 1], ["0%",  "30%"]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  /* stats intersection */
  useEffect(() => {
    if (!statsRef.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsVis(true); }, { threshold: 0.3 });
    obs.observe(statsRef.current);
    return () => obs.disconnect();
  }, []);

  /* video events */
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress(v.currentTime / v.duration);
  };
  const onLoaded = () => setDuration(videoRef.current?.duration ?? 0);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * v.duration;
  };
  const goFullscreen = () => videoRef.current?.requestFullscreen?.();

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-[#06080a] text-white overflow-x-hidden">

      {/* ── NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#d4a843] flex items-center justify-center">
            <span className="text-zinc-900 font-black text-xs">H</span>
          </div>
          <span className="font-bold text-sm tracking-wide">HSE HUB</span>
          <span className="hidden sm:block font-mono text-[9px] text-white/25 tracking-[0.16em]">OPERATIONS PLATFORM</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/hse-hub-ad.mp4"
            download="hse-hub-ad.mp4"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-white/50 text-xs font-medium hover:border-white/30 hover:text-white transition-colors"
          >
            <DlIcon /> Download MP4
          </a>
          <Link
            href="/auth/login"
            className="px-4 py-2 rounded-lg bg-[#d4a843] text-zinc-900 text-sm font-semibold hover:bg-[#e0b84a] transition-colors"
          >
            Open portal →
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section ref={heroRef} className="relative h-screen flex items-center justify-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#d4a843]/6 blur-[120px]" />
          <div className="absolute top-2/3 left-1/4 w-[300px] h-[300px] rounded-full bg-[#3b82f6]/5 blur-[80px]" />
        </div>

        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative z-10 flex flex-col items-center text-center px-6 gap-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
            className="px-4 py-1.5 rounded-full border border-[#d4a843]/40 text-[#d4a843] text-[11px] font-mono tracking-[0.2em]"
          >
            HSE HEALTH &amp; SAFETY EXPERTS GMBH
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
            className="text-5xl sm:text-7xl font-black leading-[1.05] tracking-tight max-w-3xl"
          >
            Your operations,<br />
            <span className="text-[#d4a843] relative">
              unified.
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.9, duration: 0.6, ease: "easeOut" }}
                style={{ originX: 0 }}
                className="absolute -bottom-1 left-0 right-0 h-[3px] bg-[#d4a843]/50 rounded-full"
              />
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
            className="text-white/45 text-lg max-w-xl leading-relaxed"
          >
            One real-time analytics console for Asana, TrackingTime, Factorial and Samdock — with enterprise RBAC built in.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6 }}
            className="flex flex-wrap gap-3 justify-center"
          >
            <button
              onClick={() => document.getElementById("video-section")?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#d4a843] text-zinc-900 font-bold text-sm hover:bg-[#e0b84a] transition-all hover:scale-105 shadow-lg shadow-[#d4a843]/20"
            >
              <PlayIcon /> Watch the video
            </button>
            <Link
              href="/auth/login"
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 text-white/70 font-medium text-sm hover:border-white/30 hover:text-white transition-colors"
            >
              Open portal
            </Link>
          </motion.div>

          {/* Connector logos */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            className="flex items-center gap-6 mt-4"
          >
            {["ASANA", "TRACKINGTIME", "FACTORIAL", "SAMDOCK"].map((name, i) => (
              <motion.span
                key={name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 0.3, y: 0 }}
                transition={{ delay: 0.8 + i * 0.08 }}
                className="font-mono text-[9px] tracking-[0.2em]"
              >
                {name}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll cue */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/20"
        >
          <span className="font-mono text-[9px] tracking-widest">SCROLL</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/20 to-transparent" />
        </motion.div>
      </section>

      {/* ── VIDEO SECTION ── */}
      <section id="video-section" className="relative py-24 px-4 sm:px-8">
        {/* Ambient glow behind player */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-[#d4a843]/5 blur-[100px]" />
        </div>

        <div className="max-w-5xl mx-auto relative z-10">
          {/* Section label */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-center text-center mb-10 gap-3"
          >
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#d4a843]">PRODUCT VIDEO</span>
            <h2 className="text-3xl sm:text-4xl font-bold">See it in action</h2>
            <p className="text-white/40 text-sm max-w-md">
              A 60-second walkthrough of every module — rendered programmatically with Remotion.
            </p>
          </motion.div>

          {/* ── Player ── */}
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60 group"
            onMouseEnter={() => setHoverCtrl(true)}
            onMouseLeave={() => setHoverCtrl(false)}
          >
            {/* Gold glow ring */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-[#d4a843]/20 via-transparent to-[#d4a843]/10 pointer-events-none z-10" />

            {/* Video */}
            <video
              ref={videoRef}
              className="w-full aspect-video bg-black"
              src="/hse-hub-ad.mp4"
              muted
              playsInline
              preload="metadata"
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoaded}
              onEnded={() => setPlaying(false)}
              onClick={togglePlay}
            />

            {/* Big centre play button — shown when paused */}
            <AnimatePresence>
              {!playing && (
                <motion.button
                  key="centre-play"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center z-20"
                >
                  <div className="w-20 h-20 rounded-full bg-[#d4a843] flex items-center justify-center shadow-2xl shadow-[#d4a843]/40 hover:scale-110 transition-transform">
                    <PlayIcon />
                  </div>
                </motion.button>
              )}
            </AnimatePresence>

            {/* Controls overlay */}
            <AnimatePresence>
              {(hoverCtrl || !playing) && (
                <motion.div
                  key="controls"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                  className="absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-5 pb-5 pt-16"
                >
                  {/* Progress bar */}
                  <div
                    className="h-1 rounded-full bg-white/20 mb-4 cursor-pointer overflow-hidden"
                    onClick={seekTo}
                  >
                    <motion.div
                      className="h-full rounded-full bg-[#d4a843]"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>

                  {/* Button row */}
                  <div className="flex items-center gap-3">
                    <button onClick={togglePlay} className="text-white/80 hover:text-white transition-colors">
                      {playing ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button onClick={toggleMute} className="text-white/80 hover:text-white transition-colors">
                      {muted ? <MuteIcon /> : <UnmuteIcon />}
                    </button>
                    <span className="font-mono text-[11px] text-white/40 ml-1">
                      {fmt(progress * duration)} / {fmt(duration)}
                    </span>
                    <div className="flex-1" />
                    <a
                      href="/hse-hub-ad.mp4"
                      download="hse-hub-ad.mp4"
                      className="flex items-center gap-1 text-white/50 hover:text-white transition-colors text-[12px]"
                    >
                      <DlIcon /> <span className="hidden sm:inline">Download</span>
                    </a>
                    <button onClick={goFullscreen} className="text-white/50 hover:text-white transition-colors">
                      <FullIcon />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Chapters */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[
              { t: "0:00", label: "Intro"      },
              { t: "0:05", label: "Problem"    },
              { t: "0:12", label: "Dashboard"  },
              { t: "0:22", label: "RBAC"       },
              { t: "0:30", label: "Sync"       },
              { t: "0:38", label: "Mobile"     },
              { t: "0:46", label: "CTA"        },
            ].map(({ t, label }, i) => {
              const secs = parseInt(t.split(":")[0]) * 60 + parseInt(t.split(":")[1]);
              return (
                <button
                  key={i}
                  onClick={() => { if (videoRef.current) { videoRef.current.currentTime = secs; videoRef.current.play(); setPlaying(true); }}}
                  className="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border border-white/8 hover:border-[#d4a843]/40 hover:bg-[#d4a843]/5 transition-all text-left group"
                >
                  <span className="font-mono text-[10px] text-[#d4a843]/60 group-hover:text-[#d4a843] transition-colors">{t}</span>
                  <span className="text-[11px] text-white/50 group-hover:text-white/80 transition-colors">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section ref={statsRef} className="py-20 px-4 sm:px-8 border-t border-white/6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={statsVis ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.5 }}
            >
              <StatTile {...s} animate={statsVis} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-20 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-14"
          >
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#d4a843]">WHAT&apos;S INSIDE</span>
            <h2 className="text-3xl sm:text-4xl font-bold mt-3">Every tool your team needs</h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.08, duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="p-6 rounded-2xl border border-white/8 bg-white/[0.025] hover:border-white/15 transition-colors cursor-default"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: feat.accent + "18", color: feat.accent }}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d={feat.icon} />
                  </svg>
                </div>
                <div className="font-mono text-[9px] tracking-[0.18em] mb-2" style={{ color: feat.accent }}>
                  {feat.tag}
                </div>
                <h3 className="text-base font-semibold mb-2">{feat.title}</h3>
                <p className="text-white/45 text-sm leading-relaxed">{feat.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TECH STACK ── */}
      <section className="py-16 px-4 sm:px-8 border-t border-white/6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="font-mono text-[10px] tracking-[0.2em] text-white/25 mb-8"
          >
            BUILT WITH
          </motion.p>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { name: "Next.js 15",   color: "#ffffff" },
              { name: "Supabase",     color: "#3ecf8e" },
              { name: "Vercel",       color: "#ffffff" },
              { name: "Framer Motion",color: "#ff4d6b" },
              { name: "Remotion",     color: "#ff5b79" },
              { name: "TypeScript",   color: "#3b82f6" },
              { name: "Tailwind CSS", color: "#38bdf8" },
              { name: "GitHub CI",    color: "#d4a843" },
            ].map((tech, i) => (
              <motion.span
                key={tech.name}
                initial={{ opacity: 0, scale: 0.85 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.4, type: "spring", stiffness: 200 }}
                className="px-4 py-2 rounded-full border border-white/10 text-xs font-medium"
                style={{ color: tech.color + "cc", borderColor: tech.color + "22" }}
              >
                {tech.name}
              </motion.span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-28 px-4 sm:px-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-[#d4a843]/7 blur-[100px]" />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="max-w-2xl mx-auto text-center relative z-10 flex flex-col items-center gap-6"
        >
          <h2 className="text-4xl sm:text-5xl font-black leading-tight">
            Ready to unify<br />
            <span className="text-[#d4a843]">your operations?</span>
          </h2>
          <p className="text-white/40 text-base max-w-md">
            Deployed on Vercel. Powered by Supabase. Syncs every few minutes. No manual data wrangling.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/auth/login"
              className="px-8 py-4 rounded-xl bg-[#d4a843] text-zinc-900 font-bold text-sm hover:bg-[#e0b84a] transition-all hover:scale-105 shadow-xl shadow-[#d4a843]/25"
            >
              Open the portal →
            </Link>
            <a
              href="https://github.com/hitul-hse/supabase-app"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl border border-white/15 text-white/60 font-medium text-sm hover:border-white/30 hover:text-white transition-colors"
            >
              View on GitHub
            </a>
          </div>
          <p className="font-mono text-[10px] tracking-widest text-white/20">
            hseportal.hs-experts.com
          </p>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/6 px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/20 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-[#d4a843] flex items-center justify-center">
            <span className="text-zinc-900 font-black text-[9px]">H</span>
          </div>
          <span>HSE Health &amp; Safety Experts GmbH</span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[9px] tracking-widest">
          <Link href="/auth/login" className="hover:text-white/50 transition-colors">PORTAL</Link>
          <Link href="/demo" className="hover:text-white/50 transition-colors">DEMO</Link>
          <a href="https://github.com/hitul-hse/supabase-app" target="_blank" rel="noopener noreferrer" className="hover:text-white/50 transition-colors">GITHUB</a>
        </div>
      </footer>
    </div>
  );
}
