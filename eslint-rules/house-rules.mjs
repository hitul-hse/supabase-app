/*
 * The house rules, as ESLint rules, so a violation is a finding on the changed
 * line at review time rather than an incident found weeks later.
 *
 * WHY THESE SIX AND NOT OTHERS
 * ----------------------------
 * Every rule here is named after an incident this repo actually paid for, and
 * every one of them has a SYNTACTIC signature -- a shape a parser can see
 * without guessing intent. The house has many more rules than this (honest
 * counts, worst-first ordering, migrations run twice in PGlite). Those are
 * judgments about behaviour and belong to the `check-*.mjs` gates, which run
 * against the live database. A lint rule that needs to guess is a lint rule
 * that cries wolf, and a rule nobody trusts is worse than no rule: it teaches
 * the reader to skim past findings.
 *
 * SEVERITY IS `warn`, DELIBERATELY, FOR NOW
 * -----------------------------------------
 * These are wired at `warn` in eslint.config.mjs. `npm run lint` and the CI
 * Lint step (`npx eslint src scripts`) fail on errors only, so nothing here can
 * turn the build red before its false-positive rate is known. Promotion to
 * `error` is a separate, deliberate change -- see docs in the PR.
 *
 * EVERY RULE HAS A FIXTURE
 * ------------------------
 * scripts/fixtures/house-rules/ holds a file per rule with a KNOWN number of
 * violations and, in the same file, the nearby lawful constructions that must
 * NOT fire. scripts/check-house-rules.mjs asserts the exact count both ways. A
 * rule that only ever fires on the thing it was written for is a rule whose
 * boundary nobody has measured; the fixture is where the boundary lives.
 *
 * MESSAGES
 * --------
 * Each message names the rule, the incident in one clause, and the fix. A
 * finding that says only "avoid this" makes the reader go and look it up, and
 * on a busy diff that means the finding is dismissed.
 *
 * ── THE ONE THAT WAS ASKED FOR AND DELIBERATELY NOT WRITTEN ───────────────
 *
 * "A regular expression used to rebuild a list of names or script identifiers."
 *
 * The incident is real and recent. scripts/lib/script-files.mjs carries it in
 * its own header: two audits rebuilt the list of gate files by running
 *
 *     [...part.matchAll(/(scripts\/[\w./-]+\.(?:mjs|cjs))/g)]
 *
 * over each package.json script line and taking the FIRST match. That was
 * right until `--import ./scripts/ts-resolve.mjs` was added to twelve scripts,
 * at which point the first match became the loader rather than the gate. The
 * twelve dropped out of both audits, which then reported PASS while CI failed
 * on one of them. The same class of bug is in check-lint-scope.cjs's header --
 * a block-comment regex that ate the very config entries it was checking.
 *
 * It has NO syntactic signature. The dangerous construction and the harmless
 * one are the same construction:
 *
 *     [...body.matchAll(/scripts\/\S+\.mjs/g)]      // rebuilds the gate list
 *     [...text.matchAll(/^## (.+)$/gm)]             // collects headings
 *
 * Nothing in the AST distinguishes them. The difference is whether the derived
 * list is then treated as the SOURCE OF TRUTH for a set that already has an
 * authoritative representation elsewhere (the parsed package.json, an AST, a
 * directory listing) -- a semantic question about how the value is used three
 * calls later, not a shape.
 *
 * Measured before deciding: 100 `.matchAll(` sites and 242 `.match(/` sites
 * under src/ and scripts/. A rule on that shape would fire in the hundreds and
 * be switched off within a day, taking the six rules below with it, because a
 * ruleset that cries wolf is read as one thing. So it is not written.
 *
 * What DOES address it, and is the right medium for it: script-files.mjs is
 * now the single shared resolver, and check-gates-runnable-on-ci.mjs and
 * check-gates-ci-executable.mjs both consume it, so the two audits cannot
 * disagree about which gates exist. The rule that would have caught this is
 * "parse the structured thing, do not regex it", and it is enforced by there
 * being one parser rather than by a linter.
 */

/* ------------------------------------------------------------------ shared */

