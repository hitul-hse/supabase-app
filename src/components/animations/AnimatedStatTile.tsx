"use client";
/**
 * AnimatedStatTile — stat card with a count-up number animation on mount
 * and a subtle lift on hover. Replaces StatTile for the Overview page KPIs.
 */
import { motion, useMotionValue, animate } from "framer-motion";
import { useEffect, useState } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  delay?: number;
}

/** Extracts the leading numeric part from a formatted value like "73.4%" or "18 240" */
function splitValue(v: string): { num: number | null; suffix: string } {
  const cleaned = v.replace(/\s/g, "");
  const match   = cleaned.match(/^([\d.]+)(.*)$/);
  if (!match) return { num: null, suffix: v };
  return { num: parseFloat(match[1]), suffix: match[2] };
}

export default function AnimatedStatTile({ label, value, sub, accent, delay = 0 }: Props) {
  const { num, suffix } = splitValue(value);
  const count = useMotionValue(0);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (num === null) return; // render falls back to `value` directly below
    const controls = animate(count, num, {
      duration: 1.2,
      delay,
      ease: "easeOut",
      onUpdate(v) {
        const formatted = Number.isInteger(num)
          ? Math.round(v).toLocaleString("de-DE")
          : v.toFixed(1);
        setDisplay(formatted + suffix);
      },
    });
    return controls.stop;
  }, [num, suffix, delay, count]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
      whileHover={{ y: -3, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
      className={`rounded-xl p-5 flex flex-col gap-2 border cursor-default select-none transition-colors ${
        accent
          ? "bg-[#d4a843]/10 border-[#d4a843]/30"
          : "bg-white border-zinc-200"
      }`}
    >
      <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-[#d4a843]" : "text-zinc-900"}`}>
        {num !== null ? display : value}
      </p>
      {sub && <p className="text-[11px] text-zinc-400 leading-tight">{sub}</p>}
    </motion.div>
  );
}
