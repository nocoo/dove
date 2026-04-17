import { NextResponse } from "next/server";
import { getEmailProvider } from "@/lib/db/email-providers";
import { parseProviderConfig } from "@/lib/email/provider";

/**
 * GET /api/providers/[id]/health — surface config sanity for the dashboard.
 *
 * What this checks:
 *   - configValid: parseProviderConfig() accepts the stored config shape
 *   - reachable: for Cloudflare, GET {worker_url}/health returns 200.
 *                For Resend, we skip a live probe (costs a real API call
 *                + would require burning the api_key just to ping); this
 *                field is `null` for resend.
 *
 * The endpoint is best-effort — a 200 response here does not guarantee a
 * subsequent send will succeed (DNS could flap, quota could be exhausted),
 * but it catches the common misconfiguration modes (missing worker_url,
 * malformed config JSON, typo'd worker URL) before the caller ever tries
 * to send.
 */
const REACHABILITY_TIMEOUT_MS = 5000;

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

    let configValid = true;
    let configError: string | null = null;
    let parsed: ReturnType<typeof parseProviderConfig> | null = null;
    try {
      parsed = parseProviderConfig(row);
    } catch (e) {
      configValid = false;
      configError = e instanceof Error ? e.message : String(e);
    }

    let reachable: boolean | null = null;
    let reachableError: string | null = null;

    // Only Cloudflare exposes a cheap health probe. Skipping Resend keeps
    // the endpoint free to call from the UI without burning real quota.
    if (configValid && parsed && parsed.type === "cloudflare") {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REACHABILITY_TIMEOUT_MS,
      );
      try {
        const res = await fetch(`${parsed.worker_url}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        reachable = res.ok;
        if (!res.ok) {
          reachableError = `Worker /health returned ${res.status}`;
        }
      } catch (e) {
        reachable = false;
        reachableError =
          e instanceof Error ? e.message : "Failed to reach worker";
      } finally {
        clearTimeout(timer);
      }
    }

    const healthy =
      configValid && (reachable === null || reachable === true);

    return NextResponse.json({
      id: row.id,
      type: row.type,
      domain: row.domain,
      healthy,
      configValid,
      configError,
      reachable,
      reachableError,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to run provider health check:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