/** Strip the wrappers that sit between an expression and the thing it means. */
function unwrap(node) {
  let n = node;
  for (;;) {
    if (!n) return n;
    if (n.type === "TSNonNullExpression" || n.type === "ChainExpression"
      || n.type === "TSAsExpression" || n.type === "TSTypeAssertion") { n = n.expression; continue; }
    return n;
  }
}

/** The property or identifier name an expression ultimately reads, or null. */
function readName(node) {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === "Identifier") return n.name;
  if (n.type === "MemberExpression") {
    if (!n.computed && n.property.type === "Identifier") return n.property.name;
    if (n.computed && n.property.type === "Literal" && typeof n.property.value === "string") return n.property.value;
    return null;
  }
  return null;
}

/** The left-most base identifier of a member chain: `a.b.c` -> "a". */
function baseIdentifier(node) {
  let n = unwrap(node);
  while (n && (n.type === "MemberExpression" || n.type === "CallExpression")) {
    n = unwrap(n.type === "MemberExpression" ? n.object : n.callee);
  }
  return n && n.type === "Identifier" ? n.name : null;
}

/** Split camelCase / snake_case into lowercase words. */
function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/* ============================================================ RULE 1 of 6 */

/*
 * paged-read-needs-order
 *
 * INCIDENT: a paged Supabase read without an `.order()` lets PostgREST return
 * rows in whatever order the planner picked for that request. Page 2 then
 * overlaps page 1 and rows in between are never returned at all -- silently, in
 * a total that still looks plausible. src/lib/queries/order-detail.ts and
 * my-work.ts both carry a comment about it because both were bitten.
 *
 * SHAPE: a `.range(a, b)` call whose builder chain contains no `.order(`.
 *
 * WHY THE WHOLE CHAIN, NOT "BEFORE": in supabase-js the builder is
 * order-independent -- `.range().order()` produces the same request as
 * `.order().range()`, because one sets a Range header and the other a query
 * parameter. The defect is an ABSENT order, not a late one, so the rule scans
 * the whole chain. Writing it as "before" would have flagged a correct query
 * and missed nothing extra: there are zero `.range(...).order(...)` sites in
 * this repo today.
 */
const pagedReadNeedsOrder = {
  meta: {
    type: "problem",
    docs: { description: "A Supabase paged read must be ordered, or its pages overlap." },
    schema: [],
    messages: {
      unordered:
        "paged read without an order: pages overlap and rows are silently dropped "
        + "-- add .order(<a unique, stable column>) to this chain before .range().",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "range") return;
        // `.range(from, to)` is the paged-read arity. `.range(x)` is something
        // else (a DOM Range, a date range helper) and is not our business.
        if (node.arguments.length !== 2) return;

        // Walk the builder chain in both directions from this call.
        let seenOrder = false;
        // Downstream: `.select().order().range()` -- the object side.
        let cur = unwrap(callee.object);
        while (cur && cur.type === "CallExpression") {
          const c = unwrap(cur.callee);
          if (c?.type !== "MemberExpression") break;
          if (!c.computed && c.property.type === "Identifier" && c.property.name === "order") seenOrder = true;
          cur = unwrap(c.object);
        }
        // Upstream: `.range().order()` -- walk out through enclosing calls.
        let up = node;
        while (up.parent && up.parent.type === "MemberExpression" && up.parent.object === up
          && up.parent.parent?.type === "CallExpression") {
          const prop = up.parent.property;
          if (prop.type === "Identifier" && prop.name === "order") seenOrder = true;
          up = up.parent.parent;
        }

        // The receiver is a bare identifier (`q.range(...)`), so the chain was
        // built elsewhere and this rule cannot see the `.order()`. Reporting it
        // would be a guess. Left to check-* gates and to review.
        const chainRootIsBuilderCall = (() => {
          let n = unwrap(callee.object);
          while (n && n.type === "CallExpression") n = unwrap(unwrap(n.callee)?.object);
          return n?.type !== "Identifier" || unwrap(callee.object)?.type === "CallExpression";
        })();
        if (!chainRootIsBuilderCall) return;

        if (!seenOrder) context.report({ node: callee.property, messageId: "unordered" });
      },
    };
  },
};

