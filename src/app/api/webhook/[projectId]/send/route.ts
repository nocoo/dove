import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getProject } from "@/lib/db/projects";
import { getRecipient, getRecipientByEmail } from "@/lib/db/recipients";
import { getTemplateBySlug, parseVariables } from "@/lib/db/templates";
import {
  findByIdempotencyKey,
  createSendLog,
  resetSendLogForRetry,
  markSendLogSent,
  markSendLogFailed,
} from "@/lib/db/send-logs";
import { createWebhookLog } from "@/lib/db/webhook-logs";
import { checkQuota } from "@/lib/email/quota";
import { renderTemplate } from "@/lib/email/render";
import { sendEmail } from "@/lib/email/resend";

const SendSchema = z.object({
  template: z.string().min(1),
  to: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Compute SHA-256 hash of canonical payload for idempotency fingerprint.
 */
async function computePayloadHash(payload: {
  template: string;
  to: string;
  variables?: Record<string, string> | undefined;
}): Promise<string> {
  const canonical = JSON.stringify({
    template: payload.template,
    to: payload.to,
    variables: payload.variables ?? {},
  }, Object.keys({ template: "", to: "", variables: {} }).sort());

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * POST /api/webhook/[projectId]/send — Core: send email.
 *
 * Implements the 12-step processing pipeline from the architecture doc.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const startTime = Date.now();
  const { projectId } = await params;
  const path = `/api/webhook/${projectId}/send`;
  const method = "POST";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent") ?? null;

  // Helper to log webhook and return response
  const respond = (
    response: NextResponse,
    statusCode: number,
    errorCode?: string,
    errorMessage?: string,
  ): NextResponse => {
    const duration = Date.now() - startTime;
    // Fire-and-forget webhook log
    void createWebhookLog({
      project_id: projectId,
      method,
      path,
      status_code: statusCode,
      error_code: errorCode,
      error_message: errorMessage,
      duration_ms: duration,
      ip: ip ?? undefined,
      user_agent: userAgent ?? undefined,
    });
    return response;
  };

  try {
    // Step 1: Auth — Validate Bearer token, match projectId
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond(
        errorResponse("auth_missing", "Missing Authorization header", 401),
        401,
        "auth_missing",
      );
    }

    const token = authHeader.slice(7);
    const project = await getProject(projectId);

    if (!project || project.webhook_token !== token) {
      return respond(
        errorResponse("auth_invalid", "Invalid token or project not found", 403),
        403,
        "auth_invalid",
      );
    }

    // Step 2: Parse — Validate request body (Zod)
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond(
        errorResponse("body_invalid", "Invalid JSON body", 400),
        400,
        "body_invalid",
      );
    }

    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return respond(
        errorResponse("body_invalid", "Request body validation failed", 400),
        400,
        "body_invalid",
        parsed.error.message,
      );
    }

    const { template: templateSlug, to, variables: providedVars } = parsed.data;
    const idempotencyKey = parsed.data.idempotency_key;

    // Step 3: Dedup — If idempotency_key provided, check existing
    let existingSendLog: Awaited<ReturnType<typeof findByIdempotencyKey>> | undefined;

    if (idempotencyKey) {
      existingSendLog = await findByIdempotencyKey(projectId, idempotencyKey);

      if (existingSendLog) {
        // Verify payload hash matches
        const payloadHash = await computePayloadHash({
          template: templateSlug,
          to,
          variables: providedVars,
        });

        if (existingSendLog.payload_hash && existingSendLog.payload_hash !== payloadHash) {
          return respond(
            errorResponse(
              "idempotency_payload_mismatch",
              "Same idempotency_key but different request payload. Use a new key to send a different payload.",
              422,
            ),
            422,
            "idempotency_payload_mismatch",
          );
        }

        // Already sent — return cached result
        if (existingSendLog.status === "sent") {
          return respond(
            NextResponse.json({
              id: existingSendLog.id,
              resend_id: existingSendLog.resend_id,
              status: "sent",
            }),
            200,
          );
        }

        // Currently sending — return conflict
        if (existingSendLog.status === "sending") {
          return respond(
            errorResponse("send_in_progress", "This request is already being processed", 409),
            409,
            "send_in_progress",
          );
        }

        // Failed — will retry from step 4 using existing record
      }
    }

    // Step 4: Quota check
    const quotaResult = await checkQuota(project);
    if (!quotaResult.allowed) {
      return respond(
        errorResponse(
          quotaResult.error_code ?? "quota_daily_exceeded",
          quotaResult.error_code === "quota_daily_exceeded"
            ? `Daily send limit (${project.quota_daily}) exceeded`
            : `Monthly send limit (${project.quota_monthly}) exceeded`,
          429,
        ),
        429,
        quotaResult.error_code,
      );
    }

    // Step 5: Recipient — Resolve "to" against project's recipient whitelist
    let recipient;
    if (to.includes("@")) {
      recipient = await getRecipientByEmail(projectId, to);
    } else {
      recipient = await getRecipient(to);
      // Ensure recipient belongs to this project
      if (recipient && recipient.project_id !== projectId) {
        recipient = undefined;
      }
    }

    if (!recipient) {
      return respond(
        errorResponse("recipient_not_found", "Recipient not found in project whitelist", 404),
        404,
        "recipient_not_found",
      );
    }

    // Step 6: Template — Find by slug in project
    const template = await getTemplateBySlug(projectId, templateSlug);
    if (!template) {
      return respond(
        errorResponse("template_not_found", "Template slug not found in project", 404),
        404,
        "template_not_found",
      );
    }

    // Step 7: Validate variables
    const schema = parseVariables(template);

    // Step 8: Render
    let rendered: { subject: string; html: string };
    try {
      rendered = await renderTemplate(
        template.subject,
        template.body_markdown,
        schema,
        providedVars ?? {},
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Variable validation failed";
      return respond(
        errorResponse("variables_invalid", message, 422),
        422,
        "variables_invalid",
        message,
      );
    }

    // Step 9: Pre-log — Create or reset send_log
    let sendLog;
    if (existingSendLog && existingSendLog.status === "failed") {
      // Reuse existing record for retry
      await resetSendLogForRetry(existingSendLog.id, {
        to_email: recipient.email,
        subject: rendered.subject,
      });
      sendLog = { ...existingSendLog, status: "sending" as const, to_email: recipient.email, subject: rendered.subject };
    } else {
      const payloadHash = idempotencyKey
        ? await computePayloadHash({ template: templateSlug, to, variables: providedVars })
        : undefined;

      sendLog = await createSendLog({
        project_id: projectId,
        idempotency_key: idempotencyKey,
        payload_hash: payloadHash,
        template_id: template.id,
        recipient_id: recipient.id,
        to_email: recipient.email,
        subject: rendered.subject,
      });
    }

    // Step 10: Send — POST to Resend API
    const fromDomain = process.env.RESEND_FROM_DOMAIN;
    if (!fromDomain) {
      await markSendLogFailed(sendLog.id, "RESEND_FROM_DOMAIN not configured");
      return respond(
        errorResponse("internal_error", "Email sender not configured", 500),
        500,
        "internal_error",
      );
    }

    const fromAddress = `${project.from_name} <${project.email_prefix}@${fromDomain}>`;

    try {
      const result = await sendEmail({
        from: fromAddress,
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        idempotencyKey: sendLog.id,
      });

      // Step 11: Update log — sent
      await markSendLogSent(sendLog.id, result.id);

      // Step 12: Response
      return respond(
        NextResponse.json({
          id: sendLog.id,
          resend_id: result.id,
          status: "sent",
        }),
        200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resend API error";
      await markSendLogFailed(sendLog.id, message);
      return respond(
        errorResponse("resend_failed", "Failed to send email via Resend", 502),
        502,
        "resend_failed",
        message,
      );
    }
  } catch (error) {
    console.error("Webhook send unexpected error:", error);
    return respond(
      errorResponse("internal_error", "Unexpected server error", 500),
      500,
      "internal_error",
      error instanceof Error ? error.message : undefined,
    );
  }
}
