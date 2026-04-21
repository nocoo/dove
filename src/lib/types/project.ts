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
  created_at: string;
  updated_at: string;
}