/* ============================================================ RULE 2 of 6 */

/*
 * honest-nulls-not-zero
 *
 * INCIDENT: "honest nulls, never a plausible 0" (AGENTS.md). A measure that is
 * absent -- unimported hours, an order with no contract, a budget nobody has
 * set -- must render as "—"/"n/a", not as 0. A 0 is indistinguishable from a
 * real measurement of nothing, so it is read as fact, totalled with real
 * numbers, and nobody ever asks why the figure is low.
 *
 * SHAPE: `<measure> ?? 0` or `<measure> || 0`, where the left operand READS a
 * measure-named property.
 *
 * SHAPE: `<db column> ?? 0` / `<db column> || 0`, where the left operand reads
 * a snake_case, measure-named property -- i.e. a Postgres column at the moment
 * it crosses into the app.
 *
 * THE EXCLUSIONS THAT MAKE IT USABLE, each measured against the whole repo:
 *
 *   the accumulator idiom  m.set(k, (m.get(k) ?? 0) + x)   -- lawful; 0 is the
 *     additive identity for a key not yet seen. Any `?? 0` whose left side is a
 *     `.get()`/`.at()` call is skipped. Same for `.length`/`.size`, which are
 *     cardinalities of a collection in hand.
 *   a comparison  (p.contract_hours ?? 0) > 0              -- a guard, not a
 *     figure. 18 findings, all lawful.
 *   a sort or reduce callback                              -- ordering and
 *     accumulation report nothing. 65 findings, all lawful.
 *   camelCase view-model fields                            -- see the note at
 *     the boundary check below.
 *
 * Raw `?? 0` / `|| 0` in this repo: 343 occurrences. After the exclusions: 48.
 * The narrowing is the rule.
 */
const MEASURE = new Set([
  "hours", "hour", "minutes", "seconds", "duration", "durations",
  "amount", "amounts", "budget", "budgets", "cost", "costs", "price", "prices",
  "revenue", "spend", "spent", "billable", "contracted", "logged", "booked",
  "total", "totals", "sum", "count", "counts", "rate", "rates", "fee", "fees",
  "margin", "percent", "percentage", "share", "hourly", "quantity", "qty",
  "balance", "utilisation", "utilization", "capacity", "fte",
]);

/*
 * Names that LOOK numeric but are positions or geometry, where 0 is a correct
 * default rather than a claim. `count` deliberately is NOT here -- a count is a
 * measure by the house rule -- but `index` and friends are, so the rule does
 * not fire on `arr[i ?? 0]`.
 */
const POSITIONAL = new Set([
  "index", "idx", "i", "j", "n", "offset", "page", "from", "to", "start", "end",
  "length", "size", "width", "height", "top", "left", "right", "bottom",
  "x", "y", "scroll", "scrolltop", "scrollleft", "depth", "level", "step",
]);

/** Numeric coercions that pass measure-ness through to their argument. */
const COERCIONS = new Set(["Number", "parseFloat", "parseInt", "num", "toNumber", "asNumber"]);

/** Operators that make the `?? 0` a guard rather than a reported figure. */
const COMPARISONS = new Set([">", "<", ">=", "<=", "===", "!==", "==", "!="]);

/** Callbacks where a 0 decides an order or accumulates, and reports nothing. */
const AGGREGATING_CALLBACKS = new Set(["sort", "toSorted", "reduce", "reduceRight"]);

/**
 * True when `node` sits inside a function passed to `x.<name>(...)` for one of
 * `names`. Walks out of arrow/function bodies only, so an unrelated enclosing
 * call cannot suppress a finding.
 */
function inCallbackOf(node, names) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type !== "ArrowFunctionExpression" && p.type !== "FunctionExpression") continue;
    const call = p.parent;
    if (call?.type !== "CallExpression" || !call.arguments.includes(p)) continue;
    const c = unwrap(call.callee);
    if (c?.type === "MemberExpression" && !c.computed && c.property.type === "Identifier"
      && names.has(c.property.name)) return true;
  }
  return false;
}

