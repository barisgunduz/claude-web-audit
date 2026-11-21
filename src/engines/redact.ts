/** Replaces every occurrence of a secret in a text. An empty or missing secret changes nothing. */
export function redactSecret(text: string, secret: string | undefined): string {
  const value = secret?.trim() ?? '';
  if (value === '') return text;
  // The key may also appear percent-encoded in a URL.
  return text.split(value).join('[redacted]').split(encodeURIComponent(value)).join('[redacted]');
}
