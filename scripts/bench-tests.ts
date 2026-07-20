#!/usr/bin/env bun
// Bench the unit test suite and emit METRIC lines for autoresearch.
// Runs `vitest run --coverage` 3 times, captures runtime, line coverage, test count, flakes.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// --- Quality audit (meaning): count tests with no assertions / weak smoke. ---
function* walk(dir: string): Generator<string> {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		const s = statSync(p);
		if (s.isDirectory()) yield* walk(p);
		else if (/\.(test|spec)\.tsx?$/.test(e)) yield p;
	}
}
function extractTestBodies(file: string): string[] {
	const src = readFileSync(file, "utf8");
	const out: string[] = [];
	const re =
		/\b(?:test|it)\(\s*(?:"[^"]+"|'[^']+'|`[^`]+`)\s*,\s*(?:async\s*)?(?:\(\s*\)|[a-zA-Z_$]+)\s*=>\s*\{/g;
	let m: RegExpExecArray | null;
	m = re.exec(src);
	while (m) {
		const start = m.index + m[0].length;
		let depth = 1,
			i = start;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "{") depth++;
			else if (c === "}") depth--;
			else if (c === '"' || c === "'" || c === "`") {
				const q = c;
				i++;
				while (i < src.length && src[i] !== q) {
					if (src[i] === "\\") i++;
					i++;
				}
			}
			i++;
		}
		out.push(src.slice(start, i - 1));
		m = re.exec(src);
	}
	return out;
}
function auditQuality(): {
	total: number;
	noAssert: number;
	weak: number;
	assertionsPerTest: number;
	statusOnly: number;
	calledTimesWithoutArgs: number;
	rejectsWithoutSideEffectCheck: number;
} {
	let total = 0,
		noAssert = 0,
		weak = 0,
		assertions = 0,
		statusOnly = 0,
		calledTimesWithoutArgs = 0,
		rejectsWithoutSideEffectCheck = 0;
	// Tautological-assertion patterns that look like a check but assert nothing.
	// Catches the `expect(true).toBe(true)` / `expect(1).toBe(1)` /
	// `expect("foo").toBe("foo")` idiom commonly written as a placeholder
	// for "just verify it runs without throwing". Such tests provide ZERO
	// regression defense — they pass even when the SUT does the wrong thing.
	const TAUTOLOGY =
		/\bexpect\(\s*(true|false|null|undefined|\d+|"[^"]*"|'[^']*'|`[^`]*`)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/;
	// Status-only weakness: every expect(...) is on `.status` (or similar)
	// with no body/output assertion. Catches "returns 200" tests that
	// would silently pass even if the body is the wrong shape.
	const STATUS_ONLY = /\bexpect\([^)]*\.status\)/g;
	const HAS_BODY_ASSERT =
		/\bexpect\([^)]*\b(body|json|text)\b|\.toEqual\(|\.toMatch\(|\.toContain\(|\.toHaveProperty\(|\.toHaveBeen/;
	for (const root of ["src/__tests__", "src/server/__tests__"]) {
		let exists = true;
		try {
			statSync(root);
		} catch {
			exists = false;
		}
		if (!exists) continue;
		for (const f of walk(root)) {
			for (const body of extractTestBodies(f)) {
				total++;
				const exps = (body.match(/\bexpect\s*\(/g) ?? []).length;
				assertions += exps;
				if (exps === 0) noAssert++;
				else if (exps === 1 && /\.(toBeDefined|toBeTruthy|toBeFalsy)\(\)/.test(body)) weak++;
				else if (exps === 1 && TAUTOLOGY.test(body)) weak++;
				if (exps >= 1) {
					const statusExps = (body.match(STATUS_ONLY) ?? []).length;
					if (statusExps === exps && !HAS_BODY_ASSERT.test(body)) statusOnly++;
				}
				// Called-times-without-args anti-pattern: a test that asserts
				// `mock.toHaveBeenCalledTimes(N)` but never inspects what the
				// mock was called WITH. A regression that invoked the right
				// mock but with wrong arguments (e.g. cross-tenant project_id,
				// wrong status_code in audit log, swapped INSERT bind columns)
				// would silently pass. Flag the count to track regressions.
				// Soft signal — not a gate (some functions have no args worth
				// pinning) but rising count means new weak tests creeping in.
				const hasCalledTimes = /\.toHaveBeenCalledTimes\s*\(/.test(body);
				const hasArgsCheck =
					/\.mock\.calls[.[]|\.toHaveBeenCalledWith\s*\(|\.toHaveBeenLastCalledWith\s*\(|\.toHaveBeenNthCalledWith\s*\(/.test(
						body,
					);
				if (hasCalledTimes && !hasArgsCheck) calledTimesWithoutArgs++;
				// Rejects-without-side-effect-check anti-pattern: a test that
				// asserts `await expect(fn()).rejects.toThrow(...)` (or any
				// .rejects.* matcher) but never verifies side-effect mocks at
				// all (no toHaveBeenCalled* / not.toHaveBeenCalled / mock.calls
				// / toHaveBeenCalledTimes). A regression where the SUT performs
				// an unintended side effect (DB INSERT, network POST, KV write)
				// BEFORE throwing would silently pass: the throw still happens
				// but the row was actually written / email actually sent.
				// Tests that DO pin `toHaveBeenCalledTimes(N)` (even N>0) are
				// already verifying side-effect count; only flag tests with
				// ZERO call-tracking assertions on the rejecting path.
				const hasRejects =
					/\bexpect\([^)]*\)\s*\.\s*rejects\s*\.|\bawait\s+expect\([^)]*\)\s*\.\s*rejects\s*\./.test(
						body,
					);
				const hasAnyCallCheck =
					/\.toHaveBeenCalled(?:Times|With|LastWith|NthWith)?\s*\(|\.mock\.calls[.[]/.test(body);
				if (hasRejects && !hasAnyCallCheck) rejectsWithoutSideEffectCheck++;
			}
		}
	}
	return {
		total,
		noAssert,
		weak,
		assertionsPerTest: total ? assertions / total : 0,
		statusOnly,
		calledTimesWithoutArgs,
		rejectsWithoutSideEffectCheck,
	};
}

/**
 * Forward-looking SQL-window pinning gate. Scans SUT files
 * (src/server/lib/db, src/server/routes) for date/time-bounded SQL
 * fragments and verifies the test directory pins each one.
 *
 * Matches:
 *   - `date('now')` (today-bounded queries)
 *   - `strftime('%Y-%m-...` (month-aligned queries)
 *   - `'-N days'` / `'-N months'` / `'+1 day'` / `'+1 month'` (windowing)
 *
 * For each SUT fragment, the test corpus must contain a
 * `expect(sql).toMatch(/.../) `or equivalent string match referencing
 * the same fragment text. Mocks are time-blind: a test that asserts
 * only response shape silently passes when the SQL window is wrong
 * (see #293-#295). This gate prevents new SQL-window pinning gaps
 * from regressing.
 *
 * Soft for now — returns count of unpinned fragments. Promotion to
 * a hard gate (exit 7) once stable at 0.
 */
function auditSqlWindowGaps(): { total: number; unpinned: number; details: string[] } {
	const FRAG_RE =
		/(strftime\('[^']+'(?:\s*,\s*'[^']*')?\)|date\('now'(?:\s*,\s*'[+-]\d+\s+\w+')?\))/g;
	const sutRoots = ["src/server/lib/db", "src/server/routes", "src/server/lib/email"];
	const fragments = new Set<string>();
	function* walkAll(dir: string): Generator<string> {
		for (const e of readdirSync(dir)) {
			const p = join(dir, e);
			const s = statSync(p);
			if (s.isDirectory()) yield* walkAll(p);
			else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) yield p;
		}
	}
	for (const root of sutRoots) {
		let exists = true;
		try {
			statSync(root);
		} catch {
			exists = false;
		}
		if (!exists) continue;
		for (const f of walkAll(root)) {
			const src = readFileSync(f, "utf8");
			let m: RegExpExecArray | null = FRAG_RE.exec(src);
			while (m) {
				fragments.add(m[1]);
				m = FRAG_RE.exec(src);
			}
		}
	}
	// Aggregate test-corpus body once for substring search.
	let testCorpus = "";
	for (const root of ["src/__tests__", "src/server/__tests__"]) {
		let exists = true;
		try {
			statSync(root);
		} catch {
			exists = false;
		}
		if (!exists) continue;
		for (const f of walk(root)) testCorpus += readFileSync(f, "utf8");
	}
	const unpinned: string[] = [];
	for (const frag of fragments) {
		// Tests typically embed the fragment inside a regex pattern with
		// escaped parens. Normalise both to a substring match on the
		// significant tokens (drop quotes/parens whitespace).
		const sig = frag.replace(/\s+/g, "");
		const corpusSig = testCorpus.replace(/\s+/g, "");
		// Try direct substring first, then regex-escaped fragment.
		if (corpusSig.includes(sig)) continue;
		// Fragment-with-backslashes for regex (e.g. /date\s*\(\s*'now'/i).
		// Match by significant tokens only: function name + first quoted arg.
		const fnMatch = /^(date|strftime)/.exec(frag);
		const argMatch = /'([^']+)'/.exec(frag);
		if (
			fnMatch &&
			argMatch &&
			new RegExp(`${fnMatch[1]}\\s*\\(\\s*\\\\?'?${argMatch[1].replace(/[+-]/g, "[+\\-]")}`).test(
				testCorpus,
			)
		)
			continue;
		unpinned.push(frag);
	}
	return { total: fragments.size, unpinned: unpinned.length, details: unpinned };
}

const RUNS = Number(process.env.BENCH_RUNS ?? 3);

interface RunResult {
	ms: number;
	passed: number;
	failed: number;
	total: number;
	lineCov: number;
	funcCov: number;
	branchCov: number;
	ok: boolean;
}

function runOnce(withCoverage: boolean): RunResult {
	const args = ["vitest", "run", "--reporter=default"];
	if (withCoverage) args.push("--coverage");
	const t0 = performance.now();
	const r = spawnSync("bunx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const ms = performance.now() - t0;
	// Strip ANSI color codes from vitest output (ESC via fromCharCode avoids control-char regex)
	const ansiColor = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
	const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(ansiColor, "");
	// Tests  9 failed | 132 passed (141)
	// Tests  346 passed (346)  OR  Tests  9 failed | 132 passed (141)
	let failed = 0,
		passed = 0,
		total = 0;
	const mFail = out.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s+\((\d+)\)/);
	const mPass = out.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
	if (mFail) {
		failed = Number(mFail[1]);
		passed = Number(mFail[2]);
		total = Number(mFail[3]);
	} else if (mPass) {
		passed = Number(mPass[1]);
		total = Number(mPass[2]);
	}
	// All files       |   95.5  |   88.3 |  96.1 |  95.5 |
	let lineCov = 0,
		funcCov = 0,
		branchCov = 0;
	if (withCoverage) {
		const cm = out.match(
			/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
		);
		if (cm) {
			lineCov = Number(cm[4]); // last column = lines
			funcCov = Number(cm[3]);
			branchCov = Number(cm[2]);
		}
	}
	return { ms, passed, failed, total, lineCov, funcCov, branchCov, ok: r.status === 0 };
}

// First a coverage run to grab coverage numbers + warm caches
const cov = runOnce(true);
const noCovRuns: RunResult[] = [];
for (let i = 0; i < RUNS; i++) noCovRuns.push(runOnce(false));

const mss = noCovRuns.map((r) => r.ms);
const median = [...mss].sort((a, b) => a - b)[Math.floor(mss.length / 2)];
const min = Math.min(...mss);
const max = Math.max(...mss);
const flakes = noCovRuns.filter((r) => !r.ok || r.failed > 0).length;

const totalTests = noCovRuns[0]?.total ?? cov.total;
const passedTests = noCovRuns[0]?.passed ?? cov.passed;

console.log(`\n=== BENCH SUMMARY ===`);
console.log(`runs (no-cov): ${RUNS}, ms: ${mss.map((x) => x.toFixed(0)).join(", ")}`);
console.log(`coverage run ms: ${cov.ms.toFixed(0)}`);
console.log(`tests: ${passedTests}/${totalTests}, flakes: ${flakes}`);
console.log(`coverage lines=${cov.lineCov}% funcs=${cov.funcCov}% branches=${cov.branchCov}%`);

console.log(`METRIC test_runtime_ms=${median.toFixed(0)}`);
console.log(`METRIC runtime_min_ms=${min.toFixed(0)}`);
console.log(`METRIC runtime_max_ms=${max.toFixed(0)}`);
console.log(`METRIC coverage_run_ms=${cov.ms.toFixed(0)}`);
console.log(`METRIC line_coverage_pct=${cov.lineCov}`);
console.log(`METRIC branch_coverage_pct=${cov.branchCov}`);
console.log(`METRIC test_count=${totalTests}`);
console.log(`METRIC flake_count=${flakes}`);

const q = auditQuality();
console.log(
	`audit: ${q.total} tests, ${q.noAssert} no-assert, ${q.weak} weak-smoke, ${q.statusOnly} status-only, ${q.calledTimesWithoutArgs} called-times-no-args, ${q.rejectsWithoutSideEffectCheck} rejects-no-side-effect, ${q.assertionsPerTest.toFixed(2)} expects/test`,
);
console.log(`METRIC meaningless_test_count=${q.noAssert + q.weak}`);
console.log(`METRIC assertions_per_test=${q.assertionsPerTest.toFixed(2)}`);
console.log(`METRIC status_only_test_count=${q.statusOnly}`);
console.log(`METRIC called_times_no_args_count=${q.calledTimesWithoutArgs}`);
console.log(`METRIC rejects_no_side_effect_count=${q.rejectsWithoutSideEffectCheck}`);

const sw = auditSqlWindowGaps();
console.log(
	`sql-window audit: ${sw.total} SUT date-fragments, ${sw.unpinned} unpinned${sw.unpinned > 0 ? ` -> ${sw.details.join(", ")}` : ""}`,
);
console.log(`METRIC sql_window_unpinned_count=${sw.unpinned}`);

// Coverage thresholds aligned with vitest.config.ts
const COV_LINES = 99;
const COV_FUNCS = 99;
const COV_BRANCHES = 96;
const coverageOk =
	cov.lineCov >= COV_LINES && cov.funcCov >= COV_FUNCS && cov.branchCov >= COV_BRANCHES && cov.ok;
const statusOnlyOk = q.statusOnly === 0;
const calledTimesOk = q.calledTimesWithoutArgs === 0;
const rejectsOk = q.rejectsWithoutSideEffectCheck === 0;
const allPassed = noCovRuns.every((r) => r.ok && r.failed === 0);
if (!coverageOk) {
	const fails: string[] = [];
	if (cov.lineCov < COV_LINES) fails.push(`lines ${cov.lineCov}% < ${COV_LINES}%`);
	if (cov.funcCov < COV_FUNCS) fails.push(`funcs ${cov.funcCov}% < ${COV_FUNCS}%`);
	if (cov.branchCov < COV_BRANCHES) fails.push(`branches ${cov.branchCov}% < ${COV_BRANCHES}%`);
	if (!cov.ok) fails.push("coverage run failed");
	console.error(`FAIL: coverage gate (${fails.join(", ")})`);
	process.exit(2);
}
if (!statusOnlyOk) {
	console.error(
		`FAIL: status-only test gate (${q.statusOnly} tests assert ONLY .status with no body shape — these pass even if response body is wrong)`,
	);
	process.exit(4);
}
if (!calledTimesOk) {
	console.error(
		`FAIL: called-times-no-args gate (${q.calledTimesWithoutArgs} tests assert mock.toHaveBeenCalledTimes(N) but never inspect what the mock was called WITH — these pass even if the right mock is called with the wrong arguments)`,
	);
	process.exit(5);
}
if (!rejectsOk) {
	console.error(
		`FAIL: rejects-no-side-effect gate (${q.rejectsWithoutSideEffectCheck} tests assert .rejects.* but never verify side-effect mocks at all — these pass even if the SUT performed an unintended INSERT/POST/KV-write before throwing)`,
	);
	process.exit(6);
}
if (sw.unpinned > 0) {
	console.error(
		`FAIL: sql-window-unpinned gate (${sw.unpinned} SUT date-fragments are not referenced by any test: ${sw.details.join(", ")} — mocks are time-blind so a regression that changes the SQL window silently passes when the response shape is the only assertion; pin the fragment in the corresponding test via expect(sql).toMatch(/.../))`,
	);
	process.exit(7);
}
if (!allPassed) {
	console.error(`FAIL: ${flakes}/${RUNS} runs had failures`);
	process.exit(3);
}
console.log("OK");
