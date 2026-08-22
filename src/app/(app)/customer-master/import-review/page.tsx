import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, type Tone } from "@/components/StatusBadge";
import { Card, CardDivider, CardHeader, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import {
  getCustomerMasterImportReview,
  type ImportRecord,
  type ReviewCase,
  type ReviewCaseType,
  type ReviewFilter,
  type ReviewPriority,
  type ReviewStatus,
} from "@/lib/queries/customer-master-import-review";
import { requireProfile } from "@/utils/supabase/require-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ priority?: string; case_type?: string; status?: string; sheet?: string; case?: string }>;

const REVIEW_PRIORITIES: ReviewPriority[] = ["P0", "P1", "P2"];
const REVIEW_CASE_TYPES: ReviewCaseType[] = ["LEXWARE_REFERENCE_CONFLICT", "ALIAS_REVIEW", "PROJECT_LOCATION_CANDIDATE", "MULTI_LOCATION_CUSTOMER", "HISTORICAL_SOURCE_REVIEW", "CUSTOMER_MASTER_REVIEW"];
const REVIEW_STATUSES: ReviewStatus[] = ["OPEN", "IN_REVIEW", "RESOLVED", "DEFERRED", "REJECTED"];

function parseFilter(params: Awaited<SearchParams>): ReviewFilter {
  return {
    priority: REVIEW_PRIORITIES.includes(params.priority as ReviewPriority) ? params.priority as ReviewPriority : "all",
    caseType: REVIEW_CASE_TYPES.includes(params.case_type as ReviewCaseType) ? params.case_type as ReviewCaseType : "all",
    status: REVIEW_STATUSES.includes(params.status as ReviewStatus) ? params.status as ReviewStatus : "all",
    sheet: params.sheet?.trim() || "all",
  };
}

function hrefFor(filter: ReviewFilter, patch: Partial<ReviewFilter> & { case?: string | null } = {}) {
  const next = { ...filter, ...patch };
  const search = new URLSearchParams();
  if (next.priority !== "all") search.set("priority", next.priority);
  if (next.caseType !== "all") search.set("case_type", next.caseType);
  if (next.status !== "all") search.set("status", next.status);
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

function priorityTone(priority: ReviewPriority): Tone {
  if (priority === "P0") return "critical";
  if (priority === "P1") return "warning";
  return "info";
}

export default async function CustomerMasterImportReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const developmentAuthBypass = process.env.NODE_ENV === "development";

  /**
   * Local-only development aid: the new Supabase project currently has no
   * provisioned Auth user, so the read-only review surface must remain
   * inspectable while its UI is being built. This branch is deliberately
   * route-local and keyed only by NODE_ENV. Production always requires the
   * real Supabase session, active app_user_profile, and exec role below.
   */
  if (!developmentAuthBypass) {
    await requireProfile("/customer-master/import-review", ["exec"]);
  }
  const params = await searchParams;
  const filter = parseFilter(params);
  const data = await getCustomerMasterImportReview(filter);
  const selected = [...data.cases, ...data.documentedCases].find((reviewCase) => reviewCase.case_key === params.case) ?? null;

  const priorityLinks = [
    { href: hrefFor(filter, { priority: "all", case: null }), label: "Alle" },
    ...REVIEW_PRIORITIES.map((priority) => ({ href: hrefFor(filter, { priority, case: null }), label: priority })),
  ];
  const caseTypeLinks = [
    { href: hrefFor(filter, { caseType: "all", case: null }), label: "Alle" },
    ...REVIEW_CASE_TYPES.map((caseType) => ({ href: hrefFor(filter, { caseType, case: null }), label: caseType })),
  ];
  const statusLinks = [
    { href: hrefFor(filter, { status: "all", case: null }), label: "Alle" },
    ...REVIEW_STATUSES.map((status) => ({ href: hrefFor(filter, { status, case: null }), label: status })),
  ];

  return (
    <>
      <PageHeader
        title="Customer Master Review"
        meta="READ ONLY · FACTUAL REVIEW QUEUE"
        actions={<span className="border border-[var(--accent)] bg-[var(--accent-wash)] px-2 py-1 font-mono text-[10px] font-medium tracking-[0.08em] text-[var(--accent)]">STAGING ONLY</span>}
      />

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {developmentAuthBypass && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--warning)] bg-[var(--warning-wash)] px-4 py-2.5 text-xs text-[var(--warning)]">
            <span className="font-mono text-[10px] font-semibold tracking-[0.1em]">DEVELOPMENT MODE</span>
            <span>Auth-Bypass nur für diese lokale, read-only Review-Ansicht aktiv.</span>
          </div>
        )}
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
          <div className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-3"><span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">PRIORITY</span><Segmented options={priorityLinks} current={hrefFor(filter)} ariaLabel="Review priority" /><span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STATUS</span><Segmented options={statusLinks} current={hrefFor(filter)} ariaLabel="Review status" /></div><div className="flex items-center gap-3 overflow-x-auto pb-1"><span className="flex-none font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">CASE TYPE</span><Segmented options={caseTypeLinks} current={hrefFor(filter)} ariaLabel="Review case type" /></div></div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1"><span className="flex-none font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">SHEET</span><Link href={hrefFor(filter, { sheet: "all", case: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === "all" ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>Alle</Link>{data.sheetCounts.map((sheet) => <Link key={sheet.sheet_name} href={hrefFor(filter, { sheet: sheet.sheet_name, case: null })} scroll={false} className={`flex-none rounded-full border px-2.5 py-1 font-mono text-[10px] ${filter.sheet === sheet.sheet_name ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>{sheet.sheet_name} <span className="text-[var(--text-faint)]">{sheet.count}</span></Link>)}</div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)]">
          <Card>
            <CardHeader title="Review cases" qualifier={`${data.cases.length} CASES · ${data.cases.reduce((sum, item) => sum + item.records.length, 0)} RECORDS`} />
            <CardDivider />
            {data.cases.length === 0 ? <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Keine fachlichen Review Cases für diesen Filter.</p> : <div className="divide-y divide-[var(--divider)]"><div className="hidden grid-cols-[minmax(180px,1.1fr)_minmax(90px,0.5fr)_minmax(120px,0.8fr)_70px_minmax(120px,0.8fr)_minmax(180px,1.2fr)] gap-3 bg-[var(--surface-2)] px-4 py-2 font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)] lg:grid"><span>CASE TYPE</span><span>PRIORITÄT</span><span>RESOLUTION STATUS</span><span>RECORDS</span><span>BETROFFENE QUELLE</span><span>REVIEW REASON</span></div>{data.cases.map((reviewCase) => <CaseRow key={reviewCase.case_key} reviewCase={reviewCase} active={selected?.case_key === reviewCase.case_key} href={hrefFor(filter, { case: reviewCase.case_key })} />)}</div>}
          </Card>

          {data.documentedCases.length > 0 && <Card>
            <CardHeader title="Dokumentierte Entscheidungen" qualifier={`${data.documentedCases.length} CASES · READ ONLY`} />
            <CardDivider />
            <div className="divide-y divide-[var(--divider)]">{data.documentedCases.map((reviewCase) => <DocumentedCaseRow key={reviewCase.case_key} reviewCase={reviewCase} active={selected?.case_key === reviewCase.case_key} href={hrefFor(filter, { case: reviewCase.case_key })} />)}</div>
          </Card>}

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
  return <Link href={href} scroll={false} className={`block px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${active ? "bg-[var(--accent-wash)]" : ""} ${reviewCase.priority === "P0" ? "border-l-2 border-[var(--critical)]" : ""}`}><div className="grid gap-3 lg:grid-cols-[minmax(180px,1.1fr)_minmax(90px,0.5fr)_minmax(120px,0.8fr)_70px_minmax(120px,0.8fr)_minmax(180px,1.2fr)] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{reviewCase.title}</h3><StatusBadge status={reviewCase.case_type} tone="info" /></div><p className="mt-1 font-mono text-[10px] text-[var(--text-faint)]">CASE {reviewCase.case_key}</p></div><div><span className="mr-2 font-mono text-[9px] text-[var(--text-faint)] lg:hidden">PRIORITÄT</span><StatusBadge status={reviewCase.priority} tone={priorityTone(reviewCase.priority)} /></div><div><span className="mr-2 font-mono text-[9px] text-[var(--text-faint)] lg:hidden">STATUS</span><StatusBadge status={reviewCase.status} tone={reviewCase.status === "RESOLVED" ? "positive" : reviewCase.status === "OPEN" ? "critical" : "warning"} /></div><div className="font-mono text-xs text-[var(--text-primary)]"><span className="mr-2 text-[9px] text-[var(--text-faint)] lg:hidden">RECORDS</span>{reviewCase.records.length}</div><div className="min-w-0 truncate font-mono text-[10px] text-[var(--text-muted)]"><span className="mr-2 text-[9px] text-[var(--text-faint)] lg:hidden">QUELLE</span>{reviewCase.location_source ?? reviewCase.sheet_names.join(" · ")}</div><div className="min-w-0 text-xs text-[var(--text-secondary)]"><span className="mr-2 font-mono text-[9px] text-[var(--text-faint)] lg:hidden">REASON</span>{reviewCase.review_reason}{reviewCase.location_source && <span className="mt-1 block font-mono text-[10px] text-[var(--text-muted)]">{reviewCase.customer_name ?? "Kunde"} · {reviewCase.location_address ?? "Adresse offen"} · {reviewCase.project_count} Projekte</span>}</div></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--text-muted)]"><span>{reviewCase.review_statuses.join(" · ")}</span><span>{reviewCase.resolution_statuses.join(" · ")}</span></div></Link>;
}

