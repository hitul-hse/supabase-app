# Graph Report - Supabase  (2026-08-22)

## Corpus Check
- 435 files · ~486,459 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2910 nodes · 4590 edges · 246 communities (206 shown, 40 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2864677b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- scripts
- Standalone Runtime Bootstrap
- Roles & Permissions Schema
- users/page.tsx
- AuthShell.tsx
- org-actions.ts
- dependencies
- check-time-integration.mjs
- Design System Check
- TypeScript Config Includes
- trackingtime-report.ts
- devDependencies
- people-live.ts
- Schema Apply Checks
- team-lead-live.ts
- Brand Mark Verifier
- Inventory Generation
- Org Chart Edit Check
- import-trackingtime.mjs
- time/page.tsx
- InsightPanels.tsx
- Vendor Parity Check
- Dashboard Claims Recheck
- time/actions.ts
- TeamLeadBoard.tsx
- profile/actions.ts
- projects-live.ts
- People Overview Agreement Check
- OrgChartView.tsx
- ReportTables.tsx
- check-overview-range-narrows.mjs
- MyLeavePanel.tsx
- (app)/page.tsx
- createClient
- Sidebar Collapse Check
- Time Page Render Check
- Missing Events Diagnosis
- overview-live.ts
- Paging & RLS Recheck
- PeopleDirectory.tsx
- Asana Backlog Check
- check-time-acceptance.mjs
- time-transform.ts
- projects/actions.ts
- Dashboard Tables Check
- TrackingTime Parity Check
- Charts.tsx
- Sidebar.tsx
- OAuth Success Path Check
- People Live Source Check
- check-overview-filters.mjs
- nav-icons.tsx
- No Mock People Check
- check-server-action-auth.mjs
- dashboard/page.tsx
- Marketing Demo Page
- [userId]/page.tsx
- Identity Linking Check
- No Mock Data Check
- TrackingTime Sync Script
- TimerBar.tsx
- Invite OAuth Model Check
- OAuth Callback Check
- Time Member Linking
- Marketing Video Page
- Admin User Writes Check
- Deployed Overview Check
- Profile RLS Check
- Sync & Drilldown Check
- Trend Window Check
- User Management Check
- Hours Definitions Explainer
- Asana Backlog Generator
- Dashboard Cost Measurement
- check-people-filters-live.mjs
- try-policy-verification-paths.mjs
- Entry Policy Equivalence Check
- TaskBoardView.tsx
- Profile Actions Check
- Card.tsx
- Stale Total Tracing
- apply-rls-hoisting.mjs
- Agent File References Check
- Approval Error Handling Check
- Org Chart Check
- Schema Execution Check
- Time Write Path Check
- Member Provisioning Script
- formatSeconds
- Google Client Check
- Schema Order Check
- SSO Provider Check
- Time Org Chart View Check
- Agent Claim Recheck
- Loading Skeletons
- ReportPanels.tsx
- Agent Claims Check
- check-dashboard-acceptance.mjs
- Economics Scope Check
- Lint Scope Check
- Login Redirect Safety Checks
- check-duration-parsing.mjs
- Page Length Render Check
- Parallel Paging Performance Test
- Permissions RLS Parity Check
- Provisioned Access Verification
- Remote Deploy State Check
- RLS Query Hoisting Benchmark
- User Management UI Check
- TrackingTime Integration Check
- AI Provider Credential Probes
- Deployment Wait Helper
- Root Layout And Fonts
- Auth Route Gate Checks
- Charts UI Check
- Live Dashboard Check
- People And Filters UI Check
- Records Tabs Source Check
- Redirect Allowlist Check
- Team Analysis UI Check
- Theme And Figures Check
- Google OAuth Error Diagnosis
- check-trackingtime-report.mjs
- check-team-select.mjs
- Auth Session Middleware
- Live Database Audit
- Profile Grants Check
- Project Write Auth Check
- Records Tabs UI Check
- Redirect Guard Logic Check
- Time Page Live Readiness
- Time Page Data Check
- Policy Verification Query Check
- Null Assignments Diagnosis
- Migration Module Generator
- OAuth Invite Linking Proof
- Economics Access Recheck
- Demo Video Recorder
- Sync Secrets Setup
- Yearly Screenshot Capture
- Policy Gate Failure Verification
- projects/page.tsx
- CI Workflow Check
- Deploy Skew Check
- Modules RLS Check
- OAuth Diagnosis Check
- Permission Enforcement Check
- Production Config Check
- RLS Behaviour Check
- Sync Freshness Check
- Backend Agent Grading
- Testing Agent Grading
- Live RLS Probe
- Anonymous Write Verification
- team-lead/page.tsx
- Next.js Build Config
- Profile Column Guard Trigger
- Middleware Bypass Check
- Profile Action Auth Check
- Time Analytics Check
- Frontend Agent Grading
- Machine State Export
- Requirements Traceability Run
- Provider Status Endpoint
- Member Hierarchy Migration
- Member Utilisation Bounding
- Project Sections And Tasks
- Dashboard Tile Apply
- Backslash Redirect Check
- Member Hierarchy Migration Check
- Open Redirect Check
- Policy Count Control Check
- OAuth Config Diagnosis
- Live Database Inspection
- OpenAI API Probe
- Gemini Key Setup
- Window Tabs
- Org Chart Schema
- ESLint Configuration
- MCP Server Config
- Pager Build Package Manifest
- Skew Check Build Manifest
- Tabs Build Package Manifest
- UM Check Build Manifest
- PostCSS Configuration
- Eval Rerun Grading Script
- Project Timeline Model
- User Profile Table
- time-dashboard.ts
- Time Member Model
- check-people-module.mjs
- check-oauth-success-path-live.mjs
- measure-latency-variance.mjs
- read-prod-total.mjs
- AGENTS.md
- database.types.ts
- SecurityCard.tsx
- check-hr-role-migration.mjs
- types.ts
- label
- profile-actions.ts
- public.overbooking_alert
- people/actions.ts
- TeamLeadExplorer.tsx
- Avatar.tsx
- check-profile-admin.mjs
- ThemeToggle.tsx
- TimeViewTabs.tsx
- LogoutButton.tsx

## God Nodes (most connected - your core abstractions)
1. `scripts` - 139 edges
2. `createClient()` - 90 edges
3. `secondsToHours()` - 35 edges
4. `get()` - 23 edges
5. `getLiveOverview()` - 23 edges
6. `createRuntime()` - 22 edges
7. `TrackingTimeDashboardPage()` - 20 edges
8. `userHasPermission()` - 20 edges
9. `createAdminClient()` - 20 edges
10. `PERMISSIONS` - 19 edges

## Surprising Connections (you probably didn't know these)
- `render()` --indirect_call--> `UserRow()`  [INFERRED]
  scripts/check-team-select.mjs → src/app/(app)/admin/users/UserRow.tsx
- `main()` --calls--> `classifyService()`  [EXTRACTED]
  scripts/import-trackingtime.mjs → src/lib/time-transform.ts
- `main()` --calls--> `toEntryDraft()`  [EXTRACTED]
  scripts/import-trackingtime.mjs → src/lib/time-transform.ts
- `app_user_role_v2()` --reads_from--> `app_user_profile`  [EXTRACTED]
  scripts/eval/reports-module.sql → supabase/schema.sql
- `CustomerPortfolio` --calls--> `secondsToHours()`  [EXTRACTED]
  src/lib/queries/projects-live.ts → src/lib/time-transform.ts

## Import Cycles
- None detected.

## Communities (246 total, 40 thin omitted)

### Community 0 - "scripts"
Cohesion: 0.01
Nodes (139): scripts, apply-modules, asana:backlog, build, check:acceptance, check:action-auth, check:admin-user-writes, check:avatar (+131 more)

### Community 1 - "Standalone Runtime Bootstrap"
Cohesion: 0.06
Nodes (75): boot(), bundledBlob(), cdnScriptFor(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory() (+67 more)

### Community 2 - "Roles & Permissions Schema"
Cohesion: 0.05
Nodes (55): auth, app_user_role_v2(), can_view_report(), people, reports, app_module, app_permission, app_role_permission (+47 more)

### Community 3 - "users/page.tsx"
Cohesion: 0.16
Nodes (24): render(), assertCanManageUsers(), changeUserDepartment(), changeUserRole(), deleteUser(), InviteState, inviteUser(), resendInvite() (+16 more)

### Community 4 - "AuthShell.tsx"
Cohesion: 0.19
Nodes (14): ForgotPasswordPage(), LoginForm(), safeRedirect(), SetPasswordForm(), authButtonClass, AuthHeading(), authInputClass, authLabelClass (+6 more)

### Community 5 - "org-actions.ts"
Cohesion: 0.21
Nodes (13): ProfileFieldsForm(), assertCanEditPeople(), OrgEditState, setMemberDetails(), setSupervisor(), timeSchema(), wouldCreateCycle(), OrgChartView() (+5 more)

### Community 6 - "dependencies"
Cohesion: 0.12
Nodes (16): framer-motion, next, dependencies, framer-motion, next, react, react-dom, @supabase/ssr (+8 more)

### Community 7 - "check-time-integration.mjs"
Cohesion: 0.11
Nodes (13): alias, anon, days, dir, env, queries, require, supabase (+5 more)

### Community 8 - "Design System Check"
Cohesion: 0.05
Nodes (43): APP_SHELL, authInput, authShell, buttonSrc, card, chartsSrc, check(), chrome (+35 more)

### Community 9 - "TypeScript Config Includes"
Cohesion: 0.05
Nodes (40): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next-flake-probe/dev/types/**/*.ts, .next-flake-probe/types/**/*.ts (+32 more)

### Community 10 - "trackingtime-report.ts"
Cohesion: 0.13
Nodes (19): Option, ReportFilters(), DEFAULT_FILTERS, fetchAllEntries(), fetchExcludedCalendarSeconds(), FetchResult, FilterOptions, getFilterOptions() (+11 more)

### Community 11 - "devDependencies"
Cohesion: 0.10
Nodes (21): @electric-sql/pglite, eslint, eslint-config-next, devDependencies, @electric-sql/pglite, eslint, eslint-config-next, @playwright/test (+13 more)

### Community 12 - "people-live.ts"
Cohesion: 0.23
Nodes (14): getMemberTeams(), getAssignments(), getLivePeople(), getMemberMeta(), getRosterCounts(), isSharedMailbox(), MemberMeta, PeopleDirectoryData (+6 more)

### Community 13 - "Schema Apply Checks"
Cohesion: 0.06
Nodes (28): committed, cut, publicOnly, regenerated, schema, admin, DELIBERATELY_READABLE, env (+20 more)

### Community 14 - "team-lead-live.ts"
Cohesion: 0.11
Nodes (27): BoardRangeFilter(), PRESETS, isDefaultWindow(), fetchAllPaged(), PAGE, PagedResult, BOARD_WEEKS, BoardCellStatus (+19 more)

### Community 15 - "Brand Mark Verifier"
Cohesion: 0.06
Nodes (28): AUTH, AUTH_C, authMarks, CSS, CSS_C, dAttrs, froms, heroIdx (+20 more)

### Community 16 - "Inventory Generation"
Cohesion: 0.10
Nodes (25): empty, inv, md, records, secrets, buildInventory(), classify(), collectWarnings() (+17 more)

### Community 17 - "Org Chart Edit Check"
Cohesion: 0.10
Nodes (21): admin, anon, cookies, env, errors, subordinate, time, member_clear_supervisor_source (+13 more)

### Community 18 - "import-trackingtime.mjs"
Cohesion: 0.17
Nodes (15): args, DRY_RUN, ENV, get(), getAllPaged(), getEventsByMonth(), HEADERS, idMap() (+7 more)

### Community 19 - "time/page.tsx"
Cohesion: 0.18
Nodes (24): RecordsTabKey, RecordsTabs(), parseScopeParam(), parseViewParam(), parseWeekParam(), TimePage(), TimeTracker(), currentTimeWeek() (+16 more)

### Community 20 - "InsightPanels.tsx"
Cohesion: 0.11
Nodes (19): h(), InsightPanels(), SERIES, BumpSeries, DivergingBars(), DivergingItem, HeatCell, HeatmapMatrix() (+11 more)

### Community 21 - "Vendor Parity Check"
Cohesion: 0.08
Nodes (21): admin, env, headers, missing, now, ourCalendar, ourIds, ours (+13 more)

### Community 22 - "Dashboard Claims Recheck"
Cohesion: 0.08
Nodes (20): admin, corrected, distinctProjects, env, estimatedIds, gates, hasUnattributed, lastRef (+12 more)

### Community 23 - "time/actions.ts"
Cohesion: 0.10
Nodes (37): already, atFloor, crossing, justOver, msg, onBudget, placeholder, rounding (+29 more)

### Community 24 - "TeamLeadBoard.tsx"
Cohesion: 0.27
Nodes (12): ApprovalResult, approveAllPending(), approveDecision(), approveTimesheetWeek(), rejectTimesheetWeek(), requireApprover(), setTimesheetWeekStatus(), PendingTimesheetApprovals() (+4 more)

### Community 25 - "profile/actions.ts"
Cohesion: 0.22
Nodes (15): EXT, removeAvatar(), updateDisplayName(), updatePreferences(), uploadAvatar(), ALLOWED_AVATAR_TYPES, LANDING_PAGES, LOCALES (+7 more)

### Community 26 - "projects-live.ts"
Cohesion: 0.18
Nodes (19): allTimeFilters(), burndown(), contributors(), CustomerPortfolio, CustomerPortfolioRow, CustomerRankByMonth, CustomerRankSeries, fetchAllProjects() (+11 more)

### Community 27 - "People Overview Agreement Check"
Cohesion: 0.09
Nodes (18): admin, completedByMember, currentByMember, currentMonday, drift, env, futureActivity, futureMembers (+10 more)

### Community 28 - "OrgChartView.tsx"
Cohesion: 0.20
Nodes (12): initialsOf(), NodeRow(), PeoplePage(), PeopleSection(), SearchableSelect(), getOrgChart(), OrgChartData, OrgMember (+4 more)

### Community 29 - "ReportTables.tsx"
Cohesion: 0.16
Nodes (20): Align, cmpNum(), cmpText(), Column, csvCell(), DataTable(), PAGE_SIZES, PageSize (+12 more)

### Community 30 - "check-overview-range-narrows.mjs"
Cohesion: 0.13
Nodes (17): admin, biggest, byTeam, env, first12, iso(), lastDay12, lastMonday12 (+9 more)

### Community 31 - "MyLeavePanel.tsx"
Cohesion: 0.12
Nodes (20): ApprovalResult, approveLeaveRequestAction(), cancelLeaveRequest(), rejectLeaveRequestAction(), requestLeave(), RequestLeaveState, setLeaveRequestStatus(), MyLeavePanel() (+12 more)

### Community 32 - "(app)/page.tsx"
Cohesion: 0.19
Nodes (11): OverviewFilters(), formatWeekLabel(), OverviewPage(), thursdayOf(), IconSearch(), IconWarning(), TopBarChrome(), IconButtonLink() (+3 more)

### Community 33 - "createClient"
Cohesion: 0.18
Nodes (21): AddEntryState, addTimesheetEntry(), copyLastWeek(), currentPersonId(), deleteTimesheetRow(), submitWeek(), updateDayHours(), withdrawWeek() (+13 more)

### Community 34 - "Sidebar Collapse Check"
Cohesion: 0.10
Nodes (16): CTX, dir, LAYOUT, mobileSrc, NAV, navSrc, navTourIds, require (+8 more)

### Community 35 - "Time Page Render Check"
Cohesion: 0.10
Nodes (15): alias, days, dir, emptyHtml, ghostHtml, listHtml, require, runningHtml (+7 more)

### Community 36 - "Missing Events Diagnosis"
Cohesion: 0.10
Nodes (17): admin, byMonth, daysDecl, dupes, earliest, env, headers, memberSourceIds (+9 more)

### Community 37 - "overview-live.ts"
Cohesion: 0.10
Nodes (29): PRESETS, burnTone(), countRows(), fmtHours(), getLiveOverview(), getOrgWeeksBetween(), getTeamWeeks(), isSundayOfWeek() (+21 more)

### Community 38 - "Paging & RLS Recheck"
Cohesion: 0.10
Nodes (15): admin, anon, app, asExec, bad, env, parRls, parSvc (+7 more)

### Community 39 - "PeopleDirectory.tsx"
Cohesion: 0.06
Nodes (55): bandOf(), CAPACITY_BANDS, CapacityBand, initialsOf(), PeopleDirectory(), SortKey, sortPeople(), CustomerMultiSelect() (+47 more)

### Community 40 - "Asana Backlog Check"
Cohesion: 0.14
Nodes (16): backwards, body, col(), controlBad, dupes, missingGate, RFC-4180, names (+8 more)

### Community 41 - "check-time-acceptance.mjs"
Cohesion: 0.12
Nodes (16): app, cleanup(), cleanupBuild(), customers, entries, monday, PROFILE, projects (+8 more)

### Community 42 - "time-transform.ts"
Cohesion: 0.24
Nodes (9): weekStartFor(), classifyService(), EntryDraft, FlatEvent, isCalendarSourced(), isoWeekStart(), parseVendorTimestamp(), resolveDurationSeconds() (+1 more)

### Community 43 - "projects/actions.ts"
Cohesion: 0.17
Nodes (17): addComment(), addSubtask(), CreateTaskState, deleteComment(), deleteTask(), insertTask(), moveTaskToSection(), readParent() (+9 more)

### Community 44 - "Dashboard Tables Check"
Cohesion: 0.12
Nodes (15): app, cleanup(), customers, entries, members, monthStart, PROFILE, projects (+7 more)

### Community 45 - "TrackingTime Parity Check"
Cohesion: 0.12
Nodes (13): admin, env, evSeconds(), extra, extraSeconds, headers, missing, missingSeconds (+5 more)

### Community 46 - "Charts.tsx"
Cohesion: 0.17
Nodes (13): h(), TeamLeadCharts(), BillableDonut(), hrs(), AreaPoint, chartKindListeners, chartKindSubscribe(), Donut() (+5 more)

### Community 47 - "Sidebar.tsx"
Cohesion: 0.17
Nodes (9): EmploymentCard(), BrandMark(), BrandMarkProps, PIECES, getUserInfo(), Sidebar(), TourReplayButton(), effectiveNameOf() (+1 more)

### Community 48 - "OAuth Success Path Check"
Cohesion: 0.18
Nodes (15): accessTokenFor(), app, arriveFromProvider(), arriveFromProviderStable(), b64(), build, cleanup(), currentUser (+7 more)

### Community 49 - "People Live Source Check"
Cohesion: 0.12
Nodes (14): active, activeWithTime, admin, archivedWithTime, distinctWeekly, env, future, linked (+6 more)

### Community 50 - "check-overview-filters.mjs"
Cohesion: 0.12
Nodes (11): board, boardPresets, boardQueries, filters, filtersCode, minePresets, page, pageCode (+3 more)

### Community 51 - "nav-icons.tsx"
Cohesion: 0.06
Nodes (28): DesktopSidebarShell(), MobileSidebarDrawer(), MobileSidebarProps, IconDot(), IconPanelCollapse(), IconPanelExpand(), IconProps, NAV_ICONS (+20 more)

### Community 52 - "No Mock People Check"
Cohesion: 0.13
Nodes (13): codeOnly(), files, invite, inviteAction, MOCK_TABLES, MOCKUP_NAMES, nameHits, read() (+5 more)

### Community 53 - "check-server-action-auth.mjs"
Cohesion: 0.13
Nodes (11): app, authCookie, build, cleanup(), now, restoreTsconfig(), server, session (+3 more)

### Community 54 - "dashboard/page.tsx"
Cohesion: 0.25
Nodes (16): bucketRange(), BUCKETS, GROUPS, one(), TrackingTimeDashboardPage(), capacityByMember(), customerConcentration(), serviceMixByMonth() (+8 more)

### Community 55 - "Marketing Demo Page"
Cohesion: 0.12
Nodes (6): EASE, FEATURES, NOTE: preload must stay "none". With preload="metadata" Chrome starts a, STACK, STATS, T

### Community 56 - "[userId]/page.tsx"
Cohesion: 0.14
Nodes (21): AdminUserDetailPage(), orNa(), Params, IDLE, WeeklyHoursForm(), Database, ADMIN_ENTRY_LIMIT, AdminEntryRow (+13 more)

### Community 57 - "Identity Linking Check"
Cohesion: 0.13
Nodes (11): anon, byEmail, detailed, env, forks, H, linkedUsers, mismatched (+3 more)

### Community 58 - "No Mock Data Check"
Cohesion: 0.14
Nodes (7): dash, hse, live, MOCK_TABLES, page, REPORTING_FILES, syncBar

### Community 59 - "TrackingTime Sync Script"
Cohesion: 0.14
Nodes (7): args, DRY_RUN, ENV, FULL, NO_LINK, SINCE_LAST, YEAR

### Community 60 - "TimerBar.tsx"
Cohesion: 0.29
Nodes (11): TimerBarSlot(), currentPersonId(), discardTimer(), startTimer(), stopTimer(), TimerResult, formatElapsed(), TimerBar() (+3 more)

### Community 61 - "Invite OAuth Model Check"
Cohesion: 0.15
Nodes (11): admin, byEmail, env, forked, invitedPending, multi, oauthLinked, profileIds (+3 more)

### Community 62 - "OAuth Callback Check"
Cohesion: 0.17
Nodes (11): buttons, fn, hostile, iCall, iMissingCode, iProviderCheck, iSet, leaks (+3 more)

### Community 63 - "Time Member Linking"
Cohesion: 0.18
Nodes (11): APPLY, authUsers, db, ENV, memberEmails, norm(), personIdByUser, plan (+3 more)

### Community 64 - "Marketing Video Page"
Cohesion: 0.17
Nodes (7): CONNECTORS, Feature, FEATURES, Stat, StatCard(), STATS, useCountUp()

### Community 65 - "Admin User Writes Check"
Cohesion: 0.17
Nodes (7): actions, admin, anon, dir, env, req, stub

### Community 66 - "Deployed Overview Check"
Cohesion: 0.17
Nodes (9): admin, anonClient, day, env, expectTotalHours, now, SITE, thisMonday (+1 more)

### Community 67 - "Profile RLS Check"
Cohesion: 0.17
Nodes (6): anon, anonHeaders, env, fixtureBytes, service, url

### Community 68 - "Sync & Drilldown Check"
Cohesion: 0.18
Nodes (10): FRESHNESS, IMPORT, LINKER, PAGE, PANELS, PKG, QUERIES, read() (+2 more)

### Community 69 - "Trend Window Check"
Cohesion: 0.17
Nodes (10): ascending, dashboard, emptyWindow, getter, newWindow, oldWindow, overview, shortWindow (+2 more)

### Community 70 - "User Management Check"
Cohesion: 0.21
Nodes (8): actionsAs(), admin, compile(), created, dir, env, posix(), req

### Community 71 - "Hours Definitions Explainer"
Cohesion: 0.18
Nodes (10): admin, archived, byMonth, DEFINITIONS, env, h(), rows, scored (+2 more)

### Community 72 - "Asana Backlog Generator"
Cohesion: 0.21
Nodes (11): addWorkingDays(), COLUMNS, csv, csvCell(), cursor, RFC-4180, PHASES, rows (+3 more)

### Community 73 - "Dashboard Cost Measurement"
Cohesion: 0.17
Nodes (10): env, gotParallel, headers, pages, pageTimes, WHY: the user asked for "quick reponses" and nothing in this module has ever, SELECT, t0 (+2 more)

### Community 74 - "check-people-filters-live.mjs"
Cohesion: 0.25
Nodes (5): admin, anon, cookies, env, errors

### Community 75 - "try-policy-verification-paths.mjs"
Cohesion: 0.20
Nodes (7): anyWorks, cli, credPath, env, logDir, results, tokens

### Community 76 - "Entry Policy Equivalence Check"
Cohesion: 0.18
Nodes (7): after, before, ROLES, schemaSrc, shippedMatch, text, wide

### Community 77 - "TaskBoardView.tsx"
Cohesion: 0.23
Nodes (11): createSection(), createTask(), AddTaskForm(), AddSectionForm(), TaskBoardView(), TaskListView(), usePager(), BoardParent (+3 more)

### Community 78 - "Profile Actions Check"
Cohesion: 0.20
Nodes (8): ACTIONS, bodies, changePasswordBody, constants, functionBody(), rawConstants, rawSrc, src

### Community 79 - "Card.tsx"
Cohesion: 0.15
Nodes (14): CustomerPortfolioCharts(), h(), SLICE_COLORS, CustomerPortfolioView, BAND, CapacityPanel(), h(), Card() (+6 more)

### Community 80 - "Stale Total Tracing"
Cohesion: 0.18
Nodes (8): admin, archived, CANDIDATES, env, pageSrc, rows, TODAY, year

### Community 81 - "apply-rls-hoisting.mjs"
Cohesion: 0.22
Nodes (6): admin, alreadyHoisted, client, env, qualNow, ROLLBACK

### Community 82 - "Agent File References Check"
Cohesion: 0.20
Nodes (6): allFiles, fs, path, pkg, results, total

### Community 83 - "Approval Error Handling Check"
Cohesion: 0.20
Nodes (8): actions, actionsPath, all, board, boardPath, checks, fs, path

### Community 84 - "Org Chart Check"
Cohesion: 0.20
Nodes (4): dir, mod, peopleStub, req

### Community 85 - "Schema Execution Check"
Cohesion: 0.20
Nodes (8): expectedFns, expectedTables, got, gotFns, missingFns, missingTables, sql, upd

### Community 86 - "Time Write Path Check"
Cohesion: 0.20
Nodes (5): ACTIONS, here, PAGE, root, TRACKER

### Community 87 - "Member Provisioning Script"
Cohesion: 0.20
Nodes (9): admin, APPLY, eligible, env, INVITE, profiledUserIds, ROLE_MAP, skipped (+1 more)

### Community 88 - "formatSeconds"
Cohesion: 0.17
Nodes (10): clock(), EntryRow(), formatDayHeading(), TimeEntryList(), TimeTotalsStrip(), WeekSummaryTable(), TimeEntryRow, TimeTotals (+2 more)

### Community 89 - "Google Client Check"
Cohesion: 0.22
Nodes (6): accounts, adcPath, env, needsReauth, probe, token

### Community 90 - "Schema Order Check"
Cohesion: 0.22
Nodes (8): assertions, definedFunctions, definedTables, fs, knownFnNames, lines, problems, sql

### Community 91 - "SSO Provider Check"
Cohesion: 0.25
Nodes (7): anon, env, get(), needed, probe(), siteUrl, url

### Community 92 - "Time Org Chart View Check"
Cohesion: 0.22
Nodes (7): executable, FORBIDDEN, leaked, migration, missing, names, REQUIRED

### Community 93 - "Agent Claim Recheck"
Cohesion: 0.22
Nodes (6): { execFileSync }, files, fs, graders, rerunExists, untested

### Community 95 - "ReportPanels.tsx"
Cohesion: 0.36
Nodes (6): age(), FreshnessBanner(), hrs(), stamp(), TotalsStrip(), SyncFreshness

### Community 96 - "Agent Claims Check"
Cohesion: 0.25
Nodes (6): board, firstFn, firstRolePolicy, fs, pkg, schema

### Community 97 - "check-dashboard-acceptance.mjs"
Cohesion: 0.25
Nodes (5): admin, anonClient, app, env, results

### Community 98 - "Economics Scope Check"
Cohesion: 0.25
Nodes (3): callAt, pageSrc, unattributed

### Community 99 - "Lint Scope Check"
Cohesion: 0.25
Nodes (6): eslintCfg, eslintCfgRaw, fs, gitignore, gitNextDirs, globCoversAll

### Community 100 - "Login Redirect Safety Checks"
Cohesion: 0.29
Nodes (6): fn, hostile, naive(), naiveLeaks, safeRedirect, src

### Community 101 - "check-duration-parsing.mjs"
Cohesion: 0.39
Nodes (6): check(), eq(), fmt(), rejects, formatDuration(), parseDuration()

### Community 102 - "Page Length Render Check"
Cohesion: 0.25
Nodes (4): admin, anon, cookies, env

### Community 103 - "Parallel Paging Performance Test"
Cohesion: 0.25
Nodes (4): CASES, env, root, supabase

### Community 104 - "Permissions RLS Parity Check"
Cohesion: 0.29
Nodes (6): as(), can(), codeKeys, dbSet, missingInCode, missingInDb

### Community 105 - "Provisioned Access Verification"
Cohesion: 0.25
Nodes (6): admin, anon, asThem, env, memberIdsSeen, subject

### Community 106 - "Remote Deploy State Check"
Cohesion: 0.25
Nodes (4): checks, { execFileSync }, head, remoteFiles

### Community 107 - "RLS Query Hoisting Benchmark"
Cohesion: 0.29
Nodes (5): admin, anon, env, median(), runs()

### Community 108 - "User Management UI Check"
Cohesion: 0.25
Nodes (5): admin, anon, cookies, env, errors

### Community 109 - "TrackingTime Integration Check"
Cohesion: 0.29
Nodes (5): HERE, SOURCE, threw(), tt, unwrap()

### Community 110 - "AI Provider Credential Probes"
Cohesion: 0.39
Nodes (6): CRED_PATH, DEFAULT_PROJECT, freshAccessToken(), loadStoredCreds(), oauthClient(), auth

### Community 111 - "Deployment Wait Helper"
Cohesion: 0.25
Nodes (7): admin, anon, cookie, env, MAX_WAIT_MS, parts, started

### Community 112 - "Root Layout And Fonts"
Cohesion: 0.25
Nodes (6): cormorant, jetbrains, metadata, plusJakarta, poppins, spaceGrotesk

### Community 113 - "Auth Route Gate Checks"
Cohesion: 0.29
Nodes (4): middleware, publicRoutes, publicRoutesBlock, routes

### Community 114 - "Charts UI Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 115 - "Live Dashboard Check"
Cohesion: 0.29
Nodes (4): admin, anonClient, app, env

### Community 116 - "People And Filters UI Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 117 - "Records Tabs Source Check"
Cohesion: 0.29
Nodes (4): dashSrc, sheetsSrc, tabsSrc, timeSrc

### Community 118 - "Redirect Allowlist Check"
Cohesion: 0.29
Nodes (5): cases, env, failures, SITE, URL_BASE

### Community 119 - "Team Analysis UI Check"
Cohesion: 0.38
Nodes (5): admin, cookiesFor(), env, pageText(), wait()

### Community 120 - "Theme And Figures Check"
Cohesion: 0.29
Nodes (5): admin, anon, cookies, env, errors

### Community 122 - "Google OAuth Error Diagnosis"
Cohesion: 0.29
Nodes (6): env, g, googleUrl, SIGNS, state, text

### Community 123 - "check-trackingtime-report.mjs"
Cohesion: 0.15
Nodes (9): CODE, ENV, here, NAV_SRC, NOW, PAGE_SRC, PROJECTS, root (+1 more)

### Community 124 - "check-team-select.mjs"
Cohesion: 0.12
Nodes (13): actionsStub, dir, editable, legacyOptions, legacyRow, React, readOnly, readOnlyLegacy (+5 more)

### Community 125 - "Auth Session Middleware"
Cohesion: 0.38
Nodes (5): config, proxy(), PUBLIC_PREFIXES, PUBLIC_ROUTES, updateSession()

### Community 126 - "Live Database Audit"
Cohesion: 0.33
Nodes (3): counts, env, findings

### Community 130 - "Redirect Guard Logic Check"
Cohesion: 0.33
Nodes (3): backslash, HOSTILE, src

### Community 131 - "Time Page Live Readiness"
Cohesion: 0.33
Nodes (3): env, headers, url

### Community 132 - "Time Page Data Check"
Cohesion: 0.33
Nodes (4): dashboardRepair, hrefRepair, schemaSql, utilisation

### Community 133 - "Policy Verification Query Check"
Cohesion: 0.40
Nodes (4): byFix, query, run(), schema

### Community 134 - "Null Assignments Diagnosis"
Cohesion: 0.33
Nodes (4): env, nameToProjects, nulls, personName

### Community 135 - "Migration Module Generator"
Cohesion: 0.33
Nodes (5): beforeStart, body, out, schema, startMarker

### Community 136 - "OAuth Invite Linking Proof"
Cohesion: 0.33
Nodes (4): admin, created, env, stamp

### Community 137 - "Economics Access Recheck"
Cohesion: 0.33
Nodes (4): admin, anon, env, execClient

### Community 138 - "Demo Video Recorder"
Cohesion: 0.33
Nodes (4): OUT_DIR, Scene, SCENES, SCREENSHOTS_DIR

### Community 139 - "Sync Secrets Setup"
Cohesion: 0.33
Nodes (4): dryRun, env, missing, REQUIRED

### Community 140 - "Yearly Screenshot Capture"
Cohesion: 0.33
Nodes (4): admin, anon, app, env

### Community 141 - "Policy Gate Failure Verification"
Cohesion: 0.33
Nodes (3): final, original, originalHash

### Community 142 - "projects/page.tsx"
Cohesion: 0.15
Nodes (23): LeavePage(), metadata, ProfilePage(), h(), ProjectDetailPage(), one(), ProjectsPage(), SORT_KEYS (+15 more)

### Community 144 - "Deploy Skew Check"
Cohesion: 0.40
Nodes (3): config, layout, stripped

### Community 145 - "Modules RLS Check"
Cohesion: 0.50
Nodes (3): as(), byCmd, modulesFor()

### Community 148 - "Production Config Check"
Cohesion: 0.40
Nodes (4): env, refs, scripts, unique

### Community 150 - "Sync Freshness Check"
Cohesion: 0.40
Nodes (4): env, headers, hours, lastOk

### Community 151 - "Backend Agent Grading"
Cohesion: 0.40
Nodes (3): control, KEY, treatment

### Community 152 - "Testing Agent Grading"
Cohesion: 0.40
Nodes (4): control, KEY, missedByControl, treatment

### Community 154 - "Anonymous Write Verification"
Cohesion: 0.40
Nodes (3): after, env, rows

### Community 155 - "team-lead/page.tsx"
Cohesion: 0.12
Nodes (26): toggleRolePermission(), AdminRolesPage(), PermissionToggle(), handleToggle(), Props, TeamLeadPage(), metadata, PortalPage() (+18 more)

### Community 156 - "Next.js Build Config"
Cohesion: 0.50
Nodes (3): nextConfig, NOTE: do NOT add an `env: { NEXT_PUBLIC_SITE_URL: ... }` block here., requiredEnvVars

### Community 165 - "Frontend Agent Grading"
Cohesion: 0.50
Nodes (3): control, KEY, treatment

### Community 166 - "Machine State Export"
Cohesion: 0.83
Nodes (3): Add-Result(), Copy-One(), Copy-Tree()

### Community 167 - "Requirements Traceability Run"
Cohesion: 0.50
Nodes (3): needsServer, REQUIREMENTS, results

### Community 168 - "Provider Status Endpoint"
Cohesion: 0.67
Nodes (3): classify(), GET(), PROVIDERS

### Community 170 - "Member Utilisation Bounding"
Cohesion: 0.50
Nodes (3): time.member, time.member_utilisation, time.entry

### Community 171 - "Project Sections And Tasks"
Cohesion: 0.67
Nodes (3): public.project_sections, public.project_tasks, time.project

### Community 214 - "time-dashboard.ts"
Cohesion: 0.13
Nodes (28): CustomerTable(), EconomicsTable(), eur(), hrs(), MemberTable(), OrgTotalsStrip(), ProjectTable(), relativeDays() (+20 more)

### Community 226 - "check-oauth-success-path-live.mjs"
Cohesion: 0.25
Nodes (4): admin, app, env, stamp

### Community 227 - "measure-latency-variance.mjs"
Cohesion: 0.29
Nodes (4): admin, anon, app, env

### Community 228 - "read-prod-total.mjs"
Cohesion: 0.50
Nodes (3): admin, anon, env

### Community 231 - "database.types.ts"
Cohesion: 0.20
Nodes (9): CompositeTypes, Constants, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables, TablesInsert (+1 more)

### Community 232 - "SecurityCard.tsx"
Cohesion: 0.31
Nodes (6): changePassword(), IDLE, SecurityCard(), PasswordStrengthBar(), getPasswordStrength(), MIN_PASSWORD_LENGTH

### Community 233 - "check-hr-role-migration.mjs"
Cohesion: 0.33
Nodes (4): execKeys, hrKeys, migration, names

### Community 234 - "types.ts"
Cohesion: 0.08
Nodes (24): BudgetPanel(), euro(), getProjectDetail(), nestTasks(), ApprovalDecisionRow, BillableTrend, BillableTrendPoint, ExecutiveMetricRow (+16 more)

### Community 235 - "label"
Cohesion: 0.20
Nodes (9): dir, require, hrs(), label(), labelWithDate(), TrendChart(), TrendPoint, isoWeekNumber() (+1 more)

### Community 236 - "profile-actions.ts"
Cohesion: 0.28
Nodes (14): AdminActionResult, adminDeleteEntry(), adminUpdateEntry(), adminUpdateProfile(), adminUpdateWeeklyHours(), authorise(), Authorised, Refused (+6 more)

### Community 238 - "people/actions.ts"
Cohesion: 0.38
Nodes (5): setBillableRate(), SetBillableRateResult, BillableRatePanel(), handleSubmit(), BillableValueRow

### Community 239 - "TeamLeadExplorer.tsx"
Cohesion: 0.18
Nodes (14): groupByTeam(), h(), TeamAnalysis(), TeamAnalysisSection(), TeamBlock, h(), TeamDeepAnalysis(), TeamChoice (+6 more)

### Community 240 - "Avatar.tsx"
Cohesion: 0.46
Nodes (4): Avatar(), colorForName(), initialsOf(), PALETTE

### Community 241 - "check-profile-admin.mjs"
Cohesion: 0.25
Nodes (6): actions, code, deleteBody, entryBody, profileBody, src

### Community 243 - "ThemeToggle.tsx"
Cohesion: 0.43
Nodes (4): getServerSnapshot(), getSnapshot(), subscribe(), ThemeToggle()

### Community 244 - "TimeViewTabs.tsx"
Cohesion: 0.47
Nodes (4): formatDay(), TimeViewTabs(), shiftDay(), shiftWeek()

## Knowledge Gaps
- **1237 isolated node(s):** `writes`, `server`, `stubEnv`, `build`, `app` (+1232 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `createClient` to `users/page.tsx`, `org-actions.ts`, `projects/page.tsx`, `time/page.tsx`, `time/actions.ts`, `TeamLeadBoard.tsx`, `profile/actions.ts`, `team-lead/page.tsx`, `OrgChartView.tsx`, `MyLeavePanel.tsx`, `(app)/page.tsx`, `projects/actions.ts`, `Sidebar.tsx`, `dashboard/page.tsx`, `[userId]/page.tsx`, `TimerBar.tsx`, `SecurityCard.tsx`, `profile-actions.ts`, `people/actions.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `label()` connect `label` to `check-dashboard-acceptance.mjs`, `check-oauth-success-path-live.mjs`, `measure-latency-variance.mjs`, `check-time-acceptance.mjs`, `SSO Provider Check`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `Database` connect `[userId]/page.tsx` to `createClient`, `users/page.tsx`, `AuthShell.tsx`, `overview-live.ts`, `database.types.ts`, `trackingtime-report.ts`, `types.ts`, `people-live.ts`, `team-lead-live.ts`, `time/page.tsx`, `time-dashboard.ts`, `projects-live.ts`, `OrgChartView.tsx`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `writes`, `server`, `stubEnv` to the rest of the system?**
  _1237 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.014388489208633094 - nodes in this community are weakly interconnected._
- **Should `Standalone Runtime Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.060678962844159315 - nodes in this community are weakly interconnected._
- **Should `Roles & Permissions Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.05384615384615385 - nodes in this community are weakly interconnected._