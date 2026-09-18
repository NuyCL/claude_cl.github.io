# LINE OA Member Capture Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that receives LINE Messaging API webhook events (`follow`/`unfollow`), verifies their signature, and upserts member records into a Supabase `line_members` table.

**Architecture:** A single-endpoint Cloudflare Worker (`worker/src/index.ts`) validates the `x-line-signature` header via HMAC-SHA256, parses LINE webhook event payloads, fetches the user's profile from the LINE Get Profile API on `follow`, and writes to Supabase via its REST API using `fetch`. Logic is split into small, independently testable modules: signature verification, LINE API calls, and Supabase writes, wired together in the top-level fetch handler.

**Tech Stack:** Cloudflare Workers, TypeScript, Wrangler, Vitest + `@cloudflare/vitest-pool-workers`, Supabase (Postgres + REST API), LINE Messaging API.

---

## Task 0: Supabase Table Setup (manual, user-run)

**Files:** none (run in Supabase SQL editor)

- [ ] **Step 1: Run this SQL in the Supabase SQL editor for your project**

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

- [ ] **Step 2: Confirm the table exists**

In the Supabase Table Editor, confirm `line_members` appears with columns: `line_user_id`, `display_name`, `picture_url`, `status`, `followed_at`, `unfollowed_at`.

- [ ] **Step 3: Record your Supabase project URL and service role key**

From Supabase project Settings → API, note:
- `Project URL` (e.g. `https://xxxx.supabase.co`)
- `service_role` key (secret — used only in the Worker, never in the frontend)

You'll enter these as Worker secrets in Task 5.

---

## Task 1: Worker Project Scaffold

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`
- Create: `worker/.gitignore`

- [ ] **Step 1: Create the worker directory and initialize the project**

```bash
mkdir -p worker/src
cd worker
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install --save-dev typescript wrangler vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

- [ ] **Step 3: Write `worker/package.json`**

```json
{
  "name": "line-member-capture-worker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240925.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 4: Write `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2021"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 5: Write `worker/wrangler.toml`**

```toml
name = "line-member-capture"
main = "src/index.ts"
compatibility_date = "2024-09-25"

[vars]
# Non-secret vars only. Secrets (below) are set via `wrangler secret put`.
```

- [ ] **Step 6: Write `worker/.gitignore`**

```
node_modules/
.wrangler/
dist/
.dev.vars
```

- [ ] **Step 7: Write a placeholder `worker/src/index.ts`**

```typescript
export interface Env {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response("ok", { status: 200 });
  },
};
```

- [ ] **Step 8: Verify the project builds**

