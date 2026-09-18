export interface SupabaseConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export interface FollowedMember {
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

function headers(config: SupabaseConfig): Record<string, string> {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

export async function upsertFollowedMember(
  member: FollowedMember,
  config: SupabaseConfig
): Promise<void> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/line_members`, {
    method: "POST",
    headers: {
      ...headers(config),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      line_user_id: member.lineUserId,
      display_name: member.displayName,
      picture_url: member.pictureUrl,
      status: "active",
      followed_at: new Date().toISOString(),
      unfollowed_at: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`);
  }
}

export async function markUnfollowed(lineUserId: string, config: SupabaseConfig): Promise<void> {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/line_members?line_user_id=eq.${lineUserId}`,
    {
      method: "PATCH",
      headers: headers(config),
      body: JSON.stringify({
        status: "inactive",
        unfollowed_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase update failed: ${response.status} ${await response.text()}`);
  }
}
