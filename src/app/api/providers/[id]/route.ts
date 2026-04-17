import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  getEmailProvider,
  updateEmailProvider,
  deleteEmailProvider,
  countProjectsByProvider,
} from "@/lib/db/email-providers";
import { sanitizeProvider } from "@/lib/sanitize";
import { parseConfigForType, DomainSchema } from "@/lib/email/provider-schema";

const UpdateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["resend", "cloudflare"]).optional(),
  domain: DomainSchema.optional(),
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

    // Re-validate config whenever either `type` or `config` is moving.
    // Type-only transitions are the subtle case: without re-validation,
    // updateEmailProvider() preserves the old stored config, which may be
    // structurally incompatible with the new type (e.g. switching resend →
    // cloudflare while keeping `{api_key}` and no `worker_url`). The record
    // would appear valid until webhook send time, then blow up.
    let normalizedConfig: string | undefined;
    if (config !== undefined || type !== undefined) {
      const existing = await getEmailProvider(id);
      if (!existing) {
        return NextResponse.json(
          { error: "Provider not found" },
          { status: 404 },
        );
      }
      const effectiveType = type ?? existing.type;

      if (config !== undefined) {
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
      } else if (type !== undefined && type !== existing.type) {
        // Type changed but caller didn't supply a new config. Re-check the
        // stored config against the new type's schema. If incompatible,
        // reject so the caller must provide a matching config explicitly.
        let storedConfig: unknown;
        try {
          storedConfig = JSON.parse(existing.config);
        } catch {
          return NextResponse.json(
            {
              error:
                "Stored config is malformed; supply a new `config` compatible with the target type.",
            },
            { status: 400 },
          );
        }
        const configResult = parseConfigForType(effectiveType, storedConfig);
        if (!configResult.success) {
          return NextResponse.json(
            {
              error:
                "Stored config is incompatible with the target type; supply a new `config` along with `type`.",
              details: configResult.error.flatten(),
            },
            { status: 400 },
          );
        }
        // Stored config happens to already satisfy the new type's schema
        // (e.g. nothing required changed). Re-serialize through the parsed
        // shape to drop any extraneous keys that slipped in historically.
        normalizedConfig = JSON.stringify(configResult.data);
      }
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
