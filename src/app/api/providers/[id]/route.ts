import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  getEmailProvider,
  updateEmailProvider,
  deleteEmailProvider,
  countProjectsByProvider,
} from "@/lib/db/email-providers";
import { sanitizeProvider } from "@/lib/sanitize";
import { parseConfigForType } from "@/lib/email/provider-schema";

const UpdateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["resend", "cloudflare"]).optional(),
  domain: z.string().min(1).max(253).optional(),
  config: z.record(z.string(), z.string()).optional(),
});

/**
 * GET /api/providers/[id] — Get a single provider (sanitized).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await getEmailProvider(id);
    if (!row) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(sanitizeProvider(row));
  } catch (error) {
    console.error("Failed to get provider:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/providers/[id] — Update a provider.
 *
 * When the config is being changed, it's re-validated against the
 * effective provider type (the incoming `type` if provided, else the
 * existing record's type) so a Cloudflare provider can't be rewritten
 * into an invalid state.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = UpdateProviderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { config, type, ...rest } = parsed.data;

    let normalizedConfig: string | undefined;
    if (config !== undefined) {
      const existing = await getEmailProvider(id);
      if (!existing) {
        return NextResponse.json(
          { error: "Provider not found" },
          { status: 404 },
        );
      }
      const effectiveType = type ?? existing.type;
      const configResult = parseConfigForType(effectiveType, config);
      if (!configResult.success) {
        return NextResponse.json(
          {
            error: "Invalid provider config",
            details: configResult.error.flatten(),
          },
          { status: 400 },
        );
      }
      normalizedConfig = JSON.stringify(configResult.data);
    }

    const updated = await updateEmailProvider(id, {
      ...rest,
      type,
      config: normalizedConfig,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(sanitizeProvider(updated));
  } catch (error) {
    console.error("Failed to update provider:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/providers/[id] — Delete a provider.
 *
 * Blocked with 409 provider_in_use when at least one project still
 * references this provider. The caller must reassign those projects
 * before deletion.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const inUse = await countProjectsByProvider(id);
    if (inUse > 0) {
      return NextResponse.json(
        {
          error: {
            code: "provider_in_use",
            message: `Provider is referenced by ${inUse} project(s). Reassign them before deleting.`,
          },
        },
        { status: 409 },
      );
    }

    const deleted = await deleteEmailProvider(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete provider:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