function DocumentedCaseRow({ reviewCase, active, href }: { reviewCase: ReviewCase; active: boolean; href: string }) {
  return <Link href={href} scroll={false} className={`block border-l-2 border-[var(--good)] px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${active ? "bg-[var(--accent-wash)]" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{reviewCase.case_name}</h3><StatusBadge status="DOCUMENTED" tone="positive" /><StatusBadge status={reviewCase.case_type} tone="neutral" /></div><p className="mt-1 font-mono text-[10px] text-[var(--text-faint)]">{reviewCase.records.length} RECORDS · {reviewCase.sheet_names.join(" · ")}</p></div><span className="font-mono text-[10px] text-[var(--good)]">RESOLVED / DOKUMENTIERT</span></div><p className="mt-2 text-xs text-[var(--text-secondary)]">{reviewCase.resolution_note}</p></Link>;
}

function CaseDetail({ reviewCase }: { reviewCase: ReviewCase }) {
  return <div className="flex flex-col gap-4 p-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-[var(--text-primary)]">{reviewCase.title}</h3><StatusBadge status={reviewCase.status} tone={reviewCase.status === "RESOLVED" ? "positive" : reviewCase.status === "OPEN" ? "critical" : "warning"} /></div><p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{reviewCase.case_type} · {reviewCase.records.length} BETROFFENE RECORDS</p></div><p className="border-l-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-secondary)]">{reviewCase.description}</p><div className="grid grid-cols-2 gap-3 text-xs"><Detail label="PRIORITÄT" value={reviewCase.priority} /><Detail label="STATUS" value={reviewCase.status} /><Detail label="SOURCE RECORDS" value={String(reviewCase.source_records.length)} /><Detail label="REVIEW REASON" value={reviewCase.review_reason} /><Detail label="BETROFFENE QUELLE" value={reviewCase.location_source ?? reviewCase.sheet_names.join(" · ")} /><Detail label="CASE KEY" value={reviewCase.case_key} mono />{reviewCase.location_source && <><Detail label="KUNDE" value={reviewCase.customer_name ?? "—"} /><Detail label="STANDORTADRESSE" value={reviewCase.location_address ?? "—"} /><Detail label="PROJEKTBEZUG" value={reviewCase.project_references.join(" · ") || "—"} /><Detail label="PROJEKTE JE STANDORT" value={String(reviewCase.project_count)} /></>}</div><div className="flex flex-col gap-3">{reviewCase.records.map((record) => <RecordPayload key={record.id} record={record} />)}</div></div>;
}

function RecordPayload({ record }: { record: ImportRecord }) {
  return <details open className="border border-[var(--border)] bg-[var(--surface-2)]"><summary className="cursor-pointer list-none px-3 py-2 text-xs text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><span className="font-mono text-[10px] text-[var(--accent)]">{recordSheet(record)} · Excel-Zeile {display(record.raw_payload.excel_row_number ?? record.row_number)}</span><span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">{display(record.source_customer_number ?? record.source_external_id)}</span></summary><div className="border-t border-[var(--divider)] p-3">{record.review_reason && <p className="mb-3 border-l-2 border-[var(--warning)] bg-[var(--warning-wash)] px-3 py-2 text-xs text-[var(--warning)]">{record.review_reason}</p>}<pre className="max-h-[420px] overflow-auto font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{JSON.stringify(record.raw_payload, null, 2)}</pre></div></details>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">{label}</div><div className={`mt-1 truncate text-[var(--text-secondary)] ${mono ? "font-mono text-[10px]" : ""}`}>{value}</div></div>;
}
