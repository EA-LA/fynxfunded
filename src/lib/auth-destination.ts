// Never redirect to external URLs, auth loops or arbitrary user-supplied paths.
export function safeAuthDestination(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000 || /[\\\r\n]/.test(value)) return null;
  if (!/^\/(trade(?:\/access)?|dashboard(?:\/[A-Za-z0-9_/-]+)?|checkout(?:\/success)?|order-status)(?:\?[^#]*)?$/.test(value)) return null;
  return value;
}
export const authDestinationFromSearch = (search: string) => safeAuthDestination(new URLSearchParams(search).get('next'));
export const loginPath = (destination: string) => `/login?next=${encodeURIComponent(safeAuthDestination(destination) || '/dashboard')}`;
