/**
 * ID generation utilities using nanoid.
 */

import { nanoid } from "nanoid";

/** Generate a resource ID (21 chars, URL-safe). */
export function generateId(): string {
  return nanoid();
}

/** Generate a webhook token (48 chars for higher entropy). */
export function generateWebhookToken(): string {
  return nanoid(48);
}
