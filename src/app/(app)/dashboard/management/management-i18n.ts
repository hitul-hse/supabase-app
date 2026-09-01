import type { UtilisationStatus } from "@/lib/queries/management-contract-hours";

/**
 * Render-site map from the query modules' German values to catalogue keys.
 *
 * The query modules (src/lib/queries/management-*.ts) keep producing German:
 * their status and rating values are compared in code (`row.status ===
 * "Kapazitätsrisiko"`), pinned by gates, and were the canonical German before
 * the catalogue existed. So the INTERNAL value never changes — translation
 * happens at the last moment, where the value meets the screen.
 *
 * Every entry maps a German string that a module emits to a key under the
 * `management` namespace. An unmapped string renders verbatim, which is the
 * safe failure: untranslated German, never a broken label. The i18n gate
 * (scripts/check-i18n-management.mjs) pins each German string here against the
 * module that emits it, so a rewording in the query fails loudly instead of
 * silently leaving the English side stale.
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export const STATUS_KEY: Record<UtilisationStatus, string> = {
  Unterauslastung: "status.underutilised",
  "Gesunde Auslastung": "status.healthy",
  Kapazitätsrisiko: "status.capacityRisk",
};

export const TEXT_KEY: Record<string, string> = {
  ...STATUS_KEY,
  // ratings (management-data-quality.ts, management-project-risks.ts)
  Kritisch: "rating.critical",
  Prüfen: "rating.review",
  // sentinel values (management-customer-portfolio.ts, management-project-risks.ts)
  "Nicht zugeordnet": "values.notAssigned",
  "Nicht aufgelöst": "values.notResolved",
  // risk names (management-project-risks.ts, management-customer-portfolio.ts)
  "Vertragsstunden ueberschritten": "riskNames.budgetOverrun",
  "Projekt ohne Verantwortlichen": "riskNames.projectWithoutOwner",
  "Projekt ohne Status": "riskNames.projectWithoutStatus",
  "Projekt ohne Customer Mapping": "riskNames.projectWithoutCustomerMapping",
  "Projekt ohne Service Mapping": "riskNames.projectWithoutServiceMapping",
  "Hohe Personenabhängigkeit": "riskNames.highDependencyPerson",
  "Replacement-Risiko": "riskNames.replacementRisk",
  "Mehrfach-Service-Zuordnung: Stunden nicht eindeutig verteilbar": "riskNames.multiServiceHours",
  "Vertragsstunden unvollständig": "riskNames.contractHoursIncomplete",
  // data-quality checks (management-data-quality.ts)
  "Offene Projekte ohne Verantwortlichen": "dataQuality.checks.openWithoutOwner",
  "Offene Projekte ohne Replacement": "dataQuality.checks.openWithoutReplacement",
  "Offene Projekte ohne Order Number": "dataQuality.checks.openWithoutOrderNumber",
  "Offene Projekte ohne Customer Mapping": "dataQuality.checks.openWithoutCustomerMapping",
  "Projekte ohne Contract Status": "dataQuality.checks.withoutContractStatus",
  "Projekte ohne Service Mapping": "dataQuality.checks.withoutServiceMapping",
  "Projekte ohne eindeutige Projektzuordnung": "dataQuality.checks.withoutProjectLink",
  // explanations — both the live and the fallback wording of each row
  "Gebuchte Stunden liegen ueber den vertraglich vereinbarten Stunden. Budget nachverhandeln, Vertrag verlaengern oder Leistung stoppen.": "meanings.budgetOverrunLive",
  "Gebuchte Stunden konnten nicht gegen Vertragsstunden geprueft werden.": "meanings.budgetOverrunFallback",
  "Offenes Projekt ohne owner_person_id kann operativ nicht eindeutig gesteuert werden.": "meanings.withoutOwnerLive",
  "Offene Projekte können ohne Owner nicht eindeutig gesteuert werden.": "meanings.withoutOwnerFallback",
  "Fehlender Status verhindert eine belastbare Offen-/Geschlossen-Auswertung.": "meanings.withoutStatusLive",
  "Ohne Status ist die Offen-/Geschlossen-Auswertung nicht belastbar.": "meanings.withoutStatusFallback",
  "Projekt besitzt keine stabile Customer-Master-Legal-Entity-Referenz.": "meanings.withoutCustomerMappingLive",
  "Eine stabile Customer-Master-Legal-Entity konnte nicht geprüft werden.": "meanings.withoutCustomerMappingFallback",
  "Projekt ist keiner belastbaren time.service-Zuordnung zugeordnet.": "meanings.withoutServiceMappingLive",
  "Die servicebezogene Steuerung ist ohne Service-Zuordnung eingeschränkt.": "meanings.withoutServiceMappingFallback",
  "Eine harte Schwelle für Projektanzahl oder Vertragsvolumen ist noch nicht fachlich validiert.": "meanings.highDependency",
  "Keine bestätigte servicebezogene Replacement-Relation ist im aktuellen Datenmodell verfügbar.": "meanings.replacementRisk",
  "Projekt kann operativ nicht eindeutig gesteuert werden.": "meanings.dqWithoutOwner",
  "Vertretungs- und Ausfallrisiko; keine bestätigte servicebezogene Replacement-Relation vorhanden.": "meanings.dqWithoutReplacementLive",
  "Vertretungs- und Ausfallrisiko; keine bestätigte Replacement-Relation vorhanden.": "meanings.dqWithoutReplacementFallback",
  "Eindeutige Projektidentifikation fehlt.": "meanings.dqWithoutOrderNumber",
  "Projekt ist keiner Customer-Master-Legal-Entity zugeordnet.": "meanings.dqWithoutCustomerMapping",
  "Offen-/Geschlossen-Auswertung ist nicht zuverlässig.": "meanings.dqWithoutContractStatus",
  "Servicebezogene Steuerung ist nicht vollständig möglich.": "meanings.dqWithoutServiceMapping",
  "Projekt kann keiner eindeutigen TrackingTime-/Hub-Referenz zugeordnet werden.": "meanings.dqWithoutProjectLink",
};

/** Translate a module-emitted string through the `management` namespace, verbatim when unmapped. */
export function translateText(t: Translate, text: string): string {
  const key = TEXT_KEY[text];
  return key ? t(key) : text;
}

/** Translate each element of a list of module-emitted strings (people stay themselves; sentinels translate). */
export function translateList(t: Translate, items: string[]): string[] {
  return items.map((item) => translateText(t, item));
}
