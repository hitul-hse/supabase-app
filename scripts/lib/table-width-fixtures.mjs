/*
 * Fixture rows for check-table-width.mjs: one entry per table surface the gate
 * measures, each rendering the REAL component with rows shaped like production.
 *
 * WHAT "SHAPED LIKE PRODUCTION" MEANS HERE, because a width gate is only as
 * honest as the strings it lays out:
 *
 *   - Names are the length the live data runs to, not "Customer 1". German legal
 *     entities carry their form in the name ("… SE & Co. KG", "… Anstalt des
 *     öffentlichen Rechts"), order names carry site and year, and the service
 *     labels are the seven sold services verbatim.
 *   - A full first page: 25 rows where the table pages at 25, 10 where it is a
 *     worked queue. A table's width is set by its widest visible cell, so a
 *     three-row fixture would measure a narrower table than anyone ever sees.
 *   - Figures up to four digits with a decimal ("1.234,5 h"), and a share of
 *     absent values, which render as "n/a" or "—" and are sometimes the widest
 *     thing in a numeric column.
 *
 * Nothing here is tuned to pass. The strings were written before any column was
 * changed, and the gate's header records what they measured then.
 */

const PEOPLE = [
  "Björn Schönemann", "Mathias Hoffmann", "Leonie Brandt", "Katharina Oberländer",
  "Alexander von Wedel", "Thorsten Kieselbach", "Svenja Mertens-Albrecht", "Jan-Philipp Dreyer",
  "Nadine Kowalczyk", "Frederik Janßen",
];
const CUSTOMERS = [
  "ENERCON GmbH", "Gebr. Heinemann SE & Co. KG", "Hamburger Hochbahn AG",
  "Stadtwerke Norderstedt Anstalt des öffentlichen Rechts", "Nordex Energy SE & Co. KG",
  "Deutsche Windtechnik Service GmbH & Co. KG", "GEPLAHN-T GmbH", "Wind-Projekt Ostfriesland GmbH",
  "Hapag-Lloyd Aktiengesellschaft", "Aurubis AG", "Lufthansa Technik Logistik Services GmbH",
  "Otto Group Solution Provider (OSP) GmbH", "Vattenfall Wärme Hamburg GmbH",
];
const PROJECTS = [
  "SiFa-Betreuung nach DGUV V2 – Standort Aurich 2026",
  "Brandschutzbeauftragter Werk Magdeburg (Rahmenvertrag)",
  "SiGeKo Windpark Holtriem-Dornum, Repowering BA 3",
  "Arbeitsmedizinische Vorsorge Verwaltung Hamburg-Altona",
  "Gefährdungsbeurteilung psychische Belastung, Leitstelle",
  "ENERCON SiGeKo Service-Einsätze Nord",
  "Unterweisung Flurförderzeuge und Ladungssicherung",
  "Reteach Akademie – Ersthelfer-Schulungen 2026",
  "H&S Consulting Rollout ISO 45001 Konzern",
  "Begehung Lager Billbrook",
];
const SERVICES = [
  "DGUV V2 SiFa", "H&S Consulting", "Brandschutzbeauftragter", "SiGeKo",
  "ENERCON SiGeKo", "Betriebsarzt", "Reteach / Akademie",
];
const TEAMS = ["Safety North", "Safety South", "Medical", "Fire Protection", "Admin"];

const pick = (list, i) => list[i % list.length];
/** Deterministic figures, so a run is repeatable to the pixel. */
const fig = (i, scale = 1) => Math.round(((i * 7919) % 1000) * scale * 10) / 10 + 0.5;
const range = (n) => Array.from({ length: n }, (_, i) => i);

/* ----------------------------------------------------------- management */

