"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { NumberedPager } from "@/components/NumberedPager";
import { pageFromParams, pageToParam, useUrlState } from "@/components/url-state";
import type { BrokenCoverProject, BrokenCoverSummary } from "@/lib/queries/broken-cover";
import { ReassignmentPicker } from "./ReassignmentPicker";

/*
 * The cover-repair worklist.
 *
 * WHO IT IS FOR
 * -------------
 * Björn owns replacement planning. The request was literally "Björn should
 * provide the replacements", so this is built as HIS worklist rather than
 * another read-only finding buried in a data-quality panel: every row carries
 * the reassignment picker, so seeing a broken arrangement and fixing it are the
 * same motion. A finding you cannot act on from where you see it gets a nod and
 * no action.
 *
 * WHY IT LEADS WITH MUTUAL PAIRS
 * ------------------------------
 * Self-cover (65 rows, mostly a workbook artefact) is data hygiene: wrong, but
 * it fails one project at a time. A mutual pair fails as a UNIT: Thorsten and
 * Stephan are each other's cover on 8 projects and were simultaneously on
 * approved sick leave when this was found, which left 8 projects displaying "has
 * a named cover" while nobody behind the name was available. Blast radius
 * before hygiene.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * No row says anyone is absent today. There is no absence feed yet, and
 * pretending otherwise would dress a guess as a fact. The claim is structural
 * and survivable-by-nobody: these arrangements cannot do their job on the day
 * they are needed, whoever happens to be off.
 *
 * WHY THE LIST IS PAGED (2026-09-10)
 * ----------------------------------
 * It was not, and nothing capped it. The comment above was written when the
 * mutual list was 40 rows; on production it is 121, each row carrying a picker,
 * and the tab measured 8,144px -- 9.05 screens against a 3-screen house ceiling,
 * and 15.24 screens on a phone. check-table-scroll-budget.mjs caught it only by
 * DOCUMENT HEIGHT: its row-count assertion looks at `<tbody> <tr>`, and this is
 * a <ul>, so the one gate that could see it saw it as pixels rather than as the
 * unbounded list it is.
 *
 * This IS a queue worked item by item -- every row carries the reassignment
 * picker -- so UI-CONVENTIONS rule 1 sets the page at 10, rule 2 puts the page
 * in the URL (`?cover=`, `?coverSelf=`, mirrored without a server round-trip),
 * rule 3 uses the house NumberedPager, and rule 6 makes the count line say
 * "1-10 OF 121" so a bounded list is not misread as the whole list. Rule 5 needs
 * nothing here: broken-cover.ts already sorts worst-first, by how many projects
 * fail together.
 */

/** UI-CONVENTIONS rule 1: a queue handled item by item pages at 10. */
const PAGE_SIZE = 10;

const kindKey: Record<BrokenCoverProject["kind"], "kinds.mutual" | "kinds.self"> = {
  mutual: "kinds.mutual",
  self: "kinds.self",
};

export function BrokenCoverPanel({ summary }: { summary: BrokenCoverSummary }) {
  const t = useTranslations("management.brokenCover");
  const [showSelf, setShowSelf] = useState(false);

  const mutual = summary.projects.filter((p) => p.kind === "mutual");
  const self = summary.projects.filter((p) => p.kind === "self");

  if (!summary.projects.length) {
    return (
      <Card>
        <p className="text-sm text-[var(--text-secondary)]">
          {t("empty")}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            {t("title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t("summary", {
              mutual: summary.mutualCoverCount,
              self: summary.selfCoverCount,
              people: summary.peopleAffected.join(", "),
            })}
          </p>
        </div>

        {/* Mutual pairs: the urgent list, grouped so the pair reads as a unit. */}
        <PagedCoverList rows={mutual} urlKey="cover" />

        {/*
          Self-cover is collapsed by default: 65 rows of the same workbook
          artefact would bury the 40 that fail in pairs. The count in the toggle
          keeps it honest — collapsed is not hidden.
        */}
        <button
          type="button"
          className="self-start text-xs text-[var(--text-secondary)] underline decoration-dotted underline-offset-2"
          onClick={() => setShowSelf((v) => !v)}
        >
          {showSelf ? t("collapseSelf") : t("showSelf", { count: self.length })}
        </button>
        {/*
          Paged on its own key. Opening this list used to append every self-cover
          row to a document that was already nine screens tall; now it appends
          ten, and says how many it is standing in for.
        */}
        {showSelf && <PagedCoverList rows={self} urlKey="coverSelf" />}
      </div>
    </Card>
  );
}

