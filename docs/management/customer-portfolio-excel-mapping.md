# Customer Portfolio Excel → HSE EOS Mapping

**Status:** Fachliche Migrationsdokumentation
**Zweck:** Die bisherige Customer-Portfolio-Excel-Struktur wird als fachliche Quelle dokumentiert und schrittweise in HSE-EOS-Domänen überführt.
**Umsetzungsstatus:** Keine technische Migration in diesem Dokument

## 1. Ziel und Grundsätze

Die Excel-Datei enthält operative Informationen zu Kunden, Projekten, Services, Standorten, Vertragsstunden, Abrechnung und externen Arbeitslinks. Sie ist eine fachliche Quelle und kein dauerhaft führendes Stammdatensystem.

Für HSE EOS gelten folgende Grundsätze:

- Der Customer Master bleibt führend für Legal Entities, Kundenstammdaten und Beziehungen.
- Projekte und Aufträge werden über stabile IDs und nicht über Freitext verbunden.
- Services werden über einen kanonischen Servicekatalog geführt.
- Verantwortliche und Replacement werden person- und servicebezogen modelliert.
- Stunden und Abrechnungswerte werden mit eindeutiger Einheit gespeichert.
- Fehlende oder nicht eindeutig zuordenbare Werte werden als Datenqualitätsproblem ausgewiesen.
- Links werden nur übernommen, wenn ihre Quelle und Projektzuordnung belastbar sind.

## 2. Mapping-Tabelle

| Excel Feld | Fachliche Bedeutung | Ziel-Domäne | Zukünftiges Datenmodell | Management sichtbar | Mitarbeiter sichtbar | Vertrieb sichtbar |
|---|---|---|---|---|---|---|
| Customer / Kunde | Geschäftlicher Kunde bzw. Kundenbezeichnung | Customer Master | `crm.legal_entity` über stabile `legal_entity_id`; Excel-Name nur als Importwert | Ja | Ja | Ja |
| Order Name | Bezeichnung des Auftrags oder Projekts | Projekt / Auftrag | `projects.project_order.name`, verknüpft mit `project_order.id` | Ja | Ja | Ja |
| Service | Erbrachte HSE-Leistung | Service | `time.service` bzw. kanonischer Servicekatalog mit Service-ID | Ja | Ja | Ja |
| Start Date | Beginn der Leistung oder Vertragsperiode | Vertrag / Projektzeitraum | Vertrags- oder Projektlaufzeit mit `start_date` | Ja | Ja | Ja |
| Delivery Date | Geplantes Liefer- oder Enddatum | Vertrag / Projektzeitraum | `end_date` bzw. `delivery_date` mit definierter Semantik | Ja | Ja | Ja |
| Language | Arbeitssprache des Auftrags | Projekt / Delivery | Projektsprachprofil oder `project_language` mit kontrolliertem Code | Ja | Ja | Ja |
| Sifa | Verantwortliche SiFa / fachlich betreuende Person | Verantwortlichkeit | Servicebezogene Assignment-Relation `project → service → person` | Ja | Ja | Ja |
| Replacement | Vertretung für die fachlich verantwortliche Person | Verantwortlichkeit | Bestätigte servicebezogene Replacement-Relation mit Gültigkeit | Ja | Ja | Optional |
| Postal Code | Postleitzahl des Einsatz- oder Kundenstandorts | Standort | `crm.location.postal_code`, verbunden über `legal_entity_id` bzw. Projektstandort | Ja | Ja | Ja |
| City | Ort des Einsatz- oder Kundenstandorts | Standort | `crm.location.city` | Ja | Ja | Ja |
| Street | Straße und Hausnummer des Standorts | Standort | `crm.location.street` bzw. getrennte Adressfelder | Eingeschränkt | Ja | Ja |
| Stunden laut Vertrag | Vertraglich vereinbartes Stundenvolumen | Vertrag / Kapazität | Vertragsvolumen in Stunden mit Einheit und Gültigkeitszeitraum | Ja | Ja | Ja |
| Planned Billable Hours | Geplante abrechenbare Stunden | Kapazität / Forecast | Planstunden-Projektion mit Zeitraum und Quelle | Ja | Ja | Ja |
| Onsite Factor | Anteil oder Faktor der Vor-Ort-Leistung | Delivery / Kapazität | Explizit definierter Faktor, z. B. `onsite_share_percent` | Ja | Ja | Ja |
| Onsite Hours | Vertrags- oder Planstunden vor Ort | Delivery / Kapazität | `onsite_hours` mit Quelle, Zeitraum und Einheit | Ja | Ja | Ja |
| Remote Hours | Vertrags- oder Planstunden remote | Delivery / Kapazität | `remote_hours` mit Quelle, Zeitraum und Einheit | Ja | Ja | Ja |
| Zeit vor Ort | Tatsächlich geleistete Vor-Ort-Zeit | Ist-Zeit | Verknüpfung zu Ist-Zeit, z. B. `time.entry` mit Ortsmerkmal | Ja | Ja | Eingeschränkt |
| Pauschale Anfahrt | Vereinbarte pauschale Abrechnung für Anfahrt | Abrechnung | Abrechnungsposition mit Betrag, Einheit, Währung und Gültigkeit | Ja | Eingeschränkt | Ja |
| Reisezeit bezahlt | Regel, ob Reisezeit vergütet/abrechenbar ist | Abrechnung / Vertrag | Vertragsregel oder Abrechnungsmerkmal `paid_travel_time` | Ja | Ja | Ja |
| Google Chat | Operativer Kommunikationslink | Operative Links | Projekt- oder Kundenlink mit `link_type = google_chat` und URL | Ja | Ja | Eingeschränkt |
| Drive | Dokumentenablage des Kunden oder Projekts | Operative Links | Projekt- oder Kundenlink mit `link_type = drive` und URL | Ja | Ja | Ja |
| Teams | Microsoft-Teams-Kanal oder Teamlink | Operative Links | Projekt- oder Kundenlink mit `link_type = microsoft_teams` und URL | Ja | Ja | Eingeschränkt |
| TrackingTime | Zeiterfassungsprojekt oder externe Projektansicht | Operative Links / Zeit | Stabile externe Projekt-Referenz zu `time.project` | Ja | Ja | Eingeschränkt |
| Asana | Aufgaben- oder Projektplanung | Operative Links / Delivery | Stabile externe Projekt-Referenz zu Asana mit `link_type = asana` | Ja | Ja | Eingeschränkt |

