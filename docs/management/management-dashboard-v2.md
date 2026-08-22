# Management Dashboard V2 – Fachliche Spezifikation

**Status:** Fachlicher Entwurf  
**Scope:** Executive-Steuerung von HSE  
**Datenmodus:** ausschließlich Read Model

## 1. Ziel

Das Management Dashboard V2 soll der Geschäftsführung eine belastbare Übersicht über gebundene Vertragsstunden, verfügbare Kapazität und entstehende Kapazitätsrisiken geben.

Die zentrale Managementfrage lautet:

> Wie viel Kapazität ist durch bestehende Verträge gebunden, wie viel bleibt frei und in welchen Services, Kunden oder Zeiträumen entsteht ein Risiko?

Das Dashboard ist eine Executive-Steuerungsfläche. Es ersetzt weder die operative Zeiterfassung noch den Customer-Master-Workflow.

## 2. Bestehende Funktionen

Die aktuelle Management-Ansicht enthält:

- Vertragsstunden-KPI
- Service- × Mitarbeiter-Matrix
- Summenzeile über alle Services und Mitarbeiter
- Mitarbeiter-Drilldown zu Projekten und Kunden
- Auslastungsausblick auf Basis von 1.304 Planstunden pro Jahr und Mitarbeiter
- Ampellogik für Unterauslastung, gesunde Auslastung und Kapazitätsrisiko

Die bestehende Verteilung berechnet gebundene Stunden aus:

```text
Projekt-Vertragsstunden × person_assignments.share_percent
```

Die Service-Zuordnung nutzt die belastbare Verbindung:

```text
time.project.hub_project_id → public.projects.id → time.service.name
```

Nicht verknüpfte Projekte werden als „Nicht zugeordnet“ ausgewiesen und nicht stillschweigend einer Servicegruppe zugeschlagen.

## 3. V2-Funktionalität

### 3.1 Executive KPIs

| KPI | Fachliche Definition |
|---|---|
| Gebundene Vertragsstunden | Summe der auf Mitarbeiter verteilten Vertragsstunden aus sichtbaren Projekten |
| Verfügbare Kapazität | Planstunden im Betrachtungszeitraum minus gebundene Vertragsstunden |
| Auslastung % | Gebundene Vertragsstunden / verfügbare Planstunden × 100 |
| Freie Kapazität | Verfügbare Planstunden minus gebundene Vertragsstunden; Überbindungen werden separat ausgewiesen |

Nicht zugeordnete Vertragsstunden müssen als Datenqualitätsindikator sichtbar bleiben und dürfen nicht stillschweigend aus der Executive-Summe verschwinden.

### 3.2 Kapazitätsrisiken

| Auslastung | Status | Management-Bedeutung |
|---:|---|---|
| `< 50 %` | Unterauslastung | Freie Kapazität; Vertriebs- oder Staffing-Potenzial prüfen |
| `50–90 %` | Gesunde Auslastung | Normaler operativer Korridor |
| `> 90 %` | Kapazitätsrisiko | Neue Zusagen, Abwesenheiten und Puffer aktiv prüfen |

Die Grenze `90 %` ist eine Frühwarnschwelle, keine harte Buchungssperre.

### 3.3 Service Mix

Der Service Mix zeigt, wie sich gebundene Vertragsstunden auf folgende Executive-Gruppen verteilen:

- DGUV V2
- SiGeKo
- Brandschutz
- Consulting

Die bestehenden Quelldienste werden dafür zentral gruppiert:

| Executive-Gruppe | Quelldienste |
|---|---|
| DGUV V2 | DGUV V2: SiFa / Safety Engineer |
| SiGeKo | SiGeKo / construction coordination; ENERCON SiGeKo / construction coordination |
| Brandschutz | Brandschutzbeauftragter |
| Consulting | Health & Safety Consulting |

Die Gruppierung muss in einer versionierten Mappinglogik gepflegt werden. Freitext-Matching auf Projekt- oder Kundennamen ist nicht zulässig.

### 3.4 Zeitlicher Forecast

