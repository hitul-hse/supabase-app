# Entity Resolution Rules für den Customer Master

- Status: Verbindlich
- Geltungsbereich: Customer-Master-Import, Review Queue und spätere Kanonisierung
- Grundlage: ADR-001 und ADR-002

Dieses Dokument definiert, wann ein importierter Datensatz einer fachlichen
Entität oder Beziehung zugeordnet werden darf. Es ergänzt ADR-001 und ADR-002;
bei einem Widerspruch gelten die ADRs.

## 1. Grundsätze

### 1.1 Fachliche Identität vor Ähnlichkeit

Eine Resolution ist eine fachliche Zuordnung, keine Textähnlichkeit. Die
folgenden Merkmale sind für sich allein niemals ausreichend:

- Firmenname oder Namensähnlichkeit
- Adresse oder Adressähnlichkeit
- Ansprechpartner
- E-Mail-Adresse oder Telefonnummer
- gleiche Lexware-Kundennummer ohne geprüften fachlichen Kontext

Insbesondere darf keine automatische Zusammenführung ausschließlich aufgrund
von Firmenname, Adresse oder Ansprechpartner erfolgen.

### 1.2 Voraussetzungen für automatische Resolution

Eine automatische Resolution ist nur zulässig, wenn alle drei Bedingungen
erfüllt sind:

1. Es gibt eine stabile fachliche Identität, zum Beispiel eine bestätigte
   HSE-`customer_id`, eine geprüfte USt-ID oder eine belastbare externe
   Referenz im definierten Geltungsbereich.
2. Die verwendete Regel ist dokumentiert, deterministisch und reproduzierbar.
3. Der Datensatz trägt einen passenden Review Status. Eine automatische
   Zuordnung ohne nachvollziehbaren Status ist nicht zulässig.

Fehlt eine Bedingung, bleibt der Datensatz in `stg` und erhält
`REVIEW_REQUIRED` beziehungsweise den normalisierten Status
`review_required`.

### 1.3 Keine implizite Gleichsetzung der Modelle

Die folgenden Begriffe sind getrennt zu behandeln:

```text
Legal Entity ≠ Lexware Customer Reference ≠ Location
Corporate Group ≠ Legal Entity
Framework Agreement ≠ Project
Project / Order ≠ Legal Entity
```
Eine Referenz auf eine Entität ist kein Beweis dafür, dass zwei Datensätze
dieselbe Entität sind.

### 1.4 Verbindliche Prüfreihenfolge

Bei Konflikten ist in dieser Reihenfolge zu prüfen:

1. rechtliche Identität / Legal Entity
2. Lexware Customer Reference
3. Location
4. Corporate Group
5. Framework Agreement
6. Project / Order Assignment

Die spätere Stufe darf eine ungeklärte frühere Stufe nicht verdecken oder
ersetzen.

## 2. Import- und Review-Prozess

Der verbindliche Datenfluss ist:

```text
kuratierte Excel-Quelle
        ↓
stg.import_batch
        ↓
stg.import_record mit vollständiger raw_payload
        ↓
Review Queue / fachliche Review Cases
        ↓
bestätigte Entity Resolution
        ↓
crm / projects
```

`stg` ist die Arbeits- und Nachvollziehbarkeitsebene, nicht der kanonische
Customer Master. Originalwerte, Tabellenblatt, Excel-Zeilennummer,
Review-Status, Review-Grund und externe Referenzen bleiben erhalten.

Die Review Queue darf Fälle gruppieren, aber keine Datensätze zusammenführen,
überschreiben oder in `crm` beziehungsweise `projects` übernehmen.

Verbindliche Statusbedeutungen:

| Status | Bedeutung |
|---|---|
| `unreviewed` | Noch keine fachliche Prüfung abgeschlossen |
| `review_required` | Eine fachliche Entscheidung ist erforderlich |
| `in_review` | Prüfung ist aktiv, aber noch nicht entschieden |
| `approved` | Zuordnung oder Datensatz ist fachlich bestätigt |
| `rejected` | Vorgeschlagene Zuordnung wurde abgelehnt |
| `unresolved` | Keine belastbare Zuordnung konnte hergestellt werden |

