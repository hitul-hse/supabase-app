import Link from "next/link";

import { Card, CardDivider, CardHeader, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { StatusBadge, type Tone } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import {
  getCustomerMasterImportReview,
  type ImportRecord,
  type ReviewFilter,
} from "@/lib/queries/customer-master-import-review";
import { requireProfile } from "@/utils/supabase/require-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  status?: string;
  resolution?: string;
  sheet?: string;
  record?: string;
}>;

function parseFilter(params: Awaited<SearchParams>): ReviewFilter {
  return {
    status: params.status === "review_required" ? "review_required" : "all",
    resolution: params.resolution === "unresolved" ? "unresolved" : "all",
    sheet: params.sheet?.trim() || "all",
  };
}

function hrefFor(
  filter: ReviewFilter,
  patch: Partial<ReviewFilter> & { record?: string | null } = {},
) {
  const next = { ...filter, ...patch };
  const search = new URLSearchParams();
  if (next.status !== "all") search.set("status", next.status);
  if (next.resolution !== "all") search.set("resolution", next.resolution);
  if (next.sheet !== "all") search.set("sheet", next.sheet);
  if ("record" in patch && patch.record) search.set("record", patch.record);
  const query = search.toString();
  return `/customer-master/import-review${query ? `?${query}` : ""}`;
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function recordSheet(record: ImportRecord) {
  return display(record.raw_payload.sheet_name);
}

function rawPreview(record: ImportRecord) {
  const values = record.raw_payload.values;
  if (!values || typeof values !== "object") return JSON.stringify(record.raw_payload);
  const source = values as Record<string, unknown>;
  const candidate = [
    source.canonical_name,
    source.alias,
    source.location_name,
    source.issue,
    source.name,
  ].find((value) => value !== null && value !== undefined && value !== "");
  return display(candidate ?? JSON.stringify(values));
}

function statusTone(status: string, fallback: Tone = "neutral"): Tone {
  if (["approved", "confirmed", "ok"].includes(status.toLowerCase())) return "positive";
  if (["unresolved", "rejected"].includes(status.toLowerCase())) return "critical";
  if (["review_required", "pending", "in_review"].includes(status.toLowerCase())) return "warning";
  return fallback;
}

export default async function CustomerMasterImportReviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireProfile("/customer-master/import-review", ["exec"]);
  const params = await searchParams;
  const filter = parseFilter(params);
  const data = await getCustomerMasterImportReview(filter);
  const selected = data.records.find((record) => record.id === params.record) ?? null;

  const statusLinks = [
    { href: hrefFor(filter, { status: "all", record: null }), label: "Alle" },
    {
      href: hrefFor(filter, { status: "review_required", record: null }),
      label: "Review required",
    },
  ];
  const resolutionLinks = [
    { href: hrefFor(filter, { resolution: "all", record: null }), label: "Alle" },
    { href: hrefFor(filter, { resolution: "unresolved", record: null }), label: "Unresolved" },
  ];

  return (
    <>
      <PageHeader
        title="Customer Master Review"
        meta="READ ONLY · STG IMPORT QUEUE"
        actions={
          <span className="border border-[var(--accent)] bg-[var(--accent-wash)] px-2 py-1 font-mono text-[10px] font-medium tracking-[0.08em] text-[var(--accent)]">
            STAGING ONLY
          </span>
        }
      />

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {data.error && (
          <div role="alert" className="border border-[var(--critical)] bg-[var(--critical-wash)] px-4 py-3 text-sm text-[var(--critical)]">
            {data.error}
          </div>
        )}

        <Card tone="hero">
          <CardHeader title="Latest import" qualifier="STG.IMPORT_BATCH" />
          <CardDivider />
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(120px,1fr))]">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[var(--text-primary)]">
                {display(data.batch?.file_name)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                BATCH {display(data.batch?.id)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={display(data.batch?.status)} tone={statusTone(display(data.batch?.status), "info")} />
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {display(data.batch?.source_system)} · {display(data.batch?.entity_type)}
                </span>
              </div>
            </div>
            <StatTile label="RECORDS" value={data.metrics.record_count} />
            <StatTile label="REVIEW REQUIRED" value={data.metrics.review_required_count} tone="warning" />
            <StatTile label="UNRESOLVED" value={data.metrics.unresolved_count} tone="critical" />
            <StatTile label="ERRORS" value={data.batch?.error_count ?? 0} tone={data.batch?.error_count ? "critical" : "neutral"} />
          </div>
        </Card>

        <div className="flex flex-col gap-2 border-y border-[var(--border)] py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STATUS</span>
            <Segmented options={statusLinks} current={hrefFor(filter)} ariaLabel="Review status" />
            <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">RESOLUTION</span>
            <Segmented options={resolutionLinks} current={hrefFor(filter)} ariaLabel="Resolution status" />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="flex-none font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">SHEET</span>
            <Link href={hrefFor(filter, { sheet: "all", record: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === "all" ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>Alle</Link>
            {data.sheetCounts.map((sheet) => (
              <Link key={sheet.sheet_name} href={hrefFor(filter, { sheet: sheet.sheet_name, record: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === sheet.sheet_name ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                {sheet.sheet_name} <span className="text-[var(--text-faint)]">{sheet.count}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <Card>
            <CardHeader title="Review queue" qualifier={`${data.records.length} VISIBLE RECORDS`} />
            <CardDivider />
            {data.records.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Keine Staging-Records für diesen Filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className="grid grid-cols-[1.1fr_72px_1.2fr_1fr_112px_100px_1.5fr] gap-3 border-b border-[var(--divider)] px-4 py-2 font-mono text-[10px] tracking-[0.06em] text-[var(--text-faint)]">
                    <span>SHEET</span><span>ROW</span><span>EXTERNAL ID</span><span>CUSTOMER NO.</span><span>REVIEW</span><span>RESOLUTION</span><span>RAW PREVIEW</span>
                  </div>
                  {data.records.map((record) => {
                    const active = selected?.id === record.id;
                    return (
                      <Link key={record.id} href={hrefFor(filter, { record: record.id })} scroll={false} className={`grid grid-cols-[1.1fr_72px_1.2fr_1fr_112px_100px_1.5fr] gap-3 border-b border-[var(--divider)] px-4 py-3 text-xs transition-colors last:border-b-0 hover:bg-[var(--surface-hover)] ${active ? "bg-[var(--accent-wash)]" : ""}`}>
                        <span className="truncate text-[var(--text-secondary)]">{recordSheet(record)}</span>
                        <span className="font-mono text-[var(--text-muted)]">{record.raw_payload.excel_row_number ? display(record.raw_payload.excel_row_number) : record.row_number}</span>
                        <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">{display(record.source_external_id)}</span>
                        <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">{display(record.source_customer_number)}</span>
                        <StatusBadge status={display(record.review_status)} tone={statusTone(record.review_status, "warning")} />
                        <StatusBadge status={display(record.resolution_status)} tone={statusTone(record.resolution_status)} />
                        <span className="truncate text-[var(--text-secondary)]">{rawPreview(record)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          <Card className="lg:sticky lg:top-4">
            <CardHeader title="Record detail" qualifier="FULL RAW PAYLOAD" />
            <CardDivider />
            {selected ? <RecordDetail record={selected} /> : <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Wähle einen Record aus der Queue, um die vollständige Payload zu prüfen.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

function RecordDetail({ record }: { record: ImportRecord }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Detail label="SHEET" value={recordSheet(record)} />
        <Detail label="EXCEL ROW" value={display(record.raw_payload.excel_row_number ?? record.row_number)} />
        <Detail label="EXTERNAL ID" value={display(record.source_external_id)} mono />
        <Detail label="CUSTOMER NO." value={display(record.source_customer_number)} mono />
        <Detail label="REVIEW" value={record.review_status} badge />
        <Detail label="RESOLUTION" value={record.resolution_status} badge />
      </div>
      {record.review_reason && (
        <div className="border-l-2 border-[var(--warning)] bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">
          <span className="font-mono text-[10px] tracking-[0.06em]">REVIEW REASON</span>
          <p className="mt-1">{record.review_reason}</p>
        </div>
      )}
      <pre className="max-h-[560px] overflow-auto border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
        {JSON.stringify(record.raw_payload, null, 2)}
      </pre>
    </div>
  );
}

function Detail({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">{label}</div>
      {badge ? <StatusBadge status={value} tone={statusTone(value)} className="mt-1" /> : <div className={`mt-1 truncate text-[var(--text-secondary)] ${mono ? "font-mono text-[10px]" : ""}`}>{value}</div>}
    </div>
  );
}