const riskRows = () =>
  range(9).map((i) => ({
    category: `cat-${i}`,
    risk: pick([
      "Projekte ohne Verantwortlichen", "Projekte ohne Vertretung", "Verantwortlicher inaktiv",
      "Kundenzuordnung fehlt", "Vertragsstunden fehlen", "Budget überschritten",
      "Keine Zeiterfassung seit 30 Tagen", "Serviceart fehlt", "Mehrere Verantwortliche",
    ], i),
    count: i === 4 ? null : 3 + ((i * 5) % 40),
    rating: i % 3 === 0 ? "Kritisch" : "Prüfen",
    affectedProjects: range(3 + ((i * 5) % 12)).map((j) => ({
      projectId: `P-${i}-${j}`,
      customer: pick(CUSTOMERS, i + j),
      customerMapping: j % 7 === 0 ? "missing" : "mapped",
      project: pick(PROJECTS, i + j),
      service: pick(SERVICES, j),
      responsible: j % 4 === 0 ? null : pick(PEOPLE, j),
      replacement: j % 3 === 0 ? null : pick(PEOPLE, j + 3),
      contractHours: j % 5 === 0 ? null : fig(j, 1.2),
      status: "Aktiv",
    })),
    responsible: range(1 + (i % 6)).map((j) => pick(PEOPLE, i + j)),
    services: range(1 + (i % 4)).map((j) => pick(SERVICES, i + j)),
    contractHours: i === 4 ? null : fig(i, 3),
    available: true,
    meaning: "Ohne Verantwortlichen fühlt sich niemand für den Auftrag zuständig; Fristen laufen unbemerkt ab.",
  }));

const dataQualityRows = () =>
  range(7).map((i) => ({
    check: pick([
      "Projekte ohne Kundenzuordnung", "Projekte ohne Serviceart", "Personen ohne Factorial-ID",
      "Aufträge ohne Vertragsstunden", "Doppelte Kundennummern", "Verwaiste TrackingTime-Projekte",
      "Aufträge mit abgelaufener Laufzeit",
    ], i),
    count: i === 2 ? null : (i * 37) % 180,
    rating: i % 2 === 0 ? "Kritisch" : "Prüfen",
    meaning:
      "Ohne diese Zuordnung fehlen die Stunden in jeder Kundenauswertung und die Summen im Portfolio sind zu niedrig.",
  }));

const multiServiceModel = (MULTI_SERVICE_COLUMNS) => ({
  rows: range(25).map((i) => {
    const services = Object.fromEntries(
      MULTI_SERVICE_COLUMNS.map(({ key }, k) => [key, (i + k) % 3 === 0 ? (i * k) % 14 : 0]),
    );
    const active = Object.values(services).filter((v) => v > 0).length;
    return {
      legalEntityId: `LE-${i}`,
      customer: pick(CUSTOMERS, i),
      services,
      activeServiceCount: active,
      contractHours: i % 9 === 0 ? null : fig(i, 4),
      projectCount: 1 + ((i * 3) % 19),
      possibleMissingServices: MULTI_SERVICE_COLUMNS.filter((_, k) => (i + k) % 4 === 1).map((c) => c.key),
    };
  }),
  customerMappingAvailable: true,
  activeProjectsWithoutCustomerMapping: 4,
  activeProjectsWithoutServiceMapping: 2,
  unmappedContractHours: 120.5,
});

const portfolioModel = () => ({
  rows: range(25).map((i) => ({
    legalEntityId: `LE-${i}`,
    customerNumber: i % 5 === 0 ? null : String(10000 + i * 37),
    customer: pick(CUSTOMERS, i),
    legalEntity: pick(CUSTOMERS, i + 2),
    locations: ["Hamburg", "Aurich"],
    locationsAvailable: true,
    activeServices: range(1 + (i % 4)).map((j) => pick(SERVICES, i + j)),
    projectCount: 1 + ((i * 3) % 19),
    contractHours: i % 8 === 0 ? null : fig(i, 4),
    responsible: range(1 + (i % 3)).map((j) => pick(PEOPLE, i + j)),
    risks: i % 3 === 0 ? [] : ["Projekte ohne Vertretung", "Vertragsstunden fehlen"].slice(0, 1 + (i % 2)),
    services: [],
    projects: [],
  })),
  customerMappingAvailable: true,
  projectsWithoutCustomerMapping: 3,
  projectsWithoutServiceMapping: 0,
  operationalLinksAvailable: false,
});

const ownershipRows = () =>
  range(9).map((i) => ({
    person: pick(PEOPLE, i),
    openProjects: 4 + ((i * 7) % 40),
    contractHours: fig(i, 6),
    servicesInPortfolio: range(1 + (i % 5)).map((j) => pick(SERVICES, j)),
    replacementCoveragePercent: i === 3 ? null : (i * 13) % 100,
    projectsWithoutReplacement: i === 3 ? null : (i * 5) % 22,
    replacementRelationAvailable: true,
    customerMappingIssues: i % 2,
    projects: range(25).map((j) => ({
      projectId: `P-${i}-${j}`,
      customerName: pick(CUSTOMERS, i + j),
      projectName: pick(PROJECTS, i + j),
      service: pick(SERVICES, j),
      contractHours: fig(j, 1.5),
      responsiblePerson: j % 6 === 0 ? null : pick(PEOPLE, i),
      replacementPerson: j % 4 === 0 ? null : pick(PEOPLE, i + j + 1),
      customerMappingMissing: j % 9 === 0,
    })),
  }));

