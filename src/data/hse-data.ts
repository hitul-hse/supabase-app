export interface SyncStatus {
  source: string;
  freshness: string;
  status: "ok" | "warning" | "error";
  message?: string;
}

export interface MetricCard {
  label: string;
  value: string;
  subtext: string;
  subtextColor?: string;
  progressPercent?: number;
  progressColor?: string;
}

export interface WeeklyTrend {
  week: string;
  billableHours: number;
  nonBillableHours: number;
  billablePercent: number;
  isOpen?: boolean;
}

export interface TeamUtilisation {
  team: string;
  percent: number | null;
  statusColor?: string;
}

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  customer: string;
  contractHours: number;
  billableHours: number;
  consumedPercent: number;
  due: string;
  lead: string;
  status: "NORMAL" | "WARNING" | "CRITICAL";
}

export interface TeamMemberBooking {
  name: string;
  role: string;
  department: string;
  avatarSeed: string;
  w31: { hours: number | string; status: "normal" | "over" | "under" | "leave" };
  w32: { hours: number | string; status: "normal" | "over" | "under" | "leave" };
  w33: { hours: number | string; status: "normal" | "over" | "under" | "leave" };
  w34: { hours: number | string; status: "normal" | "over" | "under" | "leave" };
  timesheetStatus: "SUBMITTED" | "MISSING 4 H" | "NOT SUBMITTED" | "LEAVE";
  certificates: { status: "OK" | "EXPIRING" | "EXPIRED"; text: string };
}

export interface ApprovalDecision {
  id: string;
  title: string;
  subtitle: string;
  type: "OVERTIME" | "HOLIDAY" | "CERTIFICATE";
  primaryAction: string;
  secondaryAction?: string;
}

export interface PersonProfile {
  id: string;
  name: string;
  role: string;
  department: string;
  since: string;
  contractHours: number;
  employeeNumber: string;
  capacityStatus: "NORMAL" | "OVER CAPACITY" | "LEAVE";
  loggedThisMonth: number;
  totalMonthlyHours: number;
  billableShare: number;
  openTasks: number;
  overdueTasks: number;
  holidayLeft: number;
  totalHoliday: number;
  assignments: {
    project: string;
    loggedHours: number;
    tasksCount: number;
    sharePercent: number;
  }[];
  qualifications: {
    name: string;
    validity: string;
    status: "VALID" | "RENEW";
  }[];
}

export interface ProjectDetail {
  code: string;
  name: string;
  customer: string;
  contractType: string;
  lead: string;
  teamSize: number;
  status: "BUDGET CRITICAL" | "ON TRACK" | "AT RISK";
  contractHours: number;
  loggedHours: number;
  remainingHours: number;
  forecastOverrun: number;
  contractValueEur: number;
  invoicedEur: number;
  changeRequests: string;
  timeline: {
    period: string;
    title: string;
    progressPercent: number;
    status: "done" | "in_progress" | "pending" | "forecast";
  }[];
  tasks: {
    name: string;
    estimateHours: number;
    loggedHours: number;
    status: "DONE" | "OVER 33%" | "IN PROGRESS" | "NOT STARTED";
    owner: string;
  }[];
}

export interface TimesheetDayEntry {
  taskName: string;
  projectName: string;
  isBillable: boolean;
  customer?: string;
  warning?: string;
  hours: [number, number, number, number, number, number, number]; // Mo - Su
}

/* ---------------- DATA STORES ---------------- */

export const SYNC_SOURCES: SyncStatus[] = [
  { source: "ASANA", freshness: "4m", status: "ok" },
  { source: "TRACKINGTIME", freshness: "4m", status: "ok" },
  { source: "FACTORIAL", freshness: "18m", status: "ok" },
  { source: "SAMDOCK", freshness: "2h RETRY", status: "warning", message: "Retry scheduled" },
  { source: "HUBSPOT", freshness: "11m", status: "ok" },
];

export const EXECUTIVE_METRICS: MetricCard[] = [
  {
    label: "BILLABLE UTILISATION",
    value: "73.4%",
    subtext: "+2.1 PTS · TARGET 75",
    subtextColor: "var(--accent)",
  },
  {
    label: "BILLABLE / CONTRACTED",
    value: "18 240 / 24 900",
    subtext: "73% OF CONTRACTED",
    progressPercent: 73,
    progressColor: "var(--accent)",
  },
  {
    label: "NON-BILLABLE SHARE",
    value: "26.6%",
    subtext: "4 850 H · INTERNAL + ADMIN",
    subtextColor: "var(--text-muted)",
  },
  {
    label: "OPEN TASKS",
    value: "612",
    subtext: "87 OVERDUE · 9 PROJECTS",
    subtextColor: "var(--critical)",
  },
  {
    label: "HOURS AT RISK",
    value: "1 480",
    subtext: "4 PROJECTS PAST 90%",
    subtextColor: "var(--critical)",
  },
];

