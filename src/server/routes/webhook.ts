import { Hono } from "hono";
import { z } from "zod/v4";
import type { Env } from "../env";
import { getProject } from "../lib/db/projects";
import { getRecipient, getRecipientByEmail } from "../lib/db/recipients";
import { constantTimeEqual } from "../lib/constant-time";
import { getTemplateBySlug, listTemplates, parseVariables } from "../lib/db/templates";
import {
  findByIdempotencyKey,
  createSendLog,
  resetSendLogForRetry,
  updateSendLogProvider,
  markSendLogSent,
  markSendLogFailed,
  type ProviderType,
} from "../lib/db/send-logs";
import { createWebhookLog } from "../lib/db/webhook-logs";
import { getEmailProvider } from "../lib/db/email-providers";
import { checkQuota } from "../lib/email/quota";
import { renderTemplate } from "../lib/email/render";
import {
  createProvider,
  createLegacyProvider,
  parseProviderConfig,
  getProviderDomain,
  type EmailProvider,
} from "../lib/email/provider";
import { IdempotentSendResult } from "@/lib/email/providers/cloudflare";

const webhook = new Hono<{ Bindings: Env }>();

const SendSchema = z.object({
  template: z.string().min(1),
  to: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

function errorJson(code: string, message: string) {
  return { error: { code, message } };
}

async function computePayloadHash(payload: {
  template: string;
  to: string;
  variables?: Record<string, string> | undefined;
}): Promise<string> {
  const sortedVars = Object.fromEntries(
    Object.entries(payload.variables ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const canonical = JSON.stringify({
    template: payload.template,
    to: payload.to,
    variables: sortedVars,
  });
  const data = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

webhook.get("/:projectId", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.body(null, 401);
  }
  const token = authHeader.slice(7);
  const project = await getProject(c.env.DB, c.req.param("projectId"));
  if (!project || !constantTimeEqual(project.webhook_token, token)) {
    return c.body(null, 403);
  }
  return c.body(null, 200);
});

webhook.get("/:projectId/templates", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(errorJson("auth_missing", "Missing Authorization header"), 401);
  }
  const token = authHeader.slice(7);
  const project = await getProject(c.env.DB, c.req.param("projectId"));
  if (!project || !constantTimeEqual(project.webhook_token, token)) {
    return c.json(errorJson("auth_invalid", "Invalid token or project not found"), 403);
  }

  const templates = await listTemplates(c.env.DB, c.req.param("projectId"));
  return c.json(
    templates.map((t) => ({
      slug: t.slug,
      name: t.name,
      subject: t.subject,
      variables: t.variables,
    })),
  );
});

webhook.post("/:projectId/send", async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param("projectId");
  const db = c.env.DB;
  const path = `/api/webhook/${projectId}/send`;
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = c.req.header("user-agent") ?? null;

  const logAndRespond = (
    statusCode: number,
    body: unknown,
    errorCode?: string,
    errorMessage?: string,
  ) => {
    const duration = Date.now() - startTime;
    c.executionCtx.waitUntil(createWebhookLog(db, {
      project_id: projectId,
      method: "POST",
      path,
      status_code: statusCode,
      error_code: errorCode,
      error_message: errorMessage,
      duration_ms: duration,
      ip: ip ?? undefined,
      user_agent: userAgent ?? undefined,
    }));
    return c.json(body as Record<string, unknown>, statusCode as 200);
  };

  try {
    // Step 1: Auth
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return logAndRespond(401, errorJson("auth_missing", "Missing Authorization header"), "auth_missing");
    }

    const token = authHeader.slice(7);
    const project = await getProject(db, projectId);
    if (!project || !constantTimeEqual(project.webhook_token, token)) {
      return logAndRespond(403, errorJson("auth_invalid", "Invalid token or project not found"), "auth_invalid");
    }

    // Step 2: Parse
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return logAndRespond(400, errorJson("body_invalid", "Invalid JSON body"), "body_invalid");
    }

    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return logAndRespond(400, errorJson("body_invalid", "Request body validation failed"), "body_invalid", parsed.error.message);
    }

    const { template: templateSlug, to, variables: providedVars } = parsed.data;
    const idempotencyKey = parsed.data.idempotency_key;

    // Step 3: Dedup
    let existingSendLog: Awaited<ReturnType<typeof findByIdempotencyKey>> | undefined;
    if (idempotencyKey) {
      existingSendLog = await findByIdempotencyKey(db, projectId, idempotencyKey);
      if (existingSendLog) {
        const payloadHash = await computePayloadHash({ template: templateSlug, to, variables: providedVars });
        if (existingSendLog.payload_hash && existingSendLog.payload_hash !== payloadHash) {
          return logAndRespond(422, errorJson("idempotency_payload_mismatch", "Same idempotency_key but different request payload. Use a new key to send a different payload."), "idempotency_payload_mismatch");
        }
        if (existingSendLog.status === "sent") {
          const cachedMessageId = existingSendLog.provider_message_id ?? existingSendLog.resend_id;
          return logAndRespond(200, {
            id: existingSendLog.id,
            resend_id: existingSendLog.resend_id,
            provider_message_id: cachedMessageId,
            provider_type: existingSendLog.provider_type ?? "legacy",
            status: "sent",
          });
        }
        if (existingSendLog.status === "sending") {
          return logAndRespond(409, errorJson("send_in_progress", "This request is already being processed"), "send_in_progress");
        }
      }
    }

    // Step 4: Quota
    const quotaResult = await checkQuota(db, project);
    if (!quotaResult.allowed) {
      const code = quotaResult.error_code ?? "quota_daily_exceeded";
      const msg = code === "quota_daily_exceeded"
        ? `Daily send limit (${project.quota_daily}) exceeded`
        : `Monthly send limit (${project.quota_monthly}) exceeded`;
      return logAndRespond(429, errorJson(code, msg), code);
    }

    // Step 5: Recipient
    //
    // Two modes:
    //   (a) default — `recipients` whitelist enforced. Lookup by email or by
    //       recipient id (the latter is tenancy-scoped via project_id check).
    //   (b) `allow_unknown_recipients=1` — the project owns its own user
    //       directory and verifies recipients itself (e.g. the ellie email
    //       verification flow). We accept any RFC-valid email and forge an
    //       ephemeral recipient object for the rest of the pipeline. The id
    //       form (no `@`) is REJECTED in this mode — there's no recipients
    //       table entry to look up, and treating the literal as "an id"
    //       would silently bypass the email-format gate.
    let recipient;
    if (project.allow_unknown_recipients) {
      if (!to.includes("@") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return logAndRespond(
          400,
          errorJson("recipient_invalid", "Recipient must be a valid email address"),
          "recipient_invalid",
        );
      }
      // Ephemeral, NOT persisted. recipient_id stays null on send_logs.
      recipient = {
        id: null as unknown as string,
        project_id: projectId,
        name: "",
        email: to.trim().toLowerCase(),
        created_at: new Date().toISOString(),
      };
    } else if (to.includes("@")) {
      recipient = await getRecipientByEmail(db, projectId, to);
    } else {
      recipient = await getRecipient(db, to);
      if (recipient && recipient.project_id !== projectId) {
        recipient = undefined;
      }
    }
    if (!recipient) {
      return logAndRespond(404, errorJson("recipient_not_found", "Recipient not found in project whitelist"), "recipient_not_found");
    }

    // Step 6: Template
    const template = await getTemplateBySlug(db, projectId, templateSlug);
    if (!template) {
      return logAndRespond(404, errorJson("template_not_found", "Template slug not found in project"), "template_not_found");
    }

    // Step 7+8: Validate + Render
    const schema = parseVariables(template);
    let rendered: { subject: string; html: string };
    try {
      rendered = await renderTemplate(template.subject, template.body_markdown, schema, providedVars ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Variable validation failed";
      return logAndRespond(422, errorJson("variables_invalid", message), "variables_invalid", message);
    }

    // Step 9: Pre-log
    let sendLog;
    if (existingSendLog && existingSendLog.status === "failed") {
      await resetSendLogForRetry(db, existingSendLog.id, {
        to_email: recipient.email,
        subject: rendered.subject,
      });
      sendLog = { ...existingSendLog, status: "sending" as const, to_email: recipient.email, subject: rendered.subject };
    } else {
      const payloadHash = idempotencyKey
        ? await computePayloadHash({ template: templateSlug, to, variables: providedVars })
        : undefined;
      sendLog = await createSendLog(db, {
        project_id: projectId,
        idempotency_key: idempotencyKey,
        payload_hash: payloadHash,
        template_id: template.id,
        recipient_id: recipient.id,
        to_email: recipient.email,
        subject: rendered.subject,
      });
    }

    // Step 10: Resolve provider
    let provider: EmailProvider;
    let providerRecord: Awaited<ReturnType<typeof getEmailProvider>> | null = null;
    let providerType: ProviderType;

    try {
      if (project.provider_id) {
        const record = await getEmailProvider(db, project.provider_id);
        if (!record) {
          await markSendLogFailed(db, sendLog.id, "Provider not found");
          return logAndRespond(500, errorJson("provider_not_found", "Configured email provider not found"), "provider_not_found");
        }
        providerRecord = record;
        provider = await createProvider(parseProviderConfig(record), c.env.EMAIL, c.env.DB);
        providerType = record.type;
      } else {
        provider = await createLegacyProvider(c.env);
        providerType = "legacy";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider init failed";
      await markSendLogFailed(db, sendLog.id, message);
      return logAndRespond(500, errorJson("provider_config_invalid", message), "provider_config_invalid", message);
    }

    let domain: string;
    try {
      domain = getProviderDomain(providerRecord, c.env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Domain resolution failed";
      await markSendLogFailed(db, sendLog.id, message);
      return logAndRespond(500, errorJson("internal_error", "Email sender not configured"), "internal_error");
    }

    const fromAddress = `${project.from_name} <${project.email_prefix}@${domain}>`;

    await updateSendLogProvider(db, sendLog.id, {
      provider_id: providerRecord?.id ?? null,
      provider_type: providerType,
    });

    try {
      const result = await provider.send({
        from: fromAddress,
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        idempotencyKey: sendLog.id,
      });

      // Step 11: Mark sent
      await markSendLogSent(db, sendLog.id, {
        providerMessageId: result.id,
        providerType,
      });

      // Step 12: Response
      return logAndRespond(200, {
        id: sendLog.id,
        resend_id: providerType === "cloudflare" ? null : result.id,
        provider_message_id: result.id,
        provider_type: providerType,
        status: "sent",
      });
    } catch (error) {
      if (error instanceof IdempotentSendResult) {
        await markSendLogSent(db, sendLog.id, {
          providerMessageId: error.idempotencyKey,
          providerType,
        });
        return logAndRespond(200, {
          id: sendLog.id,
          resend_id: null,
          provider_message_id: error.idempotencyKey,
          provider_type: providerType,
          status: "sent",
        });
      }
      const message = error instanceof Error ? error.message : "Provider send failed";
      await markSendLogFailed(db, sendLog.id, message);
      const errCode = providerType === "cloudflare" ? "cloudflare_failed" : "resend_failed";
      return logAndRespond(502, errorJson(errCode, message), errCode, message);
    }
  } catch (error) {
    console.error("Webhook send unexpected error:", error);
    return logAndRespond(500, errorJson("internal_error", "Unexpected server error"), "internal_error", error instanceof Error ? error.message : undefined);
  }
});

export { webhook };