/* ------------------------------------------------------------ factorial */

const factorialReport = () => {
  const states = ["matched", "matched", "matched", "factorial_only", "trackingtime_only", "unresolved"];
  const people = range(25).map((i) => {
    const state = pick(states, i);
    const tt = state === "matched" || state === "trackingtime_only";
    const hr = state !== "trackingtime_only";
    const logged = tt ? fig(i, 0.4) : null;
    return {
      name: pick(PEOPLE, i),
      factorialId: hr ? `F${i}` : null,
      memberId: tt ? i : null,
      hubPersonId: `H${i}`,
      factorialTeams: range(1 + (i % 2)).map((j) => pick(TEAMS, i + j)),
      memberTeam: pick(TEAMS, i),
      presentHours: hr && i % 7 !== 0 ? fig(i, 0.45) : null,
      daysClocked: hr && i % 7 !== 0 ? 10 + (i % 12) : null,
      loggedHours: logged,
      billableHours: logged === null ? null : Math.round(logged * 0.7 * 10) / 10,
      nonBillableHours: logged === null ? null : Math.round(logged * 0.3 * 10) / 10,
      billableShare: logged === null ? null : 40 + (i * 11) % 55,
      matchState: state,
    };
  });
  return {
    windowFrom: "2026-08-12",
    windowTo: "2026-09-10",
    windowDays: 30,
    people,
    teams: TEAMS.map((name, k) => ({ name, memberFactorialIds: people.filter((_, i) => i % 5 === k).map((p) => p.factorialId).filter(Boolean) })),
    totals: { presentHours: 3120.5, presentCount: 19, loggedHours: 2210.5, loggedCount: 17, billableHours: 1500 },
    factorialError: null,
    identity: { available: true, fault: null, resolved: 20, unresolved: 4 },
  };
};

/* ------------------------------------------------------ time dashboard */

const day = (i) => `2026-0${8 + (i % 2)}-${String(1 + (i % 28)).padStart(2, "0")}`;

const breakdownRows = () =>
  range(25).map((i) => ({
    key: `p${i}`,
    id: i,
    label: pick(PROJECTS, i),
    secondary: pick(CUSTOMERS, i),
    totalSeconds: Math.round(fig(i, 1.3) * 3600),
    billableSeconds: Math.round(fig(i, 0.9) * 3600),
    entryCount: 12 + ((i * 31) % 1400),
    totalHours: fig(i, 1.3),
    billableHours: fig(i, 0.9),
    sharePercent: 0.4 + ((i * 17) % 60) / 10,
    billablePercent: i % 6 === 0 ? null : (i * 23) % 100,
    lastActivityAt: i % 8 === 0 ? null : `${day(i)}T10:00:00.000Z`,
  }));

const budgetRows = () =>
  range(25).map((i) => {
    const est = fig(i, 1.1) + 20;
    const act = Math.round(est * (0.3 + (i % 9) / 5) * 10) / 10;
    return {
      projectId: i,
      projectName: pick(PROJECTS, i),
      customerName: i % 7 === 0 ? null : pick(CUSTOMERS, i),
      estimatedHours: est,
      actualHours: act,
      remainingHours: Math.round((est - act) * 10) / 10,
      burnPercent: Math.round((act / est) * 1000) / 10,
      isOver: act > est,
    };
  });

const economicsRows = () =>
  range(25).map((i) => {
    const revenue = i === 0 ? 0 : Math.round(fig(i, 180));
    const cost = Math.round(fig(i + 3, 120));
    return {
      projectId: i === 0 ? null : i,
      projectName: i === 0 ? "(no project)" : pick(PROJECTS, i),
      customerName: i === 0 ? null : pick(CUSTOMERS, i),
      totalSeconds: Math.round(fig(i, 1.3) * 3600),
      billableSeconds: Math.round(fig(i, 0.9) * 3600),
      revenue,
      cost,
      margin: revenue - cost,
      marginPercent: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
    };
  });

