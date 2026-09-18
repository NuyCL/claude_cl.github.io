import { describe, it, expect, vi, afterEach } from "vitest";
import { getProfile } from "../src/lineApi";

describe("getProfile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns displayName and pictureUrl on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ displayName: "Alice", pictureUrl: "https://example.com/a.jpg" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await getProfile("U123", "test-token");

    expect(result).toEqual({ displayName: "Alice", pictureUrl: "https://example.com/a.jpg" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/profile/U123",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      })
    );
  });

  it("returns null when the API call fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await getProfile("U123", "test-token");

    expect(result).toBeNull();
  });
});
