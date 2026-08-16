"use client";

/**
 * HSE Hub marketing page (/demo).
 *
 * Visual language is derived from four reference sites the client supplied
 * (sstr.tech, produx.design, karocrafts.com, noartmusic.com) — see the
 * `web-reference-analysis` project memory topic for the extracted tokens.
 * The load-bearing borrowed patterns are:
 *   - preloader with a percent counter
 *   - bracket / paren / double-slash typographic motifs
 *   - headings split to words AND characters for staggered reveal
 *   - odometer (slot-machine) digit rolls on statistics
 *   - line—LABEL—line eyebrows above every section
 *   - a LIGHT body sandwiched between dark hero and dark CTA (SSTR's key move)
 *   - duplicate-label hover swap on buttons
 *
 * Brand colour and logo are authoritative from hs-experts.com (see DESIGN.md).
 * Accent on dark is --teal #91C2B7; on light it must be --teal-deep #29474B,
 * because #91C2B7 fails contrast against #eff0f1.
 */

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  motion,
  useInView,
  useScroll,
  useSpring,
  useTransform,
  AnimatePresence,
} from "framer-motion";

/* ---------------------------------------------------------------- tokens */

const T = {
  // dark world
  ink: "#0c1416",
  ink2: "#111c1f",
  // light world (SSTR-style page surface)
  paper: "#eef1f0",
  // brand
  teal: "#91C2B7",
  tealDeep: "#29474B",
  tealMid: "#4d7a72",
  // type
  onInk: "#f2f5f4",
  onInkDim: "#8fa8a5",
  onPaper: "#0c1416",
  onPaperDim: "#5f6f6c",
};

const FD = "var(--font-grotesk), system-ui, sans-serif";
const FM = "var(--font-jetbrains), ui-monospace, monospace";

/** SSTR's nav sweep curve — used for every reveal so motion reads as one system. */
const EASE = [0.675, 0.15, 0.1, 1] as const;
const CUT = 10; // corner chamfer, mirrors SSTR's --cut:10px

// BUMP THIS every time hse-hub-ad.mp4 is re-rendered. Vercel serves /public/*.mp4
// with max-age=86400, so an unchanged URL means returning visitors keep seeing
// the previous cut from their own disk cache for a full day.
const VIDEO_VERSION = "v9-shared-motion";
const VIDEO_SRC = `/hse-hub-ad.mp4?v=${VIDEO_VERSION}`;

const WRAP = "w-full max-w-[1240px] mx-auto px-6 md:px-10";

/* ------------------------------------------------------------- preloader */

function Preloader({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      // ease toward 100 so it decelerates like a real load
      n += Math.max(1, Math.round((100 - n) * 0.12));
      if (n >= 100) {
        n = 100;
        clearInterval(id);
        setTimeout(onDone, 420);
      }
      setPct(n);
    }, 28);
    return () => clearInterval(id);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col justify-between p-6 md:p-10"
      style={{ background: T.ink }}
      exit={{ y: "-100%", transition: { duration: 0.8, ease: EASE } }}
    >
      <div
        className="flex justify-between text-[11px] uppercase"
        style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.14em" }}
      >
        <span>[ HSE HUB ]</span>
        <span>[ EST. 2026 ]</span>
      </div>

      <div className="flex items-end justify-between gap-6">
        <div
          style={{
            fontFamily: FD,
            color: T.onInk,
            fontSize: "clamp(56px,14vw,180px)",
            lineHeight: 0.85,
            letterSpacing: "-0.04em",
          }}
        >
          {pct}
          <span style={{ color: T.teal }}>%</span>
        </div>
        <div
          className="hidden md:block text-[11px] uppercase pb-4"
          style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.14em" }}
        >
          loading operations
        </div>
      </div>

      <div className="h-px w-full" style={{ background: "rgba(145,194,183,0.18)" }}>
        <div
          className="h-px transition-[width] duration-100"
          style={{ width: `${pct}%`, background: T.teal }}
        />
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------- split text (PRODUX) */

