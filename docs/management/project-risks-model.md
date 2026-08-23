# Project Risks Modell

**Status:** Fachliche Spezifikation  
**Zielgruppe:** Management und operative Verantwortliche  
**Datenmodus:** ausschließlich Read Model

## 1. Ziel

Das Project Risks Modell macht operative Projektrisiken im Management Dashboard sichtbar. Es zeigt, welche Projekte wegen fehlender Verantwortlichkeit, fehlender stabiler Stammdatenzuordnung oder unvollständiger Serviceinformationen nicht zuverlässig gesteuert werden können.

Das Modell bewertet Daten- und Steuerungsrisiken. Es ist keine automatische Bewertung von Mitarbeitern, Kunden oder Vertriebschancen.

## 2. Risk Types

### 2.1 `PROJECT_WITHOUT_OWNER`

**Regel:** Ein offenes Projekt besitzt keine gültige `owner_person_id`.

**Bewertung:** Kritisch

**Bedeutung:** Das Projekt kann operativ nicht eindeutig gesteuert werden. Verantwortlichkeit, Eskalation und Übergabe sind nicht belastbar.

### 2.2 `PROJECT_WITHOUT_CUSTOMER_MAPPING`

**Regel:** Ein Projekt besitzt keine stabile Zuordnung zu einer Customer-Master-Legal-Entity.

**Bewertung:** Kritisch

**Bedeutung:** Das Projekt kann nicht zuverlässig einem Kundenportfolio, einer Legal Entity oder kundenbezogenen KPIs zugeordnet werden.

### 2.3 `PROJECT_WITHOUT_ORDER_NUMBER`

**Regel:** Ein Projekt besitzt keine gültige Order Number im kanonischen Projekt- oder Auftragsmodell.

**Bewertung:** Kritisch

**Bedeutung:** Eine eindeutige Projekt- und Auftragsidentifikation fehlt. Abgleich, Abrechnung und Management-Auswertung können dadurch auseinanderlaufen.

### 2.4 `PROJECT_WITHOUT_STATUS`

**Regel:** Ein Projekt besitzt keinen verwertbaren Contract Status beziehungsweise keinen normalisierten Projektstatus.

**Bewertung:** Prüfen

**Bedeutung:** Eine belastbare Offen-/Geschlossen-Auswertung ist nicht möglich. Ein fehlender Status darf nicht automatisch als offen oder geschlossen interpretiert werden.

### 2.5 `PROJECT_WITHOUT_SERVICE_MAPPING`

**Regel:** Ein Projekt ist keinem kanonischen Service aus `time.service` zugeordnet.

**Bewertung:** Prüfen

**Bedeutung:** Servicevolumen, Service-Matrix, Verantwortlichkeit und kundenbezogene Serviceauswertung sind unvollständig.

### 2.6 `REPLACEMENT_RISK`

**Aktueller Status:** nicht verfügbar

**Grund:** Im aktuellen Datenmodell existiert kein bestätigtes servicebezogenes Replacement-Modell.

Ein Replacement darf nicht aus einer beliebigen weiteren Personenzuordnung oder aus derselben Kundenbeziehung abgeleitet werden. Die fachliche Relation muss lauten:

```text
Projekt → Service → Verantwortlicher → Replacement
```

Bis diese Relation bestätigt und technisch verfügbar ist, wird kein Risk Count berechnet. Die UI zeigt `n/a` und weist die fehlende Datenbasis als Datenqualitäts- beziehungsweise Modelllücke aus.

## 3. Zusätzliche Felder

Jede Risikoauswertung soll neben dem Risk Type folgende Felder bereitstellen:

| Feld | Fachliche Bedeutung |
|---|---|
| Risk Count | Anzahl betroffener Projekte für den Risk Type; `n/a`, wenn die Datenbasis nicht verfügbar ist |
| Risk Summary | Aggregierte Kurzbeschreibung des Risikos und seiner Management-Bedeutung |
| Source Reference | Stabile Referenz auf Quellsystem, Tabelle/View und Datensatz bzw. Read-Model-Schlüssel |

Für eine Detailansicht werden zusätzlich empfohlen:

- Projekt-ID und Projektname
- Kunde und `legal_entity_id`
- Order Number
- Service-ID und Servicebezeichnung
- Verantwortlicher
- Replacement oder `n/a`
- Vertragsstunden
- Status
- Zeitpunkt beziehungsweise Datenstand der Prüfung

## 4. Datenquellen und Source Reference

| Quelle | Verwendung |
|---|---|
| `public.projects` | Projektidentität, Status, Vertragsstunden und `owner_person_id` |
| `public.people` | Auflösung und Validierung von Personenreferenzen |
| `public.person_assignments` | Projekt-Person-Zuordnungen und fachliche Verantwortungsbezüge |
| `time.project` | stabile Verbindung zum Projekt und Service-Referenz |
| `time.service` | kanonischer Servicekatalog |
| `projects.project_order` | Order Number und Customer-Master-Projektbezug |
| `crm.legal_entity` | stabile Kunden- und Legal-Entity-Identität |

