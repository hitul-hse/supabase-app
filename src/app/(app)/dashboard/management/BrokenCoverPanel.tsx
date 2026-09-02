"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
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
 */

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
        <ul className="flex flex-col gap-1.5">
          {mutual.map((p) => (
            <BrokenCoverRow key={p.projectId} project={p} />
          ))}
        </ul>

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
        {showSelf && (
          <ul className="flex flex-col gap-1.5">
            {self.map((p) => (
              <BrokenCoverRow key={p.projectId} project={p} />
            ))}
          </ul>
        )}
      </div>
    </Card>
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
