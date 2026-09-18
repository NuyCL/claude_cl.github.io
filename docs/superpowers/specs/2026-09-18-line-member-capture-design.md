# LINE OA Member Capture Pipeline — Design

## Requirement

Keep a durable record of LINE User IDs for members who add the LINE
Official Account (OA) used for QA, so they can later be messaged via
the LINE Messaging API. This phase covers capture only — no admin UI.

## Architecture

```
LINE Platform ──(webhook: follow/unfollow events)──> Cloudflare Worker ──> Supabase (Postgres)
```

- **LINE Messaging API webhook** — configured in the LINE Developers
  Console against the existing OA/channel, pointed at the Cloudflare
  Worker's HTTP endpoint (e.g. `https://<worker>.workers.dev/line-webhook`).
  LINE pushes `follow` and `unfollow` events as HTTP POSTs whenever a
  user adds or blocks the OA.
- **Cloudflare Worker** — single endpoint that:
  1. Verifies the `x-line-signature` header (HMAC-SHA256 over the raw
     body using the Channel Secret) to confirm the request came from
     LINE.
  2. Parses the event body for `follow` and `unfollow` events.
  3. On `follow`: calls LINE's Get Profile API
     (`GET https://api.line.me/v2/bot/profile/{userId}`, Bearer token
     = Channel Access Token) to fetch `displayName` and `pictureUrl`,
     then upserts a row into Supabase.
  4. On `unfollow`: updates the matching row's `status` to `inactive`
     (soft delete — preserves history, keeps stale users out of
     future broadcasts).
  5. Returns `200 OK` promptly, per LINE's webhook timing expectations.
- **Supabase (Postgres)** — `line_members` table:
  - `line_user_id` (text, primary key)
  - `display_name` (text, nullable)
  - `picture_url` (text, nullable)
  - `status` (text: `active` | `inactive`)
  - `followed_at` (timestamptz)
  - `unfollowed_at` (timestamptz, nullable)
- Secrets (Channel Secret, Channel Access Token, Supabase service
  role key) live as Cloudflare Worker secrets, never committed to the
  repo.
- The existing GitHub Pages site in this repo is unrelated to this
  pipeline and requires no changes in this phase.

## Data Flow — Follow Event

1. User adds the LINE OA as a friend → LINE sends a `follow` webhook
   event to the Worker.
2. Worker verifies the signature.
3. Worker calls the Get Profile API for the event's `userId`.
4. Worker upserts
   `{line_user_id, display_name, picture_url, status: 'active', followed_at: now()}`
   into Supabase via the Supabase REST API (service role key).
5. Worker responds `200 OK` to LINE.

## Data Flow — Unfollow Event

1. User blocks/removes the LINE OA → LINE sends an `unfollow` webhook
   event to the Worker.
2. Worker verifies the signature.
3. Worker updates the row for that `line_user_id`:
   `status = 'inactive'`, `unfollowed_at = now()`.
4. Worker responds `200 OK` to LINE.

## Error Handling

- Invalid or missing signature → `401`, log and drop; do not process
  the payload.
- Malformed event body → `400`, log and drop.
- Supabase write failure → log the error, still return `200` to LINE.
  LINE retries aggressively on non-200 responses, which would risk
  duplicate profile-fetch calls; accepting and logging failures
  separately is preferred over retry storms at this scale ("just me"
  usage, low volume). A dead-letter/replay mechanism is explicitly
  out of scope for v1.
- Profile fetch failure (rare) → fall back to storing just
  `line_user_id` and `followed_at` with null `display_name`/
  `picture_url`, so the ID is never lost even if the profile call
  fails.

## Testing

- Unit test signature verification against known valid/invalid
  payloads (LINE publishes example signing behavior).
- Local test via `wrangler dev` with a manually crafted, correctly
  signed payload.
- End-to-end test: add a test LINE account as a friend to the real OA
  (low-risk since it's the existing QA member), confirm the row
  appears in Supabase with expected fields.
- End-to-end test for unfollow: remove the friend, confirm `status`
  flips to `inactive` and `unfollowed_at` is set.

## Out of Scope (this phase)

- Admin UI for browsing/segmenting/sending to members.
- Broadcast/send functionality itself (future phase, once the member
  list exists).
- Dead-letter queue / retry replay for failed Supabase writes.
- Creating the LINE OA or Messaging API channel (already exists).
