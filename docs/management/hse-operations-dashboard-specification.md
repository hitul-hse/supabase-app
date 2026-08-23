# HSE Operations Management Dashboard

**Status:** Fachliche Spezifikation  
**Zielgruppe:** Management und operative Verantwortliche  
**Datenmodus:** ausschließlich Read Model

## 1. Executive Overview

Das Dashboard bündelt die operative Steuerung von Kunden, Projekten, Services und Verantwortlichkeiten in einer Managementsicht. Es soll beantworten, welche Projekte offen sind, welches Vertragsvolumen gebunden ist, wer verantwortlich ist, wo Stellvertretungsrisiken bestehen und wie sich die Kapazität entwickelt.

### KPIs

| KPI | Definition |
|---|---|
| Offene Projekte | Projekte mit einem normalisierten offenen Status |
| Projekte gesamt | Alle sichtbaren Projekte unabhängig vom Status |
| Aktive Kunden | Eindeutige Kunden mit mindestens einem sichtbaren Projekt |
| Vertragsvolumen offen | Vertragsvolumen der offenen Projekte |
| Projekte ohne Verantwortlichen | Offene oder aktive Projekte ohne Owner bzw. Lead |
| Projekte ohne Status | Projekte mit fehlendem oder unbekanntem Status |

Jede KPI muss Population, Einheit und Datenstand ausweisen. Unbekannte Werte dürfen nicht als `0` erscheinen.

## 2. Service Overview

Die Service Overview zeigt die operative und kommerzielle Belastung je kanonischem Service.

| Spalte | Definition |
|---|---|
| Service | Service aus dem kanonischen Servicekatalog |
| Offene Projekte | Anzahl offener Projekte des Services |
| Projekte gesamt | Anzahl aller sichtbaren Projekte des Services |
| Eindeutige Kunden | Anzahl eindeutiger Kunden des Services |
| Ohne Verantwortlichen | Projekte ohne Owner bzw. Lead |
| Vertragsvolumen | Vertragsvolumen der zugeordneten Projekte |
| Datenqualität | Vollständigkeit und Konsistenz der Service-Projekt-Daten |

Die Datenqualität muss mindestens fehlenden Service, Status, Kundenbezug, Verantwortlichen und nicht auflösbare Servicewerte erkennen. Ein Qualitätsstatus darf die zugrunde liegenden Fehler nicht verbergen.

## 3. Service × Mitarbeiter Matrix

Die Matrix stellt Services in den Zeilen und verantwortliche Personen in den Spalten dar. Die Kennzahl jeder Zelle ist das offene Vertragsvolumen.

- Summenzeile: offenes Vertragsvolumen je Mitarbeiter
- Summenspalte: offenes Vertragsvolumen je Service
- Drilldown: Service → Mitarbeiter → Projekte → Kunde

Bei einem eindeutigen Owner wird das gesamte offene Vertragsvolumen diesem Owner zugeordnet. Bei Mehrfachzuordnung darf das Volumen nicht doppelt gezählt werden. Ohne geprüfte Verteilungsregel wird der Fall als „Mehrfachzuordnung zu prüfen“ ausgewiesen.

## 4. Employee Overview

Je Mitarbeiter werden folgende Werte dargestellt:

- Projekte
- Kunden
- Services
- Vertragsvolumen
- Replacement-Risiken
- Datenqualität

### Replacement-Risiken

Ein Replacement-Risiko liegt vor, wenn die operative Verantwortung stark auf eine Person konzentriert ist und keine belastbare Vertretung erkennbar ist. Der Indikator kann folgende Faktoren berücksichtigen:

- viele offene Projekte
- hohes offenes Vertragsvolumen
- viele Services oder Kunden
- hoher Anteil von Projekten mit nur einer verantwortlichen Person
- fehlende Vertretung
- hohe Auslastung oder nahe Fälligkeit

Der Indikator ist transparent zu erklären und keine automatische Personal- oder Performance-Bewertung.

## 5. Capacity Forecast

### Kennzahlen

| Kennzahl | Definition |
|---|---|
| Planstunden | verfügbare Arbeitsstunden im Betrachtungszeitraum |
| Gebundene Stunden | auf Personen verteilte offene Vertragsstunden |
| Auslastung % | gebundene Stunden / Planstunden × 100 |
| Freie Kapazität | Planstunden − gebundene Stunden |

Die bestehende Baseline von 1.304 Planstunden pro Mitarbeiter und Jahr kann als initialer Jahreswert verwendet werden. Für operative Forecasts ist ein individueller Kapazitätskalender erforderlich.

### Ampellogik

| Auslastung | Status | Bedeutung |
|---:|---|---|
| `< 60 %` | Unterauslastung | freie Kapazität; Staffing oder Vertrieb prüfen |
| `60–85 %` | Zielkorridor | gesunde Auslastung mit Puffer |
| `> 85 %` | Hohe Auslastung | Kapazitätsrisiko; Vertretung und neue Zusagen prüfen |

Überbindung muss separat von freier Kapazität dargestellt werden. Ohne Vertragslaufzeit darf eine zukünftige Bindung nicht automatisch auf alle Monate oder Quartale verteilt werden.

## 6. Detail Views

### Employee Overview

Projekte, Kunden, Services, Vertragsvolumen, Auslastung, Replacement-Risiken und offene Datenqualitätsprobleme einer Person.

### Service Overview

Projektbestand, Kundenportfolio, Vertragsvolumen, Verantwortlichkeitsverteilung, Kapazitätsbedarf und Datenqualität eines Services.

