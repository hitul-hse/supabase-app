# ADR-002: Customer Master Target Model and Import Architecture

- Status: Accepted
- Datum: 2026-08-22

## Beziehung zu ADR-001

Diese Entscheidung konkretisiert ADR-001: Single Source of Truth und
Stammdatenlogik für Customer Master. Sie legt die fachlichen Schema-Grenzen,
das Zielmodell und die Importreihenfolge fest. Sie ändert keine Ownership aus
ADR-001 und ersetzt Lexware nicht als SSOT für abrechnungsrelevante
Ursprungsdaten und Belege.

Es besteht kein Widerspruch zu ADR-001. Die dort ausdrücklich offengelassene
konkrete Tabellenstruktur wird mit dieser ADR verbindlich festgelegt.

## 1. Schema-Architektur

Die fachliche Trennung lautet verbindlich:

```text
raw
→ unveränderte Payloads aus Quellsystemen

stg
→ typisierte Import-, Validierungs- und Review-Ebene

crm
→ kanonischer HSE Customer Master

projects
→ kanonische HSE Projekte / Aufträge

time
→ TrackingTime-Zeitdaten und zunächst bestehender Servicekatalog

public
→ bestehende Anwendung / Kompatibilitätsschicht
```

`raw` und `stg` sind keine kanonischen Datenquellen. `crm` besitzt die
fachlichen Kundenbeziehungen; `projects` besitzt die kanonischen Projekte und
Aufträge. `time` bleibt zunächst für TrackingTime-Daten und den bestehenden
Servicekatalog zuständig.

Die bestehenden Tabellen `time.customer`, `time.project` und `public.projects`
werden nicht als fachlich identische Parallelmodelle zum Customer Master
interpretiert. Sie bleiben während der Übergangsphase Quell-, Betriebs- oder
Kompatibilitätsstrukturen.

## 2. PostgREST- und Browserzugriff

Für die Exposed Schemas gilt:

- `public` darf exponiert bleiben.
- `graphql_public` darf exponiert bleiben.
- `time` bleibt vorerst exponiert, weil die bestehende Anwendung dort
  operative Daten liest.
- `raw` darf nicht für Browser- oder PostgREST-Zugriff exponiert sein.
- `stg` darf nicht für Browser- oder PostgREST-Zugriff exponiert sein.
- `crm` und `projects` werden erst nach Einrichtung passender RLS-Regeln gezielt
  für die Anwendung exponiert.

Wichtiger Ist-Zustand: `raw` wurde in der neuen Supabase-Instanz technisch
  bereits exponiert. Vor einem produktiven Customer-Master-Betrieb muss `raw`
  wieder aus den Exposed Schemas entfernt werden. Diese ADR nimmt diese
  Konfigurationsänderung noch nicht vor.

Rohdaten und Staging-Datensätze dürfen nicht über einen Browser-Client
zugänglich sein. Import- und Review-Operationen erfolgen serverseitig oder
über einen entsprechend geschützten Service- beziehungsweise Admin-Pfad.

## 3. Legal Entity

Die kanonische Tabelle ist:

`crm.legal_entity`

Der technische Primary Key ist:

`id uuid`

Mindestens enthalten sind:

- `legal_name`
- `legal_form`
- `vat_id`
- `registration_court`
- `registration_number`
- `country_code`
- Lifecycle-Felder
- Review-Felder

Der Firmenname ist nicht allein eindeutig. Es gibt keine automatische
Zusammenführung ausschließlich aufgrund ähnlicher Namen oder Adressen.

Die rechtliche Identität wird vor einer Zusammenführung anhand belastbarer
Merkmale geprüft, insbesondere USt-ID, Handelsregisterdaten und vollständiger
rechtlicher Firmierung.

## 4. Lexware Customer

Die kanonische Quellensystem-Tabelle ist:

`crm.lexware_customer`

Ein Lexware-Kontakt beziehungsweise Lexware-Kundenstammdatensatz ist nicht
automatisch eine Legal Entity.

Mindestens enthalten sind:

- `id uuid`
- `legal_entity_id uuid null`
- `location_id uuid null`
- `customer_number text`
- `source_account_ref text`
- Original- beziehungsweise Billing-Bezeichnung
- Rechnungsadresse
- Ansprechpartner
- aus Lexware stammende USt-ID
- Lifecycle-Felder
- Review-Felder

Verbindlich ist:

```sql
UNIQUE (source_account_ref, customer_number)
```

Die Lexware-Kundennummer wird unverändert als externe Business-Referenz
gespeichert. Mehrere Lexware-Kundennummern dürfen derselben Legal Entity
zugeordnet werden. `legal_entity_id` bleibt bis zur bestätigten Entity
Resolution nullable.

