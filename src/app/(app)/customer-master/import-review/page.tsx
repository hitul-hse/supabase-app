import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, type Tone } from "@/components/StatusBadge";
import { Card, CardDivider, CardHeader, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import {
  getCustomerMasterImportReview,
  type ImportRecord,
  type ReviewCase,
  type ReviewFilter,
} from "@/lib/queries/customer-master-import-review";
import { requireProfile } from "@/utils/supabase/require-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ status?: string; resolution?: string; sheet?: string; case?: string }>;

function parseFilter(params: Awaited<SearchParams>): ReviewFilter {
  return {
    status: params.status === "review_required" ? "review_required" : "all",
    resolution: params.resolution === "unresolved" ? "unresolved" : "all",
    sheet: params.sheet?.trim() || "all",
  };
}

function hrefFor(filter: ReviewFilter, patch: Partial<ReviewFilter> & { case?: string | null } = {}) {
  const next = { ...filter, ...patch };
  const search = new URLSearchParams();
  if (next.status !== "all") search.set("status", next.status);
  if (next.resolution !== "all") search.set("resolution", next.resolution);
  if (next.sheet !== "all") search.set("sheet", next.sheet);
  if ("case" in patch && patch.case) search.set("case", patch.case);
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

function statusTone(status: string, fallback: Tone = "neutral"): Tone {
  const normalized = status.toLowerCase();
  if (["approved", "confirmed", "ok"].includes(normalized)) return "positive";
  if (["unresolved", "rejected"].includes(normalized)) return "critical";
  if (["review_required", "pending", "in_review"].includes(normalized)) return "warning";
  return fallback;
}

function caseStatus(reviewCase: ReviewCase) {
  if (reviewCase.resolution_statuses.includes("unresolved")) return { label: "unresolved", tone: "critical" as Tone };
  if (reviewCase.review_statuses.includes("review_required")) return { label: "review_required", tone: "warning" as Tone };
  if (reviewCase.review_statuses.every((status) => status === "approved")) return { label: "approved", tone: "positive" as Tone };
  return { label: reviewCase.review_statuses[0] ?? "unreviewed", tone: "neutral" as Tone };
}

export default async function CustomerMasterImportReviewPage({ searchParams }: { searchParams: SearchParams }) {
  await requireProfile("/customer-master/import-review", ["exec"]);
  const params = await searchParams;
  const filter = parseFilter(params);
  const data = await getCustomerMasterImportReview(filter);
  const selected = data.cases.find((reviewCase) => reviewCase.case_key === params.case) ?? null;

  const statusLinks = [
    { href: hrefFor(filter, { status: "all", case: null }), label: "Alle" },
    { href: hrefFor(filter, { status: "review_required", case: null }), label: "Review required" },
  ];
  const resolutionLinks = [
    { href: hrefFor(filter, { resolution: "all", case: null }), label: "Alle" },
    { href: hrefFor(filter, { resolution: "unresolved", case: null }), label: "Unresolved" },
  ];

  return (
    <>
      <PageHeader
        title="Customer Master Review"
        meta="READ ONLY · FACTUAL REVIEW QUEUE"
        actions={<span className="border border-[var(--accent)] bg-[var(--accent-wash)] px-2 py-1 font-mono text-[10px] font-medium tracking-[0.08em] text-[var(--accent)]">STAGING ONLY</span>}
      />

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {data.error && <div role="alert" className="border border-[var(--critical)] bg-[var(--critical-wash)] px-4 py-3 text-sm text-[var(--critical)]">{data.error}</div>}

        <Card tone="hero">
          <CardHeader title="Import overview" qualifier="STG.IMPORT_BATCH · READ ONLY" />
          <CardDivider />
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(120px,1fr))]">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[var(--text-primary)]">{display(data.batch?.file_name)}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">BATCH {display(data.batch?.id)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={display(data.batch?.status)} tone={statusTone(display(data.batch?.status), "info")} /><span className="font-mono text-[10px] text-[var(--text-faint)]">{display(data.batch?.source_system)} · {display(data.batch?.entity_type)}</span></div>
            </div>
            <StatTile label="IMPORT RECORDS" value={data.metrics.record_count} />
            <StatTile label="REVIEW REQUIRED" value={data.metrics.review_required_count} tone="warning" />
            <StatTile label="UNRESOLVED" value={data.metrics.unresolved_count} tone="critical" />
            <StatTile label="APPROVED" value={data.metrics.approved_count} tone="good" />
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <Card>
            <CardHeader title="Records by sheet" qualifier="ALL RECORDS IN LATEST BATCH" />
            <CardDivider />
            <div className="grid grid-cols-2 gap-px bg-[var(--divider)] sm:grid-cols-4">
              {data.sheetCounts.map((sheet) => <Link key={sheet.sheet_name} href={hrefFor(filter, { sheet: sheet.sheet_name, case: null })} scroll={false} className="bg-[var(--surface)] p-3 hover:bg-[var(--surface-hover)]"><span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">{sheet.sheet_name}</span><span className="mt-1 block font-mono text-xl font-semibold text-[var(--text-primary)]">{sheet.count}</span></Link>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Case types" qualifier="DERIVED READ MODEL" />
            <CardDivider />
            <div className="flex flex-col divide-y divide-[var(--divider)]">
              {data.caseTypeCounts.map((item) => <div key={item.case_type} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"><span className="text-[var(--text-secondary)]">{item.case_type}</span><span className="font-mono text-[var(--text-primary)]">{item.count}</span></div>)}
              {data.caseTypeCounts.length === 0 && <p className="px-4 py-6 text-sm text-[var(--text-muted)]">Noch keine Review Cases vorhanden.</p>}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-2 border-y border-[var(--border)] py-3">
          <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STATUS</span><Segmented options={statusLinks} current={hrefFor(filter)} ariaLabel="Review status" /><span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">RESOLUTION</span><Segmented options={resolutionLinks} current={hrefFor(filter)} ariaLabel="Resolution status" /></div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1"><span className="flex-none font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">SHEET</span><Link href={hrefFor(filter, { sheet: "all", case: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === "all" ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>Alle</Link>{data.sheetCounts.map((sheet) => <Link key={sheet.sheet_name} href={hrefFor(filter, { sheet: sheet.sheet_name, case: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === sheet.sheet_name ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>{sheet.sheet_name} <span className="text-[var(--text-faint)]">{sheet.count}</span></Link>)}</div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)]">
          <Card>
            <CardHeader title="Review cases" qualifier={`${data.cases.length} CASES · ${data.cases.reduce((sum, item) => sum + item.records.length, 0)} RECORDS`} />
            <CardDivider />
            {data.cases.length === 0 ? <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Keine fachlichen Review Cases für diesen Filter.</p> : <div className="divide-y divide-[var(--divider)]">{data.cases.map((reviewCase) => <CaseRow key={reviewCase.case_key} reviewCase={reviewCase} active={selected?.case_key === reviewCase.case_key} href={hrefFor(filter, { case: reviewCase.case_key })} />)}</div>}
          </Card>

          <Card className="lg:sticky lg:top-4">
            <CardHeader title="Case detail" qualifier="ORIGINAL PAYLOADS · READ ONLY" />
            <CardDivider />
            {selected ? <CaseDetail reviewCase={selected} /> : <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Wähle einen Case aus der Queue, um die betroffenen Original-Records zu prüfen.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

function CaseRow({ reviewCase, active, href }: { reviewCase: ReviewCase; active: boolean; href: string }) {
  const status = caseStatus(reviewCase);
  return <Link href={href} scroll={false} className={`block px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${active ? "bg-[var(--accent-wash)]" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{reviewCase.case_name}</h3><StatusBadge status={reviewCase.case_type} tone={reviewCase.case_type === "Customer Master Review" ? "neutral" : "info"} /></div><p className="mt-1 font-mono text-[10px] text-[var(--text-faint)]">CASE {reviewCase.case_key}</p></div><StatusBadge status={status.label} tone={status.tone} /></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] text-[var(--text-muted)]"><span>{reviewCase.records.length} RECORDS</span><span>{reviewCase.sheet_names.join(" · ")}</span><span>{reviewCase.review_statuses.join(" · ")}</span><span>{reviewCase.resolution_statuses.join(" · ")}</span></div></Link>;
}

function CaseDetail({ reviewCase }: { reviewCase: ReviewCase }) {
  return <div className="flex flex-col gap-4 p-4"><div><h3 className="text-base font-semibold text-[var(--text-primary)]">{reviewCase.case_name}</h3><p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{reviewCase.case_type} · {reviewCase.records.length} BETROFFENE RECORDS</p></div><div className="grid grid-cols-2 gap-3 text-xs"><Detail label="REVIEW STATUS" value={reviewCase.review_statuses.join(" · ")} /><Detail label="RESOLUTION" value={reviewCase.resolution_statuses.join(" · ")} /><Detail label="SHEETS" value={reviewCase.sheet_names.join(" · ")} /><Detail label="CASE KEY" value={reviewCase.case_key} mono /></div><div className="flex flex-col gap-3">{reviewCase.records.map((record) => <RecordPayload key={record.id} record={record} />)}</div></div>;
}

function RecordPayload({ record }: { record: ImportRecord }) {
  return <details open className="border border-[var(--border)] bg-[var(--surface-2)]"><summary className="cursor-pointer list-none px-3 py-2 text-xs text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><span className="font-mono text-[10px] text-[var(--accent)]">{recordSheet(record)} · Excel-Zeile {display(record.raw_payload.excel_row_number ?? record.row_number)}</span><span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">{display(record.source_customer_number ?? record.source_external_id)}</span></summary><div className="border-t border-[var(--divider)] p-3">{record.review_reason && <p className="mb-3 border-l-2 border-[var(--warning)] bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">{record.review_reason}</p>}<pre className="max-h-[420px] overflow-auto font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{JSON.stringify(record.raw_payload, null, 2)}</pre></div></details>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">{label}</div><div className={`mt-1 truncate text-[var(--text-secondary)] ${mono ? "font-mono text-[10px]" : ""}`}>{value}</div></div>;
}
