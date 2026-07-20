#!/usr/bin/env bun
// Audit unit tests for quality issues:
// - tests with 0 assertions (expect/assert)
// - tests with only smoke checks (single toBeDefined / toBeTruthy)
// - duplicate test names within a file
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function* walk(dir: string): Generator<string> {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		const s = statSync(p);
		if (s.isDirectory()) yield* walk(p);
		else if (/\.(test|spec)\.tsx?$/.test(e)) yield p;
	}
}

interface TestBlock {
	file: string;
	name: string;
	body: string;
	line: number;
	describePath: string;
}

function computeDescribePath(src: string, testIdx: number): string {
	// Walk source up to testIdx tracking brace depth + open describes.
	const stack: { name: string; depth: number }[] = [];
	let depth = 0;
	let i = 0;
	const re = /describe\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
	// Simple approach: scan all chars, recording describe-open and brace depth.
	while (i < testIdx) {
		const c = src[i];
		if (c === '"' || c === "'" || c === "`") {
			const q = c;
			i++;
			while (i < testIdx && src[i] !== q) {
				if (src[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			while (i < testIdx && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			i += 2;
			while (i < testIdx - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (c === "{") {
			depth++;
			i++;
			continue;
		}
		if (c === "}") {
			while (stack.length && (stack[stack.length - 1]?.depth ?? 0) > depth) stack.pop();
			depth--;
			// Also pop if a describe's body just closed (depth equals describe.depth).
			while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= depth + 1) stack.pop();
			i++;
			continue;
		}
		re.lastIndex = i;
		const m = re.exec(src);
		if (m && m.index === i) {
			const name = m[1] ?? m[2] ?? m[3] ?? "";
			// Find the `{` that opens this describe's callback body.
			let j = m.index + m[0].length;
			while (j < testIdx && src[j] !== "{") j++;
			stack.push({ name, depth: depth + 1 });
			i = j; // next iter will see `{` and bump depth
			continue;
		}
		i++;
	}
	return stack.map((f) => f.name).join(" > ");
}

function extractTests(file: string): TestBlock[] {
	const src = readFileSync(file, "utf8");
	const out: TestBlock[] = [];
	const re =
		/\b(?:test|it)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*,\s*(?:async\s*)?(?:\(\s*\)|[a-zA-Z_$]+)\s*=>\s*\{/g;
	let m: RegExpExecArray | null;
	m = re.exec(src);
	while (m) {
		const name = m[1] ?? m[2] ?? m[3] ?? "";
		const start = m.index + m[0].length;
		let depth = 1;
		let i = start;
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
		const body = src.slice(start, i - 1);
		const line = src.slice(0, m.index).split("\n").length;
		const describePath = computeDescribePath(src, m.index);
		out.push({ file, name, body, line, describePath });
		m = re.exec(src);
	}
	return out;
}

const ROOTS = ["src/__tests__", "src/server/__tests__"];
const all: TestBlock[] = [];
for (const r of ROOTS) for (const f of walk(r)) all.push(...extractTests(f));

const noAssert: TestBlock[] = [];
const weak: TestBlock[] = [];
const TAUTOLOGY =
	/\bexpect\(\s*(true|false|null|undefined|\d+|"[^"]*"|'[^']*'|`[^`]*`)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/;
for (const t of all) {
	const exps = (t.body.match(/\bexpect\s*\(/g) ?? []).length;
	if (exps === 0) noAssert.push(t);
	else if (exps === 1 && /\.(toBeDefined|toBeTruthy|toBeFalsy)\(\)/.test(t.body)) weak.push(t);
	else if (exps === 1 && TAUTOLOGY.test(t.body)) weak.push(t);
}

// Duplicate names per file, scoped by describe path (so tests with the
// same leaf name in different describe blocks aren't flagged).
const dupByFile = new Map<string, Map<string, number>>();
for (const t of all) {
	if (!dupByFile.has(t.file)) dupByFile.set(t.file, new Map());
	const m = dupByFile.get(t.file);
	if (!m) continue;
	const fullName = t.describePath ? `${t.describePath} > ${t.name}` : t.name;
	m.set(fullName, (m.get(fullName) ?? 0) + 1);
}
const dups: { file: string; name: string; count: number }[] = [];
for (const [file, m] of dupByFile)
	for (const [name, c] of m) if (c > 1) dups.push({ file, name, count: c });

console.log(`total tests scanned: ${all.length}`);
console.log(`\n--- tests with 0 expect() calls (${noAssert.length}) ---`);
for (const t of noAssert) console.log(`  ${t.file}:${t.line}  "${t.name}"`);
console.log(`\n--- weak smoke tests (${weak.length}) ---`);
for (const t of weak) console.log(`  ${t.file}:${t.line}  "${t.name}"`);
console.log(`\n--- duplicate test names (${dups.length}) ---`);
for (const d of dups) console.log(`  ${d.file}  "${d.name}" x${d.count}`);
