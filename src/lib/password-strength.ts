export const MIN_PASSWORD_LENGTH = 8;

/** 0-4 password strength score based on length, digits, uppercase, and symbols. */
export function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 14) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const clamp = Math.min(score, 4);
  const labels = ["Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["var(--critical)", "var(--warning)", "var(--warning)", "var(--good)", "var(--good)"];
  return { score: clamp, label: labels[clamp], color: colors[clamp] };
}
