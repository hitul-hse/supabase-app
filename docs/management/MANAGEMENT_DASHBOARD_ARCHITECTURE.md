# HSE Operations Management Dashboard – Architektur

**Status:** Aktuelle Architektur- und Verantwortungsabgrenzung
**Datenmodus:** ausschließlich Read Model
**Route:** `/dashboard/management`

## 1. Ziel und Zweck

Das HSE Operations Management Dashboard ist die zentrale Managementsicht für die operative Steuerung von:

- Kunden und Legal Entities
- Projekten
- Services
- Verantwortlichkeiten und Vertretungsfähigkeit
- gebundener und verfügbarer Kapazität
- Datenqualität und operativen Risiken

Das Dashboard aggregiert vorhandene Daten für Managemententscheidungen. Es ist keine weitere Stammdatenpflege und ersetzt keine fachlichen Quellsysteme.

## 2. Abgrenzung

### Customer Master

Der Customer Master bleibt das führende System für:

- Legal Entities
- Kundenstammdaten
- Kundenbeziehungen und Zuordnungen
- kanonische Kunden- und Projektidentitäten

Das Management Dashboard liest diese Referenzen ausschließlich aus. Es verändert keine Customer-Master-Daten und führt keine konkurrierende Kundenlogik ein.

### Management Dashboard

Das Dashboard dient der operativen und executive Steuerung von:

- Leistung und gebundenem Vertragsvolumen
- Kapazität und Auslastung
- Serviceverteilung
- Verantwortlichkeiten und Ownership
- Risiken und Datenqualität

Es stellt berechnete Management-KPIs dar und bietet Drilldowns auf die zugrunde liegenden Projekte und Kunden.

### TrackingTime / HSE Hub

TrackingTime und HSE Hub sind die Quellen für operative Zeitinformationen. Ist-Stunden, Reststunden und ein belastbarer Forecast werden später integriert. Die aktuelle Vertragsstunden- und Kapazitätssicht darf diese Werte nicht vorwegnehmen oder aus nicht vorhandenen Daten schätzen.

## 3. Aktuelle Module

### Contract Hours

Zeigt das vertraglich gebundene Stundenvolumen als KPI sowie in einer Service-×-Mitarbeiter-Matrix. Die Matrix weist Services, verantwortliche Personen und Summen aus.

### Utilization Outlook

Vergleicht gebundene Vertragsstunden mit der initialen Planstunden-Baseline von 1.304 Stunden pro Mitarbeiter und Jahr. Die aktuelle Ampellogik lautet:

- `<50 %`: Unterauslastung
- `50–90 %`: Gesunde Auslastung
- `>90 %`: Kapazitätsrisiko

### Service Overview

Aggregiert Projekte, Kunden, Vertragsvolumen und Datenqualitätsmerkmale je Service. Die Einheit der Kennzahl muss immer sichtbar sein, insbesondere `HOURS` oder `USERS`.

### Employee Ownership Overview

Zeigt je Mitarbeiter offene Projekte, Vertragsvolumen, Services, Kundenbezug und Replacement-Abdeckung. Das Betreuerportfolio kann bis auf Kunde, Projekt, Service und Verantwortlichen aufgeklappt werden.

Replacement ist fachlich servicebezogen:

```text
Service → Verantwortlicher → Replacement
```

Eine beliebige andere Person im Unternehmen gilt nicht automatisch als Ersatz.

### Data Quality Dashboard

Prüft die Steuerbarkeit der operativen Projektstammdaten. Aktuelle Prüfungen sind:

- offene Projekte ohne Verantwortlichen
- offene Projekte ohne Replacement
- offene Projekte ohne Order Number
- offene Projekte ohne Customer Mapping
- Projekte ohne Contract Status
- Projekte ohne Service Mapping
- Projekte ohne eindeutige Projektzuordnung

Fehlt eine bestätigte Replacement-Relation, wird `n/a` statt eines geschätzten Werts angezeigt.

## 4. Datenquellen

| Quelle | Verwendung im Dashboard |
|---|---|
| `public.projects` | Projektidentität, Status, Vertragsstunden, Owner und sichtbarer Projektbestand |
| `public.people` | Personenidentität und Auflösung verantwortlicher Mitarbeiter |
| `public.person_assignments` | Projekt-Person-Zuordnung und Verteilungsanteile |
| `time.project` | Verbindung von Hub-Projekt, externer Projekt-ID und Service |
| `time.service` | kanonischer Servicekatalog und Servicebezeichnung |
| `projects.project_order` | Order Number und Projektbezug im Customer Master |
| `crm.legal_entity` | stabile Legal-Entity-Referenz für Customer Mapping |

Ergänzende Referenztabellen, beispielsweise für externe TrackingTime-Projekt-IDs, dürfen nur über stabile Schlüssel in das Read Model einfließen. Freitext-Matching von Kunden- oder Projektnamen ist keine belastbare Aggregationslogik.

## 5. KPI-Definitionen

### Vertragsvolumen

Das Vertragsvolumen beschreibt die vertraglich gebundenen Stunden sichtbarer Projekte. Für die Mitarbeiterverteilung gilt die vorhandene Assignment-Logik:

```text
gebundene Stunden je Assignment
  = Projekt-Vertragsstunden × share_percent / 100
```

Die Summe wird je Service, Mitarbeiter, Kunde oder Legal Entity gebildet. Nicht eindeutig zuordenbare Stunden bleiben als Datenqualitätsfall sichtbar und werden nicht stillschweigend einem Service oder Mitarbeiter zugeschlagen.

### Auslastung

Die initiale Planstunden-Baseline beträgt 1.304 Stunden pro Mitarbeiter und Jahr und entspricht 75 % billable capacity.