Der Forecast zeigt die Entwicklung der gebundenen Kapazität über Quartale:

- Q1–Q4 je Kalenderjahr
- Vertragsstunden je Quartal
- Planstunden je Quartal
- Auslastung je Quartal
- freie Kapazität je Quartal
- auslaufende Verträge
- Quartale mit `>90 %` Auslastung

Ein Forecast muss zwischen gebunden, auslaufend, nicht terminiert und überbucht unterscheiden. Zukünftige Stunden dürfen nicht aus historischen Ist-Stunden abgeleitet werden, solange keine Vertragslaufzeiten vorliegen.

### 3.5 Customer-Master-Verbindung

Die Managementsicht soll Projekte einer kanonischen Legal Entity zuordnen und kundenspezifische Kapazitätsanalysen ermöglichen:

- Vertragsstunden je Legal Entity
- Auslastung je Legal Entity
- freie Kapazität je Kunde
- Services je Legal Entity
- auslaufende oder nicht zugeordnete Projekte je Legal Entity

Die vorgesehene fachliche Referenz ist:

```text
projects.project_order
  → crm.legal_entity
  → crm.trackingtime_project_reference
  → time.project / externe Projekt-ID
```

Die durchgängige Verbindung zur bestehenden `public.projects`-Struktur muss vor einer produktiven Kundenauswertung validiert werden.

## 4. Datenquellen

| Quelle | Verwendung | Status |
|---|---|---|
| `public.projects` | Projektname, Kunde, Vertragsstunden | aktuell verwendet |
| `public.person_assignments` | Mitarbeiter-Projekt-Zuordnung und `share_percent` | aktuell verwendet |
| `public.people` | Mitarbeiteridentität und Sichtbarkeit | aktuell verwendet |
| `time.project` | Hub-Projekt-Verbindung und Servicebezug | aktuell verwendet |
| `time.service` | Servicekatalog | aktuell verwendet |
| `crm.legal_entity` | kanonische Kundeneinheit | vorhanden, Verbindung offen |
| `projects.project_order` | kanonisches Projekt / Order | vorhanden, Verbindung offen |
| `crm.trackingtime_project_reference` | externe Projektverknüpfung | vorhanden, Mapping zu validieren |
| `time.entry` | historische Ist-Stunden | vorhanden |
| `time.member.weekly_hours` | nominelle Wochenkapazität | vorhanden, nicht automatisch Vertragskapazität |
| Abwesenheits- und Feiertagsdaten | verfügbare Netto-Kapazität | aktuell nicht integriert |

## 5. Berechnungen

### 5.1 Gebundene Vertragsstunden

```text
gebundene Stunden je Assignment
  = public.projects.contract_hours
  × public.person_assignments.share_percent / 100
```

Die Summe erfolgt je Mitarbeiter, Service, Kunde und Zeitraum. Es muss fachlich bestätigt werden, dass `share_percent` als Kapazitätsanteil verwendet werden darf; aktuell ist es die gespeicherte Verteilungsbasis.

### 5.2 Planstunden

Die aktuelle Baseline lautet:

```text
1.304 Planstunden/Jahr je Mitarbeiter
```

Sie entspricht 75 % billable capacity. Für Quartale gilt zunächst `1.304 / 4 = 326` Planstunden je Quartal. Der Wert berücksichtigt noch keine individuellen Arbeitszeitmodelle, Feiertage, Abwesenheiten oder Ein- und Austritte.

### 5.3 Auslastung und freie Kapazität

```text
Auslastung % = gebundene Vertragsstunden / Planstunden × 100
freie Kapazität = Planstunden − gebundene Vertragsstunden
```

Positive freie Kapazität und Überbindung müssen getrennt dargestellt werden, damit eine Überlastung nicht durch eine gekappte Null verborgen wird.

### 5.4 Forecast je Quartal

Ein Quartalswert darf nur dann als gebunden gelten, wenn ein Projekt eine aktive Vertragsperiode besitzt:

