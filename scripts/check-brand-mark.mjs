/**
 * Is the brand mark still the brand mark -- and does it animate only where it
 * should?
 *
 * Four failure modes, each of which compiles, renders, lints and looks roughly
 * fine, so nothing else in this repo would catch them:
 *
 *   1. THE MARK STOPS BEING THE LOGO. It is now hand-authored SVG geometry
 *      rather than /hse-logo.png. Someone "tidying" a path command, flipping a
 *      stub, or changing the viewBox produces a shape that still renders four
 *      teal blocks and is no longer the company logo. This gate rasterises the
 *      paths and compares them against the PNG's own alpha mask, so the claim
 *      "this is the same mark" stays true rather than being a comment.
 *
 *   2. IT ANIMATES WHERE IT IS SEEN ALL DAY. The sidebar mark is on screen for
 *      every module page; the portal is where people land between tasks.
 *      Replaying a 630ms assemble there is a stutter in the middle of someone's
 *      work. `animate` therefore defaults to off, and the two high-frequency
 *      mounts must not opt in.
 *
 *   3. THE ANIMATION BECOMES UNSKIPPABLE. Someone who has asked their OS to
 *      reduce motion must get the mark without the travel.
 *
 *   4. IT GOES OFF-SYSTEM. A hex fill instead of the accent token, `ease-in`
 *      (which delays the exact moment the user is watching), or a duration that
 *      turns a brand moment into a wait.
 *
 * Deliberately NOT asserted: the exact start offsets, the stagger value, or the
 * per-piece direction. Those are taste, they will be tuned, and pinning them
 * makes the gate a maintenance tax -- the lesson this repo already learned when
 * a gate pinned ReportPanels.tsx by filename and a legitimate refactor turned
 * CI red. What is pinned is that the offsets DIFFER (so the pieces read as a
 * sequence) and that they resolve to real movement.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");

const MARK_PATH    = "src/components/BrandMark.tsx";
const CSS_PATH     = "src/app/globals.css";
const AUTH_PATH    = "src/components/AuthShell.tsx";
const SIDEBAR_PATH = "src/components/Sidebar.tsx";
const PORTAL_PATH  = "src/app/portal/page.tsx";
const LOGO_PNG     = "public/hse-logo.png";

for (const p of [MARK_PATH, CSS_PATH, AUTH_PATH, SIDEBAR_PATH, PORTAL_PATH, LOGO_PNG]) {
  if (!existsSync(join(root, p))) check(`${p} exists`, false, "brand mark file missing");
}
if (failed) process.exit(1);

const MARK    = read(MARK_PATH);
const CSS     = read(CSS_PATH);
const AUTH    = read(AUTH_PATH);
const SIDEBAR = read(SIDEBAR_PATH);
const PORTAL  = read(PORTAL_PATH);

// Strip comments before asserting: this file's own documentation names every
// pattern it forbids ("ease-in", hex colours), and a naive regex over the raw
// source matches the prose rather than the code. That mistake has produced a
// green gate in this repo before.
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const MARK_C    = strip(MARK);
const CSS_C     = strip(CSS);
const AUTH_C    = strip(AUTH);
const SIDEBAR_C = strip(SIDEBAR);
const PORTAL_C  = strip(PORTAL);

/* ── 1. The mark is still the logo ───────────────────────────────────────── */

// Minimal PNG decoder (no dependency): the geometry claim must be checked
// against the real asset, not against a copy of the numbers.
function decodePng(buf) {
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    chunks.push({ type: buf.toString("ascii", off + 4, off + 8), data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR").data;
  const W = ihdr.readUInt32BE(0), H = ihdr.readUInt32BE(4);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr[9]];
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = W * ch;
  const out = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let pos = 0;
  for (let y = 0; y < H; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= ch ? cur[i - ch] : 0;
      const up = prev ? prev[i] : 0;
      const ul = prev && i >= ch ? prev[i - ch] : 0;
      const rb = line[i];
      cur[i] = (f === 0 ? rb : f === 1 ? rb + left : f === 2 ? rb + up
        : f === 3 ? rb + ((left + up) >> 1) : rb + paeth(left, up, ul)) & 0xff;
    }
  }
  return { W, H, ch, pixels: out };
}

