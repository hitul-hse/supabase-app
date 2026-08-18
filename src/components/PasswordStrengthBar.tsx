"use client";

import { getPasswordStrength } from "@/lib/password-strength";

export function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all"
            style={{ background: i <= score ? color : "var(--border)" }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
