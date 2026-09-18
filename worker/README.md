# LINE Member Capture Worker

Cloudflare Worker that receives LINE Messaging API webhook events and
syncs member follow/unfollow state into Supabase.

## Setup

1. Run the SQL in `../docs/superpowers/specs/2026-09-18-line-member-capture-design.md`
   (Task 0) against your Supabase project to create the `line_members` table.
2. `npm install`
3. Copy `.dev.vars.example` values into `.dev.vars` for local development
   (see Task 6 of the implementation plan for exact keys).
4. `npm run dev` to run locally, `npm run deploy` to ship to Cloudflare.

## Secrets

Set via `wrangler secret put <NAME>`:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Testing

`npm test` runs the Vitest suite against the Workers runtime via
`@cloudflare/vitest-pool-workers`.
