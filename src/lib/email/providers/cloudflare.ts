import type { EmailProvider, SendParams, SendResult } from "../provider";

declare const EmailMessage: {
  new (from: string, to: string, raw: ReadableStream): { from: string; to: string };
};

export class CloudflareProvider implements EmailProvider {
  readonly type = "cloudflare" as const;

  constructor(private readonly emailBinding: SendEmail) {}

  supportsDryRun(): boolean {
    return false;
  }

  setDryRun(): void {}

  async send(params: SendParams): Promise<SendResult> {
    const fromAddr = extractAddress(params.from);
    const fromName = extractName(params.from);

    const boundary = "----cf" + crypto.randomUUID().replace(/-/g, "");
    const rawEmail = [
      `From: ${fromName ? `${fromName} <${fromAddr}>` : fromAddr}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      params.html,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    const msg = new EmailMessage(fromAddr, params.to, new Blob([rawEmail]).stream());
    await this.emailBinding.send(msg);

    return { id: crypto.randomUUID() };
  }
}

export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match?.[1]?.trim() ?? "";
}

export function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? from.trim();
}
