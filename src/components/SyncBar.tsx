import { SYNC_SOURCES } from "@/data/hse-data";

export function SyncBar() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] bg-[#0b0d0f] px-6 py-2 font-mono text-[11px]">
      <span className="tracking-[0.12em] text-[var(--text-faint)]">SYNC</span>
      {SYNC_SOURCES.map((item) => (
        <span
          key={item.source}
          className={`flex items-center gap-1.5 ${
            item.status === "warning"
              ? "text-[var(--warning)]"
              : item.status === "error"
              ? "text-[var(--critical)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          <span
            className="h-1.5 w-1.5"
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
