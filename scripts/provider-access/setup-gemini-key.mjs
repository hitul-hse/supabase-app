// One-command Gemini setup. Takes an AI Studio API key, validates it against
// the real API, wires it into Jcode, and smoke-tests the result.
//
// Usage:
//   node scripts/provider-access/setup-gemini-key.mjs <API_KEY>
//   node scripts/provider-access/setup-gemini-key.mjs        (reads GEMINI_API_KEY)
//
// Nothing is written to Jcode until the key is proven to work, so a typo or a
// restricted key fails loudly here rather than silently half-configuring.
import { execFileSync } from "node:child_process";

const key = process.argv[2] || process.env.GEMINI_API_KEY;

if (!key) {
  console.log(`No API key supplied.

Get one (free, no billing) at:  https://aistudio.google.com/apikey

Then run:
  node scripts/provider-access/setup-gemini-key.mjs <API_KEY>

The underlying API (generativelanguage.googleapis.com) is already enabled on
the "Default Gemini Project", so the key should work immediately.`);
  process.exit(0);
}

if (!/^AIza[\w-]{20,}$/.test(key)) {
  console.log(
    `That does not look like a Google API key (expected to start with "AIza").\nGot: ${key.slice(0, 8)}...`,
  );
  process.exit(1);
}

console.log("1. validating the key against the real API...");

const list = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
);
const lj = await list.json();

if (!list.ok) {
  console.log(`   FAILED: HTTP ${list.status}`);
  console.log(`   ${(lj?.error?.message || JSON.stringify(lj)).slice(0, 300)}`);
  console.log("\nNothing was configured. Fix the key and re-run.");
  process.exit(1);
}

const models = (lj.models || [])
  .map((m) => m.name.replace("models/", ""))
  .filter((n) => n.startsWith("gemini"));
console.log(`   OK: ${models.length} gemini model(s) reachable`);

// Pick a sensible default: prefer a stable 2.5 pro, else the first available.
const preferred =
  models.find((m) => m === "gemini-2.5-pro") ||
  models.find((m) => /^gemini-2\.5-flash$/.test(m)) ||
  models[0];
console.log(`   default model: ${preferred}`);

console.log("\n2. generating a real completion...");
const gen = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${preferred}:generateContent?key=${encodeURIComponent(key)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: GEMINI_WORKS" }] }],
    }),
  },
);
const gj = await gen.json();
const text = gj?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
console.log(`   HTTP ${gen.status}: ${text || (gj?.error?.message || "").slice(0, 200)}`);

if (!gen.ok || !text) {
  console.log("\nThe key lists models but cannot generate. Nothing was configured.");
  process.exit(1);
}

console.log("\n3. configuring Jcode (jcode login --provider gemini-api)...");
try {
  const out = execFileSync(
    "jcode",
    ["login", "--provider", "gemini-api", "--api-key", key, "--quiet"],
    { encoding: "utf8", stdio: "pipe" },
  );
  console.log(`   ${out.trim() || "configured"}`);
} catch (err) {
  console.log(`   jcode login failed: ${(err.stdout || err.stderr || err.message).slice(0, 300)}`);
  console.log("\nThe key is valid; only the Jcode wiring failed. Try manually:");
  console.log("   jcode login --provider gemini-api");
  process.exit(1);
}

console.log("\n4. smoke-testing through Jcode...");
try {
  const out = execFileSync("jcode", ["run", "--model", preferred, "Reply with exactly: JCODE_GEMINI_OK"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  console.log(`   ${out.trim().slice(0, 200)}`);
} catch (err) {
  console.log(`   ${(err.stdout || err.stderr || err.message).slice(0, 300)}`);
}

console.log(`\nDone. Switch with:  /model ${preferred}`);
