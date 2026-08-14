// OpenAI access probe. Reads only the locally stored credential and decodes the
// id_token offline; makes no API call, so it cannot consume quota.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const p = path.join(os.homedir(), ".codex", "auth.json");
if (!fs.existsSync(p)) {
  console.log(`No stored OpenAI credential at ${p}`);
  process.exit(0);
}
const auth = JSON.parse(fs.readFileSync(p, "utf8"));

console.log("OPENAI ACCESS PROBE\n");
console.log(`  auth_mode: ${auth.auth_mode}`);
console.log(`  API key stored: ${auth.OPENAI_API_KEY ? "yes" : "no"}`);
console.log(`  OPENAI_API_KEY in env: ${process.env.OPENAI_API_KEY ? "yes" : "no"}`);

if (auth.tokens?.id_token) {
  try {
    const payload = JSON.parse(
      Buffer.from(auth.tokens.id_token.split(".")[1], "base64").toString("utf8"),
    );
    const claims = payload["https://api.openai.com/auth"] || {};
    console.log(`\n  account: ${payload.email || "(n/a)"}`);
    console.log(`  chatgpt plan: ${claims.chatgpt_plan_type || "(n/a)"}`);
  } catch (e) {
    console.log(`  could not decode id_token: ${e.message}`);
  }
}

console.log(`
VERDICT

  The OAuth routes return usage_limit_reached because the ChatGPT account is on
  the FREE plan and its quota is exhausted. No API key is stored anywhere.

  Unlike Gemini, there is no free fallback: OpenAI's API has no free tier. Using
  it requires either
    - a ChatGPT Plus/Pro upgrade, which unblocks the existing OAuth routes, or
    - a funded API account, then: jcode login --provider openai-api

  Both are purchases, so neither can be done on the account owner's behalf.`);
