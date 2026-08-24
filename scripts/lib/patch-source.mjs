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
 * Inserts an import after the LAST existing import statement.
 *
 * WHY NOT AN ANCHOR PER FILE. The first version took an `afterAnchor` string,
 * and it was wrong three times in a row -- TimeTracker imports a multi-line
 * brace block, DashboardPanels imports different helpers than its siblings, and
 * each miss cost a run. The last import line is derivable from the file itself,
 * so derive it. Multi-line import blocks are handled by scanning for the line
 * that CLOSES the last import, not the line that starts it.
 */
function insertImport(source, statement) {
  const lines = source.split("\n");
  let last = -1;
  let inBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (inBlock) {
      // A closing brace with a `from "..."` tail ends a multi-line import.
      if (/^\}\s*from\s+["']/.test(line.trim()) || /^\}\s*from\s+["']/.test(line)) {
        last = i;
        inBlock = false;
      }
      continue;
    }
    if (/^import\s/.test(line)) {
      if (/\bfrom\s+["'][^"']+["'];?\s*$/.test(line) || /^import\s+["']/.test(line)) {
        last = i; // single-line import
      } else {
        inBlock = true; // opened `import {` with members on following lines
      }
    }
  }

  if (last < 0) throw new Error("no import statement found to insert after");
  lines.splice(last + 1, 0, statement);
  return lines.join("\n");
}

/**
 * Applies `[from, to]` pairs, asserting each `from` appears EXACTLY once.
 * A count of 0 means the file moved under us; a count of 2+ means the anchor
 * is ambiguous and the edit would land somewhere unintended. Both are bugs,
 * and both are silent if you use a plain `.replace()`.
 *
 * `imports` is a list of statements added only if not already present, after
 * the file's last existing import.
 */
export function patchFile(file, edits, { imports = [] } = {}) {
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

  for (const statement of imports) {
    // Compare on the module path, so re-running with a different member list
    // does not add a second import of the same module.
    const modulePath = /from\s+["']([^"']+)["']/.exec(statement)?.[1];
    if (modulePath && s.includes(`from "${modulePath}"`)) continue;
    s = insertImport(s, statement);
  }

  writeFileSync(file, crlfDominant ? s.replace(/\n/g, "\r\n") : s);
  console.log(`patched ${file} (${edits.length} edit(s), ${crlfDominant ? "CRLF" : "LF"})`);
}

/** The card vocabulary import, needed by nearly every panel migration. */
export const cardImport = (names = "Card") =>
  `import { ${names} } from "@/components/ui/Card";`;