const honestNullsNotZero = {
  meta: {
    type: "problem",
    docs: { description: "A missing measure is null, not a plausible zero." },
    schema: [],
    messages: {
      plausibleZero:
        "honest nulls: `{{name}} ?? 0` turns a MISSING measure into a measured zero, which then "
        + "totals with real figures and is never questioned -- keep it null and render \"—\"/\"n/a\" "
        + "at the edge (AGENTS.md house rules).",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "??" && node.operator !== "||") return;
        const right = unwrap(node.right);
        if (right?.type !== "Literal" || right.value !== 0) return;

        /*
         * `(p.contract_hours ?? 0) > 0` is a GUARD -- "does this project have a
         * contract at all" -- not a figure. It never reaches a reader as a
         * number, so a defaulted 0 asserts nothing false. Excluding
         * comparisons removed 36 findings, every one of them lawful.
         */
        if (node.parent?.type === "BinaryExpression"
          && COMPARISONS.has(node.parent.operator)) return;

        /*
         * Ordering and aggregation are not reporting.
         *
         *   .sort((a, b) => (b.burnPercent ?? 0) - (a.burnPercent ?? 0))
         *   rows.reduce((sum, r) => sum + (r.contractHours ?? 0), 0)
         *
         * In a comparator the 0 decides a position, never a printed figure. In
         * an accumulator it is the additive identity, and the surrounding code
         * in this repo already filters to the known rows first (`hoursKnown`,
         * `withPresent`) precisely so the total stays honest. Measured: these
         * two shapes were 65 findings repo-wide, 40 of them in src/, and the
         * sample read as lawful throughout.
         *
         * A total that silently absorbs unknown rows IS a real defect -- it is
         * just not one a parser can tell from a legitimate sum, because the
         * difference is whether the rows were filtered upstream. That half
         * belongs to the check-* gates, which can see the data.
         */
        if (inCallbackOf(node, AGGREGATING_CALLBACKS)) return;

        let left = unwrap(node.left);

        // The accumulator idiom: `(m.get(k) ?? 0) + 1`. Lawful -- see header.
        // Also any `.get(...)`/`.at(...)` read: the container is in hand, so an
        // absent key is genuinely a zero start, not an unmeasured quantity.
        if (left.type === "CallExpression") {
          const c = unwrap(left.callee);
          if (c?.type === "MemberExpression" && !c.computed && c.property.type === "Identifier"
            && (c.property.name === "get" || c.property.name === "at")) return;
          // Pass measure-ness through Number()/num()/parseFloat().
          const fn = c?.type === "Identifier" ? c.name
            : (c?.type === "MemberExpression" && c.property.type === "Identifier" ? c.property.name : null);
          if (fn && COERCIONS.has(fn) && left.arguments.length) left = unwrap(left.arguments[0]);
          else return;
        }

        const name = readName(left);
        if (!name) return;
        const w = words(name);
        if (w.some((t) => POSITIONAL.has(t))) return;
        if (!w.some((t) => MEASURE.has(t))) return;

        /*
         * THE BOUNDARY: a snake_case property is a Postgres column. That is the
         * one place in this codebase where the parser can tell "the database
         * had no value" from "the value is zero", because it is where the two
         * meet. `contract_hours`, `duration_seconds`, `margin_eur`,
         * `weekly_hours`, `burn_percent` -- each of these is nullable in the
         * schema, and each `?? 0` on one is the app inventing a measurement.
         *
         * camelCase measures (`burnPercent`, `remainingHours`, `contractHours`)
         * are view-model fields, one or more steps downstream, where the
         * unknown/zero decision has usually already been taken deliberately --
         * factorial-hours.ts returns `m ? r1((agg?.logged ?? 0) / 3600) : null`,
         * which is correct and would be flagged. Measured: 56 camelCase sites
         * repo-wide, and the sample read as overwhelmingly lawful. They are out
         * of scope on purpose, not by accident. Widening to them is a decision
         * to take once these 48 are triaged.
         */
        if (!name.includes("_")) return;

        context.report({ node, messageId: "plausibleZero", data: { name } });
      },
    };
  },
};

/* ============================================================ RULE 3 of 6 */

