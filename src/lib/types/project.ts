export interface Project {
	id: string;
	name: string;
	description: string | null;
	email_prefix: string;
	from_name: string;
	webhook_token: string;
	quota_daily: number;
	quota_monthly: number;
	provider_id: string | null;
	/**
	 * When true (stored as 1 in D1), the webhook send endpoint skips the
	 * project-recipient whitelist check and accepts any RFC-valid email.
	 * Default false. Intended for projects that own their own user model and
	 * verify recipients themselves (e.g. ellie's email-verification flow).
	 */
	allow_unknown_recipients: boolean;
	created_at: string;
	updated_at: string;
}
