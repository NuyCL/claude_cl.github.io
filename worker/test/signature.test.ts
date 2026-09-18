import { describe, it, expect } from "vitest";
import { verifySignature } from "../src/signature";

describe("verifySignature", () => {
  const channelSecret = "test-secret";

  it("returns true for a correctly signed body", async () => {
    const body = '{"events":[]}';
    // Precomputed HMAC-SHA256(body, "test-secret") base64
    const validSignature = await computeHmacBase64(channelSecret, body);
    const result = await verifySignature(body, validSignature, channelSecret);
    expect(result).toBe(true);
  });

  it("returns false for an incorrect signature", async () => {
    const body = '{"events":[]}';
    const result = await verifySignature(body, "bm90LXZhbGlk", channelSecret);
    expect(result).toBe(false);
  });

  it("returns false for a missing signature", async () => {
    const body = '{"events":[]}';
    const result = await verifySignature(body, "", channelSecret);
    expect(result).toBe(false);
  });
});

async function computeHmacBase64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}