## 3. Ziel-Domänen

### Customer Master

Enthält die kanonische Legal Entity, Kundenstammdaten, Beziehungen und Standorte. Ein Excel-Kundenname darf nicht als endgültige Kundenidentität verwendet werden.

### Projekt und Auftrag

Ein Auftrag kann mehrere operative Projekte oder Services umfassen. `Order Name`, Start- und Lieferdatum sowie der Projektstatus müssen auf eine stabile Auftrags- oder Projektidentität abgebildet werden.

### Service und Verantwortlichkeit

Der Service wird aus dem kanonischen Servicekatalog bezogen. Die Verantwortlichkeit ist nicht nur eine globale Personenzuordnung, sondern wird fachlich je Service geprüft:

```text
Projekt → Service → Verantwortlicher → Replacement
```

### Vertrag und Kapazität

Vertragliche Stunden, geplante abrechenbare Stunden und Vor-Ort-/Remote-Aufteilung müssen als getrennte Werte mit Einheit, Zeitraum und Quelle gespeichert werden. Ein Planwert ist nicht automatisch eine Ist-Zeit.

### Abrechnung

Anfahrtspauschalen und bezahlte Reisezeit sind Vertrags- oder Abrechnungsregeln. Sie dürfen nicht mit Arbeitsstunden vermischt werden.

### Operative Links

Externe Links werden als reine Read-only-Referenzen geführt. Sie dürfen nur angezeigt werden, wenn URL, Linktyp und Projekt- oder Kundenbezug belastbar sind. Eine Excel-Zeichenkette ohne verifizierbare Zielidentität wird als Datenqualitätsfall behandelt.

## 4. Sichtbarkeitsregeln

- **Management:** erhält aggregierte Kunden-, Projekt-, Service-, Kapazitäts-, Risiko- und Datenqualitätsinformationen.
- **Mitarbeiter:** erhält die für eigene operative Arbeit erforderlichen Projekte, Services, Verantwortlichkeiten, Stunden und Links gemäß Berechtigung.
- **Vertrieb:** erhält kunden- und vertriebsrelevante Portfolioinformationen, Vertragsvolumen und Services; interne Mitarbeiter- oder Abrechnungsdetails nur nach fachlicher Berechtigung.

„Ja“ in der Tabelle bedeutet fachliche Eignung, nicht automatisch Zugriff für jede Rolle. Die tatsächliche Sichtbarkeit wird durch HSE-EOS-Berechtigungen und RLS bestimmt.

## 5. Datenqualitätsregeln

Folgende Fälle müssen vor einer produktiven Überführung erkannt werden:

- Kunde ohne stabile `legal_entity_id`
- Order ohne eindeutige Projekt- oder Auftrags-ID
- Service außerhalb des kanonischen Servicekatalogs
- Sifa ohne auflösbare Personreferenz
- Replacement ohne bestätigte servicebezogene Relation
- Start- oder Lieferdatum ohne definierte Datumssemantik
- Stundenwerte ohne Einheit, Zeitraum oder Herkunft
- Onsite-/Remote-Stunden, deren Summe nicht zum Vertragsvolumen passt
- fehlende oder widersprüchliche Standortdaten
- externe Links ohne stabile Projekt- oder Kundenreferenz

Keiner dieser Fälle darf durch einen geschätzten Defaultwert verdeckt werden. Nicht verfügbare Werte werden als `n/a` bzw. als Datenqualitätsfehler geführt.

## 6. Fachliche Überführungsschritte

1. Excel-Spalten und Wertebereiche inventarisieren, ohne Daten zu verändern.
2. Kunden gegen `crm.legal_entity` abgleichen und stabile Referenzen bestätigen.
3. Aufträge und Projekte gegen `projects.project_order`, `public.projects` und `time.project` abgleichen.
4. Excel-Servicewerte auf den kanonischen `time.service`-Katalog mappen.
5. Sifa- und Replacement-Beziehungen fachlich validieren.
6. Stunden- und Abrechnungsfelder hinsichtlich Einheit, Zeitraum und Berechnung klären.
7. Standorte und externe Links auf vorhandene HSE-EOS-Modelle prüfen.
8. Nicht auflösbare Datensätze in einem Data-Quality-Review ausweisen.
9. Erst nach fachlicher Freigabe ein technisches Import- oder Backfill-Konzept erstellen.

Dieses Dokument beschreibt ausschließlich das fachliche Mapping. Es führt keine Migration, keinen Import und keine Datenbankänderung aus.
