/*
 * Line-ending-agnostic asserted patching.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo has MIXED line endings, file by file: Card.tsx is fully CRLF,
 * ContractWatchlist.tsx is fully LF, and AlertList.tsx had a single CRLF line
 * where an earlier script inserted an import. Any patch script that hardcodes
 * one convention fails on half the files -- and fails LOUDLY only if it
 * asserts, which is why every replacement here must match exactly once.
 *
 * Strategy: normalise to LF in memory, patch, write back in the file's own
 * DOMINANT ending. Writing back in the dominant form also quietly repairs
 * files that had a stray line in the other convention.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Reads a file as LF text, remembering how it was stored. */
export function readNormalised(file) {
  const raw = readFileSync(file, "utf8");
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length;
  return { text: raw.replace(/\r\n/g, "\n"), crlfDominant: crlf * 2 > lf };
}

/**
 * Applies `[from, to]` pairs, asserting each `from` appears EXACTLY once.
 * A count of 0 means the file moved under us; a count of 2+ means the anchor
 * is ambiguous and the edit would land somewhere unintended. Both are bugs,
 * and both are silent if you use a plain `.replace()`.
 */
export function patchFile(file, edits, { addImport } = {}) {
  const { text, crlfDominant } = readNormalised(file);
  let s = text;

  for (const [from, to] of edits) {
    const n = s.split(from).length - 1;
    if (n !== 1) {
      throw new Error(
        `${file}: expected exactly 1 match, found ${n}\n  anchor: ${from.slice(0, 90)}`
      );
    }
    s = s.replace(from, to);
  }

  if (addImport) {
    const { statement, afterAnchor, test } = addImport;
    if (!test.test(s)) {
      const n = s.split(afterAnchor).length - 1;
      if (n < 1) throw new Error(`${file}: import anchor not found: ${afterAnchor}`);
      s = s.replace(afterAnchor, `${afterAnchor}\n${statement}`);
    }
  }

  writeFileSync(file, crlfDominant ? s.replace(/\n/g, "\r\n") : s);
  console.log(`patched ${file} (${edits.length} edit(s), ${crlfDominant ? "CRLF" : "LF"})`);
}

/** The Card import, needed by nearly every panel migration. */
export const cardImport = (names = "Card") => ({
  statement: `import { ${names} } from "@/components/ui/Card";`,
  test: /from "@\/components\/ui\/Card"/,
  afterAnchor: `import Link from "next/link";`,
});
