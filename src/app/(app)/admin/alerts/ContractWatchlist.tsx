/**
 * The contract watchlist: what is about to become a problem.
 *
 * WHY THIS IS SEPARATE FROM THE ALERT LIST. Alerts record things that already
 * happened -- a booking refused, a threshold crossed. This answers a forward
 * question: which contracts run out soon, which have already lapsed, which are
 * burning through their hours. The user asked for exactly this ("when we are
 * near to the budget it should give notification"), and a deadline is not an
 * event: it needs no acknowledgement and it changes every day on its own.
 *
 * Server-rendered, because nothing here is interactive: it is a list of links
 * to the projects whose terms need a conversation.
 */

import Link from "next/link";
import type { ContractAttentionRow } from "@/lib/queries/contract-periods";

const KIND_LABEL: Record<ContractAttentionRow["kind"], string> = {
  over_budget: "Over the agreed budget",
  approaching_budget: "Approaching the budget",
  lapsed: "Contract lapsed, not renewed",
  expiring: "Contract ending soon",
};

/** Tone per kind: money already spent is critical, a diary note is not. */
function tone(kind: ContractAttentionRow["kind"]): string {
  switch (kind) {
    case "over_budget":
      return "var(--critical)";
    case "lapsed":
      return "var(--critical)";
    case "approaching_budget":
      return "var(--warning, #d99b3d)";
    case "expiring":
      return "var(--text-secondary)";
  }
}

export function ContractWatchlist({ rows }: { rows: ContractAttentionRow[] }) {
  if (rows.length === 0) {
    /*
     * An empty watchlist is ambiguous until the migration is applied and terms
     * are recorded, so say which it is rather than implying all is well.
     */
    return (
      <section className="border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Contract watchlist
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          No contract periods need attention. This list stays empty until contract
          terms are recorded on projects, so it is also what you see before sales
          have entered any agreements.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Contract watchlist ({rows.length})
        </h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
          Contracts running out of hours or out of time. Worst first. Nothing here
          needs acknowledging: it changes as the dates and the hours change.
        </p>
      </header>

      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1 border-b border-[var(--border)] px-4 py-2.5 last:border-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: tone(r.kind) }}
                >
                  {KIND_LABEL[r.kind]}
                </span>
                <Link
                  href={`/projects/${r.projectId}`}
                  className="text-[12.5px] font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
                >
                  {r.projectName}
                </Link>
                <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                  period {r.periodNo}
                  {r.contractReference ? ` · ${r.contractReference}` : ""}
                </span>
              </div>
              <span
                className="font-mono text-[12px] tabular-nums"
                style={{ color: tone(r.kind) }}
              >
                {r.burnPercent === null ? "n/a" : `${r.burnPercent}%`}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
              {r.headline}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