Run: `cd worker && npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 9: Commit**

```bash
cd ..
git add worker/package.json worker/tsconfig.json worker/wrangler.toml worker/.gitignore worker/src/index.ts
git commit -m "chore: scaffold Cloudflare Worker project"
```

---

## Task 2: Signature Verification Module

**Files:**
- Create: `worker/src/signature.ts`
- Test: `worker/test/signature.test.ts`

LINE signs each webhook request body with HMAC-SHA256 using the Channel Secret, base64-encoded, sent in the `x-line-signature` header. This module verifies that signature using the Web Crypto API (available in Workers).

- [ ] **Step 1: Write the failing test**

Create `worker/test/signature.test.ts`:

```typescript
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
```

- [ ] **Step 2: Create `worker/test/vitest.config.ts` for the Workers test pool**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "../wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: FAIL with "Cannot find module '../src/signature'"

- [ ] **Step 4: Write `worker/src/signature.ts`**

```typescript
export async function verifySignature(
  body: string,
  signatureHeader: string,
  channelSecret: string
): Promise<boolean> {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  return computed === signatureHeader;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add worker/src/signature.ts worker/test/signature.test.ts worker/test/vitest.config.ts
git commit -m "feat: add LINE webhook signature verification"
```

---

## Task 3: LINE Profile API Client

**Files:**
- Create: `worker/src/lineApi.ts`
- Test: `worker/test/lineApi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/lineApi.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: FAIL with "Cannot find module '../src/lineApi'"

- [ ] **Step 3: Write `worker/src/lineApi.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lineApi.ts worker/test/lineApi.test.ts
git commit -m "feat: add LINE Get Profile API client"
```

---

## Task 4: Supabase Client Module

**Files:**
- Create: `worker/src/supabase.ts`
- Test: `worker/test/supabase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/supabase.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: FAIL with "Cannot find module '../src/supabase'"

- [ ] **Step 3: Write `worker/src/supabase.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add worker/src/supabase.ts worker/test/supabase.test.ts
git commit -m "feat: add Supabase upsert/unfollow client"
```

---

## Task 5: Webhook Event Handler (wiring)

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/index.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: FAIL (handler currently just returns "ok" for everything, so 401/400 assertions fail)

- [ ] **Step 3: Write the full `worker/src/index.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run --config test/vitest.config.ts`
Expected: PASS (12 tests total)

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/test/index.test.ts
git commit -m "feat: wire up LINE webhook handler with follow/unfollow processing"
```

---

## Task 6: Local Manual Verification

**Files:** none (manual verification step)

- [ ] **Step 1: Set local dev secrets**

Create `worker/.dev.vars` (already gitignored from Task 1):

```
LINE_CHANNEL_SECRET=your-real-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-real-channel-access-token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-real-service-role-key
```

- [ ] **Step 2: Start the local dev server**

Run: `cd worker && npx wrangler dev`
Expected: server starts, prints a local URL (e.g. `http://localhost:8787`)

- [ ] **Step 3: Send a signed test follow event with curl**

```bash
cd worker
BODY='{"events":[{"type":"follow","source":{"userId":"Utestuser1234567890"}}]}'
SECRET=$(grep LINE_CHANNEL_SECRET .dev.vars | cut -d= -f2)
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -s -X POST http://localhost:8787/ \
  -H "x-line-signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

Expected: `ok` response, HTTP 200. Note: this will call the real LINE Get Profile API with a fake userId and fail that call (logged, not thrown), then still attempt the Supabase upsert with null profile fields — confirm a row appears in Supabase with `line_user_id = 'Utestuser1234567890'`.

- [ ] **Step 4: Confirm in Supabase**

In the Supabase Table Editor, confirm a row exists for `Utestuser1234567890` with `status = 'active'`.

- [ ] **Step 5: Stop the dev server**

Press `Ctrl+C` in the terminal running `wrangler dev`.

---

## Task 7: Deployment Setup

**Files:** none (Cloudflare dashboard / CLI setup)

- [ ] **Step 1: Authenticate wrangler with your Cloudflare account**

Run: `cd worker && npx wrangler login`
Expected: opens a browser to authorize wrangler against your Cloudflare account

- [ ] **Step 2: Set production secrets**

```bash
cd worker
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Each command prompts for the secret value interactively — paste the real value from your LINE Developers Console and Supabase project settings.

- [ ] **Step 3: Deploy the Worker**

Run: `cd worker && npx wrangler deploy`
Expected: output includes the deployed Worker URL, e.g. `https://line-member-capture.<your-subdomain>.workers.dev`

- [ ] **Step 4: Configure the LINE webhook URL**

In the LINE Developers Console, under your Messaging API channel → Messaging API tab:
1. Set **Webhook URL** to the deployed Worker URL from Step 3.
2. Click **Verify** — LINE sends a test request; confirm it succeeds (the Worker must return 200 for LINE's verification ping, which has no events, so the loop in Task 5 Step 3 simply does nothing and returns `ok`).
3. Enable **Use webhook**.

- [ ] **Step 5: Real end-to-end test**

Using a personal LINE account, add the QA OA as a friend. Confirm a row appears in Supabase `line_members` with your real `line_user_id`, `display_name`, and `picture_url`, `status = 'active'`.

Then remove/block the OA as a friend. Confirm the row's `status` flips to `inactive` and `unfollowed_at` is set.

---

## Task 8: Documentation

**Files:**
- Create: `worker/README.md`

- [ ] **Step 1: Write `worker/README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add worker/README.md
git commit -m "docs: add worker setup README"
```

---

## Spec Coverage Check

- Webhook signature verification → Task 2
- Follow event → profile fetch → Supabase upsert → Task 3, Task 4, Task 5
- Unfollow event → mark inactive → Task 4, Task 5
- Error handling (invalid signature 401, malformed body 400, Supabase failure logged not thrown, profile fetch failure falls back to null fields) → Task 5 Step 3, covered by tests in Task 5 Step 1
- Testing requirements from spec (unit tests for signature verification, local wrangler test, end-to-end follow/unfollow) → Task 2, Task 6, Task 7 Step 5
- Table schema from spec → Task 0
- Secrets never committed → Task 1 `.gitignore`, Task 7 `wrangler secret put`