/*
 * no-silent-catch
 *
 * INCIDENT: src/lib/queries/data-hygiene.ts twice carries a comment about this
 * -- a thrown error "was swallowed by a bare `catch {}` and never logged", and
 * a permissions problem was invented to explain a failure the code had already
 * discarded. An empty catch converts a fault into a wrong answer, which is the
 * expensive kind.
 *
 * SHAPE: a catch block with no statements AND no comment.
 *
 * WHY A COMMENT IS ENOUGH TO SUPPRESS: there are legitimate swallows -- a
 * best-effort `p.kill()` in a timeout path, a `writeSync` to a closed stdout.
 * What makes them legitimate is that someone decided, and the decision is
 * readable at the line. Requiring a sentence is the cheapest possible proof
 * that the empty block is a choice and not an omission, and it keeps the rule
 * from firing on eleven correct teardown paths in scripts/.
 */
const noSilentCatch = {
  meta: {
    type: "problem",
    docs: { description: "An empty catch swallows a fault and returns a wrong answer." },
    schema: [],
    messages: {
      silent:
        "swallowed failure: an empty catch turns a fault into a wrong answer that nobody "
        + "investigates (data-hygiene.ts shipped exactly this) -- log it, rethrow it, or write "
        + "one line inside the block saying why discarding it is correct here.",
    },
  },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();
    return {
      CatchClause(node) {
        if (node.body.body.length > 0) return;
        if (source.getCommentsInside(node.body).length > 0) return;
        context.report({ node: node.body, messageId: "silent" });
      },
    };
  },
};

/* ============================================================ RULE 4 of 6 */

/*
 * gate-skip-must-not-exit-zero
 *
 * INCIDENT (2026-09-04, and again in PR #46): check-time-integration.mjs
 * crashed on the next-intl components, printed SKIP, exited 0 having asserted
 * NOTHING, and a pull request was opened on that green.
 * check-sync-schedule-alive.mjs -- the gate written to catch a scheduler dying
 * silently -- exited 0 with "SKIP: no .env.local" on every runner, and was
 * itself silent for nine days.
 *
 * The protocol that replaced it is scripts/lib/gate-result.mjs: exit 3 for
 * "did not run", via notRun(), or notRunInChain() for the twenty gates inside
 * the `test:db` && chain. Exit 0 must mean "ran, and everything passed".
 *
 * SHAPE:
 *   (a) a `process.exit(0)` with a SKIP-bearing string in the same block, or
 *   (b) a `process.exit(0)` guarded by a condition whose text says "skip"
 *       -- the `if (!(await listenOrSkip(...))) process.exit(0)` shape, where
 *       the SKIP literal lives inside the helper.
 *
 * SCOPING LIVES IN THE CONFIG, NOT IN HERE. eslint.config.mjs turns this rule
 * on for `scripts/**\/check-*.{mjs,cjs}` only -- a `process.exit(0)` in a sync
 * script or a diagnostic is nobody's business. It is deliberately not a
 * filename test inside the rule: that would have forced the fixture to be
 * named check-*.mjs, and check-gates-runnable-on-ci.mjs requires every file
 * matching that name to be a registered CI gate. A rule that can only be
 * tested by lying about what a file is, is a rule that will not be tested.
 */
const SKIP_LITERAL = /\bSKIP\b/;