export const WEEKLY_TRENDS: WeeklyTrend[] = [
  { week: "W20", billableHours: 1480, nonBillableHours: 520, billablePercent: 74 },
  { week: "W21", billableHours: 1510, nonBillableHours: 490, billablePercent: 75 },
  { week: "W22", billableHours: 1390, nonBillableHours: 610, billablePercent: 69 },
  { week: "W23", billableHours: 1600, nonBillableHours: 400, billablePercent: 80 },
  { week: "W24", billableHours: 1540, nonBillableHours: 460, billablePercent: 77 },
  { week: "W25", billableHours: 1680, nonBillableHours: 320, billablePercent: 84 },
  { week: "W26", billableHours: 1410, nonBillableHours: 590, billablePercent: 70 },
  { week: "W27", billableHours: 1580, nonBillableHours: 420, billablePercent: 79 },
  { week: "W28", billableHours: 1220, nonBillableHours: 780, billablePercent: 61 },
  { week: "W29", billableHours: 1620, nonBillableHours: 380, billablePercent: 81 },
  { week: "W30", billableHours: 1500, nonBillableHours: 500, billablePercent: 75 },
  { week: "W31 OPEN", billableHours: 1420, nonBillableHours: 410, billablePercent: 77, isOpen: true },
];

export const TEAM_UTILISATIONS: TeamUtilisation[] = [
  { team: "Engineering", percent: 81, statusColor: "var(--accent)" },
  { team: "Safety consulting", percent: 76, statusColor: "var(--accent)" },
  { team: "Training", percent: 69, statusColor: "var(--accent)" },
  { team: "Lab & measurement", percent: 58, statusColor: "var(--warning)" },
  { team: "Back office", percent: null, statusColor: "var(--border)" },
];

export const ACTIVE_PROJECTS_LEDGER: ProjectSummary[] = [
  {
    id: "prj-1",
    code: "PRJ-2026-014",
    name: "Site risk assessment 2026",
    customer: "Nordwerk AG",
    contractHours: 1200,
    billableHours: 1164,
    consumedPercent: 97,
    due: "30 SEP",
    lead: "S. Ott",
    status: "CRITICAL",
  },
  {
    id: "prj-2",
    code: "PRJ-2026-009",
    name: "ISO 45001 readiness",
    customer: "Halbach Werke",
    contractHours: 840,
    billableHours: 771,
    consumedPercent: 92,
    due: "14 OCT",
    lead: "A. Brandt",
    status: "WARNING",
  },
  {
    id: "prj-3",
    code: "PRJ-2026-022",
    name: "Noise mapping – plant 2",
    customer: "Rheinmetric GmbH",
    contractHours: 560,
    billableHours: 402,
    consumedPercent: 72,
    due: "21 NOV",
    lead: "S. Ott",
    status: "NORMAL",
  },
  {
    id: "prj-4",
    code: "PRJ-2026-005",
    name: "Safety training programme",
    customer: "Stadtwerke Lohr",
    contractHours: 1600,
    billableHours: 988,
    consumedPercent: 62,
    due: "31 DEC",
    lead: "L. Fischer",
    status: "NORMAL",
  },
  {
    id: "prj-5",
    code: "PRJ-2026-031",
    name: "Hazardous substances audit",
    customer: "Kern Chemie",
    contractHours: 320,
    billableHours: 118,
    consumedPercent: 37,
    due: "15 JAN",
    lead: "A. Brandt",
    status: "NORMAL",
  },
];

