import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  listEmailProviders,
  createEmailProvider,
} from "@/lib/db/email-providers";
import { sanitizeProvider } from "@/lib/sanitize";

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
 * The config object is JSON-serialized before storage; the response is
 * sanitized (api_key masked).
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
    const created = await createEmailProvider({
      name,
      type,
      domain,
      config: JSON.stringify(config),
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
