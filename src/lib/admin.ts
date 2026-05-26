export const OWNER_ADMIN_EMAILS = ["ha6876122@gmail.com", "fynxteam5@gmail.com"] as const;

export function isOwnerAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return OWNER_ADMIN_EMAILS.includes(email.toLowerCase() as (typeof OWNER_ADMIN_EMAILS)[number]);
}
