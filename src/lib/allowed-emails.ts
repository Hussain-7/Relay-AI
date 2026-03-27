/**
 * Invite-only allowlist. Only these emails can access the app.
 * Used by both middleware (route protection) and server-auth (API protection).
 */
export const ALLOWED_EMAILS = new Set(["hussain2000.rizvi@gmail.com", "syed.rizvi@trilogy.com", "test@relay-ai.local"]);

export function isEmailAllowed(email: string): boolean {
  console.log("isEmailAllowed", email, ALLOWED_EMAILS.has(email.toLowerCase()));
  return ALLOWED_EMAILS.has(email.toLowerCase());
}