Eine Source Reference muss auf stabile IDs zeigen. Anzeigenamen, Excel-Zeilennummern oder Freitextwerte können ergänzende Hinweise sein, sind aber keine Primärreferenz.

## 5. Abgleich mit der Excel-Struktur

Die Legacy Customer-Portfolio-Excel enthält insbesondere Kunde, Order Name, Service, Start- und Lieferdatum, Sifa, Replacement, Vertragsstunden und operative Links. Diese Felder dienen als fachlicher Vergleich und als Quelle für die spätere Datenbereinigung.

Für das Project Risks Modell werden daraus folgende Prüfungen abgeleitet:

| Excel-Struktur | Project-Risk-Prüfung |
|---|---|
| Customer / Kunde | `PROJECT_WITHOUT_CUSTOMER_MAPPING` |
| Order Name / Order Number | `PROJECT_WITHOUT_ORDER_NUMBER` |
| Service | `PROJECT_WITHOUT_SERVICE_MAPPING` |
| Sifa | `PROJECT_WITHOUT_OWNER` beziehungsweise Verantwortlichkeitsprüfung |
| Replacement | `REPLACEMENT_RISK`, aktuell nicht verfügbar |
| Start Date / Delivery Date | zukünftig Laufzeit- und Forecast-Risiken |
| Vertragsstunden | Risikovolumen und Management-Auswirkung |
| Operative Links | Source Reference beziehungsweise Datenqualitätsprüfung |

Die Excel-Zeile selbst ist kein stabiler Schlüssel. Mehrere Zeilen können dieselbe Legal Entity oder dasselbe Projekt beschreiben und dürfen nicht ungeprüft als separate Kunden oder Risiken gezählt werden.

## 6. Legacy Excel vs. HSE EOS

| Aspekt | Legacy Excel | HSE EOS |
|---|---|---|
| Kundenidentität | häufig Kundenname oder manuelle Schreibweise | `crm.legal_entity.id` als kanonische Identität |
| Projektidentität | Order Name, Zeile oder externe Bezeichnung | stabile Projekt- und Auftragsreferenzen |
| Service | Freitext oder lokale Bezeichnung | `time.service` und versioniertes Mapping |
| Verantwortlicher | Sifa-Spalte oder Text | `public.people` plus Assignment-/Owner-Relation |
| Replacement | manuelle Spalte, Semantik nicht immer eindeutig | bestätigte servicebezogene Relation, aktuell fehlend |
| Status | Excel-Wert oder implizite Annahme | normalisierter Contract-/Projektstatus |
| Risk Count | manuell oder nicht vorhanden | deterministische Read-Model-Aggregation |
| Source Reference | Tabellenblatt und Zeilennummer | stabile Quellsystem- und Datensatzreferenz |
| Datenqualität | häufig visuell erkennbar | expliziter Risk Type und `n/a`-Status |

HSE EOS soll die Excel-Fachlichkeit abbilden, aber nicht ihre instabilen Identitäts- und Freitextmechanismen übernehmen.

## 7. Zukünftiges Replacement-Modell

Für eine belastbare `REPLACEMENT_RISK`-Berechnung werden mindestens benötigt:

- `project_id`
- `service_id`
- verantwortliche `person_id`
- Replacement-`person_id`
- Gültigkeitszeitraum
- fachlicher Status, zum Beispiel bestätigt oder abgelaufen
- optional Skill-, Verfügbarkeits- und Prioritätsinformationen
- Quelle und Änderungszeitpunkt der Relation

Ein Projekt kann je Service unterschiedliche Vertretungen besitzen. Eine Person, die bei einem anderen Service oder Projekt zugeordnet ist, gilt nicht automatisch als Replacement.

Bis zur Einführung dieses Modells bleibt die Kennzahl nicht verfügbar. Es werden keine Ersatzwerte aus `public.person_assignments`, Namensähnlichkeiten oder Teamzugehörigkeiten abgeleitet.

## 8. Datenqualitätsregeln

1. Ein Projekt wird je Risk Type höchstens einmal gezählt.
2. Freitext-Kunden werden nicht als stabile Customer-Master-Zuordnung verwendet.
3. Eine Legal Entity gilt nur als gemappt, wenn die Referenz auflösbar und nicht widersprüchlich ist.
4. Eine Order Number muss aus dem kanonischen Projekt-/Auftragsmodell stammen.
5. Ein Service muss über eine stabile Service-ID oder eine bestätigte Mappinglogik auflösbar sein.
6. Ein fehlender Status wird nicht automatisch als offen interpretiert.
7. Fehlende Daten werden als Risiko oder `n/a` ausgewiesen, nicht als `0` ersetzt.
8. Ein Risk Count mit nicht verfügbarer Quellbasis ist `n/a`.
9. Source References enthalten keine sensiblen Payloads oder Secrets.
10. Die Prüfung bleibt read-only und führt keine Korrektur oder Rückschreibung in Quellsysteme aus.

## 9. Abgrenzung

Das Project Risks Modell zeigt Risiken und ihre Quellen. Es führt keine automatische Datenbereinigung, keine Customer-Master-Änderung, keine Statusänderung und keine operative Zuweisung von Verantwortlichen oder Replacements aus.