// Parse the viewBox and the four `d` attributes straight out of the component.
const viewBox = MARK_C.match(/viewBox="0 0 (\d+) (\d+)"/);
check("mark declares a viewBox", Boolean(viewBox), viewBox ? viewBox[0] : "not found");

// `(?<![\w-])d:` and not just `d:` — the pieces also carry an `id:` field, and a
// looser pattern captures "top"/"mid-left" as if they were path data.
const dAttrs = [...MARK_C.matchAll(/(?<![\w-])d:\s*"([^"]+)"/g)].map((m) => m[1]);
check("mark is built from four pieces", dAttrs.length === 4, `found ${dAttrs.length}`);
check(
  "every piece is real path data",
  dAttrs.length > 0 && dAttrs.every((d) => /^M[\d\s]/.test(d) && /Z$/.test(d)),
  dAttrs.map((d) => d.slice(0, 14)).join(" | "),
);

// Rasterise the paths. Every command in this mark is M/H/V/Z on integer
// coordinates, which is exactly why the geometry was authored that way: it can
// be filled here without a full SVG engine, so the comparison is real.
function rasterise(dList, W, H) {
  const grid = new Uint8Array(W * H);
  for (const d of dList) {
    const pts = [];
    let cx = 0, cy = 0;
    const tokens = d.match(/[MHVLZ][-\d.\s,]*/gi) || [];
    for (const t of tokens) {
      const cmd = t[0].toUpperCase();
      const nums = (t.slice(1).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (cmd === "M") { cx = nums[0]; cy = nums[1]; pts.push([cx, cy]); }
      else if (cmd === "H") { cx = nums[0]; pts.push([cx, cy]); }
      else if (cmd === "V") { cy = nums[0]; pts.push([cx, cy]); }
      else if (cmd === "L") { cx = nums[0]; cy = nums[1]; pts.push([cx, cy]); }
    }
    if (pts.length < 3) return null;
    // even-odd scanline fill
    for (let y = 0; y < H; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 === y2) continue;
        const yTop = Math.min(y1, y2), yBot = Math.max(y1, y2);
        if (y + 0.5 < yTop || y + 0.5 >= yBot) continue;
        xs.push(x1 + ((y + 0.5 - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) {
          if (x >= 0 && x < W) grid[y * W + x] = 1;
        }
      }
    }
  }
  return grid;
}

if (viewBox && dAttrs.length === 4) {
  const VW = Number(viewBox[1]), VH = Number(viewBox[2]);
  const svgMask = rasterise(dAttrs, VW, VH);
  check("mark paths are fillable geometry", Boolean(svgMask), "a path with fewer than 3 points cannot be a shape");

  if (svgMask) {
    const { W, H, ch, pixels } = decodePng(readFileSync(join(root, LOGO_PNG)));
    // Locate the PNG's own ink bbox rather than hardcoding it, so replacing the
    // asset with a differently-padded export does not silently pass.
    //
    // Measure the bbox from rows that are actually PART OF THE MARK, not from
    // any pixel that happens to be non-transparent.
    //
    // The asset carries a 2px speck at y=78-79 (a stray 7-11 pixels wide) above
    // the real top bar, which starts at y=80. A naive "any alpha > 128" bbox
    // therefore measures 367x343 instead of the mark's true 367x337, every
    // sample lands ~6 rows off, and the gate reports a 94% mismatch while the
    // geometry is in fact correct. Requiring a row to be at least 10% covered
    // ignores the speck and finds the mark.
    const INK = 128;
    const MIN_ROW_COVER = 0.10;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      let n = 0, rx0 = W, rx1 = -1;
      for (let x = 0; x < W; x++) {
        if (pixels[(y * W + x) * ch + ch - 1] > INK) {
          n++;
          if (x < rx0) rx0 = x;
          if (x > rx1) rx1 = x;
        }
      }
      if (n < W * MIN_ROW_COVER) continue;
      if (rx0 < x0) x0 = rx0;
      if (rx1 > x1) x1 = rx1;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
    check("viewBox matches the logo's aspect ratio",
      Math.abs(VW / VH - pw / ph) < 0.02, `viewBox ${VW}x${VH} vs png ink ${pw}x${ph}`);

    let both = 0, onlySvg = 0, onlyPng = 0;
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        const sx = x0 + Math.round((x * pw) / VW);
        const sy = y0 + Math.round((y * ph) / VH);
        const inPng = sx <= x1 && sy <= y1 && pixels[(sy * W + sx) * ch + ch - 1] > INK;
        const inSvg = svgMask[y * VW + x] === 1;
        if (inPng && inSvg) both++; else if (inSvg) onlySvg++; else if (inPng) onlyPng++;
      }
    }
    const agree = (100 * both) / (both + onlySvg + onlyPng);
    check("vector geometry still matches hse-logo.png", agree >= 98,
      `agreement ${agree.toFixed(2)}% (svg-only ${((100 * onlySvg) / (both + onlySvg + onlyPng)).toFixed(2)}%, png-only ${((100 * onlyPng) / (both + onlySvg + onlyPng)).toFixed(2)}%)`);
  }
}

