# Project Risk Resolution Actions

**Status:** Fachliche Spezifikation für eine zukünftige Erweiterung  
**Datenmodus heute:** ausschließlich Read Model  
**Ziel:** kontrollierte, nachvollziehbare Bereinigung ausgewählter Project Risks

## 1. Ziel

Das bestehende Project Risks Dashboard zeigt operative Probleme und ihre Quellen. Perspektivisch soll ein davon getrennter Project-Resolution-Prozess ausgewählte Probleme kontrolliert bereinigen können.

Die Resolution-Funktion darf nur fachlich erlaubte Felder ändern, muss vor jeder Änderung die Berechtigung prüfen und jede Änderung nachvollziehbar protokollieren.

```text
Project Risks
  → zeigt Probleme

Project Resolution
  → führt kontrollierte Korrekturen aus
```

Bis zur fachlichen und technischen Freigabe bleibt das Management Dashboard read-only.

## 2. Editierbare Felder

### 2.1 Responsible Person

**UI:** Dropdown

**Quelle:** Mitarbeiter aus `public.people`

**Aktion:** Projektverantwortlichen setzen

**Regeln:**

- Es dürfen nur sichtbare und aktive Mitarbeiter angeboten werden.
- Die Auswahl wird über eine stabile `person_id` gespeichert, nicht über den Namen.
- Die UI muss den aktuellen Wert, die neue Auswahl und den Änderungsgrund anzeigen.
- Eine Änderung darf nur erfolgen, wenn der Benutzer die Berechtigung für das Projekt besitzt.
- Die Änderung löst eine erneute Prüfung von `PROJECT_WITHOUT_OWNER` aus.

### 2.2 Replacement

**UI:** Dropdown mit servicebezogenen Ersatzpersonen

**Voraussetzung:** Bestätigtes Service-Assignment-Modell

**Regeln:**

- Eine Replacement-Auswahl ist erst zulässig, wenn die Relation

  ```text
  Projekt → Service → Verantwortlicher → Replacement
  ```

  fachlich und technisch unterstützt wird.
- Es dürfen nur Personen angeboten werden, die für den konkreten Service als Ersatz zulässig sind.
- Eine beliebige Person aus `public.people` ist nicht automatisch ein Replacement.
- Gültigkeitszeitraum, Bestätigungsstatus und gegebenenfalls Skills müssen berücksichtigt werden.
- Solange das Service-Assignment-Modell fehlt, bleibt Replacement `n/a` und ist nicht editierbar.

### 2.3 Contract Status

**UI:** Dropdown

**Zulässige Werte:**

- `Open`
- `Closed`
- `Pending`
- `Cancelled`

**Regeln:**

- Die Werte werden in ein kanonisches Statusmodell überführt.
- Statusänderungen müssen den bisherigen Wert, den neuen Wert und den Änderungsgrund speichern.
- Ein Statuswechsel kann die offenen Projekte, Vertragsstunden, Risiken und Auslastungskennzahlen verändern.
- Die Änderung darf deshalb nur mit ausreichender Berechtigung und sichtbarer Bestätigung erfolgen.

## 3. Nicht direkt editierbare Felder

### Customer Mapping

Customer Mapping bleibt ein Customer-Master-Stammdatenprozess. Eine Resolution im Project-Risks-Modul darf keine `legal_entity_id` setzen, ändern oder ersatzweise über den Kundennamen bestimmen.

Fehlende oder widersprüchliche Customer Mappings werden an den zuständigen Customer-Master-Prozess verwiesen.

### Service Mapping

Service Mapping bleibt ein kanonischer Service- beziehungsweise Stammdatenprozess. Eine Resolution darf keine freie Servicebezeichnung in `time.project` oder `time.service` schreiben.

Fehlende Servicezuordnungen werden fachlich geprüft und über einen dafür vorgesehenen Datenprozess korrigiert.

## 4. Berechtigungen

Die Berechtigungsprüfung muss serverseitig erfolgen und darf nicht nur durch ausgeblendete UI-Elemente umgesetzt werden.

Vorgesehene Berechtigungsstufen:

| Berechtigung | Sichtbarkeit | Änderungsumfang |
|---|---|---|
| Project Risks Read | Risiken und Source References | keine Änderungen |
| Project Resolution Read | Risiken, vorgeschlagene Aktionen und Audit-Historie | keine Änderungen |
| Project Resolution Responsible | Verantwortlichen setzen | nur `owner_person_id` in erlaubtem Projektscope |
| Project Resolution Status | Contract Status ändern | nur kanonischer Status im erlaubten Projektscope |
| Project Resolution Replacement | Replacement setzen | erst nach Einführung des Service-Assignment-Modells |
| Customer Master Write | Customer Mapping | nicht durch Project Resolution; separater Stammdatenprozess |
| Service Master Write | Service Mapping | nicht durch Project Resolution; separater Stammdatenprozess |

Zusätzlich müssen Rolle, Projekt-Scope, Department-Scope und gegebenenfalls Freigabestufe geprüft werden. Ein Benutzer darf keine Änderung allein deshalb ausführen können, weil er das Risiko sehen kann.