```text
gebundene Quartalsstunden
  = Vertragsstunden × Anteil der aktiven Vertragstage im Quartal
```

Ohne Start- und Enddatum ist der Forecastwert „nicht bestimmbar“, nicht automatisch die volle Jahresmenge.

## 6. Data Quality Dashboard

### Ziel

Das Data Quality Dashboard schafft Transparenz über die Steuerbarkeit der operativen Projektstammdaten. Es macht sichtbar, bei welchen offenen Projekten eine belastbare Managemententscheidung durch fehlende Verantwortlichkeiten, Referenzen oder Statusinformationen eingeschränkt ist.

### KPIs

| KPI | Bewertung | Bedeutung |
|---|---|---|
| Offene Projekte ohne Verantwortlichen | Kritisch | Das Projekt kann operativ nicht eindeutig gesteuert werden. |
| Offene Projekte ohne Replacement | Prüfen | Es besteht ein Vertretungs- und Ausfallrisiko. |
| Offene Projekte ohne Order Number | Kritisch | Eine eindeutige Projektidentifikation fehlt. |
| Offene Projekte ohne Customer Mapping | Kritisch | Das Projekt ist keiner Customer-Master-Legal-Entity zugeordnet. |
| Projekte ohne Contract Status | Prüfen | Die Offen-/Geschlossen-Auswertung ist nicht zuverlässig. |

Die KPIs zählen jeweils Projekte und nicht Stunden. Ein Projekt darf innerhalb einer KPI nur einmal gezählt werden. Unbekannte Werte werden als Datenqualitätsproblem ausgewiesen und nicht automatisch als vollständig oder unkritisch interpretiert.

### Datenquellen

| Datenquelle | Verwendung im Data Quality Dashboard |
|---|---|
| `public.projects` | Projektstatus, Vertragsstunden, Kundenwert und `owner_person_id` |
| `public.person_assignments` | Verantwortungs- und Replacement-Zuordnungen |
| `public.people` | Auflösung und Aktivstatus von Verantwortlichen |
| `time.project` | Verbindung von TrackingTime-Projekt und Hub-Projekt über `hub_project_id` |
| `time.service` | Prüfung der Service-Zuordnung |
| `projects.project_order` | Order Number und kanonisches CRM-Projekt |
| `crm.legal_entity` | Ziel der Customer-Master-Zuordnung |
| `crm.trackingtime_project_reference` | Referenz zwischen externer TrackingTime-Projekt-ID und CRM-Projekt |

### Berechnungen

- **Ohne Verantwortlichen:** offenes Projekt mit leerem `owner_person_id` oder einer nicht auflösbaren Personreferenz.
- **Ohne Replacement:** offenes Projekt mit Verantwortlichem, aber ohne zweite gültige Person in der geprüften Replacement-/Assignment-Zuordnung.
- **Ohne Order Number:** offenes Projekt ohne gültige Order Number im kanonischen Projektmodell.
- **Ohne Customer Mapping:** offenes Projekt ohne auflösbare `crm.legal_entity`-Referenz.
- **Ohne Contract Status:** Projekt mit leerem, unbekanntem oder nicht normalisiertem Contract Status.

Die Projektidentität muss über stabile IDs und Referenztabellen bestimmt werden. Freitext-Matching von Kunden- oder Projektnamen ist für diese KPIs nicht zulässig.

### Ampellogik

| Status | Anwendung |
|---|---|
| Kritisch | Verantwortlicher, Order Number oder Customer-Master-Mapping fehlt |
| Prüfen | Replacement oder Contract Status fehlt bzw. ist nicht belastbar |
| Informativ | Daten sind vollständig; keine Data-Quality-Aktion erforderlich |

Die Ampel bewertet die Steuerbarkeit der Stammdaten, nicht die wirtschaftliche Qualität, die Arbeitsleistung oder die tatsächliche Projektauslastung. Ein Projekt kann gleichzeitig mehrere Data-Quality-Probleme haben; die Detailansicht muss alle Probleme ausweisen.

### Abgrenzung zu TrackingTime und HSE Hub

