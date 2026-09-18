export interface LineProfile {
  displayName: string;
  pictureUrl: string | null;
}

export async function getProfile(
  userId: string,
  channelAccessToken: string
): Promise<LineProfile | null> {
  const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${channelAccessToken}` },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { displayName: string; pictureUrl?: string };
  return {
    displayName: data.displayName,
    pictureUrl: data.pictureUrl ?? null,
  };
}
