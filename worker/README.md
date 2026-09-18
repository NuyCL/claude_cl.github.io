# LINE Member Capture Worker

Cloudflare Worker that receives LINE Messaging API webhook events and
syncs member follow/unfollow state into Supabase.

## Setup

1. Run this SQL against your Supabase project to create the `line_members` table:

   ```sql
   create table line_members (
     line_user_id text primary key,
     display_name text,
     picture_url text,
     status text not null default 'active' check (status in ('active', 'inactive')),
     followed_at timestamptz not null default now(),
     unfollowed_at timestamptz
   );
   ```

2. `npm install`
3. Create `worker/.dev.vars` for local development with the four keys listed
   below under Secrets, e.g.:

   ```
   LINE_CHANNEL_SECRET=your-real-channel-secret
   LINE_CHANNEL_ACCESS_TOKEN=your-real-channel-access-token
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-real-service-role-key
   ```

4. `npm run dev` to run locally, `npm run deploy` to ship to Cloudflare.

## Secrets

Set via `wrangler secret put <NAME>` for production:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Testing

`npm test` runs the Vitest suite against the Workers runtime via
`@cloudflare/vitest-pool-workers`.