export const TEAM_MEMBERS_BOOKING: TeamMemberBooking[] = [
  {
    name: "A. Brandt",
    role: "Senior Safety Consultant",
    department: "Safety consulting",
    avatarSeed: "AB",
    w31: { hours: 46, status: "over" },
    w32: { hours: 42, status: "over" },
    w33: { hours: 36, status: "normal" },
    w34: { hours: 32, status: "normal" },
    timesheetStatus: "SUBMITTED",
    certificates: { status: "OK", text: "OK" },
  },
  {
    name: "J. Weiß",
    role: "Junior Consultant",
    department: "Safety consulting",
    avatarSeed: "JW",
    w31: { hours: 38, status: "normal" },
    w32: { hours: 37, status: "normal" },
    w33: { hours: "LEAVE", status: "leave" },
    w34: { hours: "LEAVE", status: "leave" },
    timesheetStatus: "MISSING 4 H",
    certificates: { status: "OK", text: "OK" },
  },
  {
    name: "P. Novak",
    role: "Measurement Engineer",
    department: "Safety consulting",
    avatarSeed: "PN",
    w31: { hours: 34, status: "normal" },
    w32: { hours: 22, status: "under" },
    w33: { hours: 18, status: "under" },
    w34: { hours: 14, status: "under" },
    timesheetStatus: "SUBMITTED",
    certificates: { status: "EXPIRING", text: "SIFA EXP 12 SEP" },
  },
  {
    name: "R. Yilmaz",
    role: "Safety Consultant",
    department: "Safety consulting",
    avatarSeed: "RY",
    w31: { hours: 40, status: "normal" },
    w32: { hours: 39, status: "normal" },
    w33: { hours: 36, status: "normal" },
    w34: { hours: 24, status: "under" },
    timesheetStatus: "NOT SUBMITTED",
    certificates: { status: "OK", text: "OK" },
  },
  {
    name: "C. Haas",
    role: "Safety Consultant",
    department: "Safety consulting",
    avatarSeed: "CH",
    w31: { hours: 36, status: "normal" },
    w32: { hours: 35, status: "normal" },
    w33: { hours: 38, status: "normal" },
    w34: { hours: 34, status: "normal" },
    timesheetStatus: "SUBMITTED",
    certificates: { status: "OK", text: "OK" },
  },
];

export const APPROVAL_DECISIONS: ApprovalDecision[] = [
  {
    id: "dec-1",
    title: "A. Brandt – 46 h in week 30",
    subtitle: "6 H OVER CONTRACT · NORDWERK AG",
    type: "OVERTIME",
    primaryAction: "Approve",
    secondaryAction: "Review",
  },
  {
    id: "dec-2",
    title: "Holiday request – J. Weiß, W33–W34",
    subtitle: "CLASHES WITH HALBACH MILESTONE",
    type: "HOLIDAY",
    primaryAction: "Approve",
    secondaryAction: "Review",
  },
  {
    id: "dec-3",
    title: "SiFa certificate expiring – P. Novak",
    subtitle: "BLOCKS 3 ASSIGNMENTS AFTER 12 SEP",
    type: "CERTIFICATE",
    primaryAction: "Schedule",
  },
];

