import { Hono } from "hono";
import { z } from "zod/v4";
import { DomainSchema, parseConfigForType } from "@/lib/email/provider-schema";
import type { Env } from "../env";
import {
	countProjectsByProvider,
	createEmailProvider,
	deleteEmailProvider,
	getEmailProvider,
	listEmailProviders,
	updateEmailProvider,
} from "../lib/db/email-providers";
import { getProviderSendStats } from "../lib/db/send-logs";
import { parseProviderConfig } from "../lib/email/provider";
import { sanitizeProvider } from "../lib/sanitize";

const providers = new Hono<{ Bindings: Env }>();

const CreateProviderSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(["resend", "cloudflare"]),
	domain: DomainSchema,
	config: z.record(z.string(), z.string()),
});

const UpdateProviderSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	type: z.enum(["resend", "cloudflare"]).optional(),
	domain: DomainSchema.optional(),
	config: z.record(z.string(), z.string()).optional(),
});

providers.get("/", async (c) => {
	const rows = await listEmailProviders(c.env.DB);
	return c.json(rows.map(sanitizeProvider));
});

providers.post("/", async (c) => {
	const body = await c.req.json();
	const parsed = CreateProviderSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
	}

	const { name, type, domain, config } = parsed.data;
	const configResult = parseConfigForType(type, config);
	if (!configResult.success) {
		return c.json({ error: "Invalid provider config", details: configResult.error.flatten() }, 400);
	}

	const created = await createEmailProvider(c.env.DB, {
		name,
		type,
		domain,
		config: JSON.stringify(configResult.data),
	});
	return c.json(sanitizeProvider(created), 201);
});

providers.get("/:id", async (c) => {
	const row = await getEmailProvider(c.env.DB, c.req.param("id"));
	if (!row) return c.json({ error: "Provider not found" }, 404);
	return c.json(sanitizeProvider(row));
});

providers.put("/:id", async (c) => {
	const body = await c.req.json();
	const parsed = UpdateProviderSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
	}

	const { config, type, ...rest } = parsed.data;
	let normalizedConfig: string | undefined;

	if (config !== undefined || type !== undefined) {
		const existing = await getEmailProvider(c.env.DB, c.req.param("id"));
		if (!existing) return c.json({ error: "Provider not found" }, 404);

		const effectiveType = type ?? existing.type;

		if (config !== undefined) {
			const configResult = parseConfigForType(effectiveType, config);
			if (!configResult.success) {
				return c.json(
					{ error: "Invalid provider config", details: configResult.error.flatten() },
					400,
				);
			}
			normalizedConfig = JSON.stringify(configResult.data);
		} else if (type !== undefined && type !== existing.type) {
			let storedConfig: unknown;
			try {
				storedConfig = JSON.parse(existing.config);
			} catch {
				return c.json(
					{
						error:
							"Stored config is malformed; supply a new `config` compatible with the target type.",
					},
					400,
				);
			}
			const configResult = parseConfigForType(effectiveType, storedConfig);
			if (!configResult.success) {
				return c.json(
					{
						error:
							"Stored config is incompatible with the target type; supply a new `config` along with `type`.",
						details: configResult.error.flatten(),
					},
					400,
				);
			}
			normalizedConfig = JSON.stringify(configResult.data);
		}
	}

	const updated = await updateEmailProvider(c.env.DB, c.req.param("id"), {
		...rest,
		type,
		config: normalizedConfig,
	});
	if (!updated) return c.json({ error: "Provider not found" }, 404);
	return c.json(sanitizeProvider(updated));
});

providers.delete("/:id", async (c) => {
	const inUse = await countProjectsByProvider(c.env.DB, c.req.param("id"));
	if (inUse > 0) {
		return c.json(
			{
				error: {
					code: "provider_in_use",
					message: `Provider is referenced by ${inUse} project(s). Reassign them before deleting.`,
				},
			},
			409,
		);
	}

	const deleted = await deleteEmailProvider(c.env.DB, c.req.param("id"));
	if (!deleted) return c.json({ error: "Provider not found" }, 404);
	return c.body(null, 204);
});

providers.get("/:id/health", async (c) => {
	const row = await getEmailProvider(c.env.DB, c.req.param("id"));
	if (!row) return c.json({ error: "Provider not found" }, 404);

	let configValid = true;
	let configError: string | null = null;
	try {
		parseProviderConfig(row);
	} catch (e) {
		configValid = false;
		configError = e instanceof Error ? e.message : String(e);
	}

	const reachable: boolean | null = null;
	const reachableError: string | null = null;

	const stats = await getProviderSendStats(c.env.DB, row.id);
	const lastSendHealth =
		stats.total > 0
			? {
					total: stats.total,
					sent: stats.sent,
					failed: stats.failed,
					successRate: stats.sent / stats.total,
				}
			: null;

	const l3Degraded =
		lastSendHealth !== null && lastSendHealth.total >= 5 && lastSendHealth.successRate < 0.5;
	const healthy = configValid && !l3Degraded;

	return c.json({
		id: row.id,
		type: row.type,
		domain: row.domain,
		healthy,
		configValid,
		configError,
		reachable,
		reachableError,
		lastSendHealth,
		checkedAt: new Date().toISOString(),
	});
});

export { providers };
