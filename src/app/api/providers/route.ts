import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  listEmailProviders,
  createEmailProvider,
} from "@/lib/db/email-providers";
import { sanitizeProvider } from "@/lib/sanitize";
import { parseConfigForType } from "@/lib/email/provider-schema";

const CreateProviderSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["resend", "cloudflare"]),
  domain: z.string().min(1).max(253),
  config: z.record(z.string(), z.string()),
});

/**
 * GET /api/providers — List all email providers (sanitized).
 */
export async function GET() {
  try {
    const rows = await listEmailProviders();
    return NextResponse.json(rows.map(sanitizeProvider));
  } catch (error) {
    console.error("Failed to list providers:", error);
    return NextResponse.json(
      { error: "Failed to list providers" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/providers — Create a new email provider.
 *
 * Validation runs in two stages: the outer envelope (name, type, domain,
 * config object shape) is checked here, then the config is re-parsed
 * against the type-specific schema so, e.g., a Cloudflare provider
 * without worker_url is rejected with 400 rather than surfacing as a
 * 500 provider_config_invalid at send time.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = CreateProviderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, type, domain, config } = parsed.data;

    const configResult = parseConfigForType(type, config);
    if (!configResult.success) {
      return NextResponse.json(
        {
          error: "Invalid provider config",
          details: configResult.error.flatten(),
        },
        { status: 400 },
      );
    }

    const created = await createEmailProvider({
      name,
      type,
      domain,
      config: JSON.stringify(configResult.data),
    });
    return NextResponse.json(sanitizeProvider(created), { status: 201 });
  } catch (error) {
    console.error("Failed to create provider:", error);
    return NextResponse.json(
      { error: "Failed to create provider" },
      { status: 500 },
    );
  }
}