const gateSkipMustNotExitZero = {
  meta: {
    type: "problem",
    docs: { description: "A gate that could not run must exit 3, not 0." },
    schema: [],
    messages: {
      skipExitZero:
        "a gate that cannot run must not exit 0: SKIP + exit 0 is how check-time-integration "
        + "opened a PR on a green that asserted nothing -- call notRun(reason) from "
        + "scripts/lib/gate-result.mjs (exit 3), or notRunInChain(reason) if this gate sits "
        + "inside the `test:db` && chain.",
    },
  },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();

    /*
     * Both arrays live in this closure, one set per FILE. Module scope would
     * leak SKIP literals from one gate into the next file linted in the same
     * process, which is the classic way a lint rule becomes non-deterministic
     * depending on the order eslint happens to walk the tree.
     */
    /** Every string node in the file whose text contains SKIP. */
    const skipNodes = [];
    /** Every `process.exit(0)` in the file. */
    const exitZeroCalls = [];

    function enclosingBlock(node) {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "BlockStatement" || p.type === "Program" || p.type === "SwitchCase") return p;
      }
      return null;
    }

    return {
      Literal(node) {
        if (typeof node.value === "string" && SKIP_LITERAL.test(node.value)) skipNodes.push(node);
      },
      TemplateElement(node) {
        if (SKIP_LITERAL.test(node.value.raw)) skipNodes.push(node);
      },
      "Program:exit"() {
        for (const exitCall of exitZeroCalls) {
          // (a) a SKIP string somewhere in the same enclosing block.
          const block = enclosingBlock(exitCall);
          const inSameBlock = block && skipNodes.some(
            (s) => s.range[0] >= block.range[0] && s.range[1] <= block.range[1],
          );
          // (b) the guard itself says "skip".
          let guardSaysSkip = false;
          for (let p = exitCall.parent, hops = 0; p && hops < 4; p = p.parent, hops += 1) {
            if (p.type === "IfStatement") {
              guardSaysSkip = /skip/i.test(source.getText(p.test));
              break;
            }
          }
          if (inSameBlock || guardSaysSkip) {
            context.report({ node: exitCall, messageId: "skipExitZero" });
          }
        }
      },
      CallExpression(node) {
        const c = unwrap(node.callee);
        if (c?.type !== "MemberExpression" || c.computed) return;
        if (c.object.type !== "Identifier" || c.object.name !== "process") return;
        if (c.property.type !== "Identifier" || c.property.name !== "exit") return;
        const arg = node.arguments[0] && unwrap(node.arguments[0]);
        if (!arg || arg.type !== "Literal" || arg.value !== 0) return;
        exitZeroCalls.push(node);
      },
    };
  },
};

/* ============================================================ RULE 5 of 6 */

/*
 * no-name-join-across-systems
 *
 * INCIDENT: ADR-001. src/lib/queries/factorial-hours.ts shipped
 *   memberByEmail.get(f.email) ?? memberByName.get(norm(f.fullName))
 * so /operations-analytics decided whose TrackingTime hours belonged to whose
 * Factorial attendance record by comparing two display names, and rendered the
 * result as a measured figure about a named person. Nothing was red. On the
 * live roster the one person it reached by name happened to be right.
 *
 * scripts/check-no-name-matching.mjs already enforces the map-lookup half of
 * ADR-001 across src/. This rule covers the two shapes that gate does not:
 *
 *   (a) `.ilike("<name column>", <a value, not a literal>)` -- a fuzzy match
 *       driven by data. A literal argument is a human typing a probe into a
 *       one-off diagnostic and is left alone; the repo has several, and firing
 *       on them would be 35 findings of pure noise.
 *       `.ilike("email", email)` is likewise NOT flagged: email is an exact
 *       key, matched case-insensitively, which is what admin/users/actions.ts
 *       does on purpose.
 *
 *   (b) `<names>.includes(<other.name>)` where the two sides read name-ish
 *       things off DIFFERENT base identifiers -- i.e. two record sets.
 *       `query.includes(term)` and `p.name.includes(p.prefix)` do not fire.
 */
const NAME_COLUMN = /^(?:name|full_?name|display_?name|first_?name|last_?name|customer_?name|project_?name|order_?name|company|title|label|bezeichnung|kunde)$/i;
const NAMEISH = /(?:^|_|\b)(?:name|names|fullname|displayname|firstname|lastname|company|title|bezeichnung|kunde)(?:s)?$/i;

function isNameish(node) {
  const n = readName(node);
  if (!n) return false;
  const w = words(n);
  return NAMEISH.test(n) || w.some((t) => ["name", "names", "company", "kunde", "bezeichnung"].includes(t));
}