## 5. Audit Trail

Jede erfolgreiche, abgelehnte oder fehlgeschlagene Resolution-Aktion muss nachvollziehbar protokolliert werden.

Mindestens erforderliche Audit-Felder:

- Audit-ID
- Projekt-ID
- Risk Type beziehungsweise ursprüngliche Risikoquelle
- Aktionstyp
- Feldname
- vorheriger Wert
- neuer Wert
- Änderungsgrund
- auslösender Benutzer und stabile User-ID
- Rolle und Berechtigung zum Zeitpunkt der Aktion
- Zeitstempel mit Zeitzone
- Ergebnis: erfolgreich, abgelehnt oder fehlgeschlagen
- Fehler- oder Ablehnungsgrund
- Source Reference und Read-Model-Datenstand

Vorherige und neue Werte müssen strukturiert und revisionssicher gespeichert werden. Sensible Payloads und Secrets gehören nicht in den Audit Trail.

## 6. Änderungen nachvollziehbar speichern

Die Speicherung muss als kontrollierte, serverseitig validierte Aktion erfolgen:

1. Risk-Detail und aktuelle Projektversion lesen.
2. Berechtigung und erlaubtes Feld prüfen.
3. Wert gegen das kanonische Datenmodell validieren.
4. Optionalen Änderungsgrund und Bestätigung erfassen.
5. Konkurrenzänderungen über Version, Zeitstempel oder vergleichbaren Mechanismus erkennen.
6. Änderung atomar speichern.
7. Audit-Ereignis mit altem und neuem Wert schreiben.
8. Betroffene Read-Model-KPIs neu auswerten.

Eine fehlgeschlagene Speicherung darf nicht als erfolgreiche Korrektur angezeigt werden. Bei unklarer Datenlage ist die Aktion abzulehnen und als `n/a` beziehungsweise Datenqualitätsfall sichtbar zu halten.

## 7. Mögliche Freigaben

Für fachlich oder operativ relevante Änderungen kann ein zweistufiger Prozess erforderlich sein:

```text
Risiko → Änderung vorgeschlagen → Freigabe → Speicherung → Audit
```

Mögliche Freigaberegeln:

- Owner-Änderung durch Projektleitung oder Department Head
- Statusänderung von `Open` nach `Closed` durch berechtigte Projektverantwortliche oder Management
- Statusänderung nach `Cancelled` mit verpflichtendem Grund
- Replacement-Änderung durch fachlich zuständige Serviceleitung
- Änderungen mit Auswirkung auf Vertragsvolumen oder Forecast mit zusätzlicher Management-Freigabe

Freigaben müssen selbst auditiert werden. Eine Freigabe darf nicht automatisch eine Customer-Master- oder Service-Master-Änderung auslösen.

## 8. UI-Verhalten

- Risiken bleiben sichtbar, bis die erneute Read-Model-Prüfung die Korrektur bestätigt.
- Editierbare Felder zeigen ihren aktuellen Wert und die zulässigen Optionen.
- Nicht editierbare Customer- und Service-Mappings zeigen einen Verweis auf den zuständigen Stammdatenprozess.
- Aktionen benötigen eine klare Bestätigung und bei kritischen Feldern einen Änderungsgrund.
- Fehler, fehlende Berechtigungen und ausstehende Freigaben werden eindeutig angezeigt.
- Während einer Aktion werden keine optimistischen Erfolgswerte angezeigt, die noch nicht gespeichert oder geprüft wurden.

## 9. Datenqualitäts- und Sicherheitsregeln

- Keine Freitext-Kundenaggregation als Korrekturmechanismus.
- Keine Ersatzperson ohne bestätigte servicebezogene Relation.
- Keine direkte Bearbeitung von Customer Mapping oder Service Mapping im Project-Risks-Modul.
- Keine Änderung ohne serverseitige Berechtigungsprüfung.
- Keine Änderung ohne Audit Trail.
- Keine stillschweigenden Defaults oder Dummy-Werte.
- Keine Secrets oder sensiblen Rohdaten in UI, Logs oder Audit-Ereignissen.
- Jede Änderung muss auf stabile IDs und eine konkrete Source Reference zurückführbar sein.

## 10. Offene Voraussetzungen

Vor einer technischen Umsetzung müssen mindestens folgende Punkte fachlich bestätigt werden:

1. Verantwortungs- und Projekt-Scope je Rolle.
2. Kanonisches Contract-Statusmodell und zulässige Übergänge.
3. Service-Assignment-Modell für Replacement.
4. Freigabepflichten je Aktion und Statuswechsel.
5. Audit-Aufbewahrung und Zugriff auf Historien.
6. Konfliktverhalten bei parallelen Änderungen.
7. Revalidierung der betroffenen Project-Risk-KPIs.

Dieses Dokument beschreibt ausschließlich das Zielbild. Es führt keine Schreiboperation, Migration oder Datenbankänderung aus.