const entryRows = () =>
  range(25).map((i) => ({
    id: i,
    startedAt: `${day(i)}T0${7 + (i % 3)}:${String((i * 7) % 60).padStart(2, "0")}:00.000Z`,
    memberName: pick(PEOPLE, i),
    projectName: i % 9 === 0 ? null : pick(PROJECTS, i),
    customerName: i % 9 === 0 ? null : pick(CUSTOMERS, i),
    taskName: i % 2 ? "Begehung und Protokoll" : null,
    serviceName: pick(SERVICES, i),
    durationSeconds: 900 + ((i * 1733) % 28800),
    isBillable: i % 3 !== 0,
    isCalendar: i % 3 === 0 && i % 2 === 0,
    notes: i % 4 === 0 ? "Nachbereitung, Abstimmung mit Werkleitung und Betriebsrat" : null,
  }));

/* ------------------------------------------------------------- overview */

const overBudgetRows = () =>
  range(10).map((i) => ({
    id: i,
    name: pick(PROJECTS, i),
    customerName: i % 6 === 0 ? null : pick(CUSTOMERS, i),
    burnPercent: 101 + ((i * 37) % 260),
    overHours: fig(i, 0.3),
  }));

const utilisationRows = () =>
  range(10).map((i) => ({
    name: pick(PEOPLE, i),
    percent: i === 7 ? null : 40 + ((i * 17) % 90),
    hours: i === 7 ? 0 : fig(i, 0.5),
    weeksActive: 1 + (i % 12),
    tone: pick(["neutral", "good", "warning", "critical"], i),
    team: i % 4 === 0 ? null : pick(TEAMS, i),
    entryCount: i === 7 ? 0 : 40 + i,
  }));

/* ------------------------------------------------------------- customer */

const customerOrders = () =>
  range(25).map((i) => ({
    id: `2026-${String(4100 + i)}`,
    code: `2026-${String(4100 + i)}`,
    name: pick(PROJECTS, i),
    serviceNumber: 100 + (i % 7),
    serviceName: pick(SERVICES, i),
    subprojectNumber: i % 3 === 0 ? null : 1 + (i % 4),
    contractStart: "2025-01-01",
    contractEnd: i % 4 === 0 ? null : "2026-12-31",
    termState: i % 4 === 0 ? "unknownEnd" : i % 5 === 0 ? "ended" : "running",
    contractHours: i % 6 === 0 ? null : fig(i, 0.8),
    loggedHours: i % 5 === 0 ? null : fig(i, 0.7),
    lifecycleStatus: i % 11 === 0 ? "historical" : "active",
    responsibleKind: i % 9 === 0 ? "doctor" : "person",
    responsibleName: pick(PEOPLE, i),
    replacementKind: i % 3 === 0 ? null : "person",
    replacementName: i % 3 === 0 ? null : pick(PEOPLE, i + 4),
    serviceRole: "Fachkraft für Arbeitssicherheit",
  }));

/* -------------------------------------------------------------- my work */

const LINK_KINDS = ["google_chat", "microsoft_teams", "asana", "trackingtime", "google_drive"];
const ROLES = ["responsible", "owner", "replacement", "assigned"];

const myProjects = () =>
  range(25).map((i) => ({
    id: `P${i}`,
    // The live code shape MyWorkTables' own notes quote ("10234_00103_402_01").
    code: `${10234 + i}_00103_402_0${i % 10}`,
    name: pick(PROJECTS, i),
    customer: pick(CUSTOMERS, i),
    customerText: pick(CUSTOMERS, i),
    customerEntityId: i % 8 === 0 ? null : `LE-${i}`,
    // The vocabulary projects.status carries (statusTone in MyWorkTables.tsx).
    status: pick(["ACTIVE", "ACTIVE", "WARNING", "CRITICAL"], i),
    role: pick(ROLES, i),
    isAssigned: true,
    isOwner: i % 4 === 1,
    isResponsible: i % 4 === 0,
    isReplacement: i % 4 === 2,
    // Live import sets order_no to the code itself, so the cell prints it once.
    orderNo: `${10234 + i}_00103_402_0${i % 10}`,
    contractHours: i % 5 === 0 ? null : fig(i, 0.8),
    loggedHours: i % 6 === 0 ? null : fig(i, 0.7),
    myLoggedHours: i % 4 === 0 ? null : fig(i, 0.2),
    mySharePercent: 25,
    consumedPercent: 60,
    dueDate: i % 3 === 0 ? null : "2026-10-15",
    services: [pick(SERVICES, i)],
    links: LINK_KINDS.filter((_, k) => (i + k) % 3 === 0).map((kind) => ({ kind, url: `https://example.invalid/${kind}`, label: null })),
    detail: null,
    customerNumber: String(10000 + i),
    customerDisplayName: pick(CUSTOMERS, i),
    customerName: pick(CUSTOMERS, i),
    language: "de",
    street: null, postalCode: null, city: null,
    contractStart: null, contractEnd: null,
    responsibleName: pick(PEOPLE, i), responsibleKind: "person",
    replacementName: null, replacementKind: null,
    serviceRole: null, minOnsiteTime: null,
    travelFlatRate: null, travelFlatRateText: null,
    travelAsProjectTime: null, travelAsProjectTimeText: null,
    fileStorage: null, lifecycleStatus: "active", lastSeenAt: null,
  }));

