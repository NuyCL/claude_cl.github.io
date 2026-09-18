export async function verifySignature(
  body: string,
  signatureHeader: string,
  channelSecret: string
): Promise<boolean> {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  return computed === signatureHeader;
}
