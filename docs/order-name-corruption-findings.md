# The eight mis-named orders are a spreadsheet problem, not an import bug

Written 26 Aug 2026. Reproduce with
`node scripts/diagnose-order-names-vs-workbook.mjs`.

## What was suspected

`scripts/diagnose-order-name-customer-conflict.mjs` found orders in
`public.projects` whose **name names a different company than their own
customer field**. The Lexware prefix in each order number agrees with the
customer, so the name looked like the corrupted field — the classic signature of
an off-by-one row shift while reading a spreadsheet.

The natural conclusion was that the importer had misaligned rows, and the fix
would be mechanical: re-read the workbook and write the right names.

## What is actually true

**The importer is faultless. Every one of the eight bad names is sitting in the
source workbook, verbatim, on the same row as the customer it contradicts.**

| Order | Customer (workbook) | Order Name (workbook) | Hours at stake |
| --- | --- | --- | --- |
| `10234_00103_104_01` | Netto ApS & Co. KG | `Mirantis Safety Engineer 2026/2027` | **201.5h logged, 288h contract** |
| `10738_00319_104_01` | Unity Technologies GmbH | `Intel GmbH / SiFa` | 9.3h logged |
| `10110_00375_205_01` | AWB Aluminiumwerk Berlin GmbH | `missing` | 5.8h logged |
| `10361_00178_205_01` | SAGE Automotive Interiors | `missing` | 4h contract |
| `10305_00327_104_01` | Susell GmbH | `Reteach / 26/27 SiFa` | 10h contract |
| `10822_00326_203_01` | Susell GmbH | `Reteach / 26/27 BA` | 2h contract |
| `10151_00369_403_01` | Stiftung Topographie des Terrors | `NS Dokumentationszentrum / Notfallhandbuch` | 10h contract |
| `10940_00407_401_01` | Kirby Group Engineering (Germany) GmbH | `Abrechnung über SIFA Vertrag` | 20h contract |

Several appear on **multiple sheets** with the same wrong name — `Intel GmbH /
SiFa` against Unity Technologies is on the service sheet *and* on Stephan's *and*
on Thorsten's. So this is not one stray paste; the error has been copied across
the workbook.

## Why that matters more, not less

A misaligned importer is one bug in one script, fixed once. This is worse in two
specific ways:

1. **Re-running the import cannot fix it and will re-import it.** The pipeline is
   working exactly as designed. Any correction applied to `public.projects` alone
   is undone by the next import.
2. **The workbook is what the team reads.** Someone opening the SiFa sheet to
   check Netto's 2026 contract sees "Mirantis Safety Engineer" against 288
   contracted hours, with 201.5h already logged. The hub is faithfully reporting
   what the source says.

## The judgement calls, which are yours

These are not all the same kind of problem:

- **Two are almost certainly row shifts in Excel.** `Mirantis` against Netto and
  `Intel GmbH` against Unity Technologies both name a real, different customer who
  also exists in the book. Someone dragged a fill handle.
- **Two are literally the string `missing`.** That is a placeholder someone typed
  and never replaced, so the honest hub representation is arguably NULL rather
  than the word "missing" — but only you can say what those orders are.
- **Four may be legitimate and only look wrong.** `Reteach` is a product name, and
  Susell GmbH may genuinely have bought Reteach training. `Abrechnung über SIFA
  Vertrag` ("billed under the SiFa contract") reads like a real note about how
  Kirby Group is invoiced. `NS Dokumentationszentrum` against Stiftung
  Topographie des Terrors is plausibly the site name rather than the client name.
  **Do not "fix" these without checking.** The conflict detector flags a name that
  shares no word with its customer, which correctly catches a row shift and also
  catches a perfectly good name for a differently-named site or product.

## Recommended fix, in order

1. **Correct the workbook first**, at least for the two probable row shifts. It is
   the source of truth and the thing colleagues read.
2. Re-run `node scripts/import-masterdata-projects.mjs --dry-run` and confirm the
   names change.
3. Then run it for real.
4. Decide what the two `missing` orders are, or delete them if they are not real
   orders.
5. Confirm or dismiss the four possible false positives.

## What was deliberately not done

No name was written to the database. Both the earlier diagnostic and this one are
read-only. Correcting `projects.name` from the hub side would have hidden a source
error behind a database patch that the next import silently reverts, and one of
these rows carries 201.5h of logged time against a customer contract.