### Data Quality

Zentrale Fehlerliste für fehlenden Status, Owner, Kundenbezug oder Service, ungültige Referenzen, Mehrfachzuordnungen und veraltete Stammdaten. Jeder Fehler soll Quelle, Datensatzreferenz, Schweregrad und betroffene Kennzahlen zeigen.

### Multi-Service Matrix

Erweiterte Sicht für Projekte mit mehreren Services. Sie unterscheidet ein Service, mehrere Services, kein Service und unbekannter Service. Ohne Verteilungsregel wird Vertragsvolumen nicht mehrfach gezählt.

### Project Risks

Risiken umfassen offene Projekte ohne Owner oder Status, hohes offenes Vertragsvolumen, hohe Auslastungswirkung, fehlenden Kunden- oder Legal-Entity-Bezug, auslaufende oder nicht terminierte Vertragslaufzeit sowie fehlende Vertretung.

## 7. Datenquellen

| Quelle | Verwendung | Status |
|---|---|---|
| `public.projects` | Projektname, Kunde, Status, Lead, Vertragswerte | aktueller Projektbestand |
| `public.people` | Personen, Identität und Aktivstatus | Verantwortlichkeitsdimension |
| `public.person_assignments` | Projekt-Person-Zuordnung und Verteilungsdaten | Semantik von `share_percent` prüfen |
| `time.project` | TrackingTime-Projekt und Hub-Projekt-Verknüpfung | Service- und externe Projektbeziehung |
| `time.service` | kanonischer Servicekatalog | Servicegruppen |
| `time.entry` | historische Ist-Zeit und Aktivität | Forecast-Vergleich |
| `time.member` | nominelle Wochenkapazität | nicht automatisch Vertragskapazität |
| `crm.legal_entity` | kanonische Legal Entity | Customer-Master-Verbindung |
| `projects.project_order` | kanonisches CRM-Projekt | Zuordnung zur Legal Entity |
| `crm.trackingtime_project_reference` | externe Projektreferenz | stabile Verbindung validieren |

## 8. Berechnungen und Regeln

### Offene Projekte

Eine zentrale Statusnormalisierung entscheidet, ob ein Projekt offen ist. Fehlende oder unbekannte Statuswerte werden nicht automatisch als offen oder geschlossen interpretiert, sondern separat als Datenqualitätsfall gezählt.

### Vertragsvolumen

Offenes Vertragsvolumen ist die Summe des vertraglichen Projektwerts offener Projekte. Falls nur Vertragsstunden vorliegen, muss die Einheit ausdrücklich als Stunden ausgewiesen werden. Euro und Stunden dürfen nicht in einer Kennzahl vermischt werden.

### Verantwortlichkeit

Kunden, Services und Personen werden über stabile IDs gezählt. Namensvergleiche dienen nur der Anzeige. Nicht auflösbare oder doppelte Referenzen werden als Datenqualität ausgewiesen.

### Kapazität

Auslastung = gebundene Stunden / Planstunden × 100. Freie Kapazität = Planstunden − gebundene Stunden. Jede gebundene Stunde darf nur einmal gezählt werden; Mehrfach-Assignments benötigen eine geprüfte Verteilung.

## 9. Fehlende Datenmodelle

1. Kanonisches Projektstatusmodell und Statusübergänge.
2. Eindeutiger Owner, mehrere Verantwortliche und Stellvertretung.
3. Vertragslaufzeiten, Verlängerungen und Kündigungsstatus.
4. Klare Einheit für Vertragsvolumen: Euro, Stunden oder getrennte Werte.
5. Assignment-Historie mit Gültigkeitszeiträumen.
6. Versioniertes Mapping von Quelldiensten zu Executive-Servicegruppen.
7. Kapazitätskalender für Teilzeit, Urlaub, Feiertage, Eintritt, Austritt und Pflichtzeiten.
8. Durchgängige Legal-Entity-Referenz zwischen CRM-Projekt, `public.projects` und `time.project`.
9. Replacement-Modell mit Vertretung, Skills und Verfügbarkeit.
10. Datenqualitätsmodell mit Fehlerart, Schweregrad, Quelle, Status und Bereinigungsverantwortung.

## 10. Technische Umsetzungsschritte

1. Status-, Owner-, Service- und Vertragsvolumen-Semantik fachlich abnehmen.
2. Projekt- und Customer-Master-Referenzen mit realen Daten validieren.
3. Ein gemeinsames Read-only-Aggregationsmodell für Projekt, Kunde, Legal Entity, Service und Person definieren.
4. Datenqualitätsregeln deterministisch formulieren und separat auswertbar machen.
5. Servicegruppen-Mapping zentral und versioniert pflegen.
6. Vertragslaufzeiten und Assignment-Gültigkeit für Monats- und Quartalsforecast spezifizieren.
7. Capacity Forecast gegen Mehrfach-Assignments und Überbindung testen.
8. Detail Views auf dieselben Aggregationen und Filterparameter aufsetzen.
9. Replacement-Risiko zunächst als transparenten Indikator implementieren.
10. Erst nach fachlicher Abnahme prüfen, ob View, Projektion oder Migration erforderlich ist.

## 11. Nicht-Ziele

- keine Bearbeitung von Projekten, Personen, Services oder Assignments
- keine Customer-Master-Merge- oder Importlogik
- keine unsichere Zuordnung über freie Namens-Matches
- keine Vermischung von Ist-Zeit, Vertragsvolumen und Kapazitätsbindung
- keine Migration oder Datenbankänderung im Rahmen dieser Spezifikation