Originalwerte wie `OK`, `LEXWARE_CLEANUP_PENDING` oder
`MULTI_LOCATION_MULTI_LEXWARE` werden nicht neu interpretiert oder
überschrieben. Sie bleiben in der Original-Payload sichtbar; eine
Normalisierung darf nur als zusätzliches Read-/Review-Feld erfolgen.

## 3. Legal Entity Resolution

### 3.1 Ziel

Ziel ist die Zuordnung zu genau einer rechtlich eigenständigen Entität in
`crm.legal_entity`. Eine Legal Entity kann mehrere Standorte und mehrere
Lexware-Referenzen besitzen.

### 3.2 Starke Identitätsmerkmale

In absteigender Beweiskraft:

1. bestätigte kuratierte `customer_id`, sofern sie als stabile HSE-ID
   validiert und nicht widersprüchlich belegt ist;
2. bestätigte USt-ID / VAT-ID im korrekten Länder- und Formatkontext;
3. Handelsregisterdaten: Registergericht, Registernummer und vollständige
   rechtliche Firmierung;
4. eine ausdrücklich bestätigte fachliche Zuordnung aus dem Review Workflow;
5. vollständige rechtliche Firmierung nur als unterstützendes Merkmal, niemals
   allein als Merge-Grund.

`customer_id` ist eine kuratierte fachliche HSE-ID. Wenn Format, UUID und
Fachlichkeit geprüft sind, darf sie direkt als `crm.legal_entity.id`
übernommen werden. Sie darf nicht mit einer Lexware-Kundennummer verwechselt
werden.

### 3.3 Regeln

- Unterschiedliche Adressen erzeugen nicht automatisch unterschiedliche Legal
  Entities.
- Unterschiedliche Ansprechpartner erzeugen keine neue Legal Entity.
- Eine abweichende Gesellschaftsform, USt-ID oder Handelsregister-Identität
  ist ein Trennsignal und erfordert Review.
- Fehlende rechtliche Identifikatoren führen nicht automatisch zu einem Merge.
- Eine Legal Entity darf erst nach bestätigter Resolution in `crm` geschrieben
  werden.
- `canonical_name` wird nicht durch einen Alias oder eine Lexware-Bezeichnung
  automatisch geändert.

### 3.4 Beispiele

- **PBS Germany Operations GmbH:** Mehrere Lexware-Kundennummern oder
  Standorte können auf dieselbe Legal Entity zeigen, wenn die rechtliche
  Identität bestätigt ist. Die Kundennummern bleiben separate
  Lexware-Referenzen.
- **YPOG:** Bekannte Cleanup- oder Review-Entscheidungen werden übernommen,
  nicht neu berechnet. Eine ähnliche Namensvariante ist kein automatischer
  Merge.
- **Susell:** Der bestehende Review-/Cleanup-Entscheid bleibt maßgeblich. Die
  Resolution muss die kuratierte Entscheidung abbilden und darf sie nicht aus
  Namensähnlichkeit ableiten.
- **Solar Pro:** Gesellschaften innerhalb eines Verbunds bleiben eigene Legal
  Entities. Eine Gruppenzugehörigkeit ersetzt keine rechtliche Identität.
- **Closer:** Ein bestehender Review-Fall bleibt `REVIEW_REQUIRED`, solange
  die fachliche Entscheidung nicht bestätigt ist.
- **ENERCON:** Vertrag, Projekt, Standort und Legal Entity werden getrennt
  behandelt; eine Rahmenvertrags- oder Projektbeziehung ist kein Merge-Grund.

## 4. Lexware Customer Reference Resolution

Die kanonische Referenz wird in `crm.lexware_customer` geführt. Der erste
Import verwendet:

