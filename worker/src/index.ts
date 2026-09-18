import { verifySignature } from "./signature";
import { getProfile } from "./lineApi";
import { upsertFollowedMember, markUnfollowed } from "./supabase";

export interface Env {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface LineEvent {
  type: string;
  source: { userId: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();
    const signature = request.headers.get("x-line-signature") ?? "";

    const isValid = await verifySignature(body, signature, env.LINE_CHANNEL_SECRET);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: { events: LineEvent[] };
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Malformed body", { status: 400 });
    }

    const supabaseConfig = {
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    };

    for (const event of payload.events ?? []) {
      const userId = event.source?.userId;
      if (!userId) continue;

      try {
        if (event.type === "follow") {
          const profile = await getProfile(userId, env.LINE_CHANNEL_ACCESS_TOKEN);
          await upsertFollowedMember(
            {
              lineUserId: userId,
              displayName: profile?.displayName ?? null,
              pictureUrl: profile?.pictureUrl ?? null,
            },
            supabaseConfig
          );
        } else if (event.type === "unfollow") {
          await markUnfollowed(userId, supabaseConfig);
        }
      } catch (err) {
        console.error(`Failed to process ${event.type} event for ${userId}:`, err);
      }
    }

    return new Response("ok", { status: 200 });
  },
};
