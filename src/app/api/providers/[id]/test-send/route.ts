import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { getEmailProvider } from "@/lib/db/email-providers";
import {
  createProvider,
  parseProviderConfig,
  getProviderDomain,
  isDryRunEnabled,
} from "@/lib/email/provider";
import { generateId } from "@/lib/id";

const TestSendSchema = z.object({
  /**
   * Where to send the test email. Optional — defaults to the currently
   * authenticated admin's email (from the NextAuth session). Explicit
   * override is allowed so admins can verify a different mailbox.
   */
  to: z.string().email().optional(),
  /** Optional subject override for the test email. */
  subject: z.string().min(1).max(200).optional(),
  /** Optional from_name override; default is "Dove Test". */
  fromName: z.string().min(1).max(100).optional(),
  /** Optional local-part override; default is "test". */
  emailPrefix: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i, "must be a valid email local part")
    .optional(),
});

/**
 * POST /api/providers/[id]/test-send — dispatch a canned test email through
 * the chosen provider. Intended for the admin dashboard: click a button,
 * an email lands in your inbox, you can confirm the end-to-end path works.
 *
 * Recipient defaults to `session.user.email` so a signed-in admin can never
 * accidentally send a test to the wrong person. Overriding `to` is allowed
 * but still bounded by provider quotas; the test itself does NOT update
 * send_logs or the quota counter because the endpoint is explicitly
 * out-of-band from project-scoped sending (it has no project_id).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    const adminEmail = session?.user?.email;
    if (!adminEmail) {
      // proxy.ts should have redirected unauthenticated requests already,
      // but defence-in-depth: test-send never fires without an admin
      // identity.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let body: unknown = {};
    // Tolerate empty/invalid JSON: the default flow is "click button, no
    // body", so the endpoint should not 400 on a zero-length POST.
    try {
      const text = await request.text();
      if (text.length > 0) body = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = TestSendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const record = await getEmailProvider(id);
    if (!record) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }

    let provider;
    try {
      provider = await createProvider(parseProviderConfig(record));
    } catch (e) {
      return NextResponse.json(
        {
          error: "Provider config invalid",
          details: e instanceof Error ? e.message : String(e),
        },
        { status: 400 },
      );
    }

    // Honor the provider-agnostic EMAIL_DRY_RUN toggle so admins can
    // exercise the whole dashboard path locally without burning real
    // sends. The webhook /send route applies the same rule.
    if (isDryRunEnabled(record.type) && provider.supportsDryRun()) {
      provider.setDryRun(true);
    }

    const domain = getProviderDomain(record);
    const emailPrefix = parsed.data.emailPrefix ?? "test";
    const fromName = parsed.data.fromName ?? "Dove Test";
    const from = `${fromName} <${emailPrefix}@${domain}>`;
    const to = parsed.data.to ?? adminEmail;
    const subject =
      parsed.data.subject ?? `Dove test — ${record.name} (${record.type})`;

    // Fresh idempotency key per click. Test sends are not expected to
    // dedupe across retries; the caller can spam the button and every
    // click produces a distinct message.
    const idempotencyKey = `test_${generateId()}`;
    const sentAt = new Date().toISOString();
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">✅ Dove provider test</h2>
        <p>Hi ${adminEmail},</p>
        <p>This message confirms that the provider is configured correctly
        and can deliver mail end-to-end.</p>
        <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
          <tr><td style="padding: 4px 8px; color: #666;">Provider</td><td style="padding: 4px 8px;">${record.name}</td></tr>
          <tr><td style="padding: 4px 8px; color: #666;">Type</td><td style="padding: 4px 8px;">${record.type}</td></tr>
          <tr><td style="padding: 4px 8px; color: #666;">Domain</td><td style="padding: 4px 8px;">${record.domain}</td></tr>
          <tr><td style="padding: 4px 8px; color: #666;">Sent at</td><td style="padding: 4px 8px;">${sentAt}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          This is an automated test from the Dove admin dashboard.
        </p>
      </div>
    `;

    try {
      const result = await provider.send({
        from,
        to,
        subject,
        html,
        idempotencyKey,
      });
      return NextResponse.json({
        ok: true,
        id: result.id,
        to,
        from,
        sentAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "Send failed", details: message },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("Failed to run provider test-send:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