```text
source_account_ref = LEXWARE_HSE
```

### 4.1 Regeln

- `customer_number` bleibt unverändert als externe Lexware-Referenz erhalten.
- Die Eindeutigkeit gilt für `(source_account_ref, customer_number)`.
- Mehrere Lexware-Kundennummern dürfen auf dieselbe Legal Entity zeigen.
- Eine Lexware-Kundennummer erzeugt nicht automatisch eine Legal Entity.
- `legal_entity_id` bleibt bis zur bestätigten Resolution nullable.
- `location_id` bleibt nullable, bis der Standort fachlich bestätigt ist.
- Externe Lexware-IDs werden niemals als technische CRM-Primary-Keys verwendet.
- Abweichende Billing-Daten oder Ansprechpartner werden als Quellwerte
  erhalten und nicht ungeprüft in die kanonische Legal Entity kopiert.

### 4.2 Cleanup und Mehrfachreferenzen

`LEXWARE_CLEANUP_PENDING` bedeutet, dass eine Quellreferenz oder deren
Zuordnung fachlich geprüft werden muss. `MULTI_LOCATION_MULTI_LEXWARE` weist
auf einen Fall mit mehreren Standorten und/oder mehreren Lexware-Referenzen
hin. Beide Fälle bleiben sichtbar und `review_required`, bis die Beziehung
bestätigt ist.

Eine gleiche Kundennummer in unterschiedlichen `source_account_ref`-Scopes
ist nicht automatisch dieselbe Referenz. Ein Konflikt innerhalb desselben
Scopes ist ein Fehler- oder Review-Fall.

## 5. Corporate Group Resolution

Corporate Groups werden in `crm.corporate_group` und
`crm.corporate_group_member` modelliert.

### Regeln

- Eine Gruppe beschreibt eine fachliche oder wirtschaftliche Zugehörigkeit.
- Jede rechtlich eigenständige Gesellschaft bleibt eine eigene Legal Entity.
- `customer_group_id` gruppiert Legal Entities, führt sie aber niemals
  zusammen.
- Ein Gruppenname ist allein kein Beweis für die Mitgliedschaft.
- Die Mitgliedschaft benötigt eine belastbare Quelle oder eine bestätigte
  fachliche Review-Entscheidung.
- Ein Unternehmen kann im Zeitverlauf Gruppen wechseln; die Beziehung darf
  deshalb nicht als Änderung der Legal Entity interpretiert werden.
- Unklare oder widersprüchliche Gruppenmitgliedschaften bleiben in Review.

## 6. Location Resolution

Locations werden in `crm.location` geführt und referenzieren genau eine
Legal Entity. Eine Location ist keine Legal Entity.

### Regeln

- `location_observations` sind zunächst Beobachtungen und werden nicht
  automatisch als kanonische Locations übernommen.
- `location_review` ist ein fachlicher Review-Eingang und kein automatischer
  Schreibauftrag.
- Adresse, Standortname, Standorttyp und Quellsystemreferenz werden als
  Evidenz betrachtet, nicht als alleinige Identität.
- Gleiche Adresse bei unterschiedlichen Legal Entities ist ein Konfliktfall.
- Unterschiedliche Adressen bei derselben bestätigten Legal Entity können
  mehrere Locations bedeuten.
- Eine Location darf erst nach bestätigter Zuordnung zu einer Legal Entity in
  `crm.location` angelegt werden.
- Eine Location darf nicht als Ersatz für eine ungeklärte Legal Entity dienen.

Bekannte Fälle mit mehreren Standorten, insbesondere PBS Germany Operations
GmbH und `MULTI_LOCATION_MULTI_LEXWARE`, sind zuerst als Review Case zu
behandeln.

## 7. Framework Agreement Resolution

Rahmenverträge werden als eigene fachliche Objekte modelliert:

- `crm.framework_agreement`
- `crm.framework_agreement_party`
- `crm.framework_agreement_project`

