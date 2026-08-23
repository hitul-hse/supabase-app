# Management Dashboard – Übergabe und Restarbeiten

**Stand:** 23.08.2026
**Branch:** `feature/customer-dashboard-development`
**Aktueller Feature-Commit:** `1e2e3a6`

## Bereits im Branch enthalten

Der Branch enthält die Management-Dashboard-Module und den kontrollierten Wechsel des Projektverantwortlichen:

- Vertragsstunden und Auslastungsausblick
- Service Overview
- Employee Ownership Overview
- Data Quality Dashboard
- Project Risks
- Multi-Service Matrix
- Customer Portfolio
- Customer-Mapping-Read-Model über stabile Order Number und Legal Entity
- Verantwortlichenwechsel über Änderungsantrag
- `projects:write`-Berechtigungsprüfung
- Change Lock über einen offenen Antrag je Projekt
- Vier-Augen-Freigabe
- append-only Change Events
- Datenbankmigration `20260823090000_add_project_change_control.sql`

## Lokale, nicht in diesem Feature-Commit enthaltene Änderungen

Diese Dateien lagen beim Commit bereits lokal verändert oder unversioniert vor. Sie wurden bewusst nicht automatisch in den Change-Control-Commit aufgenommen:

### Development Auth und lokaler Direktzugang

- `src/app/auth/login/page.tsx`
- `src/app/auth/login/actions.ts`
- `src/lib/auth/`
- `src/components/SidebarNav.tsx`
- `src/components/LogoutButton.tsx`
- `src/utils/supabase/middleware.ts`
- `src/utils/supabase/require-profile.ts`
- `src/utils/supabase/require-user.ts`
- `src/utils/supabase/management-read.ts`

Diese Änderungen sind ausschließlich für die lokale Entwicklung gedacht. Production Auth darf daraus nicht übernommen werden, sofern kein eigener Review dafür erfolgt.

### Lokale Excel-Importgrundlage

- `scripts/import-management-excel.mjs`

Der Import wurde im eigenen Entwicklungsprojekt ausgeführt. Die Quelldatei liegt lokal und ist nicht Bestandteil des Repositories. Für ein anderes Supabase-Projekt muss der Import separat geprüft, konfiguriert und freigegeben werden.

### Fachliche Dokumente

- `docs/management/project-risk-resolution-actions.md`
- `docs/management/project-risks-model.md`

Diese Dokumente sind fachliche Entwürfe und enthalten keine ausführbare Umsetzung.

## Schritte für den Kollegen beim Merge

1. Feature-Branch in das Zielprojekt übernehmen.
2. Migration `20260823090000_add_project_change_control.sql` im vorgesehenen Migrationsprozess anwenden.
3. Prüfen, dass die Zielumgebung die Berechtigung `projects:write` korrekt auflöst.
4. Management Dashboard mit einem echten authentifizierten Benutzer testen.
5. Verantwortlichenwechsel mit zwei unterschiedlichen berechtigten Benutzern testen.
6. Prüfen, dass ein Benutzer seinen eigenen Antrag nicht freigeben kann.
7. Audit-Events auf Antrag, Ablehnung und Anwendung prüfen.
8. `npm run lint` und `npm run build -- --webpack` ausführen.

## Sicherheitsgrenzen

- Development Auth darf keine produktiven Schreiboperationen ermöglichen.
- Mutation läuft ausschließlich über die Datenbankfunktionen.
- Direkte Updates der Change-Request- und Event-Tabellen sind nicht freigegeben.
- Customer Master bleibt führendes System für Legal Entities und Kundenbeziehungen.
- Customer Mapping darf nicht über Freitext erfolgen.
- Secrets und `.env.local` werden nicht committed.

## Noch offen

- Servicebezogenes Replacement-Modell: Verantwortlicher und Replacement sind noch nicht als bestätigte Beziehung modelliert.
- Replacement darf deshalb weiterhin nur als `n/a` angezeigt werden.
- Für produktive Umgebungen müssen Server-Environment und DB-Read-Zugriff entsprechend der Zielarchitektur geprüft werden.
- Lokale Excel-Daten müssen für ein Zielprojekt separat fachlich freigegeben und importiert werden.

## Worktree-Hinweis

Der Commit `1e2e3a6` enthält nur die geprüfte Management-Änderung. Andere lokale Änderungen bleiben absichtlich außerhalb dieses Commits und müssen separat reviewed, committed oder verworfen werden.