const noNameJoinAcrossSystems = {
  meta: {
    type: "problem",
    docs: { description: "ADR-001: records join on exact keys, never on name similarity." },
    schema: [],
    messages: {
      fuzzyIlike:
        "ADR-001 join by name: a data-driven .ilike on a NAME column decides identity by "
        + "similarity -- factorial-hours.ts did this and attributed one colleague's hours to "
        + "another -- match on the exact key (external_id, email, the recorded reference row) "
        + "and show a name only for a human to confirm.",
      crossIncludes:
        "ADR-001 join by name: .includes() across two record sets matches identity by name "
        + "similarity, which is exactly the shape that shipped in factorial-hours.ts -- compare "
        + "the exact keys instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        const method = callee.property.name;

        if (method === "ilike" && node.arguments.length >= 2) {
          const col = unwrap(node.arguments[0]);
          const val = unwrap(node.arguments[1]);
          if (col?.type !== "Literal" || typeof col.value !== "string") return;
          if (!NAME_COLUMN.test(col.value)) return;
          // A hand-typed probe string is a human searching, not code joining.
          if (val?.type === "Literal") return;
          context.report({ node, messageId: "fuzzyIlike" });
          return;
        }

        if (method === "includes" && node.arguments.length === 1) {
          const haystack = callee.object;
          const needle = unwrap(node.arguments[0]);
          if (!isNameish(haystack) || !isNameish(needle)) return;
          const a = baseIdentifier(haystack);
          const b = baseIdentifier(needle);
          if (!a || !b || a === b) return;
          context.report({ node, messageId: "crossIncludes" });
        }
      },
    };
  },
};

/* ============================================================ RULE 6 of 6 */

/*
 * no-machine-absolute-path
 *
 * INCIDENT (2026-09-06): 150 of 207 scripts carried a dead Windows drive-letter
 * path. One of them was run-all-gates.mjs -- the only thing that runs the suite
 * end to end -- which died on line 13 reading that path's package.json, so on
 * this machine the whole gate suite could not be evaluated at all. The gate
 * whose entire job was to catch it printed green, because it only scanned the
 * CI chain and none of the 150 was in it.
 *
 * SHAPE: a string literal or template chunk containing `<drive>:/` or `/home/`.
 * Both halves matter: the drive path was the Windows failure, and `/home/` is
 * the same defect written from WSL, which the existing gate does not match.
 *
 * scripts/check-no-absolute-paths.mjs stays the authority (it also reads
 * committed config and template literals as raw text). This rule is the
 * review-time half: it puts the finding on the line as it is written, rather
 * than on the CI run that finally reaches the file.
 */
/*
 * `(?<![A-Za-z])` keeps "https:/evil.example.com" — a real fixture in
 * check-open-redirect.mjs — from reading as a drive letter, and reading the
 * COOKED template value rather than the raw one keeps `\n` (backslash, n) in
 * `console.log(`policy:\n ...`)` from matching `[A-Za-z]:[/\\]`. Both were
 * measured: the naive regex produced fourteen findings, and all fourteen were
 * one of those two shapes.
 */
const MACHINE_PATH = /(?<![A-Za-z])[A-Za-z]:[/\\][A-Za-z0-9._-]|\/home\/[A-Za-z0-9._-]/;

const noMachineAbsolutePath = {
  meta: {
    type: "problem",
    docs: { description: "No developer-machine absolute path in shipped source." },
    schema: [],
    messages: {
      machinePath:
        "machine-specific absolute path: 150 scripts carried a dead drive-letter path and the "
        + "whole gate suite could not start -- resolve from the file's own location instead "
        + "(`import { REPO_ROOT } from \"./lib/repo-root.mjs\"`), or name the tool and let PATH "
        + "answer.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!MACHINE_PATH.test(node.value)) return;
        context.report({ node, messageId: "machinePath" });
      },
      TemplateElement(node) {
        const text = node.value.cooked ?? node.value.raw;
        if (!MACHINE_PATH.test(text)) return;
        context.report({ node, messageId: "machinePath" });
      },
    };
  },
};

/* ------------------------------------------------------------------ export */

const plugin = {
  meta: { name: "house-rules", version: "1.0.0" },
  rules: {
    "paged-read-needs-order": pagedReadNeedsOrder,
    "honest-nulls-not-zero": honestNullsNotZero,
    "no-silent-catch": noSilentCatch,
    "gate-skip-must-not-exit-zero": gateSkipMustNotExitZero,
    "no-name-join-across-systems": noNameJoinAcrossSystems,
    "no-machine-absolute-path": noMachineAbsolutePath,
  },
};

export default plugin;