Angebote, Auftragsbestätigungen und andere abrechnungsrelevante Belege bleiben
fachlich bei Lexware. Der Customer Master darf dazu Referenzen, Suchdaten oder
Caches halten, übernimmt aber nicht die Ownership der Lexware-Ursprungsbelege.

## 5. Location

Die kanonische Tabelle ist:

`crm.location`

Eine Location ist keine Legal Entity und referenziert genau eine Legal Entity.

Eine abweichende Adresse allein erzeugt niemals automatisch einen neuen Kunden.

Standorte können separat geführt und über Projekte, Lexware-Kontakte und
Rahmenverträge referenziert werden.

## 6. Corporate Group

Unternehmensverbünde werden separat modelliert:

- `crm.corporate_group`
- `crm.corporate_group_member`

Rechtlich eigenständige Gesellschaften behalten jeweils:

- ihre eigene Legal Entity
- ihre eigenen Lexware-Kundennummern
- ihre eigenen Projekte und Aufträge

Die Gruppenzugehörigkeit ist ausschließlich eine fachliche Beziehung und
ersetzt keine Legal Entity.

## 7. Aliases

Aliases werden in folgender Tabelle gespeichert:

`crm.legal_entity_alias`

Aliases dienen für:

- historische Namen
- Kurzbezeichnungen
- alternative Schreibweisen
- Quellsystembezeichnungen

Ein Alias darf die offizielle Legal Entity nicht automatisch verändern. Die
Auflösung eines Alias ist ein Such- und Review-Hinweis, keine automatische
Merge-Anweisung.

## 8. Framework Agreements

Rahmenverträge werden separat modelliert:

- `crm.framework_agreement`
- `crm.framework_agreement_party`
- `crm.framework_agreement_project`

Ein Rahmenvertrag ist weder:

- Legal Entity
- Corporate Group
- Location
- Projekt

Die Beziehung zu mehreren Legal Entities und Projekten wird über die
Beziehungstabellen hergestellt.

## 9. Project / Order

Die kanonische Tabelle ist:

`projects.project_order`

Der technische Identifier ist:

`id uuid`

Der fachliche Business Identifier ist:

`order_number text not null`

`order_number` ist HSE-weit global eindeutig. Daher gilt verbindlich:

```sql
UNIQUE (order_number)
```

Beispiel:

```text
10443_00253_104_01
```

Mehrere Quelldatensätze mit derselben Order-Number werden zunächst als
Referenzen auf dasselbe fachliche Projekt betrachtet. Widersprüchliche Inhalte
sind ein Data-Quality-Fall und dürfen nicht stillschweigend überschrieben
werden.

Das kanonische Projekt kann auf Legal Entity, Location und Framework Agreement
verweisen. Bestehende Task-, Section- und Comment-Strukturen bleiben während
der Einführung über Kompatibilitätsbeziehungen erreichbar.

## 10. Service

In Phase 1 wird `time.service` weiterverwendet.

Es wird vorerst keine parallele `crm.service`- oder `projects.service`-Tabelle
angelegt. Der bestehende Servicekatalog bleibt im Verantwortungsbereich des
Time-Moduls.

Eine spätere Änderung der fachlichen Ownership von Services muss separat
entschieden werden. Ein solcher Wechsel darf nicht durch eine zweite, parallel
gepflegte Service-Tabelle eingeführt werden.

## 11. External References

Externe IDs dürfen niemals technische Primary Keys des Customer Masters sein.
Alle Beziehungen zu Quellsystemen verwenden interne technische IDs und
separate externe Referenzen.

Phase 1 muss stabile Beziehungen zu mindestens folgenden Systemen ermöglichen:

- Lexware
- TrackingTime
- Asana
- Factorial

Die Lexware-Kundennummer bleibt unverändert in `crm.lexware_customer` erhalten.

In Phase 1 wird keine unnötig komplexe polymorphe
`crm.external_reference`-Struktur vorausgesetzt. Stattdessen werden für die
tatsächlich benötigten Beziehungen typisierte Referenzen verwendet:

- Lexware: `crm.lexware_customer`
- TrackingTime-Kunden und -Projekte: typisierte Referenzstrukturen mit
  `external_id`, `account_ref` und interner UUID
- Asana-Projekte: typisierte Projekt-Referenz mit Workspace-/Account-Referenz
- Factorial-Personen: Wiederverwendung der bestehenden
  `public.people.factorial_employee_id`-Zuordnung

Jede typisierte Referenz muss mindestens enthalten:

- interne UUID des kanonischen Datensatzes
- `external_id text`
- `source_account_ref` beziehungsweise Workspace-Referenz, falls erforderlich
- `source_system`
- Unique Constraint auf der Quellsystem-ID innerhalb ihres Geltungsbereichs