const myCustomers = (projects) =>
  range(13).map((i) => ({
    entityId: i % 5 === 0 ? null : `LE-${i}`,
    customerNumber: i % 4 === 0 ? null : String(10000 + i),
    customer: pick(CUSTOMERS, i),
    aliases: i % 6 === 0 ? [`${pick(CUSTOMERS, i).split(" ")[0]}`] : [],
    projectCount: 1 + (i % 6),
    roleCounts: { responsible: i % 3, owner: 1, replacement: i % 2, assigned: 1 + (i % 4) },
    topRole: pick(ROLES, i),
    contractHours: i % 5 === 0 ? null : fig(i, 2),
    loggedHours: fig(i, 1.8),
    measuredProjectCount: i % 4 === 0 ? 1 : 1 + (i % 6),
    myLoggedHours: fig(i, 0.3),
    services: range(1 + (i % 3)).map((j) => pick(SERVICES, i + j)),
    projects: projects.slice(0, 1 + (i % 6)),
  }));

/* -------------------------------------------------------------- surfaces */

/**
 * One entry per table SURFACE: the component, where it lives, and which slot
 * of that page it gets. Every surface spans the page's content width, except
 * the two Overview queues, which share a two-column row from `halfFrom` px up.
 * `layout` names the class in the page source that creates that row, and the
 * gate asserts it is still there -- so the model the widths are measured in
 * cannot drift from the page without the gate saying so.
 *
 * `tables` is how many <table> elements the surface must render. It is asserted,
 * because a surface that silently renders no table measures as "nothing too
 * wide", which is a pass that proved nothing.
 */