/**
 * Splits a phrase into words then characters so each glyph can stagger in.
 *
 * GOTCHA: splitting destroys the accessible text — the DOM ends up as
 * "Ifnothinghappens" because inter-word gaps are zero-width spacer spans, not
 * real spaces. So the visible glyphs are aria-hidden and the real phrase is
 * exposed once via a visually-hidden span. Do not remove either half.
 */
function SplitLine({
  text,
  className,
  style,
  delay = 0,
  color,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  color?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-12%" });
  let i = 0;

  return (
    <span ref={ref} className={className} style={{ display: "block", ...style }}>
      {/* real text for screen readers / SEO — the split glyphs below are decorative */}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {text}{" "}
      </span>
      {text.split(" ").map((word, w) => (
        <span
          key={w}
          aria-hidden="true"
          style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}
        >
          {word.split("").map((ch) => {
            const d = delay + i * 0.016;
            i += 1;
            return (
              <motion.span
                key={`${w}-${i}`}
                style={{ display: "inline-block", color }}
                initial={{ y: "110%" }}
                animate={inView ? { y: 0 } : { y: "110%" }}
                transition={{ duration: 0.8, ease: EASE, delay: d }}
              >
                {ch}
              </motion.span>
            );
          })}
          <span style={{ display: "inline-block", width: "0.28em" }} />
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------- odometer stat (SSTR) */

/** One vertically-scrolling 0-9 strip. Lands on `digit` when in view. */
function Reel({ digit, delay, size }: { digit: number; delay: number; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  return (
    <span
      ref={ref}
      style={{ display: "inline-block", height: size, overflow: "hidden", lineHeight: `${size}px` }}
    >
      <motion.span
        style={{ display: "block" }}
        initial={{ y: 0 }}
        animate={inView ? { y: -digit * size } : { y: 0 }}
        transition={{ duration: 1.5, ease: EASE, delay }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} style={{ display: "block", height: size }}>
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

function Odometer({ value, size = 64 }: { value: string; size?: number }) {
  const chars = value.split("");
  let d = 0;
  return (
    <span
      style={{
        fontFamily: FD,
        fontSize: size,
        lineHeight: `${size}px`,
        letterSpacing: "-0.04em",
        display: "inline-flex",
        alignItems: "flex-start",
      }}
    >
      {chars.map((c, idx) => {
        if (/\d/.test(c)) {
          const delay = d * 0.09;
          d += 1;
          return <Reel key={idx} digit={Number(c)} delay={delay} size={size} />;
        }
        return (
          <span key={idx} style={{ display: "inline-block", height: size }}>
            {c}
          </span>
        );
      })}
    </span>
  );
}

/* ----------------------------------------------------- eyebrow (SSTR) */

function Eyebrow({ label, dark }: { label: string; dark?: boolean }) {
  const line = dark ? "rgba(145,194,183,0.28)" : "rgba(41,71,75,0.24)";
  const col = dark ? T.teal : T.tealDeep;
  return (
    <motion.div
      className="flex items-center gap-3"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <span className="h-px w-8" style={{ background: line }} />
      <span
        className="text-[11px] uppercase"
        style={{ fontFamily: FM, color: col, letterSpacing: "0.18em" }}
      >
        {label}
      </span>
      <span className="h-px flex-1" style={{ background: line }} />
    </motion.div>
  );
}

/* --------------------------------------------- button w/ label swap (KARO) */

function SwapButton({
  href,
  label,
  dark,
  solid,
  download,
}: {
  href: string;
  label: string;
  dark?: boolean;
  solid?: boolean;
  download?: boolean;
}) {
  const fg = solid ? T.ink : dark ? T.onInk : T.onPaper;
  const bg = solid ? T.teal : "transparent";
  const bd = solid
    ? T.teal
    : dark
      ? "rgba(145,194,183,0.32)"
      : "rgba(41,71,75,0.28)";

  return (
    <a
      href={href}
      {...(download ? { download: true } : {})}
      className="group relative inline-flex items-center gap-3 overflow-hidden px-7 py-4"
      style={{
        background: bg,
        border: `1px solid ${bd}`,
        color: fg,
        fontFamily: FM,
        fontSize: 12,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        clipPath: `polygon(${CUT}px 0,100% 0,100% calc(100% - ${CUT}px),calc(100% - ${CUT}px) 100%,0 100%,0 ${CUT}px)`,
      }}
    >
      {/* label rendered twice — one slides out as the other slides in */}
      <span className="relative block overflow-hidden" style={{ height: 14 }}>
        <span className="block transition-transform duration-[420ms] group-hover:-translate-y-full"
          style={{ transitionTimingFunction: "cubic-bezier(0.675,0.15,0.1,1)" }}>
          {label}
        </span>
        <span className="absolute left-0 top-full block transition-transform duration-[420ms] group-hover:-translate-y-full"
          style={{ transitionTimingFunction: "cubic-bezier(0.675,0.15,0.1,1)" }}>
          {label}
        </span>
      </span>
      <span className="transition-transform duration-[420ms] group-hover:translate-x-1"
        style={{ transitionTimingFunction: "cubic-bezier(0.675,0.15,0.1,1)" }}>
        →
      </span>
    </a>
  );
}

/* ------------------------------------------------------------ video block */

function VideoBlock() {
  const vref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);

  /**
   * NOTE: preload must stay "none". With preload="metadata" Chrome starts a
   * speculative fetch that click-to-play aborts, leaving the element wedged
   * with a bogus short duration (MEDIA_ERR_NETWORK). The load() guard below
   * recovers an element that already got into that state.
   */
  const toggle = () => {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      if (v.error || (v.duration && v.duration < 30)) v.load();
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        border: "1px solid rgba(145,194,183,0.18)",
        clipPath: `polygon(${CUT * 2}px 0,100% 0,100% calc(100% - ${CUT * 2}px),calc(100% - ${CUT * 2}px) 100%,0 100%,0 ${CUT * 2}px)`,
        background: T.ink2,
      }}
    >
      <video
        ref={vref}
        src={VIDEO_SRC}
        preload="none"
        playsInline
        className="block w-full"
        style={{ aspectRatio: "16/9", objectFit: "cover" }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setPct((v.currentTime / v.duration) * 100);
        }}
        onEnded={() => setPlaying(false)}
        onClick={toggle}
      />

      {!playing && (
        <button
          onClick={toggle}
          aria-label="Play showreel"
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "rgba(12,20,22,0.42)" }}
        >
          <span
            className="flex items-center justify-center transition-transform duration-500 hover:scale-105"
            style={{
              width: 92,
              height: 92,
              borderRadius: "50%",
              background: T.teal,
              color: T.ink,
            }}
          >
            <svg width="26" height="30" viewBox="0 0 26 30" fill="currentColor">
              <path d="M0 0 L26 15 L0 30 Z" />
            </svg>
          </span>
        </button>
      )}

      <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{ background: "rgba(145,194,183,0.14)" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: T.teal }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ data */

const STATS = [
  { v: "41", l: "People tracked", s: "across 4 departments" },
  { v: "27", l: "Live projects", s: "synced from Asana" },
  { v: "04", l: "Systems unified", s: "one canonical identity" },
  { v: "24", l: "Permissions", s: "role-configurable" },
];

const FEATURES = [
  {
    n: "01",
    t: "Executive overview",
    d: "Billable trend, utilisation and the full project ledger on one screen — every figure traced to a source system, never re-keyed.",
    tag: "Real-time",
  },
  {
    n: "02",
    t: "Role-based access",
    d: "Four roles, twenty-four permissions, enforced in Postgres row-level security rather than hopeful checks in the UI layer.",
    tag: "RLS-enforced",
  },
  {
    n: "03",
    t: "Identity resolution",
    d: "One person exists three times across three systems. Canonical identity maps with effective dating resolve them into one.",
    tag: "Identity-aware",
  },
  {
    n: "04",
    t: "Workload booking",
    d: "Team leads book capacity a month ahead and see over-allocation before it becomes an overrun rather than after.",
    tag: "Forward-looking",
  },
  {
    n: "05",
    t: "Timesheets",
    d: "Hours arrive from TrackingTime and Factorial, normalised out of raw seconds and minutes into a single reconciled grid.",
    tag: "Reconciled",
  },
  {
    n: "06",
    t: "Delivery pipeline",
    d: "Every push runs lint, types, build and database tests before Vercel promotes it. No manual step between merge and live.",
    tag: "Automated",
  },
];

const STACK = [
  ["Next.js 16", "App Router, RSC, streaming"],
  ["Supabase", "Postgres + row-level security"],
  ["Vercel", "Edge network, preview per PR"],
  ["Asana", "Projects and task graph"],
  ["TrackingTime", "Time entries, billable split"],
  ["FactorialHR", "People, absence, contracts"],
];

/* ------------------------------------------------------------------ page */

export default function DemoPage() {
  const [loading, setLoading] = useState(true);
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  // hero parallax
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(heroP, [0, 1], [0, 140]);
  const heroFade = useTransform(heroP, [0, 0.8], [1, 0]);


  return (
    <div style={{ background: T.paper }}>
      <AnimatePresence>
        {loading && <Preloader key="pre" onDone={() => setLoading(false)} />}
      </AnimatePresence>

      {/* scroll progress — every reference site has one */}
      <motion.div
        className="fixed left-0 top-0 z-[60] h-[2px] origin-left"
        style={{ scaleX: bar, width: "100%", background: T.teal }}
      />

      {/* ------------------------------------------------------------ nav */}
      <nav
        className="fixed inset-x-0 top-0 z-50"
        style={{
          background: "rgba(12,20,22,0.72)",
          backdropFilter: "blur(18px) saturate(160%)",
          borderBottom: "1px solid rgba(145,194,183,0.12)",
        }}
      >
        <div className={`${WRAP} flex h-16 items-center justify-between`}>
          <a href="/" className="flex items-center gap-3">
            <Image src="/hse-logo.png" alt="HSE" width={26} height={26} />
            <span
              style={{
                fontFamily: FD,
                color: T.onInk,
                fontSize: 15,
                letterSpacing: "-0.01em",
                fontWeight: 600,
              }}
            >
              HSE HUB
            </span>
          </a>
          <div
            className="hidden items-center gap-8 md:flex text-[11px] uppercase"
            style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.16em" }}
          >
            <a href="#work" className="transition-colors hover:text-white">Product</a>
            <a href="#reel" className="transition-colors hover:text-white">Showreel</a>
            <a href="#stack" className="transition-colors hover:text-white">Stack</a>
          </div>
          <a
            href="/"
            className="text-[11px] uppercase px-5 py-2.5"
            style={{
              fontFamily: FM,
              letterSpacing: "0.14em",
              background: T.teal,
              color: T.ink,
              clipPath: `polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)`,
            }}
          >
            Sign in
          </a>
        </div>
      </nav>

      {/* ----------------------------------------------------------- hero */}
      <section
        ref={heroRef}
        className="relative flex min-h-[100dvh] flex-col justify-end overflow-hidden pb-14 pt-32"
        style={{ background: T.ink }}
      >
        {/* grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(145,194,183,0.055) 1px,transparent 1px),linear-gradient(90deg,rgba(145,194,183,0.055) 1px,transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        <motion.div
          className="pointer-events-none absolute -right-40 top-10 h-[520px] w-[520px] rounded-full"
          style={{
            background: "radial-gradient(circle,rgba(145,194,183,0.16),transparent 68%)",
            filter: "blur(28px)",
            opacity: heroFade,
          }}
        />

        <motion.div className={`${WRAP} relative`} style={{ y: heroY, opacity: heroFade }}>
          {/* corner meta, KARO-style */}
          <div
            className="mb-10 flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase"
            style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.16em" }}
          >
            <span>[ HS-EXPERTS GMBH · BERLIN ]</span>
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: T.teal }}
              />
              live · 4 systems connected
            </span>
          </div>

          <h1
            style={{
              fontFamily: FD,
              color: T.onInk,
              fontSize: "clamp(44px,8.4vw,132px)",
              lineHeight: 0.92,
              letterSpacing: "-0.045em",
              fontWeight: 500,
            }}
          >
            <SplitLine text="If nothing happens," delay={0.15} />
            <SplitLine text="we've done our job." delay={0.3} color={T.teal} />
          </h1>

          <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <motion.p
              className="max-w-md text-[15px] leading-relaxed"
              style={{ fontFamily: FD, color: T.onInkDim }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
            >
              HSE Hub unifies Asana, TrackingTime, Samdock and FactorialHR into one
              operational picture — resolved to a single canonical identity, governed
              by row-level security.
            </motion.p>

            <motion.div
              className="flex flex-wrap gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 1.05 }}
            >
              <SwapButton href="#reel" label="Watch showreel" dark solid />
              <SwapButton href="/" label="Open portal" dark />
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ---------------------------------------------------------- stats */}
      <section className="py-24 md:py-32" style={{ background: T.paper }}>
        <div className={WRAP}>
          <Eyebrow label="By the numbers" />
          <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-14 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.l}>
                <div style={{ color: T.tealDeep }}>
                  <Odometer value={s.v} size={72} />
                </div>
                <div
                  className="mt-5 text-[13px]"
                  style={{ fontFamily: FD, color: T.onPaper, fontWeight: 500 }}
                >
                  {s.l}
                </div>
                <div
                  className="mt-1 text-[11px] uppercase"
                  style={{ fontFamily: FM, color: T.onPaperDim, letterSpacing: "0.12em" }}
                >
                  {s.s}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section id="work" className="pb-28" style={{ background: T.paper }}>
        <div className={WRAP}>
          <Eyebrow label="Product" />
          <h2
            className="mt-8 max-w-3xl"
            style={{
              fontFamily: FD,
              color: T.onPaper,
              fontSize: "clamp(30px,4.6vw,60px)",
              lineHeight: 1.02,
              letterSpacing: "-0.04em",
              fontWeight: 500,
            }}
          >
            <SplitLine text="Six modules. One" />
            <SplitLine text="operational truth." delay={0.08} color={T.tealDeep} />
          </h2>

          <div className="mt-16 border-t" style={{ borderColor: "rgba(12,20,22,0.12)" }}>
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.n}
                className="group grid grid-cols-1 gap-4 border-b py-9 md:grid-cols-12 md:gap-8"
                style={{ borderColor: "rgba(12,20,22,0.12)" }}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{ duration: 0.7, ease: EASE, delay: i * 0.05 }}
              >
                <div
                  className="md:col-span-1 text-[12px]"
                  style={{ fontFamily: FM, color: T.tealMid, letterSpacing: "0.1em" }}
                >
                  {f.n}
                </div>
                <h3
                  className="md:col-span-4 transition-transform duration-500 group-hover:translate-x-1"
                  style={{
                    fontFamily: FD,
                    color: T.onPaper,
                    fontSize: 24,
                    letterSpacing: "-0.03em",
                    fontWeight: 500,
                  }}
                >
                  {f.t}
                </h3>
                <p
                  className="md:col-span-5 text-[14px] leading-relaxed"
                  style={{ fontFamily: FD, color: T.onPaperDim }}
                >
                  {f.d}
                </p>
                <div className="md:col-span-2 md:text-right">
                  <span
                    className="inline-block px-3 py-1.5 text-[10px] uppercase"
                    style={{
                      fontFamily: FM,
                      letterSpacing: "0.14em",
                      color: T.tealDeep,
                      border: "1px solid rgba(41,71,75,0.24)",
                    }}
                  >
                    {f.tag}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- reel */}
      <section id="reel" className="py-24 md:py-32" style={{ background: T.ink }}>
        <div className={WRAP}>
          <Eyebrow label="Showreel" dark />
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h2
              style={{
                fontFamily: FD,
                color: T.onInk,
                fontSize: "clamp(30px,4.6vw,60px)",
                lineHeight: 1.02,
                letterSpacing: "-0.04em",
                fontWeight: 500,
              }}
            >
              <SplitLine text="Sixty seconds," />
              <SplitLine text="the whole system." delay={0.08} color={T.teal} />
            </h2>
            <div
              className="text-[11px] uppercase"
              style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.14em" }}
            >
              // 1920×1080 · H264
            </div>
          </div>

          <motion.div
            className="mt-12"
            initial={{ opacity: 0, y: 34 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-8%" }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            <VideoBlock />
          </motion.div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <span
              className="text-[11px] uppercase"
              style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.14em" }}
            >
              [ rendered with remotion ]
            </span>
            <SwapButton href={VIDEO_SRC} label="Download MP4" dark download />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- stack */}
      <section id="stack" className="py-24 md:py-32" style={{ background: T.paper }}>
        <div className={WRAP}>
          <Eyebrow label="Architecture" />
          <h2
            className="mt-8 max-w-2xl"
            style={{
              fontFamily: FD,
              color: T.onPaper,
              fontSize: "clamp(30px,4.6vw,60px)",
              lineHeight: 1.02,
              letterSpacing: "-0.04em",
              fontWeight: 500,
            }}
          >
            <SplitLine text="Built on systems" />
            <SplitLine text="you already run." delay={0.08} color={T.tealDeep} />
          </h2>

          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map(([name, desc], i) => (
              <motion.div
                key={name}
                className="group relative p-8 transition-colors duration-500"
                style={{
                  borderTop: "1px solid rgba(12,20,22,0.12)",
                  borderLeft: i % 3 === 0 ? "none" : "1px solid rgba(12,20,22,0.12)",
                }}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE, delay: (i % 3) * 0.06 }}
              >
                <div
                  className="text-[11px]"
                  style={{ fontFamily: FM, color: T.tealMid, letterSpacing: "0.12em" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div
                  className="mt-5 transition-transform duration-500 group-hover:translate-x-1"
                  style={{
                    fontFamily: FD,
                    color: T.onPaper,
                    fontSize: 19,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {name}
                </div>
                <div
                  className="mt-2 text-[13px]"
                  style={{ fontFamily: FD, color: T.onPaperDim }}
                >
                  {desc}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ cta */}
      <section className="relative overflow-hidden py-28 md:py-40" style={{ background: T.ink }}>
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle,rgba(145,194,183,0.14),transparent 68%)",
            filter: "blur(30px)",
          }}
        />
        <div className={`${WRAP} relative text-center`}>
          <Image
            src="/hse-logo.png"
            alt="HSE"
            width={44}
            height={44}
            className="mx-auto mb-10"
          />
          <h2
            style={{
              fontFamily: FD,
              color: T.onInk,
              fontSize: "clamp(34px,6vw,88px)",
              lineHeight: 0.98,
              letterSpacing: "-0.045em",
              fontWeight: 500,
            }}
          >
            <SplitLine text="Ready to see" />
            <SplitLine text="the whole picture?" delay={0.08} color={T.teal} />
          </h2>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <SwapButton href="/" label="Open the portal" dark solid />
            <SwapButton href="mailto:info@hs-experts.com" label="Talk to us" dark />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer style={{ background: T.ink, borderTop: "1px solid rgba(145,194,183,0.12)" }}>
        <div
          className={`${WRAP} flex flex-col gap-4 py-9 text-[11px] uppercase md:flex-row md:items-center md:justify-between`}
          style={{ fontFamily: FM, color: T.onInkDim, letterSpacing: "0.14em" }}
        >
          <span>© 2026 HSE Health &amp; Safety Experts GmbH</span>
          <span>[ hseportal.hs-experts.com ]</span>
          <a href="mailto:info@hs-experts.com" className="transition-colors hover:text-white">
            info@hs-experts.com
          </a>
        </div>
      </footer>
    </div>
  );
}