/* ── 2. Frequency: animate only where it is rare ─────────────────────────── */

check(
  "animation is opt-in, not the default",
  /animate\s*=\s*false/.test(MARK_C),
  "a default-on flourish would play on every high-frequency mount",
);

// The sidebar mark is visible on every module page, all day.
const sidebarMark = SIDEBAR_C.match(/<BrandMark[^>]*\/>/);
check("sidebar mark exists", Boolean(sidebarMark), sidebarMark ? sidebarMark[0] : "not found");
check(
  "sidebar mark does NOT animate",
  Boolean(sidebarMark) && !/\banimate\b/.test(sidebarMark[0]),
  sidebarMark ? sidebarMark[0] : "",
);

// The portal is the hub people return to between tasks.
const portalMark = PORTAL_C.match(/<BrandMark[^>]*\/>/);
check("portal mark exists", Boolean(portalMark), portalMark ? portalMark[0] : "not found");
check(
  "portal mark does NOT animate",
  Boolean(portalMark) && !/\banimate\b/.test(portalMark[0]),
  portalMark ? portalMark[0] : "",
);

// Sign-in is the rare, first-time surface where the delight budget lives.
check(
  "auth shell mark DOES animate",
  /<BrandMark[^>]*\banimate\b/.test(AUTH_C),
  "the one rare surface is where the brand moment belongs",
);

// The raster asset must be gone from the app chrome, or the vector work is
// decorative and half the mounts still ship a blurry PNG.
for (const [label, src] of [["sidebar", SIDEBAR_C], ["portal", PORTAL_C], ["auth shell", AUTH_C]]) {
  check(`${label} no longer renders the raster logo`, !/hse-logo\.png/.test(src), "hse-logo.png still referenced");
}

/* ── 3. Reduced motion ───────────────────────────────────────────────────── */

const reducedBlocks = [...CSS_C.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)]
  .map((m) => m[1]);
check("a reduced-motion rule exists", reducedBlocks.length > 0, `${reducedBlocks.length} blocks`);
check(
  "reduced motion disables the mark's travel specifically",
  reducedBlocks.some((b) => /brand-mark__piece/.test(b) && /animation:\s*none/.test(b)),
  "relying on the global 0.01ms sweep is accidental, not intentional",
);
check(
  "reduced motion leaves the mark visible",
  reducedBlocks.some((b) => /brand-mark__piece/.test(b) && /opacity:\s*1/.test(b)),
  "a hidden logo is not a reduced animation",
);

