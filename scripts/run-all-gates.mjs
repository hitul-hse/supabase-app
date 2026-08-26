// `npm run test:db` is a single && chain of ~75 gates. The first non-zero exit
// stops it, so a stale failure early in the chain hides every gate after it.
// Today it stopped at permissions-rls, gate 20 of 75, meaning 55 gates have not
// been run at all - and nobody would know, because the output ends in PASS lines.
//
// Run every gate independently and report the true state.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

// A UTF-8 BOM on package.json is invisible to npm but fatal to JSON.parse, which
// silently killed this whole runner (and with it every gate) until 26 Aug 2026.
// Strip it on read so a text editor saving with a BOM cannot disable the suite.
const pkg = JSON.parse(readFileSync("C:/Supabase/package.json", "utf8").replace(/^\uFEFF/, ""));
const chain = pkg.scripts["test:db"];

// The chain is "npm run a && npm run b && ..."
const names = [...chain.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
console.log(`test:db chains ${names.length} gates; running each independently\n`);

const run = (name) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = spawn("npm", ["run", name], { cwd: "C:/Supabase", shell: true });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => {
    const fails = [...out.matchAll(/^FAIL:.*$/gm)].map((m) => m[0]);
    const skip = /^SKIP/m.test(out);
    resolve({ name, code, ms: Date.now() - t0, fails, skip });
  });
  // Playwright gates drive production over the network across ~18 routes twice
  // (desktop + mobile). check:table-scroll-budget legitimately takes ~4m25s, so a
  // 180s cap reported it as red-by-timeout and hid its 3 real assertion failures.
  setTimeout(() => { try { p.kill(); } catch {} resolve({ name, code: -1, ms: Date.now() - t0, fails: ["(timeout)"], skip: false }); }, 600000);
});

const results = [];
for (const n of names) {
  const r = await run(n);
  results.push(r);
  const mark = r.code === 0 ? (r.skip ? "SKIP" : "pass") : "FAIL";
  console.log(`${mark}  ${String(r.ms).padStart(6)}ms  ${n}${r.fails.length ? `  (${r.fails.length} assertion failures)` : ""}`);
}

const broken = results.filter((r) => r.code !== 0);
console.log(`\n${results.length} gates: ${results.length - broken.length} green, ${broken.length} red\n`);
for (const b of broken) {
  console.log(`### ${b.name} (exit ${b.code})`);
  for (const f of b.fails.slice(0, 6)) console.log(`     ${f}`);
}

const idx = names.indexOf(broken[0]?.name);
if (idx >= 0) {
  console.log(`\nFirst red gate is #${idx + 1} of ${names.length}.`);
  console.log(`In the real chain that hides the ${names.length - idx - 1} gates after it.`);
}
