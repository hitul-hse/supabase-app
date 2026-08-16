import type { OrgChartNode } from "@/lib/queries/types";

function buildTree(nodes: OrgChartNode[]) {
  const byManager = new Map<string | null, OrgChartNode[]>();
  for (const node of nodes) {
    const key = node.managerId;
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key)!.push(node);
  }
  return byManager;
}

function OrgChartBranch({
  node,
  byManager,
  depth,
}: {
  node: OrgChartNode;
  byManager: Map<string | null, OrgChartNode[]>;
  depth: number;
}) {
  const reports = byManager.get(node.id) ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-3 border border-[var(--border)] bg-[var(--surface)] p-3"
        style={{ marginLeft: depth * 28 }}
      >
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] font-mono text-[11px] text-[var(--text-secondary)]">
          {node.name
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="flex flex-col">
          <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{node.name}</span>
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
            {node.role ?? "—"} {node.department ? `· ${node.department}` : ""}
          </span>
        </div>
        {reports.length > 0 && (
          <span className="ml-auto font-mono text-[10px] text-[var(--text-faint)]">
            {reports.length} DIRECT REPORT{reports.length === 1 ? "" : "S"}
          </span>
        )}
      </div>
      {reports.map((child) => (
        <OrgChartBranch key={child.id} node={child} byManager={byManager} depth={depth + 1} />
      ))}
    </div>
  );
}

export function OrgChartView({ nodes }: { nodes: OrgChartNode[] }) {
  const byManager = buildTree(nodes);
  const roots = byManager.get(null) ?? [];

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-6">
      {roots.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">No reporting-line data yet.</p>
      ) : (
        roots.map((root) => (
          <OrgChartBranch key={root.id} node={root} byManager={byManager} depth={0} />
        ))
      )}
    </div>
  );
}
