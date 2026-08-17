/**
 * Can someone without projects:write change a project's tasks?
 *
 * THE BUG THIS EXISTS TO PREVENT COMING BACK
 * ------------------------------------------
 * Five of the eight exported actions in src/app/(app)/projects/actions.ts --
 * updateTaskStatus, deleteTask, deleteComment, moveTaskToSection and
 * createSection -- performed NO identity check and NO permission check. They
 * called supabase.from(...).delete().eq("id", taskId) with an id taken straight
 * off the submitted form.
 *
 * That was not an anonymous-write hole: the RLS policies on project_tasks are
 * `to authenticated` and scope writes with can_view_project(). The defect is
 * subtler and survives a reading of the policy file: it gates WRITING on READ
 * visibility. projects:write exists (permissions.ts:31) and is held only by
 * exec -- and it was checked at no layer at all. So any employee who could SEE
 * a project could delete every task in it, including tasks they did not create.
 *
 * Two reasons no existing gate caught it:
 *   1. check-server-action-auth.mjs drives only the /time?view=track form over
 *      HTTP. It never touches these actions.
 *   2. The components that mount them are currently orphaned, so an HTTP probe
 *      cannot reach them at all -- there is no endpoint to POST to yet. The
 *      hole is latent, and goes live the moment TasksSection is re-mounted.
 *      A gate that can only test what is routable would go green on a bug that
 *      is one import away from shipping.
 *
 * So this drives the SHIPPED actions directly, compiled with Next's own SWC,
 * against a stub Supabase client that records every write attempt. The
 * assertion is not "the source contains a permission check" -- a grep would
 * pass on a check that is present but ineffective. It is "no row-mutating call
 * reaches the database when the caller lacks projects:write", which is the
 * property that actually matters.
 *
 * The positive cases matter just as much: a fix that denies everybody would
 * satisfy the negative assertions and break the feature. Every action is also
 * asserted to WRITE when the caller does hold the permission.
 *
 * Run: node scripts/check-project-write-auth.mjs
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Inside node_modules so the compiled module's own requires resolve — Node
// walks up from the file's location, and %TEMP% has no node_modules above it.
const dir = resolve(mkdtempSync(join("node_modules", ".project-auth-gate-")));
const require = createRequire(import.meta.url);

/**
 * A Supabase double that is chainable and thenable in the same shapes the
 * actions use, and records every row-mutating call. Reads are answered with
 * empty results: the actions only read to compute a sort_order/position.
 */
function makeClient({ user, hasPermission }) {
  const writes = [];
  const rpcCalls = [];

  const chain = (result) => ({
    eq: () => chain(result),
    order: () => chain(result),
    limit: () => chain(result),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (onOk, onErr) => Promise.resolve(result).then(onOk, onErr),
  });

  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === "app_user_has_permission") return { data: hasPermission, error: null };
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => chain({ data: null, error: null }),
      insert: (payload) => {
        writes.push({ op: "insert", table, payload });
        return chain({ data: null, error: null });
      },
      update: (payload) => {
        writes.push({ op: "update", table, payload });
        return chain({ data: null, error: null });
      },
      delete: () => {
        writes.push({ op: "delete", table });
        return chain({ data: null, error: null });
      },
    }),
  };

  return { client, writes, rpcCalls };
}

const form = (entries) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, String(v));
  return fd;
};

