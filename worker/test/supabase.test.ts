import { describe, it, expect, vi, afterEach } from "vitest";
import { upsertFollowedMember, markUnfollowed } from "../src/supabase";

const config = {
  supabaseUrl: "https://test.supabase.co",
  serviceRoleKey: "test-key",
};

describe("upsertFollowedMember", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an upsert to the line_members table", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", mockFetch);

    await upsertFollowedMember(
      { lineUserId: "U123", displayName: "Alice", pictureUrl: "https://x/a.jpg" },
      config
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/rest/v1/line_members",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "test-key",
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        }),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      line_user_id: "U123",
      display_name: "Alice",
      picture_url: "https://x/a.jpg",
      status: "active",
    });
  });

  it("throws when the request fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      upsertFollowedMember({ lineUserId: "U123", displayName: null, pictureUrl: null }, config)
    ).rejects.toThrow("Supabase upsert failed");
  });
});

describe("markUnfollowed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches the member row to inactive", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mockFetch);

    await markUnfollowed("U123", config);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/rest/v1/line_members?line_user_id=eq.U123",
      expect.objectContaining({ method: "PATCH" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.status).toBe("inactive");
    expect(body.unfollowed_at).toBeTruthy();
  });
});
