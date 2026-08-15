"use client";

/**
 * HSE Hub — Cinematic Product Demo Page
 * Accessible at /demo (no auth required).
 * Apple-style full-screen sections with scroll-triggered animations,
 * real app screenshots, and an embedded video player.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

/* ─── Feature slides ──────────────────────────────────────────────────── */
const FEATURES = [
  {
    id: "overview",
    label: "Overview",
    headline: "Every metric,\none glance.",
    sub: "Executive KPIs, billable trends, and project health — all live-synced from Asana, TrackingTime, Samdock, and Factorial.",
    screenshot: "/screenshots/02-overview.png",
    accent: "#d4a843",
    stat: { value: "98%", label: "Data freshness" },
  },
  {
    id: "teamlead",
    label: "Team Lead",
    headline: "Workload at\na glance.",
    sub: "Colour-coded utilisation per person, per week. Spot over-booking before it becomes a problem. Approve or reject time bookings inline.",
    screenshot: "/screenshots/03-team-lead.png",
    accent: "#7c3aed",
    stat: { value: "4×", label: "Faster decisions" },
  },
  {
    id: "people",
    label: "People",
    headline: "Your team,\nfully mapped.",
    sub: "Qualifications, assignments, department breakdowns — with role-based visibility so everyone sees exactly what they need.",
    screenshot: "/screenshots/04-people.png",
    accent: "#0ea5e9",
    stat: { value: "41", label: "Team members" },
  },
  {
    id: "projects",
    label: "Projects",
    headline: "Projects on\ntrack.",
    sub: "Timeline view, task breakdown, budget vs actual — all pulled live from Asana so your data is never stale.",
    screenshot: "/screenshots/05-projects.png",
    accent: "#10b981",
    stat: { value: "27", label: "Active projects" },
  },
  {
    id: "timesheets",
    label: "Timesheets",
    headline: "Time tracked\nwithout friction.",
    sub: "Weekly timesheet grid synced from TrackingTime. Billable vs non-billable split, export-ready, RLS-protected per employee.",
    screenshot: "/screenshots/06-timesheets.png",
    accent: "#f43f5e",
    stat: { value: "1,240h", label: "Tracked this month" },
  },
  {
    id: "rbac",
    label: "Permissions",
    headline: "Role control\nyou define.",
    sub: "Granular permission matrix: 24 toggleable permissions across 7 resource groups. Change what each role can access without touching code.",
    screenshot: "/screenshots/07-admin-roles.png",
    accent: "#f59e0b",
    stat: { value: "24", label: "Permissions" },
  },
];

const CONNECTORS = [
  { name: "Asana", color: "#f06a6a" },
  { name: "TrackingTime", color: "#0057ff" },
  { name: "Samdock", color: "#00c27c" },
  { name: "Factorial", color: "#7c3aed" },
  { name: "Supabase", color: "#3ecf8e" },
  { name: "Vercel", color: "#ffffff" },
];