export function surfaces({ loadTsx, React }) {
  const h = React.createElement;
  const mgmt = (f) => loadTsx(`src/app/(app)/dashboard/management/${f}.tsx`);
  const report = () => loadTsx("src/app/(app)/time/dashboard/ReportTables.tsx");
  const { MULTI_SERVICE_COLUMNS } = loadTsx("src/lib/queries/management-multi-service-matrix.types.ts");
  const projects = myProjects();

  return [
    {
      id: "time/dashboard · Breakdown",
      file: "src/app/(app)/time/dashboard/ReportTables.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(report().BreakdownTable, {
          rows: breakdownRows(),
          dimension: "project",
          hrefFor: Object.fromEntries(range(25).map((i) => [`p${i}`, `/time/dashboard?project=${i}`])),
          period: "2026-08",
        }),
    },
    {
      id: "time/dashboard · Budget",
      file: "src/app/(app)/time/dashboard/ReportTables.tsx",
      slot: "full",
      tables: 1,
      render: () => h(report().BudgetTable, { rows: budgetRows(), period: "2026-08" }),
    },
    {
      id: "time/dashboard · Economics",
      file: "src/app/(app)/time/dashboard/ReportTables.tsx",
      slot: "full",
      tables: 1,
      render: () => h(report().EconomicsTable, { rows: economicsRows(), period: "2026-08" }),
    },
    {
      id: "time/dashboard · Entries",
      file: "src/app/(app)/time/dashboard/ReportTables.tsx",
      slot: "full",
      tables: 1,
      render: () => h(report().EntriesTable, { rows: entryRows(), period: "2026-08" }),
    },
    {
      id: "my-work · projects",
      file: "src/components/my-work/MyWorkTables.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(loadTsx("src/components/my-work/MyWorkTables.tsx").MyWorkTables, {
          projects,
          customers: myCustomers(projects),
          showMyHours: false, // as on live data: assignment rows carry no hours yet
          budgetsWithheld: false,
          roleCounts: { responsible: 7, owner: 6, replacement: 6, assigned: 6 },
        }),
    },
    {
      id: "my-work · customers",
      file: "src/components/my-work/MyWorkTables.tsx",
      slot: "full",
      tables: 1,
      search: "view=customers",
      render: () =>
        h(loadTsx("src/components/my-work/MyWorkTables.tsx").MyWorkTables, {
          projects,
          customers: myCustomers(projects),
          showMyHours: false, // as on live data: assignment rows carry no hours yet
          budgetsWithheld: false,
          roleCounts: { responsible: 7, owner: 6, replacement: 6, assigned: 6 },
        }),
    },
    {
      id: "overview · over budget",
      file: "src/app/(app)/OverviewQueues.tsx",
      slot: "full",
      halfFrom: 1440,
      layout: { file: "src/app/(app)/page.tsx", pattern: "min-[1440px]:grid-cols-2" },
      tables: 1,
      render: () =>
        h(loadTsx("src/app/(app)/OverviewQueues.tsx").OverBudgetQueue, {
          rows: overBudgetRows(),
          hint: "Burn over 100 %",
          footnote: "Hours beyond the estimate.",
          emptyText: "None",
          locale: "de-DE",
        }),
    },
    {
      id: "overview · utilisation",
      file: "src/app/(app)/OverviewQueues.tsx",
      slot: "full",
      halfFrom: 1440,
      layout: { file: "src/app/(app)/page.tsx", pattern: "min-[1440px]:grid-cols-2" },
      tables: 1,
      render: () =>
        h(loadTsx("src/app/(app)/OverviewQueues.tsx").UtilisationQueue, {
          rows: utilisationRows(),
          hint: "Tracked over contracted",
          footnote: "n/a means no contract.",
          emptyText: "None",
          locale: "de-DE",
        }),
    },
    {
      id: "operations-analytics · presence vs logged",
      file: "src/components/factorial/factorial-hours-panel.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(loadTsx("src/components/factorial/factorial-hours-panel.tsx").FactorialHoursPanel, {
          report: factorialReport(),
        }),
    },
    {
      id: "management?tab=risks · project risks",
      file: "src/app/(app)/dashboard/management/ManagementProjectRisks.tsx",
      slot: "full",
      tables: 1,
      render: () => h(mgmt("ManagementProjectRisks").ManagementProjectRisks, { rows: riskRows() }),
    },
    {
      id: "management?tab=risks · data quality",
      file: "src/app/(app)/dashboard/management/ManagementDataQuality.tsx",
      slot: "full",
      tables: 1,
      render: () => h(mgmt("ManagementDataQuality").ManagementDataQuality, { rows: dataQualityRows() }),
    },
    {
      id: "management?tab=customers · multi-service",
      file: "src/app/(app)/dashboard/management/ManagementMultiServiceMatrix.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(mgmt("ManagementMultiServiceMatrix").ManagementMultiServiceMatrix, {
          model: multiServiceModel(MULTI_SERVICE_COLUMNS),
        }),
    },
    {
      id: "management?tab=customers · portfolio",
      file: "src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(mgmt("ManagementCustomerPortfolio").ManagementCustomerPortfolio, {
          model: portfolioModel(),
          changeRequests: [],
        }),
    },
    {
      id: "management?tab=employees · roster + portfolio",
      file: "src/app/(app)/dashboard/management/EmployeeOwnershipOverview.tsx",
      slot: "full",
      tables: 2,
      render: () => h(mgmt("EmployeeOwnershipOverview").EmployeeOwnershipOverview, { rows: ownershipRows() }),
    },
    {
      id: "customers/[number] · orders",
      file: "src/components/customer/CustomerOrdersTable.tsx",
      slot: "full",
      tables: 1,
      render: () =>
        h(loadTsx("src/components/customer/CustomerOrdersTable.tsx").CustomerOrdersTable, {
          customerNumber: "10037",
          orders: customerOrders(),
          budgetsWithheld: false,
          canOpenOrder: true,
          loggedHoursAsOf: "10.09.2026, 06:00",
          footnotes: {
            isExec: true,
            budgetsWithheld: false,
            measuredOrders: 20,
            totalOrders: 25,
            siblingUnnumberedOrders: 0,
            siblingCustomerNumbers: [],
            truncated: false,
          },
        }),
    },
  ];
}
