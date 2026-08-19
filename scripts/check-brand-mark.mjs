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

/* ── 2b. The loop is contained to the sign-in hero ───────────────────────── */

// A looping animation is the one thing here that can never be waited out, so
// where it is allowed matters more than any other assertion in this file.
check(
  "looping is opt-in, not the default",
  /loop\s*=\s*false/.test(MARK_C),
  "a default-on loop would put a perpetual animation on every mount",
);
check(
  "loop requires animate (cannot loop a static mark)",
  /const\s+looping\s*=\s*animate\s*&&\s*loop/.test(MARK_C),
  "`loop` alone must not produce a class that animates",
);

// The hero is the only loop in the product. Anywhere inside the app, a
// perpetual animation sits beside content people are reading all day.
for (const [label, src] of [["sidebar", SIDEBAR_C], ["portal", PORTAL_C]]) {
  check(`${label} mark does NOT loop`, !/<BrandMark[^>]*\bloop\b/.test(src), "loop escaped the auth shell");
}

const authMarks = [...AUTH_C.matchAll(/<BrandMark[^>]*\/>/g)].map((m) => m[0]);
check("auth shell renders more than one mark", authMarks.length >= 2, `found ${authMarks.length}`);
check(
  "exactly one mark loops",
  authMarks.filter((m) => /\bloop\b/.test(m)).length === 1,
  authMarks.map((m) => (/\bloop\b/.test(m) ? "LOOP" : "once")).join(" "),
);

// The hero has to actually be a hero. A looping 32px chip is the worst of both:
// perpetual motion with none of the presence that justifies it.
const heroMark = authMarks.find((m) => /\bloop\b/.test(m));
const heroSize = heroMark?.match(/size=\{(\d+)\}/);
check(
  "the looping mark is hero-sized (>= 140px)",
  Boolean(heroSize) && Number(heroSize[1]) >= 140,
  heroSize ? `${heroSize[1]}px` : "no size found",
);

// The hero mark and its line of copy must be ONE block, stacked and centred.
// They previously sat in separate flex children — mark centred in the panel,
// copy pinned to the bottom edge ~300px below — so neither read as related to
// the other: the mark floated in empty space and the sentence looked like a
// footnote. Asserted structurally because it is a composition claim, not a
// pixel one: the same flex column must contain both.
//
// Anchored on the LOOPING MARK rather than on a class string: keying the search
// off `flex flex-1 flex-col` matched the form panel once the shell was
// restructured, and cheerfully reported the hero as "centred on both axes"
// while measuring a completely different element.
const heroIdx = AUTH_C.search(/<BrandMark[^>]*\bloop\b/);
check("the hero mark is present", heroIdx !== -1, "no looping mark found in the auth shell");
if (heroIdx !== -1) {
  // The container is the nearest opening <div ...> above the hero mark that is
  // NOT a decorative/absolute layer. Skipping that filter made this resolve to
  // the rings overlay — an absolutely-positioned sibling — and report the hero
  // as "not a stacked column" while the real container was correct.
  const before = AUTH_C.slice(0, heroIdx);
  let openIdx = -1;
  for (let i = before.length; i >= 0; ) {
    const idx = before.lastIndexOf("<div ", i);
    if (idx === -1) break;
    const tag = AUTH_C.slice(idx, AUTH_C.indexOf(">", idx) + 1);
    if (!/aria-hidden|\babsolute\b/.test(tag)) { openIdx = idx; break; }
    i = idx - 1;
  }
  const openTag = openIdx === -1 ? "" : AUTH_C.slice(openIdx, AUTH_C.indexOf(">", openIdx) + 1);
  // Everything from the container to the end of the identity panel: enough to
  // see whether the copy travels with the mark.
  const heroRegion = AUTH_C.slice(openIdx, heroIdx + 900);

  check(
    "the hero is a stacked column",
    /flex-col/.test(openTag),
    openTag.slice(0, 90),
  );
  check(
    "the hero block is centred on both axes",
    /items-center/.test(openTag) && /justify-center/.test(openTag),
    openTag.slice(0, 90),
  );
  check(
    "the hero copy sits INSIDE the same block as the mark",
    /<h2/.test(heroRegion) && /<p /.test(heroRegion),
    "mark and copy in separate containers read as unrelated",
  );
  // The reference pairs its centred hero with a headline, not a lone sentence:
  // a 220px mark over one line of small grey text has no anchor between them.
  check(
    "the hero has a headline, not only body copy",
    /<h2[^>]*text-\[\d\dpx\]/.test(heroRegion),
    "hero copy has no display-sized heading",
  );
}