Eine generische `crm.external_reference` darf später eingeführt werden, wenn
ihre referenzielle Integrität ausdrücklich abgesichert werden kann. Eine
polymorphe Struktur ohne überprüfbare Zuordnung ist nicht zulässig.

## 12. Responsibilities

Die bestehende Personenbasis `public.people` wird wiederverwendet.

In Phase 1 wird keine unnötig generische polymorphe Responsibility-Architektur
eingeführt.

Projektverantwortlichkeiten dürfen zunächst projektspezifisch modelliert
werden, zum Beispiel über eine typisierte Tabelle wie:

`projects.project_responsibility`

mit einer festen FK auf `projects.project_order` und einer festen FK auf
`public.people`.

Eine übergreifende Responsibility-Domain für Legal Entity, Corporate Group,
Framework Agreement und Project wird erst eingeführt, wenn ein konkreter
Use Case dies rechtfertigt.

## 13. Import-Architektur

Der verbindliche Datenfluss lautet:

```text
Lexware / anderes Source System
        ↓
raw
        ↓
stg.import_batch
        ↓
stg.import_record
        ↓
Validation
        ↓
Entity Resolution
        ↓
REVIEW_REQUIRED bei Unsicherheit
        ↓
manuelle Freigabe
        ↓
crm / projects
```

Ein Quellsystem darf niemals Rohdaten unmittelbar in kanonische Customer-
Master-Tabellen schreiben.

`raw` bewahrt die unveränderte Payload. `stg` enthält Importlauf, Zeilennummer,
normalisierte Kandidatenwerte, Validierungsfehler, vorgeschlagene Zuordnungen
und Review-Status. Erst ein freigegebener Datensatz darf in `crm` oder
`projects` übernommen werden.

## 14. Review-Regel

Für kanonische und Staging-Daten gilt einheitlich:

```text
unreviewed
review_required
in_review
approved
rejected
```

Unsichere Zuordnungen dürfen nicht automatisch kanonisiert werden. Das gilt
insbesondere für:

- mehrere mögliche Legal Entities
- ähnliche Firmennamen
- mehrere Kundennummern
- mehrere Standorte
- Unternehmensverbünde
- widersprüchliche Auftragsnummern
- fehlende rechtliche Identifikatoren

Review-Datensätze müssen mindestens einen Review-Grund sowie Zeitstempel und
verantwortliche prüfende Person speichern.

## 15. Bestehende Systeme nicht ersetzen

Die Einführung des Customer Masters darf bestehende Strukturen zunächst nicht
entfernen oder brechen:

- `time.customer`
- `time.project`
- `public.projects`

Die Migration erfolgt schrittweise. Die bestehende Anwendung bleibt während
der Einführung funktionsfähig. Kompatibilitätsviews oder explizite
Referenzbeziehungen werden vor einer Query- oder UI-Umstellung hergestellt.

Die alten Tabellen dürfen erst stillgelegt werden, wenn alle fachlichen
Verbraucher auf das kanonische Modell umgestellt und verifiziert wurden.

## 16. Konsequenz für den ersten Datenimport

Der erste reale Import ist die Lexware-Kundenliste.

Dabei gilt:

1. Originaldaten vollständig erhalten.
2. Zunächst Import nach `raw` und `stg`.
3. Kundennummer unverändert übernehmen.
4. Keine automatische Zusammenführung aufgrund des Firmennamens.
5. Legal Entity und Location separat bestimmen.
6. Unklare Datensätze auf `review_required` setzen.
7. Erst bestätigte Datensätze in den kanonischen Customer Master übernehmen.

## 17. Konsequenzen

- Der Customer Master erhält eine eindeutige kanonische Ownership für fachliche
  Beziehungen.
- Lexware bleibt Owner der abrechnungsrelevanten Kundendaten und Belege.
- Mehrere Lexware-Kontakte können einer Legal Entity zugeordnet werden.
- Unternehmensverbünde und Rahmenverträge werden nicht in Legal Entities oder
  Projekten versteckt.
- `order_number` ist global eindeutig und bleibt von technischen UUIDs getrennt.
- Unsichere Entity Resolution bleibt sichtbar und manuell prüfbar.
- Die bestehenden operativen Module können während der Einführung weiterlaufen.

## 18. Offene Fragen

Vor der ersten Migration müssen noch bestätigt werden:

- exaktes Format und Spaltenmodell der Lexware-Kundenliste
- fachlicher Geltungsbereich von `source_account_ref`
- konkrete typisierte Referenztabellen für TrackingTime und Asana
- endgültige RLS-Sichtbarkeit für `crm` und `projects`
- Berechtigung, wer Customer-Master-Reviews freigeben darf
- Zeitpunkt und Form der späteren Service-Ownership-Entscheidung
- konkrete Kompatibilitätsviews für `time.customer`, `time.project` und
  `public.projects`