/* ─── Counter animation ───────────────────────────────────────────────── */
function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = value / 60;
    const timer = setInterval(() => {
      start += step;
      if (start >= value) { setDisplayed(value); clearInterval(timer); }
      else setDisplayed(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return <>{displayed.toLocaleString()}{suffix}</>;
}

/* ─── Screenshot card ─────────────────────────────────────────────────── */
function ScreenshotCard({ src, alt, accent }: { src: string; alt: string; accent: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div
      className="relative rounded-2xl overflow-hidden shadow-2xl"
      style={{ border: `1px solid ${accent}33` }}
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 bg-[#1a1a1a]">
        <div className="w-3 h-3 rounded-full bg-red-500/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <div className="w-3 h-3 rounded-full bg-green-500/80" />
        <div className="ml-3 flex-1 bg-[#2a2a2a] rounded-md px-3 py-1 text-xs text-gray-500 font-mono">
          hseportal.hs-experts.com
        </div>
      </div>

      {/* Screenshot or fallback */}
      {!error ? (
        <div className="relative aspect-[16/9] bg-[#0f0f0f]">
          <Image
            src={src}
            alt={alt}
            fill
            className={`object-cover object-top transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: accent }} />
            </div>
          )}
        </div>
      ) : (
        <div
          className="aspect-[16/9] flex items-center justify-center text-sm font-mono"
          style={{ background: `${accent}11`, color: accent }}
        >
          {alt}
        </div>
      )}
    </div>
  );
}

/* ─── Video section ───────────────────────────────────────────────────── */
function VideoSection() {
  const [playing, setPlaying] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggle = () => {
    if (!videoRef.current) return;
    if (playing) { videoRef.current.pause(); setPlaying(false); }
    else { videoRef.current.play(); setPlaying(true); }
  };

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24 bg-[#080808]">
      {/* Glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[400px] bg-[#d4a843]/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="text-center mb-12 relative z-10"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#d4a843]/10 border border-[#d4a843]/20 text-[#d4a843] text-xs font-mono uppercase tracking-widest mb-6">
          ▶ Product Demo
        </div>
        <h2 className="text-4xl md:text-6xl font-bold text-white leading-tight mb-4">
          See it in action
        </h2>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          A full walkthrough of every feature — from the overview dashboard to granular role permissions.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        viewport={{ once: true }}
        className="relative w-full max-w-5xl z-10"
      >
        <div className="relative rounded-2xl overflow-hidden bg-[#111] border border-white/10 shadow-[0_0_80px_rgba(212,168,67,0.15)]">
          {/* Browser chrome */}
          <div className="flex items-center gap-1.5 px-4 py-3 bg-[#1a1a1a] border-b border-white/5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <div className="ml-3 flex-1 bg-[#2a2a2a] rounded-md px-3 py-1 text-xs text-gray-500 font-mono">
              hseportal.hs-experts.com
            </div>
          </div>

          {hasVideo ? (
            <div className="relative aspect-video cursor-pointer" onClick={toggle}>
              <video
                ref={videoRef}
                src="/hse-hub-demo.webm"
                className="w-full h-full object-cover"
                onError={() => setHasVideo(false)}
                onEnded={() => setPlaying(false)}
                playsInline
                muted
              />
              <AnimatePresence>
                {!playing && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  >
                    <div className="w-20 h-20 rounded-full bg-[#d4a843] flex items-center justify-center shadow-[0_0_40px_rgba(212,168,67,0.5)] hover:scale-110 transition-transform">
                      <svg className="w-8 h-8 text-black ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            /* Fallback: animated mockup when video not yet generated */
            <div className="aspect-video bg-[#0a0a0a] flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">🎬</div>
                <div className="text-white/60 text-sm font-mono">
                  Run <span className="text-[#d4a843]">npx tsx scripts/record-demo-video.ts</span> to generate
                </div>
                <div className="text-white/40 text-xs mt-2">Then push — video auto-serves from /hse-hub-demo.webm</div>
              </div>
            </div>
          )}
        </div>

        {/* Download link */}
        <div className="text-center mt-6">
          <a
            href="/hse-hub-demo.webm"
            download="hse-hub-demo.webm"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download video (.webm)
          </a>
        </div>
      </motion.div>
    </section>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */
export default function DemoPage() {
  const [activeFeature, setActiveFeature] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.5], [0, -80]);

  // Auto-cycle features
  useEffect(() => {
    if (!autoPlay) return;
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % FEATURES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [autoPlay]);

  const current = FEATURES[activeFeature];

  return (
    <div className="min-h-screen bg-[#060606] text-white overflow-x-hidden">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
        {/* Background grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:64px_64px]" />

        {/* Gold radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#d4a843]/8 rounded-full blur-3xl pointer-events-none" />

        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 text-center max-w-5xl mx-auto">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#d4a843]/10 border border-[#d4a843]/30 text-[#d4a843] text-xs font-mono uppercase tracking-widest mb-8"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4a843] animate-pulse" />
            HSE Health & Safety Experts GmbH — Internal Portal
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-6"
          >
            <span className="text-white">Operations.</span>
            <br />
            <span className="bg-gradient-to-r from-[#d4a843] via-[#f0c96e] to-[#d4a843] bg-clip-text text-transparent">
              Unified.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            One portal. Four systems. Real-time sync. Role-based access from executive to employee.
            Built on Next.js 15, Supabase, and deployed globally on Vercel.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href="/login"
              className="px-8 py-4 rounded-xl bg-[#d4a843] text-black font-bold text-sm tracking-wide hover:bg-[#f0c96e] transition-all shadow-[0_0_30px_rgba(212,168,67,0.4)] hover:shadow-[0_0_50px_rgba(212,168,67,0.6)]"
            >
              Open the portal →
            </Link>
            <a
              href="#features"
              className="px-8 py-4 rounded-xl border border-white/10 text-white text-sm font-medium hover:bg-white/5 transition-all"
            >
              See features ↓
            </a>
          </motion.div>

          {/* Live stats strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="mt-16 flex flex-wrap items-center justify-center gap-8 md:gap-16 text-center"
          >
            {[
              { n: 41, suffix: "", label: "Team members" },
              { n: 27, suffix: "", label: "Active projects" },
              { n: 4, suffix: "×", label: "Integrated systems" },
              { n: 24, suffix: "", label: "Permissions" },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl md:text-4xl font-bold text-white">
                  <AnimatedNumber value={s.n} suffix={s.suffix} />
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-widest mt-1">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-600"
        >
          <span className="text-xs font-mono uppercase tracking-widest">Scroll</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="w-5 h-8 rounded-full border border-gray-700 flex items-start justify-center p-1"
          >
            <div className="w-1 h-2 bg-[#d4a843] rounded-full" />
          </motion.div>
        </motion.div>
      </section>

      {/* ── Connectors strip ─────────────────────────────────────────────── */}
      <section className="py-12 border-y border-white/5 bg-[#080808]">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-center text-xs text-gray-600 uppercase tracking-widest font-mono mb-8">
            Connected systems
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
            {CONNECTORS.map((c, i) => (
              <motion.div
                key={c.name}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                viewport={{ once: true }}
                className="text-sm font-semibold"
                style={{ color: c.color }}
              >
                {c.name}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature showcase ─────────────────────────────────────────────── */}
      <section id="features" className="min-h-screen py-24 px-6 bg-[#060606]">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-4">
              Every feature you need
            </h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">
              Purpose-built for HSE operations — not a generic BI tool.
            </p>
          </motion.div>

          {/* Tab strip */}
          <div
            className="flex flex-wrap justify-center gap-2 mb-12"
            onMouseEnter={() => setAutoPlay(false)}
            onMouseLeave={() => setAutoPlay(true)}
          >
            {FEATURES.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setActiveFeature(i)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                  i === activeFeature
                    ? "text-black shadow-lg"
                    : "text-gray-400 bg-white/5 hover:bg-white/10"
                }`}
                style={i === activeFeature ? { background: current.accent } : {}}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Feature panel */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="grid md:grid-cols-2 gap-12 items-center"
              onMouseEnter={() => setAutoPlay(false)}
              onMouseLeave={() => setAutoPlay(true)}
            >
              {/* Copy */}
              <div>
                <div
                  className="text-xs font-mono uppercase tracking-widest mb-4"
                  style={{ color: current.accent }}
                >
                  {current.label}
                </div>
                <h3 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-6 whitespace-pre-line">
                  {current.headline}
                </h3>
                <p className="text-gray-400 text-lg leading-relaxed mb-8">
                  {current.sub}
                </p>

                {/* Stat */}
                <div
                  className="inline-flex flex-col px-6 py-4 rounded-2xl border"
                  style={{ borderColor: `${current.accent}33`, background: `${current.accent}0d` }}
                >
                  <span className="text-4xl font-bold" style={{ color: current.accent }}>
                    {current.stat.value}
                  </span>
                  <span className="text-xs text-gray-500 uppercase tracking-widest mt-1">
                    {current.stat.label}
                  </span>
                </div>
              </div>

              {/* Screenshot */}
              <ScreenshotCard
                src={current.screenshot}
                alt={current.label}
                accent={current.accent}
              />
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mt-12">
            {FEATURES.map((_, i) => (
              <button
                key={i}
                onClick={() => { setActiveFeature(i); setAutoPlay(false); }}
                className="h-1 rounded-full transition-all duration-300"
                style={{
                  width: i === activeFeature ? 32 : 8,
                  background: i === activeFeature ? current.accent : "#ffffff20",
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Video section ────────────────────────────────────────────────── */}
      <VideoSection />

      {/* ── Architecture strip ───────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-[#060606] border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Production-grade stack
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              Every layer chosen for reliability, security, and developer velocity.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: "⚡", title: "Next.js 15 App Router", desc: "Server components, streaming SSR, and edge-ready. Zero client JS where it isn't needed." },
              { icon: "🔐", title: "Supabase + RLS", desc: "Row-level security enforced at the database layer. 24 fine-grained permissions, 4 roles." },
              { icon: "🚀", title: "Vercel Edge Network", desc: "Global CDN, automatic preview deployments on every PR, instant rollbacks." },
              { icon: "🔄", title: "Live Sync Pipeline", desc: "Asana · TrackingTime · Samdock · Factorial — polled and normalised into a star schema." },
              { icon: "🎯", title: "Identity Resolution", desc: "One person, three systems. Canonical person_id via effective-dated identity maps." },
              { icon: "✅", title: "CI/CD with GitHub Actions", desc: "Lint → TypeScript → Build → DB tests on every push. Single required status check." },
            ].map((card, i) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
                className="p-6 rounded-2xl bg-white/3 border border-white/8 hover:border-[#d4a843]/30 hover:bg-white/5 transition-all"
              >
                <div className="text-3xl mb-4">{card.icon}</div>
                <div className="text-white font-semibold mb-2">{card.title}</div>
                <div className="text-gray-500 text-sm leading-relaxed">{card.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="py-32 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#d4a843]/5 to-transparent pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative z-10 max-w-2xl mx-auto"
        >
          <h2 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-none">
            Ready to<br />
            <span className="text-[#d4a843]">connect?</span>
          </h2>
          <p className="text-gray-400 text-lg mb-10">
            Deployed on Vercel · Powered by Supabase · Syncs every few minutes
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="px-10 py-4 rounded-xl bg-[#d4a843] text-black font-bold hover:bg-[#f0c96e] transition-all shadow-[0_0_40px_rgba(212,168,67,0.4)]"
            >
              Sign in to the portal →
            </Link>
            <a
              href="https://github.com/hitul-hse/supabase-app"
              target="_blank"
              rel="noopener noreferrer"
              className="px-10 py-4 rounded-xl border border-white/10 text-white hover:bg-white/5 transition-all"
            >
              View on GitHub
            </a>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="py-8 px-6 border-t border-white/5 text-center">
        <p className="text-gray-600 text-sm">
          © {new Date().getFullYear()} HSE Health & Safety Experts GmbH · Built with V3Code · Claude
        </p>
      </footer>
    </div>
  );
}