// The loop must resolve and then hold. A tight repeat never lets the page
// settle, which is a different (and much worse) thing than what was asked for.
const loopKf = CSS_C.match(/@keyframes\s+brand-mark-assemble-loop\s*\{([\s\S]*?)\n\}/);
check("loop keyframes exist", Boolean(loopKf));
const loopRule = CSS_C.match(/\.brand-mark__piece--loop\s*\{([\s\S]*?)\n\}/);
check("loop rule exists", Boolean(loopRule));
if (loopRule && loopKf) {
  const dur = loopRule[1].match(/animation:[^;]*?(\d+)ms/);
  check(
    "loop period is at least 3s",
    Boolean(dur) && Number(dur[1]) >= 3000,
    dur ? `${dur[1]}ms` : "no duration found",
  );
  check("loop actually repeats", /\binfinite\b/.test(loopRule[1]), "an `infinite` count is what makes it a loop");

  // The ASSEMBLE must resolve early in the cycle, leaving the rest as hold.
  // Measured off the reference: ~0.64s of motion in a 10.7s loop, i.e. 94% hold.
  //
  // "Resolves" means the first stop that reaches rest — NOT the last stop in the
  // block. Later stops legitimately exist for the idle breath, so taking
  // max(stops) would fail on correct code. And excluding 0/100 matters because a
  // naive /(\d+)%\s*\{/ matches 0% first and reports "settles at 0%", which
  // passes a <= 20 test while proving nothing at all.
  const stopBlocks = [...loopKf[1].matchAll(/(\d+(?:\.\d+)?)%\s*\{([^}]*)\}/g)]
    .map((m) => ({ at: Number(m[1]), body: m[2] }))
    .filter((s) => s.at > 0 && s.at < 100);
  const settle = stopBlocks.find((s) => /transform:\s*translate\(0,\s*0\)/.test(s.body));
  check(
    "the assemble resolves in the first fifth of the cycle (the rest is hold)",
    Boolean(settle) && settle.at <= 20,
    settle ? `settles at ${settle.at}%` : "no keyframe reaches rest — the mark never settles",
  );
  check(
    "the loop ends where it settled (no reverse or drift)",
    /100%\s*\{\s*transform:\s*translate\(0,\s*0\)/.test(loopKf[1]),
    "a loop that animates back out reads as a glitch, not a brand moment",
  );
}

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
// The looping class is a SEPARATE selector, so the one-shot rule above does not
// cover it. An unstoppable perpetual animation is the single worst outcome for
// someone who asked their OS to reduce motion.
check(
  "reduced motion also stops the LOOP",
  reducedBlocks.some((b) => /brand-mark__piece--loop/.test(b) && /animation:\s*none/.test(b)),
  "the loop needs its own carve-out; the one-shot selector does not match it",
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
  // Upper bound raised from 500ms to 900ms deliberately. At hero size (220px)
  // each piece travels ~10x the distance the 32px chip did, and the same
  // duration over a longer distance reads as a snap rather than a movement.
  // 900ms remains a hard ceiling: past ~1s an entrance stops feeling like
  // motion and starts feeling like a wait, even on a brand surface.
  check("per-piece duration is 150-900ms", Boolean(dur) && Number(dur[1]) >= 150 && Number(dur[1]) <= 900,
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
// The stagger has to be a real fraction of the per-piece duration: too small
// and the four arrivals blur into one lump, too large and the mark assembles in
// visibly separate acts. 10-30% of the duration is the readable band.
const perPiece = Number(
  CSS_C.match(/animation:\s*brand-mark-assemble\s+(\d+)ms/)?.[1] ?? 0,
);
const stagger = Number(MARK_C.match(/STAGGER_MS\s*=\s*(\d+)/)?.[1] ?? 0);
check(
  "stagger is a readable fraction of the piece duration (10-30%)",
  perPiece > 0 && stagger > 0 && stagger / perPiece >= 0.1 && stagger / perPiece <= 0.3,
  `${stagger}ms of ${perPiece}ms = ${perPiece ? Math.round((stagger / perPiece) * 100) : "?"}%`,
);

/* ── 5b. The motion is multi-phase, not a single slide ────────────────────── */

// A bare from/to never decelerates INTO anything, so it reads as a div moving
// rather than an object arriving. Every piece must overshoot past rest and ease
// back — and in its OWN axis, or the mark visibly comes apart mid-flight.
const overs = [...MARK_C.matchAll(/over:\s*"([^"]+)"/g)].map((m) => m[1]);
check("every piece declares an overshoot", overs.length === 4, `found ${overs.length}`);
check(
  "each overshoot is in the same axis as its start offset",
  froms.length === 4 &&
    overs.length === 4 &&
    froms.every((f, i) => {
      const axis = (s) => (/translateY/.test(s) ? "Y" : /translateX/.test(s) ? "X" : "?");
      return axis(f) === axis(overs[i]);
    }),
  froms.map((f, i) => `${f}->${overs[i] ?? "?"}`).join(" "),
);
// Sign must FLIP: entering from -46% and overshooting to -2% is not an
// overshoot, it is stopping short.
check(
  "each overshoot passes rest (sign flips)",
  froms.length === 4 &&
    overs.length === 4 &&
    froms.every((f, i) => {
      const num = (s) => Number(s.match(/\(\s*(-?[\d.]+)/)?.[1] ?? 0);
      return num(f) * num(overs[i]) < 0;
    }),
  froms.map((f, i) => `${f}->${overs[i] ?? "?"}`).join(" "),
);
// A logo should feel weighted, not springy. Anything past ~8% of the travel
// starts reading as a cartoon bounce.
check(
  "overshoot stays small (<= 8% — weighted, not bouncy)",
  overs.length === 4 && overs.every((o) => Math.abs(Number(o.match(/\(\s*(-?[\d.]+)/)?.[1] ?? 99)) <= 8),
  overs.join(" "),
);
// The second half of a two-stage move needs its own curve; reusing the entry
// ease-out makes the correction land abruptly.
check(
  "the settle back from overshoot uses its own curve",
  /--ease-settle:/.test(CSS_C) && /animation-timing-function:\s*var\(--ease-settle\)/.test(CSS_C),
  "reusing --ease-out for the return makes the settle land abruptly",
);
// Declaring `over:` in the component is not enough — BOTH keyframe blocks have
// to actually consume it. Without this, deleting the one-shot's overshoot stop
// left every other check passing (the loop still referenced --piece-over and the
// component still declared the values) while the one-shot silently reverted to a
// plain slide. A real gate hole, found by injection.
for (const [label, kf] of [
  ["one-shot", CSS_C.match(/@keyframes\s+brand-mark-assemble\s*\{([\s\S]*?)\n\}/)],
  ["loop", CSS_C.match(/@keyframes\s+brand-mark-assemble-loop\s*\{([\s\S]*?)\n\}/)],
]) {
  check(
    `${label} keyframes actually use the overshoot`,
    Boolean(kf) && /var\(--piece-over\)/.test(kf[1]),
    "a declared overshoot no keyframe reads is a plain slide",
  );
}
// The breath is what keeps the mark alive through the hold instead of frozen.
// It must be ONE shared value: staggering it pulls the mark apart at exactly
// the moment it should read as one finished object.
check(
  "the loop breathes during the hold",
  /--piece-breathe/.test(CSS_C) && /BREATHE\s*=/.test(MARK_C),
  "without this the mark is frozen for most of the cycle",
);
check(
  "the breath is shared by all four pieces, not staggered",
  (MARK_C.match(/BREATHE\s*=\s*"[^"]+"/g) || []).length === 1 &&
    !/breathe:\s*"/.test(MARK_C),
  "a per-piece breath separates the pieces during the hold",
);
// The mark must be STILL between arriving and breathing. Without a second stop
// at rest the breath interpolates straight out of the settle keyframe, so the
// assemble never resolves into anything that reads as finished — measured live,
// the piece was already 3.1px off rest at t=1500ms of a 7.2s cycle.
{
  const kf = CSS_C.match(/@keyframes\s+brand-mark-assemble-loop\s*\{([\s\S]*?)\n\}/);
  const restStops = kf
    ? [...kf[1].matchAll(/(\d+(?:\.\d+)?)%\s*\{([^}]*)\}/g)]
        .filter((m) => /transform:\s*translate\(0,\s*0\)/.test(m[2]))
        .map((m) => Number(m[1]))
        .filter((n) => n > 0 && n < 100)
    : [];
  check(
    "the mark actually HOLDS still after settling, before it breathes",
    restStops.length >= 2 && Math.max(...restStops) - Math.min(...restStops) >= 10,
    restStops.length
      ? `rest stops at ${restStops.join("%, ")}%`
      : "no rest stops — the breath starts the instant the mark lands",
  );
}

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

/* ── 7. The sign-in page on a phone ──────────────────────────────────────── */
//
// Every rule here was MEASURED on the live portal at real phone viewports
// (390x844, 360x640, 320x568, and 390x420 for an open keyboard), not inferred.
// This is the one screen nobody can skip and the one nobody can work around: a
// user who cannot get through it has no route into the product at all.

const LOGIN_PATH = "src/app/auth/login/page.tsx";
const OAUTH_PATH = "src/components/OAuthButtons.tsx";
const LOGIN_C = existsSync(join(root, LOGIN_PATH)) ? strip(read(LOGIN_PATH)) : "";
const OAUTH_C = existsSync(join(root, OAUTH_PATH)) ? strip(read(OAUTH_PATH)) : "";

// iOS Safari force-zooms the entire page when a focused input's font-size is
// below 16px. Measured at 14px, which is why tapping the email field made the
// page lurch and scale. No viewport meta tag disables this on modern iOS; 16px
// is the only fix. `text-sm` (14px) is fine from sm upward, where there is no
// such behaviour.
const inputCls = AUTH_C.match(/authInputClass\s*=\s*\n?\s*"([^"]*)"/)?.[1] ?? "";
check(
  "auth inputs are >= 16px on phones (or iOS force-zooms the page)",
  /\btext-base\b/.test(inputCls) && !/^(?!.*sm:).*\btext-sm\b/.test(inputCls),
  inputCls ? `class: ...${inputCls.slice(-72)}` : "authInputClass not found",
);
check(
  "auth inputs drop back to 14px at sm+ (16px is a mobile fix, not a design change)",
  /\bsm:text-sm\b/.test(inputCls),
  "16px everywhere would coarsen the desktop form for no reason",
);

// 44px minimum target: Apple's HIG and WCAG 2.5.8 agree. Measured heights were
// inputs 37.3px, submit 36px, Google 37.3px, and "Forgot password?" just 18px.
for (const [label, cls] of [
  ["input", inputCls],
  ["submit button", AUTH_C.match(/authButtonClass\s*=\s*\n?\s*"([^"]*)"/)?.[1] ?? ""],
  ["OAuth button", OAUTH_C.match(/const base\s*=\s*\n?\s*"([^"]*)"/)?.[1] ?? ""],
]) {
  check(
    `${label} meets the 44px touch target on phones`,
    /\bmin-h-11\b/.test(cls),
    cls ? "no min-h-11" : `${label} class not found`,
  );
}
check(
  'the "forgot password" link is a real tap target, not 18px of text',
  /min-h-11/.test(LOGIN_C.match(/href="\/auth\/forgot-password"[\s\S]{0,220}/)?.[0] ?? ""),
  "the control a locked-out user needs most was the smallest on the page",
);

// 100vh on mobile resolves to the viewport with the URL bar HIDDEN — the largest
// it ever gets — so a 100vh page is permanently taller than the visible area and
// shifts whenever the address bar collapses or returns. dvh tracks the real one.
check(
  "the auth shell sizes to the DYNAMIC viewport (dvh), not 100vh",
  /min-h-dvh/.test(AUTH_C) && !/min-h-screen/.test(AUTH_C),
  /min-h-screen/.test(AUTH_C) ? "still uses min-h-screen" : "no min-h-dvh found",
);

// min-h, never a fixed h: with a keyboard open the viewport can halve, and a
// fixed height plus justify-center clips the top of the form beyond reach.
// `\bh-dvh\b` matches inside `min-h-dvh`, because `-` is a word boundary — so a
// naive version of this check failed on the very fix it is meant to protect.
// Require a non-`min-` prefix.
check(
  "the shell can GROW past the viewport (so an open keyboard scrolls, not clips)",
  !/(^|[\s"])h-(dvh|screen)\b/.test(AUTH_C),
  "a fixed height plus centring puts the top of the form out of reach",
);

// The inset card is a desktop treatment. On a 390px screen a frame around the
// form spends ~48px of the scarcest resource on the page.
check(
  "the inset card is desktop-only (full-bleed on phones)",
  /lg:rounded-\[var\(--radius-panel\)\]/.test(AUTH_C) && /lg:p-6/.test(AUTH_C),
  "an inset card on a phone wastes ~48px of width on decoration",
);

console.log(failed ? "\nFAILED" : "\nOK");
process.exitCode = failed ? 1 : 0;
