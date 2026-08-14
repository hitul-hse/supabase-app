"use client";
/**
 * AnimatedNavLink — sidebar navigation link with slide-in indicator,
 * active glow, and smooth hover state via Framer Motion.
 */
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

interface Props {
  href: string;
  children: ReactNode;
  badge?: string | number;
  tourId?: string; // data-tour attribute for the onboarding tour spotlight
}

export default function AnimatedNavLink({ href, children, badge, tourId }: Props) {
  const pathname = usePathname();
  const active   = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link href={href} data-tour={tourId} className="block">
      <motion.div
        whileHover={{ x: 3 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          active
            ? "bg-[#d4a843]/12 text-[#d4a843]"
            : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
        }`}
      >
        {/* Active indicator bar */}
        {active && (
          <motion.span
            layoutId="nav-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[#d4a843] rounded-full"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        )}
        <span className="pl-1">{children}</span>
        {badge != null && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#d4a843]/20 text-[#d4a843] text-[10px] font-bold px-1"
          >
            {badge}
          </motion.span>
        )}
      </motion.div>
    </Link>
  );
}
