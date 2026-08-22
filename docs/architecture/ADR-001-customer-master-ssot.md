# ADR-001: Single Source of Truth und Stammdatenlogik fuer den Customer Master

- **Status:** Accepted
- **Datum:** 2026-08-22
- **Autor:** Bjoern Schoenemann (erarbeitet im Customer-Dashboard-Sandbox-Projekt),
  uebernommen in das Hub-Portal durch Review am 2026-08-22
- **Gilt fuer:** alle zukuenftigen Aenderungen an Kunden-, Projekt-, Vertrags-
  und Stammdatenstrukturen in diesem Repository

> Provenance: Dieses ADR entstand in Bjoerns Sandbox-Fork
> (`kerne1b1ueprint/supabase-app--customer-dashboard`) waehrend der Arbeit an
> einem Customer-Master-Datenmodell gegen die HSE-Masterdata-Exceldatei
> (`HSE_Masterdata_Uebersicht Kunden_verantwortlichkeiten_customer_responsible_2026_V2.xlsx`).
> Es wird hier unveraendert in der Sache uebernommen, weil die Regeln fuer das
> HAUPTPORTAL genauso gelten: auch unsere `time.customer`-Tabelle enthaelt
> Vendor-Duplikate (z. B. "WorkMotion Software GmbH" vs "WorkMotion Europe
> GmbH", ENERCON GmbH vs ENERCON PLM GmbH), und ohne diese Regeln wuerde jede
> Bereinigung raten statt pruefen.

## 1. Lexware als SSOT fuer abrechnungsrelevante Kundendaten

Lexware ist das fuehrende System fuer:

- rechtliche Kundenbezeichnung
- Kundennummer
- Rechnungsadressen
- Ansprechpartner
- Angebote
- Auftragsbestaetigungen
- abrechnungsrelevante Stammdaten

Eine Lexware-Kundennummer entspricht jedoch **nicht automatisch** einer
eindeutigen Legal Entity. Ein Unternehmen kann aufgrund verschiedener
Standorte, historischer Prozesse oder anderer organisatorischer Gruende
mehrfach in Lexware vorhanden sein.

## 2. HSE Customer Master als SSOT fuer fachliche Kundenbeziehungen

Der HSE Customer Master ist das fuehrende System fuer die fachlichen
Beziehungen, die in Lexware nicht ausreichend modelliert werden:

- eindeutige Legal Entities
- Standorte
- Unternehmensverbuende
- Rahmenvertraege
- Aliase und historische Bezeichnungen
- Beziehungen zwischen Kunden, Standorten, Vertraegen und Projekten

Der Customer Master **ersetzt Lexware nicht**.

## 3. Legal Entity und Lexware-Kontakt strikt trennen

Ein Lexware-Kontakt ist nicht automatisch ein eigenstaendiger Kunde bzw. eine
eigenstaendige Legal Entity im HSE-Datenmodell.

Beispiel PBS: `PBS Germany Operations GmbH` ist voraussichtlich EINE Legal
Entity mit zwei Standorten und zwei Lexware-Referenzen:

- Berlin -> Lexware-Kundennummer 10284
- Neu-Isenburg -> Lexware-Kundennummer 10285

Vor einer Zusammenfuehrung muss die rechtliche Identitaet geprueft werden,
z. B. anhand von USt-ID, Handelsregisterdaten oder vollstaendiger rechtlicher
Firmierung. **Eine automatische Zusammenfuehrung ausschliesslich anhand
aehnlicher Namen ist nicht zulaessig.**

## 4. Unternehmensverbuende separat modellieren

Rechtlich eigenstaendige Gesellschaften bleiben eigenstaendige Legal Entities.

```
Unternehmensverbund SolarPro
+-- SolarPro Gesellschaft A  -> eigene Legal Entity
+-- SolarPro Gesellschaft B  -> eigene Legal Entity
+-- SolarPro Gesellschaft C  -> eigene Legal Entity
```

Die Konzern-/Gruppenzugehoerigkeit wird im HSE Customer Master als BEZIEHUNG
modelliert, nicht durch Zusammenlegen der Gesellschaften.

## 5. Standort ist keine Legal Entity

```
gleicher Firmenname
+ gleiche rechtliche Identitaet
+ unterschiedliche Adresse
= EINE Legal Entity mit mehreren Standorten
```

Eine abweichende Adresse allein erzeugt keine neue Legal Entity.

## 6. Rahmenvertraege separat modellieren

Ein Rahmenvertrag ist keine Legal Entity, kein Standort und kein
Unternehmensverbund. Er ist eine eigene Vertragsbeziehung.

```
Rahmenvertrag ENERCON
+-- Projekt A (z. B. W-12727 Bimolten, 320h)
+-- Projekt B (z. B. W-13019 Duelmen, 195h)
+-- Projekt C (z. B. W-13301 Wohlsdorf, 184h)
```

Anmerkung fuer dieses Repository: die `time.project_contract_period`-Tabelle
(Contract-Feature, 2026-08-22) modelliert Vertragszeitraeume PRO PROJEKT. Ein
Rahmenvertrag umspannt mehrere Projekte und ist damit eine EIGENE, noch nicht
gebaute Ebene DARUEBER -- nicht dasselbe Konzept.

## 7. Verbindliche Reihenfolge bei Datenbereinigung und Entity Resolution

Bei Konflikten oder moeglichen Dubletten wird in dieser Reihenfolge geprueft:

1. rechtliche Identitaet / Legal Entity
2. Lexware-Kontakt und Kundennummer
3. Standort
4. Unternehmensverbund
5. Rahmenvertrag
6. Projekt-/Auftragszuordnung

Erst danach darf ein Datensatz klassifiziert werden als: Legal Entity /
eigener Kunde, Standort, Alias, Verbund-Mitglied, historischer Datensatz,
Dublette oder fehlerhafte Zuordnung.

**Schutzregel:** Unsichere Zuordnungen duerfen nicht automatisch
zusammengefuehrt werden. Sie werden fuer eine manuelle Pruefung markiert.
(Diese Regel existiert, damit kein Werkzeug -- menschlich oder KI -- aus
"aehnlicher Firmenname + aehnliche Adresse" eigenmaechtig eine Legal Entity
macht.)

## 8. Integrationsprinzip

Die Systeme werden ueber **stabile Referenzen** verbunden. Ziel ist
ausdruecklich keine redundante Kopie der Lexware-Datenbank.

- Lexware ist SSOT fuer abrechnungsrelevante Kundendaten und Belege.
- Der HSE Customer Master ist SSOT fuer die fachlichen Beziehungen zwischen
  Legal Entities, Standorten, Unternehmensverbuenden, Rahmenvertraegen und
  Projekten.

Daten aus Lexware duerfen im Customer Master fuer Suche, Darstellung,
Zuordnung und technische Verarbeitung gespiegelt oder gecacht werden. Die
fachliche Ownership der abrechnungsrelevanten Ursprungsdaten verbleibt bei
Lexware.

In DIESEM Repository gilt dieselbe Logik bereits fuer TrackingTime:
`time.project.estimated_hours` gehoert dem Vendor-Sync (der Sync upsertet die
Spalte bei jedem Lauf), waehrend vertragliche Budgets in
`time.project_contract_period` leben, wo der Sync sie nicht erreicht. Das ist
derselbe Grundsatz -- externe Systeme behalten ihre Spalten, fachliche
Wahrheit lebt in eigenen Tabellen -- und ADR-001 erweitert ihn auf Lexware und
den kommenden Customer Master.

## 9. Konsequenzen fuer das Datenmodell

Das zukuenftige Datenmodell darf diese Konzepte NICHT in einer einzigen
`customer`-Tabelle vermischen. Mindestens konzeptionell getrennt:

- Legal Entity
- External System Reference (Lexware-Kunde, TrackingTime-Customer, ...)
- Location (Standort)
- Corporate Group (Unternehmensverbund)
- Framework Agreement (Rahmenvertrag)
- Project / Order
- Alias

Die konkrete Tabellenstruktur wird separat entworfen und ist nicht Bestandteil
dieses ADR.

## 10. Schutzregel fuer zukuenftige Entwicklung

Dieses ADR ist bei allen zukuenftigen Aenderungen an Kunden-, Projekt-,
Vertrags- und Stammdatenstrukturen zu beruecksichtigen. Vor Schemaaenderungen
oder automatischen Datenbereinigungen muss geprueft werden, ob die Aenderung
mit ADR-001 vereinbar ist.
