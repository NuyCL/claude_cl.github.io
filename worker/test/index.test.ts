import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env } from "../src/index";

const testEnv: Env = {
  LINE_CHANNEL_SECRET: "test-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-token",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
};

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

describe("worker fetch handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 when signature is invalid", async () => {
    const body = JSON.stringify({ events: [] });
    const request = new Request("https://worker.example/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": "invalid" },
      body,
    });

    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(401);
  });

  it("upserts a member on follow event and returns 200", async () => {
    const body = JSON.stringify({
      events: [{ type: "follow", source: { userId: "U123" } }],
    });
    const signature = await sign(body, testEnv.LINE_CHANNEL_SECRET);

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes("api.line.me")) {
        return new Response(JSON.stringify({ displayName: "Alice", pictureUrl: null }), {
          status: 200,
        });
      }
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const request = new Request("https://worker.example/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body,
    });

    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(200);

    const supabaseCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("test.supabase.co")
    );
    expect(supabaseCall).toBeTruthy();
  });

  it("upserts with null profile fields when LINE profile fetch fails", async () => {
    const body = JSON.stringify({
      events: [{ type: "follow", source: { userId: "U123" } }],
    });
    const signature = await sign(body, testEnv.LINE_CHANNEL_SECRET);

    const mockFetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("api.line.me")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const request = new Request("https://worker.example/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body,
    });

    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(200);

    const supabaseCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("test.supabase.co")
    );
    expect(supabaseCall).toBeTruthy();
    const requestBody = JSON.parse((supabaseCall![1] as RequestInit).body as string);
    expect(requestBody.display_name).toBeNull();
    expect(requestBody.picture_url).toBeNull();
    expect(requestBody.line_user_id).toBe("U123");
  });

  it("marks member inactive on unfollow event and returns 200", async () => {
    const body = JSON.stringify({
      events: [{ type: "unfollow", source: { userId: "U123" } }],
    });
    const signature = await sign(body, testEnv.LINE_CHANNEL_SECRET);

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mockFetch);

    const request = new Request("https://worker.example/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body,
    });

    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("line_user_id=eq.U123"),
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("returns 400 for malformed JSON body", async () => {
    const body = "not json";
    const signature = await sign(body, testEnv.LINE_CHANNEL_SECRET);

    const request = new Request("https://worker.example/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body,
    });

    const response = await worker.fetch(request, testEnv);
    expect(response.status).toBe(400);
  });
});