export const PEOPLE_DIRECTORY: PersonProfile[] = [
  {
    id: "emp-1",
    name: "Anna Brandt",
    role: "SENIOR SAFETY CONSULTANT",
    department: "SAFETY",
    since: "03/2021",
    contractHours: 40,
    employeeNumber: "EMP-0142",
    capacityStatus: "OVER CAPACITY",
    loggedThisMonth: 168,
    totalMonthlyHours: 160,
    billableShare: 84,
    openTasks: 23,
    overdueTasks: 4,
    holidayLeft: 11,
    totalHoliday: 30,
    assignments: [
      { project: "ISO 45001 readiness", loggedHours: 412, tasksCount: 12, sharePercent: 48 },
      { project: "Site risk assessment 2026", loggedHours: 288, tasksCount: 7, sharePercent: 33 },
      { project: "Hazardous substances audit", loggedHours: 61, tasksCount: 4, sharePercent: 7 },
      { project: "Internal · admin, training", loggedHours: 104, tasksCount: 0, sharePercent: 12 },
    ],
    qualifications: [
      { name: "SiFa (Sicherheitsfachkraft)", validity: "VALID 2028", status: "VALID" },
      { name: "ISO 45001 lead auditor", validity: "VALID 2027", status: "VALID" },
      { name: "Hazardous substances", validity: "RENEW 03/2027", status: "RENEW" },
      { name: "First aid", validity: "VALID 2027", status: "VALID" },
    ],
  },
  {
    id: "emp-2",
    name: "C. Haas",
    role: "SAFETY CONSULTANT",
    department: "SAFETY",
    since: "09/2022",
    contractHours: 40,
    employeeNumber: "EMP-0158",
    capacityStatus: "NORMAL",
    loggedThisMonth: 152,
    totalMonthlyHours: 160,
    billableShare: 92,
    openTasks: 14,
    overdueTasks: 0,
    holidayLeft: 18,
    totalHoliday: 30,
    assignments: [
      { project: "Noise mapping – plant 2", loggedHours: 210, tasksCount: 6, sharePercent: 55 },
      { project: "Site risk assessment 2026", loggedHours: 140, tasksCount: 4, sharePercent: 35 },
      { project: "Internal admin", loggedHours: 38, tasksCount: 0, sharePercent: 10 },
    ],
    qualifications: [
      { name: "SiFa (Sicherheitsfachkraft)", validity: "VALID 2028", status: "VALID" },
      { name: "First aid", validity: "VALID 2027", status: "VALID" },
    ],
  },
  {
    id: "emp-3",
    name: "L. Fischer",
    role: "TEAM LEAD TRAINING",
    department: "ENG",
    since: "01/2020",
    contractHours: 40,
    employeeNumber: "EMP-0112",
    capacityStatus: "NORMAL",
    loggedThisMonth: 148,
    totalMonthlyHours: 160,
    billableShare: 88,
    openTasks: 19,
    overdueTasks: 1,
    holidayLeft: 14,
    totalHoliday: 30,
    assignments: [
      { project: "Safety training programme", loggedHours: 540, tasksCount: 16, sharePercent: 78 },
      { project: "Internal management", loggedHours: 120, tasksCount: 0, sharePercent: 22 },
    ],
    qualifications: [
      { name: "Master Safety Trainer", validity: "VALID 2029", status: "VALID" },
      { name: "ISO 45001 auditor", validity: "VALID 2027", status: "VALID" },
    ],
  },
  {
    id: "emp-4",
    name: "P. Novak",
    role: "MEASUREMENT ENGINEER",
    department: "LAB",
    since: "05/2023",
    contractHours: 40,
    employeeNumber: "EMP-0174",
    capacityStatus: "NORMAL",
    loggedThisMonth: 112,
    totalMonthlyHours: 160,
    billableShare: 58,
    openTasks: 8,
    overdueTasks: 2,
    holidayLeft: 22,
    totalHoliday: 30,
    assignments: [
      { project: "Site risk assessment 2026", loggedHours: 318, tasksCount: 5, sharePercent: 70 },
      { project: "Lab calibration", loggedHours: 94, tasksCount: 0, sharePercent: 30 },
    ],
    qualifications: [
      { name: "Measurement Tech level 2", validity: "VALID 2027", status: "VALID" },
      { name: "SiFa (Sicherheitsfachkraft)", validity: "EXP 12 SEP", status: "RENEW" },
    ],
  },
  {
    id: "emp-5",
    name: "R. Yilmaz",
    role: "SAFETY CONSULTANT",
    department: "SAFETY",
    since: "11/2021",
    contractHours: 40,
    employeeNumber: "EMP-0149",
    capacityStatus: "NORMAL",
    loggedThisMonth: 160,
    totalMonthlyHours: 160,
    billableShare: 97,
    openTasks: 11,
    overdueTasks: 0,
    holidayLeft: 15,
    totalHoliday: 30,
    assignments: [
      { project: "Site risk assessment 2026", loggedHours: 294, tasksCount: 6, sharePercent: 65 },
      { project: "Hazardous substances audit", loggedHours: 130, tasksCount: 4, sharePercent: 30 },
      { project: "Internal", loggedHours: 20, tasksCount: 0, sharePercent: 5 },
    ],
    qualifications: [
      { name: "SiFa (Sicherheitsfachkraft)", validity: "VALID 2028", status: "VALID" },
      { name: "Fire Safety Inspector", validity: "VALID 2027", status: "VALID" },
    ],
  },
  {
    id: "emp-6",
    name: "S. Ott",
    role: "TEAM LEAD SAFETY",
    department: "SAFETY",
    since: "08/2019",
    contractHours: 40,
    employeeNumber: "EMP-0098",
    capacityStatus: "NORMAL",
    loggedThisMonth: 156,
    totalMonthlyHours: 160,
    billableShare: 74,
    openTasks: 31,
    overdueTasks: 3,
    holidayLeft: 8,
    totalHoliday: 30,
    assignments: [
      { project: "Site risk assessment 2026", loggedHours: 240, tasksCount: 10, sharePercent: 45 },
      { project: "Noise mapping – plant 2", loggedHours: 180, tasksCount: 8, sharePercent: 35 },
      { project: "Team leadership & planning", loggedHours: 90, tasksCount: 0, sharePercent: 20 },
    ],
    qualifications: [
      { name: "Senior SiFa Expert", validity: "VALID 2030", status: "VALID" },
      { name: "ISO 45001 Lead Auditor", validity: "VALID 2028", status: "VALID" },
    ],
  },
  {
    id: "emp-7",
    name: "T. Bergmann",
    role: "LAB TECHNICIAN",
    department: "LAB",
    since: "02/2024",
    contractHours: 40,
    employeeNumber: "EMP-0188",
    capacityStatus: "NORMAL",
    loggedThisMonth: 145,
    totalMonthlyHours: 160,
    billableShare: 81,
    openTasks: 5,
    overdueTasks: 0,
    holidayLeft: 25,
    totalHoliday: 30,
    assignments: [
      { project: "Noise mapping – plant 2", loggedHours: 160, tasksCount: 3, sharePercent: 60 },
      { project: "Lab measurement tests", loggedHours: 85, tasksCount: 0, sharePercent: 40 },
    ],
    qualifications: [
      { name: "Acoustics Specialist", validity: "VALID 2028", status: "VALID" },
      { name: "First aid", validity: "VALID 2027", status: "VALID" },
    ],
  },
  {
    id: "emp-8",
    name: "J. Weiß",
    role: "JUNIOR CONSULTANT",
    department: "SAFETY",
    since: "04/2024",
    contractHours: 40,
    employeeNumber: "EMP-0192",
    capacityStatus: "LEAVE",
    loggedThisMonth: 75,
    totalMonthlyHours: 160,
    billableShare: 60,
    openTasks: 4,
    overdueTasks: 0,
    holidayLeft: 20,
    totalHoliday: 30,
    assignments: [
      { project: "ISO 45001 readiness", loggedHours: 80, tasksCount: 2, sharePercent: 65 },
      { project: "Internal training", loggedHours: 40, tasksCount: 0, sharePercent: 35 },
    ],
    qualifications: [
      { name: "Junior Safety Trainee", validity: "VALID 2026", status: "VALID" },
    ],
  },
];

