import { createClient } from "@/utils/supabase/server";
import { getSyncSources } from "@/lib/queries/hse";

/**
 * SyncBar — shows freshness of each external data source.
 * On mobile: horizontally scrollable single row to save vertical space.
 * On desktop: wraps naturally.
 */
export async function SyncBar() {
  const supabase = await createClient();
  const sources = await getSyncSources(supabase);

  return (
    <div data-tour="tour-sync" className="flex items-center gap-4 overflow-x-auto border-b border-[var(--border)] bg-[#0b0d0f] px-4 py-2 font-mono text-[11px] sm:px-6 [&::-webkit-scrollbar]:hidden">
      <span className="flex-none tracking-[0.12em] text-[var(--text-faint)]">SYNC</span>
      {sources.map((item) => (
        <span
          key={item.source}
          className={`flex flex-none items-center gap-1.5 ${
            item.status === "warning"
              ? "text-[var(--warning)]"
              : item.status === "error"
              ? "text-[var(--critical)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          <span
            className="h-1.5 w-1.5 flex-none"
            style={{
              background:
                item.status === "warning"
                  ? "var(--warning)"
                  : item.status === "error"
                  ? "var(--critical)"
                  : "var(--accent)",
            }}
          />
          {item.source} {item.freshness}
        </span>
      ))}
    </div>
  );
}
