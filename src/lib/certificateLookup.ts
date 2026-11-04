/**
 * Turns whatever someone pastes into the "Verify a certificate" box into a
 * certificate ID: a bare ID, an ID with stray spaces, or a full verification
 * link such as https://fynxfunded.com/certificates/verify/FYNX-CERT-0ABC123.
 * Issued IDs are upper case (FYNX-CERT-… / FYNX-LEARN-…), so those prefixes
 * are normalised to upper case; anything else is passed through as typed.
 */
export function normalizeCertificateInput(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  const fromPath = value.match(/certificates\/verify\/([^/?#\s]+)/i);
  if (fromPath) {
    try {
      value = decodeURIComponent(fromPath[1]);
    } catch {
      value = fromPath[1];
    }
  }
  value = value.replace(/\s+/g, "");
  if (/^fynx-(cert|learn)-[a-z0-9]+$/i.test(value)) value = value.toUpperCase();
  return value;
}

export function certificateVerifyPath(id: string): string {
  return `/certificates/verify/${encodeURIComponent(id)}`;
}

export function certificateVerifyUrl(id: string, origin = "https://www.fynxfunded.com"): string {
  return `${origin.replace(/\/$/, "")}${certificateVerifyPath(id)}`;
}