/**
 * Ten rows of the worklist, the house pager, and a count line that says what the
 * ten are ten OF.
 *
 * The page index is mirrored into the URL rather than kept in useState alone
 * (UI-CONVENTIONS rule 2) through `useUrlState`, which writes it with the native
 * History API and costs no server round-trip -- the rows are already in the
 * browser, and this is a pure re-projection of them. The tab lives in the same
 * query string (`?tab=risks`), so a link to page 4 of the cover queue still
 * lands on the tab it was read from.
 *
 * A stale link to a page that no longer exists CLAMPS to the last page rather
 * than rendering an empty list (rule 2 again): rows get repaired, so `?cover=13`
 * stops being a real page as soon as the queue is worked down.
 */
function PagedCoverList({ rows, urlKey }: { rows: BrokenCoverProject[]; urlKey: "cover" | "coverSelf" }) {
  const t = useTranslations("management.brokenCover");
  const tpager = useTranslations("pager");
  const [page, setPage] = useUrlState<number>(
    (params) => pageFromParams(params, urlKey),
    (next) => ({ [urlKey]: pageToParam(next) }),
    { mode: "push" },
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  // Upper-cased at the call site, as every other NumberedPager count line does:
  // the label style is the pager's, not the catalogue's.
  const noun = t("pagerNoun").toUpperCase();

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col gap-1.5">
        {shown.map((p) => (
          <BrokenCoverRow key={p.projectId} project={p} />
        ))}
      </ul>
      <NumberedPager
        page={current + 1}
        pageCount={pageCount}
        countLine={
          <span>
            {tpager("range", { from: start + 1, to: start + shown.length, count: rows.length, noun })}
            {pageCount > 1 ? ` · ${tpager("pageOf", { page: current + 1, pages: pageCount })}` : ""}
          </span>
        }
        navLabel={t("pagerNav")}
        labels={{
          prev: tpager("prev"),
          next: tpager("next"),
          pageLabel: (n) => tpager("goToPage", { page: n }),
        }}
        onSelect={(n) => setPage(n - 1)}
        className="mt-3"
      />
    </div>
  );
}

function BrokenCoverRow({ project }: { project: BrokenCoverProject }) {
  const t = useTranslations("management.brokenCover");
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-primary)]">{project.projectId}</span>
          <span
            className={`rounded-full bg-[var(--surface)] px-1.5 py-px font-mono text-[9px] tracking-[0.08em] ${
              project.kind === "mutual" ? "text-[var(--warning,#d99b3d)]" : "text-[var(--text-secondary)]"
            }`}
          >
            {t(kindKey[project.kind])}
          </span>
          {project.kind === "mutual" && project.pairSize > 1 && (
            <span
              className="font-mono text-[9px] text-[var(--text-muted)]"
              title={t("pairTitle")}
            >
              {t("pairSize", { count: project.pairSize })}
            </span>
          )}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          {t("cover", { responsible: project.responsibleName, replacement: project.replacementName })}
          {project.kind === "self" && t("samePerson")}
        </span>
      </div>

      {/*
        The picker needs the portfolio project shape; contractHours: null is the
        honest value here because this panel deliberately does not re-derive
        hours — the picker itself shows capacity per candidate, which is the
        number the decision actually needs.
      */}
      <ReassignmentPicker
        project={{
          projectId: project.projectId,
          project: project.orderNo ?? project.projectId,
          responsiblePersonId: project.responsiblePersonId,
          service: "",
          contractHours: null,
          status: null,
          responsible: [project.responsibleName],
          links: { asana: null, chat: null, trackingTime: null, drive: null, microsoftTeams: null },
        }}
      />
    </li>
  );
}