/* ── 4. On-system ingredients ────────────────────────────────────────────── */

check(
  "pieces fill from the accent token, not a hex literal",
  /fill="var\(--accent\)"/.test(MARK_C) && !/fill="#[0-9a-fA-F]{3,8}"/.test(MARK_C),
  "a hardcoded mint cannot follow the brand colour",
);

const kf = CSS_C.match(/@keyframes\s+brand-mark-assemble\s*\{([\s\S]*?)\n\}/);
check("assemble keyframes exist", Boolean(kf));
if (kf) {
  const body = kf[1];
  check(
    "animates transform and opacity only",
    !/\b(width|height|margin|padding|top|left|right|bottom)\s*:/.test(body),
    "layout properties trigger layout and paint on every frame",
  );
  check(
    "does not start from scale(0) or opacity 0",
    !/scale\(0\)/.test(body) && !/opacity:\s*0\s*;/.test(body),
    "nothing in the real world appears from nothing",
  );
}

const pieceRule = CSS_C.match(/\.brand-mark__piece\s*\{([\s\S]*?)\n\}/);
check("piece rule exists", Boolean(pieceRule));
if (pieceRule) {
  const body = pieceRule[1];
  const dur = body.match(/animation:[^;]*?(\d+)ms/);
  check("per-piece duration is 150-500ms", Boolean(dur) && Number(dur[1]) >= 150 && Number(dur[1]) <= 500,
    dur ? `${dur[1]}ms` : "no duration found");
  check(
    "uses the shared ease-out token",
    /var\(--ease-out\)/.test(body),
    "an inline cubic-bezier here forks the motion system",
  );
  check(
    "no ease-in on an entrance",
    !/\bease-in\b/.test(body),
    "ease-in delays the exact moment the user is watching",
  );
}

check(
  "ease-out token is a real curve, not the browser default",
  /--ease-out:\s*cubic-bezier\(/.test(CSS_C),
  "the built-in ease-out is too weak to read as deliberate",
);

/* ── 5. The pieces read as a sequence, and actually move ─────────────────── */

const froms = [...MARK_C.matchAll(/from:\s*"([^"]+)"/g)].map((m) => m[1]);
check("every piece declares a start offset", froms.length === 4, `found ${froms.length}`);
check("start offsets differ (four arrivals, not one lump)", new Set(froms).size === 4, froms.join(" "));
check(
  "offsets are non-zero translations",
  froms.length > 0 && froms.every((f) => /translate[XY]?\(-?\d/.test(f) && !/\(0%?\)/.test(f)),
  froms.join(" "),
);
check(
  "stagger is within the 30-80ms band",
  (() => {
    const m = MARK_C.match(/STAGGER_MS\s*=\s*(\d+)/);
    return Boolean(m) && Number(m[1]) >= 30 && Number(m[1]) <= 80;
  })(),
  MARK_C.match(/STAGGER_MS\s*=\s*(\d+)/)?.[1] ?? "not found",
);

/* ── 6. Accessibility ────────────────────────────────────────────────────── */

check(
  "decorative by default (hidden from assistive tech)",
  /aria-hidden=\{labelled\s*\?\s*undefined\s*:\s*true\}/.test(MARK_C),
  'a mark beside a visible "HSE HUB" must not be announced twice',
);
check(
  "can be given an accessible name when it stands alone",
  /aria-label=\{labelled\s*\?\s*title\s*:\s*undefined\}/.test(MARK_C),
  "a logo used without a wordmark needs a name",
);
check(
  "not a focus stop",
  /focusable="false"/.test(MARK_C),
  "SVG is focusable in some engines, which adds a dead tab stop",
);
check(
  "preserves aspect ratio",
  /preserveAspectRatio="xMidYMid meet"/.test(MARK_C),
  "the mark is wider than tall; without this it stretches in a square box",
);

console.log(failed ? "\nFAILED" : "\nOK");
process.exitCode = failed ? 1 : 0;