export const PROJECT_DETAILS: Record<string, ProjectDetail> = {
  "prj-1": {
    code: "PRJ-2026-014",
    name: "Site risk assessment 2026",
    customer: "Nordwerk AG",
    contractType: "T&M",
    lead: "S. Ott",
    teamSize: 5,
    status: "BUDGET CRITICAL",
    contractHours: 1200,
    loggedHours: 1164,
    remainingHours: 36,
    forecastOverrun: 148,
    contractValueEur: 138000,
    invoicedEur: 121400,
    changeRequests: "1 pending",
    timeline: [
      { period: "JAN–MAR", title: "Survey", progressPercent: 100, status: "done" },
      { period: "MAR–JUN", title: "Register", progressPercent: 100, status: "done" },
      { period: "JUN–AUG", title: "Reporting", progressPercent: 82, status: "in_progress" },
      { period: "SEP", title: "Handover", progressPercent: 0, status: "pending" },
      { period: "OCT–NOV", title: "Forecast", progressPercent: 100, status: "forecast" },
    ],
    tasks: [
      { name: "Walkthrough plant 1–4", estimateHours: 320, loggedHours: 341, status: "DONE", owner: "A. Brandt" },
      { name: "Hazard register update", estimateHours: 280, loggedHours: 294, status: "DONE", owner: "R. Yilmaz" },
      { name: "Measurement campaign", estimateHours: 240, loggedHours: 318, status: "OVER 33%", owner: "P. Novak" },
      { name: "Report & recommendations", estimateHours: 240, loggedHours: 168, status: "IN PROGRESS", owner: "A. Brandt" },
      { name: "Customer workshop", estimateHours: 80, loggedHours: 43, status: "IN PROGRESS", owner: "S. Ott" },
      { name: "Sign-off & handover", estimateHours: 40, loggedHours: 0, status: "NOT STARTED", owner: "S. Ott" },
    ],
  },
};

export const TIMESHEET_SAMPLE_ENTRIES: TimesheetDayEntry[] = [
  {
    taskName: "Report & recommendations",
    projectName: "SITE RISK ASSESSMENT 2026",
    isBillable: true,
    customer: "Nordwerk AG",
    hours: [6.0, 7.5, 4.0, 8.0, 2.0, 0, 0],
  },
  {
    taskName: "Gap analysis workshop",
    projectName: "ISO 45001 READINESS",
    isBillable: true,
    customer: "Halbach Werke",
    hours: [0, 2.0, 4.5, 0, 5.5, 0, 0],
  },
  {
    taskName: "Internal · team meeting, admin",
    projectName: "NON-BILLABLE",
    isBillable: false,
    hours: [1.5, 0, 1.0, 0, 2.0, 0, 0],
  },
  {
    taskName: "Travel · plant 2 site visit",
    projectName: "NEEDS PROJECT ASSIGNMENT",
    isBillable: false,
    warning: "Needs project assignment",
    hours: [0, 0, 0, 2.0, 0, 0, 0],
  },
];