### Regeln

- Ein Rahmenvertrag ist weder Legal Entity, Corporate Group, Location noch
  Project.
- Vertragsnummer, Vertragsname, Gültigkeitszeitraum und Vertragsparteien sind
  getrennt zu prüfen.
- Ein Vertrag kann mehrere Legal Entities und mehrere Projekte betreffen.
- Eine gemeinsame Vertragsnummer ist nur bei bestätigtem fachlichem Scope
  ausreichend.
- Ein Vertragsname oder ein Projektname allein erzeugt keine Vertragspartei.
- Widersprüchliche Vertragsparteien bleiben in Review.
- Vertragsbeziehungen dürfen keine Legal Entities zusammenführen.

Für ENERCON bedeutet das: Ein Rahmenvertrag kann mehrere Projekte verbinden;
die Projekte und die beteiligten Legal Entities bleiben dennoch separat
auflösbar.

## 8. Project Assignment Resolution

Die kanonische Projekt-/Auftragsebene ist `projects.project_order`.

### Regeln

- `order_number` ist der fachliche Business Identifier und global eindeutig.
- Eine technische UUID ist nicht mit `order_number` gleichzusetzen.
- Mehrere Quellreferenzen mit derselben `order_number` werden als möglicher
  Bezug auf dasselbe Projekt betrachtet, nicht stillschweigend überschrieben.
- Ein Projekt kann auf Legal Entity, Location und Framework Agreement zeigen.
- Die Projektzuordnung darf keine ungeklärte Legal Entity oder Location
  implizit auflösen.
- Widersprüchliche Projektinhalte, Legal-Entity-Bezüge oder
  `order_number`-Verwendungen sind Data-Quality- und Review-Fälle.
- Bestehende `time`- und `public`-Strukturen werden nicht automatisch als
  Customer-Master-Entitäten interpretiert.

## 9. Review-Entscheidung und Auditierbarkeit

Jeder Review Case muss nachvollziehbar machen:

- welche Original-Records betroffen sind;
- aus welchem Tabellenblatt und welcher Excel-Zeile sie stammen;
- welche externe ID und welche Lexware-Kundennummer vorliegen;
- welche Original-Review-Werte und Hinweise vorliegen;
- welche Zielentität oder Beziehung vorgeschlagen wird;
- welche Regel die Entscheidung stützt;
- welcher Review Status gilt;
- wer die Entscheidung getroffen hat und wann.

Eine fachliche Freigabe bestätigt eine Zuordnung. Sie verändert nicht die
Original-Payload und darf keine anderen Review-Fälle stillschweigend
entscheiden.

## 10. Nicht zulässige Abkürzungen

Folgende Aktionen sind ohne explizite fachliche Prüfung unzulässig:

- Merge nur wegen gleichem oder ähnlichem Firmennamen;
- Merge nur wegen gleicher oder ähnlicher Adresse;
- Merge nur wegen gleichem Ansprechpartner;
- Umwandlung einer Lexware-Kundennummer in eine Legal-Entity-ID;
- Umwandlung einer Location in eine Legal Entity;
- Zusammenführung rechtlich eigenständiger Gesellschaften wegen einer
  Corporate Group;
- Ableitung einer Vertragspartei nur aus einem Projektnamen;
- Ableitung einer Legal Entity nur aus einem Projekt oder Auftrag;
- Überschreiben kuratierter Entscheidungen für PBS, YPOG, Susell, Solar Pro,
  Closer oder ENERCON;
- direkte Übernahme aus `stg` nach `crm` oder `projects` ohne bestätigten
  Review Status.

## 11. Verbindliche Abschlussregel

Wenn die fachliche Identität nicht stabil, die Regel nicht nachvollziehbar
oder der Review Status nicht eindeutig ist, lautet die Entscheidung:

```text
nicht zusammenführen
in Review belassen
Originaldaten erhalten
```
