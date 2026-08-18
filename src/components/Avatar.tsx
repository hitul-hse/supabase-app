/**
 * A person's picture, or a monogram when they have not set one.
 *
 * Identity math (initials, colour) lives in @/lib/avatar-identity so it can
 * be exercised by a plain Node script; this file only renders.
 */
import Image from "next/image";
import { initialsOf, colorForName } from "@/lib/avatar-identity";

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-label={name}
      className="flex items-center justify-center rounded-full font-medium text-[var(--surface)]"
      style={{
        width: size,
        height: size,
        background: colorForName(name),
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
