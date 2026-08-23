# ADR-001: Single Source of Truth und Stammdatenlogik für Customer Master

- Status: Accepted
- Datum: 2026-08-22

## Kontext

Kundeninformationen werden in Lexware und im HSE Customer Master benötigt, dort
aber mit unterschiedlichen fachlichen Verantwortlichkeiten. Insbesondere sind
Lexware-Kontakte, Legal Entities, Standorte, Unternehmensverbünde,
Rahmenverträge und Projekte nicht dasselbe Konzept und dürfen nicht implizit
gleichgesetzt werden.

## Entscheidung

### 1. Lexware als SSOT für abrechnungsrelevante Kundendaten

Lexware ist das führende System für:

- rechtliche Kundenbezeichnung
- Kundennummer
- Rechnungsadressen
- Ansprechpartner
- Angebote
- Auftragsbestätigungen
- abrechnungsrelevante Stammdaten

Eine Lexware-Kundennummer entspricht nicht automatisch einer eindeutigen Legal
Entity. Ein Unternehmen kann aufgrund verschiedener Standorte, historischer
Prozesse oder organisatorischer Gründe mehrfach in Lexware vorhanden sein.

### 2. HSE Customer Master als SSOT für fachliche Kundenbeziehungen

Der HSE Customer Master ist das führende System für:

- eindeutige Legal Entities
- Standorte
- Unternehmensverbünde
- Rahmenverträge
- Aliase und historische Bezeichnungen
- Beziehungen zwischen Kunden, Standorten, Verträgen und Projekten

Der Customer Master ergänzt Lexware und ersetzt Lexware nicht.

### 3. Legal Entity und Lexware-Kontakt strikt trennen

Ein Lexware-Kontakt ist nicht automatisch eine eigenständige Legal Entity im
HSE-Datenmodell.

Beispiel: `PBS Germany Operations GmbH` kann eine Legal Entity mit mehreren
Standorten und Lexware-Referenzen sein:

- Berlin → Lexware-Kundennummer `10284`
- Neu-Isenburg → Lexware-Kundennummer `10285`

Vor Zusammenführungen muss die rechtliche Identität geprüft werden, zum
Beispiel anhand von:

- USt-ID
- Handelsregisterdaten
- vollständiger rechtlicher Firmierung

Eine automatische Zusammenführung ausschließlich aufgrund ähnlicher Namen
oder Adressen ist nicht zulässig.

### 4. Unternehmensverbünde separat modellieren

Rechtlich eigenständige Gesellschaften bleiben eigenständige Legal Entities.
Die Gruppenzugehörigkeit wird als eigene Beziehung im HSE Customer Master
modelliert.

```text
Unternehmensverbund SolarPro
├── SolarPro Gesellschaft A → eigene Legal Entity
├── SolarPro Gesellschaft B → eigene Legal Entity
└── SolarPro Gesellschaft C → eigene Legal Entity
```

### 5. Standort ist keine Legal Entity

Die Grundlogik lautet:

```text
gleicher Firmenname
+ gleiche rechtliche Identität
+ unterschiedliche Adresse
= eine Legal Entity mit mehreren Standorten
```

Eine abweichende Adresse allein erzeugt keine neue Legal Entity.

### 6. Rahmenverträge separat modellieren

Ein Rahmenvertrag ist weder Legal Entity noch Standort noch
Unternehmensverbund. Rahmenverträge werden als eigene Vertragsbeziehung
modelliert.

```text
Rahmenvertrag ENERCON
├── Projekt A
├── Projekt B
├── Projekt C
└── Projekt D
```

### 7. Verbindliche Entity-Resolution-Reihenfolge

Bei Konflikten, Dubletten oder unklaren Zuordnungen wird in dieser Reihenfolge
geprüft:

1. rechtliche Identität / Legal Entity
2. Lexware-Kontakt und Kundennummer
3. Standort
4. Unternehmensverbund
5. Rahmenvertrag
6. Projekt-/Auftragszuordnung

Erst danach darf ein Datensatz klassifiziert werden als:

- Legal Entity / eigener Kunde
- Standort
- Alias
- Unternehmensverbund-Mitglied
- historischer Datensatz
- Dublette
- fehlerhafte Zuordnung

Unsichere Zuordnungen dürfen niemals automatisch zusammengeführt werden und
müssen für eine manuelle Prüfung markiert werden.

### 8. Integrationsprinzip

> Lexware ist SSOT für abrechnungsrelevante Kundendaten und Belege.

> Der HSE Customer Master ist SSOT für die fachlichen Beziehungen zwischen
> Legal Entities, Standorten, Unternehmensverbünden, Rahmenverträgen und
> Projekten.

Beide Systeme werden über stabile Referenzen miteinander verbunden.

Lexware-Daten dürfen für Suche, Darstellung, Zuordnung und technische
Verarbeitung gespiegelt oder gecacht werden. Die fachliche Ownership der
abrechnungsrelevanten Ursprungsdaten verbleibt bei Lexware.

### 9. Konsequenzen für das Datenmodell

Das zukünftige Datenmodell darf diese Konzepte nicht in einer einzigen
Customer-Tabelle vermischen. Mindestens konzeptionell getrennt zu behandeln
sind:

- Legal Entity
- External System Reference / Lexware Customer
- Location
- Corporate Group
- Framework Agreement
- Project / Order
- Alias

Die konkrete Tabellenstruktur ist nicht Bestandteil dieses ADR und wird
anschließend separat entworfen.

### 10. Schutzregel für zukünftige Entwicklung

Diese ADR ist bei allen zukünftigen Änderungen an Kunden-, Projekt-, Vertrags-
und Stammdatenstrukturen verbindlich zu berücksichtigen.

Vor Schemaänderungen, Imports, Synchronisationen oder automatischen
Datenbereinigungen muss geprüft werden, ob die Änderung mit ADR-001 vereinbar
ist.

## Konsequenzen

- Lexware und HSE Customer Master haben klar getrennte fachliche Ownerships.
- Entity Resolution benötigt eine rechtliche Prüfung und darf nicht allein auf
  Namens- oder Adressähnlichkeit beruhen.
- Mehrere Lexware-Kontakte können auf eine Legal Entity referenzieren.
- Rechtlich eigenständige Gesellschaften bleiben getrennt und werden über
  Unternehmensverbund-Beziehungen gruppiert.
- Die konkrete Tabellenstruktur und nachfolgende Integrationen müssen diese
  Trennung abbilden.

## Geltungsbereich

Diese Entscheidung ist für alle zukünftigen Änderungen an Kunden-, Projekt-,
Vertrags- und Stammdatenstrukturen verbindlich. Sie gilt insbesondere für
Schemaänderungen, Imports, Synchronisationen und automatische
Datenbereinigungen.
