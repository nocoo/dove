/**
 * L2 route coverage gate.
 *
 * Statically extract every `(method, path)` declared in src/server/index.ts +
 * src/server/routes/**, then statically extract every HTTP request made from
 * e2e/api/**. Fail if any declared route is not exercised by at least one
 * E2E test.
 *
 * This is a **structural** gate, not behavioural — it only verifies that the
 * route is hit at all. Per-route assertion quality is still the test author's
 * job. But it catches the "we added a new endpoint and forgot to E2E it" miss.
 *
 * Run: `bun run scripts/check-route-coverage.ts`
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

type RouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
type Route = { method: RouteMethod; path: string };

// ---------------------------------------------------------------------------
// 1. Discover declared routes
// ---------------------------------------------------------------------------

function loadMountPrefixes(): Map<string, string> {
	const indexPath = join(ROOT, "src/server/index.ts");
	const src = readFileSync(indexPath, "utf-8");
	const prefixes = new Map<string, string>();

	const re = /app\.route\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
	for (const m of src.matchAll(re)) {
		const prefix = m[1];
		const varName = m[2];
		if (prefix && varName) prefixes.set(varName, prefix);
	}
	return prefixes;
}

function discoverDirectRoutes(): Route[] {
	const indexPath = join(ROOT, "src/server/index.ts");
	const src = readFileSync(indexPath, "utf-8");
	const routes: Route[] = [];
	const re = /\bapp\.(get|post|put|delete|patch|head)\(\s*["']([^"']+)["']/g;
	for (const m of src.matchAll(re)) {
		const method = m[1];
		const path = m[2];
		if (method && path) {
			routes.push({ method: method.toUpperCase() as RouteMethod, path });
		}
	}
	return routes;
}

function discoverSubRoutes(prefixes: Map<string, string>): Route[] {
	const routesDir = join(ROOT, "src/server/routes");
	const files = readdirSync(routesDir).filter((f) => f.endsWith(".ts"));
	const routes: Route[] = [];

	for (const file of files) {
		const src = readFileSync(join(routesDir, file), "utf-8");
		const re = /\b(\w+)\.(get|post|put|delete|patch|head)\(\s*["']([^"']*)["']/g;
		for (const m of src.matchAll(re)) {
			const varName = m[1];
			const method = m[2];
			const localPath = m[3];
			if (!varName || !method || localPath === undefined) continue;
			const prefix = prefixes.get(varName);
			if (!prefix) continue;
			const fullPath = localPath === "/" ? prefix : `${prefix}${localPath}`;
			routes.push({ method: method.toUpperCase() as RouteMethod, path: fullPath });
		}
	}
	return routes;
}

// ---------------------------------------------------------------------------
// 2. Discover exercised routes from e2e/api/
// ---------------------------------------------------------------------------

const HELPER_TO_METHOD: Record<string, RouteMethod> = {
	get: "GET",
	post: "POST",
	put: "PUT",
	del: "DELETE",
	patch: "PATCH",
	head: "HEAD",
};

function discoverE2ERequests(): Route[] {
	const e2eDir = join(ROOT, "e2e/api");
	const files = readdirSync(e2eDir).filter((f) => f.endsWith(".ts"));
	const requests: Route[] = [];

	for (const file of files) {
		const src = readFileSync(join(e2eDir, file), "utf-8");

		// get("/api/x", …)  or  get(`/api/x/${id}/y`, …)
		const helperRe = /\b(get|post|put|del|patch|head)\(\s*[`"']([^`"']+)[`"']/g;
		for (const m of src.matchAll(helperRe)) {
			const helper = m[1];
			const rawPath = m[2];
			if (!helper || !rawPath) continue;
			const method = HELPER_TO_METHOD[helper];
			if (!method) continue;
			if (!rawPath.startsWith("/api/")) continue;
			requests.push({ method, path: rawPath });
		}

		// Raw fetch("...path...", { method: "GET" }) — extract any /api/... segment.
		const fetchRe = /fetch\([^)]*?["'`][^"'`]*?(\/api\/[^"'`?]+)[^"'`]*?["'`][^)]*?\)/gs;
		for (const m of src.matchAll(fetchRe)) {
			const rawPath = m[1];
			const block = m[0];
			if (!rawPath) continue;
			const methodMatch = block.match(/method:\s*["'`](\w+)["'`]/);
			const method = (methodMatch?.[1] ? methodMatch[1].toUpperCase() : "GET") as RouteMethod;
			requests.push({ method, path: rawPath });
		}
	}
	return requests;
}

// ---------------------------------------------------------------------------
// 3. Match E2E requests against declared routes
// ---------------------------------------------------------------------------

function routeToRegex(path: string): RegExp {
	const escaped = path
		.split("/")
		.map((seg) => {
			if (seg.startsWith(":")) return "[^/]+";
			return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("/");
	return new RegExp(`^${escaped}$`);
}

function normaliseRequestPath(path: string): string {
	return path.replace(/\$\{[^}]+\}/g, "x");
}

function isMatch(route: Route, request: Route): boolean {
	// Hono dispatches HEAD requests to GET handlers, so a HEAD request
	// legitimately exercises a GET route.
	const methodOk =
		route.method === request.method || (route.method === "GET" && request.method === "HEAD");
	if (!methodOk) return false;
	const re = routeToRegex(route.path);
	return re.test(normaliseRequestPath(request.path));
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

function main(): void {
	console.log("=== L2 Route Coverage Gate ===\n");

	const prefixes = loadMountPrefixes();
	const declared = [...discoverDirectRoutes(), ...discoverSubRoutes(prefixes)];
	const requests = discoverE2ERequests();

	console.log(`Declared routes: ${declared.length}`);
	console.log(`E2E requests:    ${requests.length}\n`);

	const uncovered: Route[] = [];
	for (const route of declared) {
		const hit = requests.some((req) => isMatch(route, req));
		if (!hit) uncovered.push(route);
	}

	if (uncovered.length === 0) {
		console.log(`All ${declared.length} routes have at least one E2E request.\n`);
		return;
	}

	console.error(`${uncovered.length} route(s) have NO E2E coverage:\n`);
	for (const r of uncovered) {
		console.error(`  ${r.method.padEnd(6)} ${r.path}`);
	}
	console.error("\nAdd a request in e2e/api/ for each uncovered route.\n");
	process.exit(1);
}

main();