try {
  // ── Compile the real actions module, redirecting only its two imports ──────
  const serverStub = join(dir, "server-stub.cjs");
  writeFileSync(
    serverStub,
    `module.exports = { createClient: async () => globalThis.__GATE_CLIENT };`,
  );

  const cacheStub = join(dir, "cache-stub.cjs");
  writeFileSync(cacheStub, `module.exports = { revalidatePath: () => {} };`);

  const compileTs = async (srcPath, outName, rewrites = {}) => {
    let code = readFileSync(srcPath, "utf8");
    for (const [from, to] of Object.entries(rewrites)) {
      code = code.split(`"${from}"`).join(`"${to.replace(/\\/g, "/")}"`);
    }
    const out = await transform(code, {
      filename: srcPath,
      jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
      module: { type: "commonjs" },
    });
    const file = join(dir, outName);
    writeFileSync(file, out.code);
    return file;
  };

  // The REAL permissions module, not a stub: this gate asserts the actions ask
  // for "projects:write", and that string must come from the same constant the
  // rest of the app uses. Stubbing it would let the constant drift from the DB
  // key and still go green.
  const permissions = await compileTs("src/lib/permissions.ts", "permissions.cjs");

  const compiled = await compileTs("src/app/(app)/projects/actions.ts", "actions.cjs", {
    "@/utils/supabase/server": serverStub,
    "next/cache": cacheStub,
    "@/lib/permissions": permissions,
  });

  const actions = require(compiled);

  const USER = { id: "11111111-1111-1111-1111-111111111111" };

  // Every exported action that mutates a row, with a call that would succeed
  // if the caller were authorised. `invoke` hides the useActionState signature
  // difference: createTask/createSection take (prevState, formData).
  const MUTATORS = [
    {
      name: "createTask",
      invoke: (a) => a.createTask({ status: "idle" }, form({ project_id: "p1", name: "T" })),
    },
    {
      name: "addSubtask",
      invoke: (a) => a.addSubtask(form({ project_id: "p1", name: "S", parent_task_id: 4 })),
    },
    {
      name: "updateTaskStatus",
      invoke: (a) => a.updateTaskStatus(form({ task_id: 7, status: "DONE" })),
    },
    { name: "deleteTask", invoke: (a) => a.deleteTask(form({ task_id: 7 })) },
    { name: "addComment", invoke: (a) => a.addComment(form({ task_id: 7, body: "hi" })) },
    { name: "deleteComment", invoke: (a) => a.deleteComment(form({ comment_id: 9 })) },
    {
      name: "moveTaskToSection",
      invoke: (a) => a.moveTaskToSection(form({ task_id: 7, section_id: 2 })),
    },
    {
      name: "createSection",
      invoke: (a) => a.createSection({ status: "idle" }, form({ project_id: "p1", name: "Col" })),
    },
  ];

  console.log("\nEvery mutating action is exported (a renamed export must not silently drop coverage):\n");
  for (const { name } of MUTATORS) {
    check(`${name} is exported from actions.ts`, typeof actions[name] === "function");
  }

  console.log("\nA signed-OUT caller must not reach the database:\n");
  for (const { name, invoke } of MUTATORS) {
    const { client, writes } = makeClient({ user: null, hasPermission: false });
    globalThis.__GATE_CLIENT = client;
    await invoke(actions);
    check(
      `${name} writes nothing with no session`,
      writes.length === 0,
      writes.length ? `attempted ${writes.map((w) => `${w.op} ${w.table}`).join(", ")}` : "",
    );
  }

  console.log("\nA signed-in caller WITHOUT projects:write must not reach the database:\n");
  for (const { name, invoke } of MUTATORS) {
    const { client, writes } = makeClient({ user: USER, hasPermission: false });
    globalThis.__GATE_CLIENT = client;
    await invoke(actions);
    check(
      `${name} writes nothing without projects:write`,
      writes.length === 0,
      writes.length ? `attempted ${writes.map((w) => `${w.op} ${w.table}`).join(", ")}` : "",
    );
  }

  console.log("\nThe permission is asked of the DATABASE, not inferred from a role string:\n");
  {
    const { client, rpcCalls } = makeClient({ user: USER, hasPermission: false });
    globalThis.__GATE_CLIENT = client;
    await actions.deleteTask(form({ task_id: 7 }));
    const asked = rpcCalls.filter((c) => c.fn === "app_user_has_permission");
    check("deleteTask calls app_user_has_permission", asked.length > 0);
    check(
      "it asks for projects:write specifically",
      asked.some((c) => c.args?.p_key === "projects:write"),
      asked.map((c) => c.args?.p_key).join(", "),
    );
  }

  console.log("\nAn AUTHORISED caller still gets through (a fix that denies everyone is not a fix):\n");
  for (const { name, invoke } of MUTATORS) {
    const { client, writes } = makeClient({ user: USER, hasPermission: true });
    globalThis.__GATE_CLIENT = client;
    await invoke(actions);
    check(`${name} writes when the caller holds projects:write`, writes.length > 0);
  }

  console.log("\nNegative control — the harness can actually observe a write:\n");
  {
    const { client, writes } = makeClient({ user: USER, hasPermission: true });
    client.from("x").delete().eq("id", 1);
    check("a delete through the stub is recorded", writes.length === 1, `${writes.length} recorded`);
  }

  console.log(
    failed
      ? "\nPROJECT WRITE AUTH: a caller without projects:write can still change tasks\n"
      : "\nPROJECT WRITE AUTH: task writes require projects:write, and still work for those who hold it\n",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
