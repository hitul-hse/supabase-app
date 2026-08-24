/**
 * Build, start a private server, run a measurement command against it, retry.
 *
 * WHY THIS EXISTS. Several agents share this working tree, and `next build`
 * clears `.next` before it writes. So a production server started at T is killed
 * by somebody else's build at T+30s, and a measurement run straddling that point
 * dies with ERR_CONNECTION_REFUSED after five minutes of browser work. This
 * makes the window as small as possible and retries the whole sequence when it
 * loses the race, rather than reporting a connection error as a finding.
 *
 * Usage: node scripts/measure-with-server.mjs <port> <command...>
 */
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const [port, ...cmd] = process.argv.slice(2);
const SITE = `http://localhost:${port}`;

const up = async () => {
  try {
    const r = await fetch(`${SITE}/auth/login`, { signal: AbortSignal.timeout(4000) });
    return r.status > 0;
  } catch {
    return false;
  }
};

for (let attempt = 1; attempt <= 6; attempt += 1) {
  console.error(`\n[run ${attempt}] building`);
  const b = spawnSync("npm", ["run", "build"], { shell: true, encoding: "utf8" });
  const out = `${b.stdout ?? ""}${b.stderr ?? ""}`;
  if (/Another next build/.test(out)) {
    console.error("[build] lock held by another agent, waiting");
    await sleep(25_000);
    continue;
  }
  if (b.status !== 0) {
    console.error(out.slice(-3000));
    process.exit(1);
  }

  console.error("[run] starting server");
  const srv = spawn("npm", ["run", "start"], {
    shell: true,
    env: { ...process.env, PORT: port },
    stdio: "ignore",
    detached: false,
  });

  let ready = false;
  for (let i = 0; i < 40 && !ready; i += 1) {
    await sleep(1000);
    ready = await up();
  }
  if (!ready) {
    console.error("[run] server never came up, retrying");
    srv.kill();
    continue;
  }
  console.error(`[run] server ready on ${SITE}, measuring`);

  const m = spawnSync(cmd[0], cmd.slice(1), {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, SITE },
  });

  const stillUp = await up();
  srv.kill();

  if (m.status === 0 || stillUp) {
    // Either it succeeded, or it failed for a reason that is NOT the server
    // disappearing underneath it -- which is a real finding, so surface it.
    process.exit(m.status ?? 1);
  }
  console.error("[run] server died mid-measurement (another agent rebuilt), retrying");
}

console.error("never got a clean run against a stable server");
process.exit(1);