Das Data Quality Dashboard bewertet die Steuerbarkeit der Projektstammdaten im HSE Hub und in der Customer-Master-Referenzschicht. TrackingTime liefert dabei Projekt-, Service- und Zeitreferenzen, ist aber nicht die führende Quelle für Legal Entities, Order Numbers oder operative Verantwortungsregeln.

Die Sicht ist daher abzugrenzen von:

- **TrackingTime-Reporting:** Ist-Stunden, Service-Zeit und Benutzeraktivität.
- **HSE-Hub-Projektansicht:** operative Projektstammdaten und Zuordnungen.
- **Customer Master:** kanonische Legal Entity und geprüfte externe Referenzen.

Ein fehlender Customer-Master-Link ist ein Data-Quality-Problem, auch wenn TrackingTime einen Kundennamen oder eine Projektbezeichnung liefert.

### Nicht Bestandteil dieser Ausbaustufe

Vertragsende, Ist-Stunden, Reststunden und Forecast werden in späteren Ausbaustufen integriert. Sie dürfen in diesem Data Quality Dashboard nicht als bereits berechnete Datenqualitätswerte dargestellt werden.

## 7. Fehlende Datenmodelle und fachliche Entscheidungen

1. **Vertragslaufzeiten:** `public.projects` enthält aktuell keine belastbaren Start- und Enddaten für die Forecast-Verteilung.
2. **Semantik von `contract_hours`:** Es muss geklärt werden, ob der Wert Gesamtstunden, Jahresstunden oder Stunden für eine Vertragsperiode bedeutet.
3. **Semantik von `share_percent`:** Der Wert muss als Kapazitätsanteil bestätigt werden und darf nicht ohne Prüfung als juristischer Vertragsanteil interpretiert werden.
4. **Kapazitätskalender:** 1.304 h/Jahr ist eine Baseline, kein individueller Arbeitszeitkalender.
5. **Netto-Kapazität:** Urlaub, Feiertage, interne Tätigkeiten und nicht billable Pflichtzeiten fehlen im aktuellen Read Model.
6. **Service-Mapping:** Die vier Executive-Gruppen benötigen eine zentrale Mappingtabelle oder versionierte Konfiguration.
7. **Legal-Entity-Link:** Die CRM-Foundation besitzt Referenztabellen; die durchgängige Beziehung zu `public.projects` und `time.project` muss validiert werden.
8. **Datenqualität:** Projekte ohne Mitarbeiter, Service oder Legal Entity müssen mit eigenen Zählungen und Stundenwerten sichtbar bleiben.
9. **Historisierung:** Für einen echten Zeitverlauf werden gültige Historien oder Snapshots für Vertragsstunden und Assignments benötigt.

## 8. Nächste technische Schritte

1. Bedeutung von `contract_hours` und `share_percent` fachlich abnehmen.
2. Projekt- und Customer-Master-Referenzen anhand realer Daten prüfen.
3. Read-only-Projektion für Vertragsperioden, Legal Entity und Servicegruppen entwerfen, zunächst ohne Migration.
4. Datenqualitätsreport für nicht zugeordnete Projekte, Personen, Services und Legal Entities erstellen.
5. Kapazitätskalender inklusive Teilzeit, Urlaub, Feiertagen und Eintritt/Austritt spezifizieren.
6. Quartalsaggregation mit aktiven Vertragstagen definieren und gegen geprüfte Beispielszenarien testen.
7. Executive-KPIs, Service Mix und Forecast auf eine gemeinsame Periodenlogik bringen.
8. Erst nach fachlicher Abnahme prüfen, ob eine Migration oder materialisierte View erforderlich ist.

## 9. Nicht-Ziele

- keine Änderung der Customer-Master-Funktionen
- keine Bearbeitung von Verträgen, Projekten oder Assignments im Dashboard
- keine automatische Zuordnung per unsicherem Namens-Matching
- keine Vermischung von Ist-Zeit, Vertragsbindung und verfügbarer Kapazität
- keine Migration im Rahmen dieser Spezifikation