```text
Auslastung %
  = gebundene Vertragsstunden / verfügbare Planstunden × 100

freie Kapazität
  = verfügbare Planstunden − gebundene Vertragsstunden
```

Planstunden sind aktuell eine Management-Baseline. Individuelle Arbeitszeitmodelle, Abwesenheiten, Feiertage, Ein- und Austritte sowie Vertragslaufzeiten sind noch nicht integriert.

### Service Volumen

Service Volumen ist die Summe des Vertragsstundenvolumens, das über eine stabile `time.project`- und `time.service`-Zuordnung einem Service zugeordnet werden kann.

Die fachlichen Executive-Gruppen sind:

- DGUV V2
- SiGeKo
- Brandschutz
- Consulting

Projekte ohne Service Mapping werden separat ausgewiesen. Ein Projekt mit mehreren Services darf nur nach einer bestätigten Verteilungsregel mehrfach oder anteilig berücksichtigt werden.

### Data Quality KPIs

Data Quality KPIs zählen Projekte, nicht Stunden. Jedes Projekt wird innerhalb einer Prüfung höchstens einmal gezählt.

| KPI | Definition | Bewertung |
|---|---|---|
| Ohne Verantwortlichen | Offenes Projekt ohne auflösbaren Owner | Kritisch |
| Ohne Replacement | Offenes Projekt ohne bestätigte servicebezogene Replacement-Relation | Prüfen; bei fehlender Relation `n/a` |
| Ohne Order Number | Offenes Projekt ohne stabile Order Number | Kritisch |
| Ohne Customer Mapping | Offenes Projekt ohne gültige Legal-Entity-Referenz | Kritisch |
| Ohne Contract Status | Projekt ohne verwertbaren Vertragsstatus | Prüfen |
| Ohne Service Mapping | Projekt ohne gültige Serviceverknüpfung | Prüfen |
| Ohne Projektzuordnung | Projekt ohne eindeutige Hub-/TrackingTime-Referenz | Kritisch |

Nicht verfügbare Datenquellen und unbekannte Relationen werden als `n/a` ausgewiesen, nicht als `0` interpretiert.

## 6. Architekturprinzipien

### Read Model

Das Dashboard liest und aggregiert Daten aus den autorisierten Quellsystemen. Die UI verwendet keine Dummy-Daten und keine lokalen Ersatzwerte, die eine fehlende Datenbasis verdecken.

### Keine direkten Writes

Queries und UI des Dashboards führen keine `INSERT`, `UPDATE`, `DELETE` oder sonstigen Schreiboperationen aus. Es gibt keine Dashboard-Migrationen und keine Customer-Master-Schreibaktionen.

### Customer Master bleibt führend

Kunden, Legal Entities und deren Beziehungen werden nicht im Dashboard neu definiert. Das Dashboard verwendet stabile Referenzen und weist fehlende oder nicht auflösbare Zuordnungen als Datenqualitätsproblem aus.

### Datenqualität transparent darstellen

Jede KPI muss zwischen einem echten Wert, einem leeren Ergebnis und einer nicht verfügbaren Datenbasis unterscheiden. Unsicherheit wird sichtbar gemacht, insbesondere bei Replacement, Customer Mapping, Service Mapping und Forecast.

### Einheit und Population explizit machen

Jede Kennzahl dokumentiert ihre Einheit, Population und ihren Zeitraum. Stunden, Nutzer, Projekte, Euro und Prozente dürfen nicht ohne Kennzeichnung vermischt werden.

## 7. Offene Datenmodelle

### Replacement-Modell

Es fehlt eine bestätigte, servicebezogene Relation für:

```text
Service → Verantwortlicher → Replacement
```

Benötigt werden fachliche Gültigkeit, Status, Priorität und gegebenenfalls mehrere Vertretungen. Bis dahin bleibt die Kennzahl `n/a`.

### Capacity-Modell

Die 1.304 Planstunden sind eine globale Baseline. Es fehlen individuelle Kapazitätskalender für Teilzeit, Abwesenheit, Feiertage, Eintritt, Austritt und nicht billable Pflichtzeiten.

### Customer Mapping

Die Verbindung von `public.projects`, `time.project`, `projects.project_order` und `crm.legal_entity` muss durchgängig und fachlich eindeutig sein. Fehlende oder doppelte Referenzen benötigen einen definierten Fehlerstatus.

### Forecast-Modell

Für Quartals- und Monatsforecast fehlen insbesondere:

- Vertragsbeginn und Vertragsende
- Verlängerungen und Kündigungen
- zeitliche Gültigkeit von Assignments
- Reststunden und Ist-Stunden
- belastbare Kapazitätskalender

Vertragsende, Ist-Stunden, Reststunden und Forecast werden daher später integriert.

## 8. Roadmap

### Erledigt

- Contract Hours
- Utilization Outlook
- Service Overview
- Employee Ownership Overview
- Data Quality Dashboard

### Offen

- Multi-Service Matrix
- Project Risks
- Customer Portfolio
- Forecast

### Empfohlene nächste technische Schritte

1. Replacement-Modell fachlich definieren und die servicebezogene Relation validieren.
2. Customer-Master-Projekt- und Legal-Entity-Referenzen mit realen Daten prüfen.
3. Ein versioniertes Servicegruppen-Mapping bereitstellen.
4. Kapazitätskalender und Assignment-Gültigkeitszeiträume spezifizieren.
5. Vertragslaufzeiten, Ist-Stunden und Reststunden für den Forecast fachlich abnehmen.
6. Multi-Service- und Project-Risk-Regeln auf derselben Read-Model-Basis ergänzen.
