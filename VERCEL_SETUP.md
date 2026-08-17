# Vercel Deployment Setup Guide

## Environment Variables Configuration

### Required Environment Variables

Your Audema application requires the following environment variable to be set in Vercel:

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Claude API key from Anthropic | ✅ Yes |
| `SUPABASE_URL` | Supabase project URL (already set for auth) | ✅ Yes |
| `SUPABASE_ANON_KEY` | Supabase anon key (already set for auth) | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — needed for the MCP server to bypass RLS | ✅ For MCP |
| `MCP_SECRET` | Bearer token that MCP clients must send — set to any long random string | ✅ For MCP |

---

## Pat — Email Delivery: Unsubscribe Compliance & Bounce Handling

Fixes the highest-severity finding from the 2026 Agent Audit: campaign sends had no `List-Unsubscribe` header (a hard Gmail/Yahoo/Apple requirement for bulk senders since May 2026) and nothing ever closed the loop when a send bounced or was marked as spam, so `contacts.status` sat unused.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `UNSUBSCRIBE_SECRET` | Signs the token in every unsubscribe link so it can't be forged. Falls back to `SUPABASE_SERVICE_ROLE_KEY` if unset — set a dedicated value if you'd rather not reuse that key for this. | Recommended |
| `RESEND_WEBHOOK_SECRET` | The `whsec_...` signing secret Resend gives you when you add a webhook endpoint | ✅ For bounce/complaint tracking |
| `PUBLIC_APP_URL` | Your deployment's public base URL, e.g. `https://app.yourdomain.com`. Falls back to the request's own `Host` header if unset — set this explicitly if you're behind a proxy/custom domain where that header isn't reliable. | Optional |

### What changed

- **`api/send-campaign.js`** now attaches `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers to every send, pointing at a signed link on `api/unsubscribe.js`. If `UNSUBSCRIBE_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` isn't configured, sends still go out (nothing is blocked) but the response includes a `warnings` array saying so — check for that in Pat's UI/QA flow.
- **`api/unsubscribe.js`** (new, public, no login required) — `GET` shows a confirmation page; `POST` (what mail clients send for one-click unsubscribe, and what the confirmation page's form submits to) flips the contact's `status` to `'unsubscribed'` in Supabase. Only works for recipients that came from a saved segment (i.e. had a real `contacts` row) — an ad-hoc pasted recipient has no CRM record to flip, and still sees a confirmation page rather than an error.
- **`api/resend-webhook.js`** (new) — verifies Resend's Svix-style webhook signature (HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw body}`, keyed by the base64-decoded `whsec_` secret) and sets `contacts.status` to `'bounced'` on a **permanent** bounce or `'complained'` on a spam complaint. Transient bounces (full mailbox, greylisting) are deliberately left alone — that's not a signal to stop emailing someone. Requires `contact_id` to be present in the event's echoed-back tags, which only happens for recipients sent with a real contact — see above.

### Setup

1. In the Resend dashboard: **Webhooks → Add Endpoint** → URL `https://<your-domain>/api/resend-webhook`, events `email.bounced` and `email.complained`. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.
2. No new Supabase table needed — this only writes to the `status` column `supabase-audience.sql` already created.
3. Send a real campaign to a segment-loaded recipient and confirm the outgoing message actually carries `List-Unsubscribe`/`List-Unsubscribe-Post` headers (most email clients' "view original" shows raw headers).

**Not yet covered by this pass**: `api/send-email.js` (Chase's one-off/sales-sequence sends) doesn't attach these headers — those recipients aren't audience `contacts` rows today, so there's no contact record for a webhook or unsubscribe link to act on. Revisit once sales-sequence prospects have a server-side record to update.

---

## Pulse Social Studio — Real AI Ad Image Generation

The "✨ Generate Ad Image" button on each ad card in Social Studio (`web/agents/social-agent.html`) creates a real, finished PNG/JPEG/WEBP creative — headline, supporting line, and CTA baked in as real on-image typography, using direct-response ad design principles — via `api/generate-ad-image.js`, proxied server-side so the key never reaches the browser.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `OPENAI_API_KEY` | Same key already used by `api/openai.js` — no separate key needed | ✅ For AI ad images |
| `OPENAI_IMAGE_MODEL` | Image model to request | Optional (defaults to `gpt-image-1`) |

Without `OPENAI_API_KEY`, the button returns a clear "not configured" error — a free, instant, no-API-key "quick template" fallback (deterministic SVG background + typography, via `api/render-social-image.js`) stays available underneath every card either way, clearly labeled as a placeholder rather than a finished ad.

Generated images upload to a hosted bucket (Cloudflare R2 preferred, Supabase Storage as a fallback — see "Hosted storage" below) as the quick-template ones (`api/render-social-image.js`), giving a real hosted URL — which is what unlocks Instagram/TikTok publishing, since those platforms reject `data:` URIs.

**Publishing stays manual until platform credentials are added.** Every approved post/image can be pushed to Pat and published with one click today. Once you add a given platform's credentials (`META_PAGE_ACCESS_TOKEN`, `LINKEDIN_ACCESS_TOKEN`, `TWITTER_USER_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` + Meta token, `TIKTOK_ACCESS_TOKEN` — see `api/publish-social-post.js`), that platform starts publishing automatically too: `api/cron-auto-publish.js` already runs every 15 minutes via the Vercel Cron entry in `vercel.json`, publishing anything scheduled through Beeker's calendar with no further code changes needed.

### AI image credit quota

Each real AI image generation call costs money, so `api/generate-ad-image.js` meters usage against a per-site credit balance stored in Supabase (`supabase-credits.sql` — run it after `supabase-intelligence-profiles.sql`). The balance is shared by everyone working on the same intelligence profile/site (falling back to the legacy `project_id` scope), not per individual login.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `AD_IMAGE_CREDIT_COST` | Credits deducted per successful image generation | Optional (defaults to `100`) |
| `DEFAULT_CREDIT_BALANCE` | Starting balance for a site's first-ever image generation | Optional (defaults to `20000`, i.e. 200 images at the default cost) |

At 0 remaining credits, generation is paused before the OpenAI call is made (never billed) and the UI shows an "Out of AI image credits — Upgrade for more credits →" prompt linking to `/index.html#pricing`. That's currently a message only — no payment is collected automatically. To actually sell credit top-ups, wire a real checkout (e.g. Stripe) that inserts/updates a `credit_balances` row (increase `credits_total`) on successful payment; the metering logic already reads whatever's in that table, so no changes to `api/generate-ad-image.js` would be needed for that follow-up.

Metering only activates when both a site/profile scope *and* `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are present — without either, image generation proceeds unmetered rather than blocking users who haven't set up Supabase or picked an active site yet.

---

## Hosted storage — Cloudflare R2

Ad creative that needs a real public URL (Instagram/TikTok publishing, mainly) uploads to Cloudflare R2 when configured, falling back to Supabase Storage otherwise — purely additive, nothing breaks if you only have one or neither set up.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `R2_ACCOUNT_ID` | Cloudflare account ID | For R2 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token credentials (S3-compatible) | For R2 |
| `R2_BUCKET_NAME` | The R2 bucket to upload into | For R2 |
| `R2_PUBLIC_BASE_URL` | A custom domain or the bucket's `r2.dev` URL, used to build the returned public URL | Optional but effectively required — without it, uploads succeed but no fetchable URL comes back |

Implemented via hand-rolled AWS SigV4 request signing (`api/_lib/r2.js` — Node's built-in `crypto` only, no `aws-sdk` dependency, matching this project's zero-npm-dependency `api/*.js` convention), since R2 exposes an S3-compatible API. `api/_lib/` is not treated as a route by Vercel — it's a shared module imported by `api/generate-ad-image.js` and `api/render-social-image.js`.

Both the web app and the standalone AdForge MCP server (`audema-adforge-mcp/`) can share the **same R2 bucket** under different key prefixes — `social-creatives/` for the web app, `adforge/` for AdForge's exported creative — so a file exported from either one is reachable the same way. AdForge needs its own copy of the same four `R2_*` env vars in its own `.env` (see `audema-adforge-mcp/.env.example`); they aren't shared automatically since AdForge runs as a separate local process, not on Vercel.

SigV4 is a stable, long-documented public standard, not a shifting vendor API contract — but a signing bug still fails loudly and immediately (403 `SignatureDoesNotMatch`), never silently. Verify with one real image generation after adding credentials and confirm the object actually appears in the R2 bucket.

---

## Reel Video Studio — Seedance 2.0 AI Video Generation

Reel's "AI Video Generator" panel (`web/agents/video-agent.html`) turns a text prompt (or a prompt + reference image) into a real rendered video clip via Seedance 2.0, proxied server-side through `api/generate-video.js` — the API key never reaches the browser.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `ARK_API_KEY` | API key from your BytePlus/Volcengine Ark console (the name their own docs use). Checked first. | ✅ For video generation |
| `SEEDANCE_API_KEY` | Fallback API key variable, used only if `ARK_API_KEY` isn't set — for non-Ark providers of Seedance 2.0 | Optional |
| `SEEDANCE_API_BASE_URL` | Base URL for the provider's REST API. Defaults to the BytePlus (international) Ark endpoint `https://ark.ap-southeast.bytepluses.com/api/v3`. Volcengine mainland-China accounts need `https://ark.cn-beijing.volces.com/api/v3` instead. | Optional |
| `SEEDANCE_MODEL` | The exact Model/Endpoint ID from your Ark console (Model Inference → Endpoints) — Ark frequently requires the provisioned Endpoint ID (e.g. `ep-20240611094208-xxxxx`), not a generic model name | Optional (defaults to `seedance-2-0`, which will 404 on most Ark accounts — set this to your real endpoint ID) |

**Provider note:** Seedance 2.0 ships through more than one host, and exact field names vary slightly per host. `api/generate-video.js` implements the Ark-style async task contract (`POST .../contents/generations/tasks` → task id, `GET .../contents/generations/tasks/{id}` → status + video URL), which is the pattern ByteDance's video models have used since Seedance 1.0. If you're on a different provider (fal.ai, Replicate, OpenRouter, etc.), point `SEEDANCE_API_BASE_URL`/`SEEDANCE_MODEL` at it and adjust the two small request/response-shaping blocks in `api/generate-video.js` to match — everything else (validation, the create→poll contract the client speaks) stays the same. Verify the exact contract against your provider's live docs before going to production; third-party API surfaces move fast.

Without `ARK_API_KEY`/`SEEDANCE_API_KEY` set, the Generate Video button returns a clear "not configured" error instead of failing silently — the rest of Reel (Claude-powered scripts, Tavus avatar videos) keeps working either way.

---

## Business Brain — Per-Project Memory + History

Business Brain previously lived only in browser `localStorage`, shared globally across every project with no version history — so clearing browser data, switching devices, or an accidental "Overwrite all fields" click could silently destroy it with no way back.

This is now fixed:
- **Per-project**: each project gets its own Business Brain, keyed off the same `projects` table/current-project pointer used elsewhere in the app.
- **Cloud-synced**: every save mirrors to Supabase (`business_brain` table) in the background — localStorage stays as the instant-read cache, Supabase is the durable copy.
- **Versioned**: every save also appends to `business_brain_history` (last 20 kept per project). Click **History** on the Business Brain page to browse and restore any previous version — restoring itself creates a "Before restore" snapshot first, so nothing is ever truly lost.

### Setup

1. Run `supabase-business-brain.sql` in Supabase Dashboard → SQL Editor.
2. No new env vars needed — this uses the same `SUPABASE_URL`/`SUPABASE_ANON_KEY` client-side auth already configured.
3. On first visit to Business Brain after this update, if pre-migration global data is found (and the current project's brain is still empty), a prompt lets you assign it to whichever project it belongs to.

---

## Intelligence Profiles — Multi-Business Intelligence Layer

One intelligence profile = one business's complete Intelligence Layer (Business Brain, cloud-synced and versioned). Users switch the active profile to work across multiple businesses; agencies manage one profile per client.

**Plan limits** (enforced server-side by a Postgres trigger and mirrored in the UI):

| Plan | Profiles |
|------|----------|
| Free / Basic | 1 |
| Pro / Professional | 3 |
| Agency | 8 |
| Enterprise | Admin-configured per account |

### Setup

1. Run `supabase-business-brain.sql` first (if not already), then `supabase-intelligence-profiles.sql` in Supabase Dashboard → SQL Editor.
2. No new env vars — uses the existing client-side Supabase auth.
3. Set a user's plan in the `profiles` table (`plan` column: `basic` / `professional` / `agency` / `enterprise`).
4. **Enterprise accounts**: an admin sets the custom allowance directly on the account row — `UPDATE profiles SET plan = 'enterprise', intel_profile_limit = <N> WHERE email = '<customer>';` — sized to what the customer pays for.

### How it works

- The Business Brain page shows a **profile selector** (when more than one exists) and a **⚙ Profiles** manager: create (limit-enforced), rename, delete, switch. Switching reloads the Brain into that profile's data instantly, then hydrates from the cloud.
- On first login a "Default" profile is auto-created; pre-profile local Brain data is offered for one-click import.
- Shared access is built in at the schema level: `intelligence_profile_members` grants owner/editor/viewer roles on a profile to other users (RLS-enforced), ready for team features.
- Data isolation: each profile has its own `business_brain` row, its own last-20 snapshot history, and its own localStorage cache key. Legacy per-project scoping still works as a fallback for accounts that haven't run the migration.

---

## Switching Between Multiple Sites/Clients — what's actually wired to what

This app has **two separate multi-tenancy concepts** that are not reconciled with each other — there's no foreign key or shared ID between them. Knowing which is which matters when debugging "why didn't switching sites change this page."

| | `projects` table | `intelligence_profiles` table |
|---|---|---|
| **What it represents** | An SEO tracking target: URL, sitemap, crawl depth, keywords | A business/client identity: name, brand, ICP, positioning |
| **Active pointer** | `localStorage['seo-current-project']`, set by `ProjectService.setCurrentProject()` | `localStorage['intel_active_profile']`, set by `IntelligenceProfiles.setActiveProfile()` |
| **Drives** | `dashboard.html`, the classic SEO audit chain (`seo-audit.js`, `analysis-engine.js`) | Business Brain, and — via each store's `getScope()`/`_key()` fallback chain (profile first, project second) — Audience Manager (Beeker), Social Studio, Pat, Sales Intelligence, LinkedIn Outreach |
| **Switcher UI** | `dashboard.html`'s topbar dropdown (fixed — see below; previously **cosmetic only**, it relabeled a button and never called `setCurrentProject()`) | The global `site-switcher-mount` widget (`web/js/site-switcher.js`) in the nav of `hub.html` and the 5 agent pages above, plus Business Brain's own inline `⚙ Profiles` panel |

**What this means in practice**: switching your active site via the global switcher (hub/agent pages) changes what Business Brain, Audience Manager, Social Studio, Pat, Sales Intelligence, and LinkedIn Outreach show — it does **not** change which SEO project the dashboard is tracking, and vice versa. For a single-business account this is invisible (there's only ever one of each). For an agency running multiple clients, you currently manage "which SEO project" and "which client's marketing" as two independent switches, not one.

Unifying them into one canonical "site" concept is a real data-model decision (merge the tables, or add a mapping table linking a `project_id` to an `intelligence_profile_id`) — not something to silently paper over. Flagging it here rather than pretending it's already unified.

### `web/js/site-switcher.js` — the global switcher

- Mounts wherever a page has `<div id="site-switcher-mount"></div>` in its nav + calls `SiteSwitcher.mount()`.
- Thin wrapper around `IntelligenceProfiles` — same plan limits, same `ensureActiveProfile()` auto-create-a-default-profile behavior.
- Switching reloads the page (the simplest reliable way to make every store on that page re-scope, since most compute their storage key from `localStorage` at call time rather than reactively).
- Syncs across open tabs via the `storage` event.

---

## A/B Testing MCP Server

The Aduma MCP server exposes your A/B experiment data to Claude so you can manage experiments, analyse results, generate tracking snippets, and trigger new ad creative directly from a chat interface.

### Step 1 — Run the Supabase migration

In Supabase Dashboard → SQL Editor → New query, paste and run the contents of `supabase-ab-testing.sql`.

This creates: `experiments`, `variants`, `goals`, `visitors`, `conversions` tables with RLS policies.

### Step 2 — Add env vars to Vercel

Add `SUPABASE_SERVICE_ROLE_KEY` (Settings → Environment Variables in Vercel Dashboard).
Set `MCP_SECRET` to a long random string — e.g. `openssl rand -hex 32`.

### Step 3 — Connect Claude Desktop or Cursor

Add to your Claude Desktop `claude_desktop_config.json` (or Cursor `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "aduma": {
      "type": "http",
      "url": "https://<your-vercel-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-MCP_SECRET>"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see "aduma" in the MCP tools panel.

### Available MCP Tools

| Tool | What it does |
|------|-------------|
| `list_experiments` | Show all experiments with status |
| `get_experiment_stats` | CVR, uplift %, statistical significance per variant |
| `create_experiment` | Create a new A/B test |
| `add_variant` | Add a variant (or control) to an experiment |
| `update_experiment` | Change status: draft → active → paused → finished |
| `declare_winner` | Mark variant as winner, close experiment |
| `create_goal` | Add a conversion goal (click / pageview / revenue) |
| `get_winning_copy` | List all winning copy from finished experiments |
| `generate_tracking_snippet` | Get the JS embed for any experiment |
| `generate_ads_from_winner` | Ad creative loop: winner copy → new ad variants |

### Example Claude workflow

```
You: "Create an experiment called 'Homepage hero CTA', add a control and a variant,
      set the goal to the #get-started button click, and give me the tracking snippet."

Claude: [calls create_experiment → add_variant × 2 → create_goal → generate_tracking_snippet]
        Here's your tracking snippet — paste it into your <head>...
```

```
You: "Check the stats on experiment abc123 and declare the winner."

Claude: [calls get_experiment_stats]
        Variant B has 14.2% CVR vs 12.1% control (+17.3%, p=0.02) — statistically significant.
        [calls declare_winner]
        Winner declared. Want me to generate new ads based on this winning copy?
```

---

## Chase — Prospect Discovery & Enrichment (Real Data Only)

Chase's Discover tab finds real businesses and enriches them through a five-source chain — every source is a real API call or a hard stop, never an invented fallback. This matters: cold-emailing or cold-calling a hallucinated business/contact is a real CAN-SPAM/TCPA exposure, not just an embarrassment, so the app refuses to run the discovery step at all without a working Perplexity key rather than quietly inventing businesses.

**The chain**, per prospect, once discovered via Perplexity:

1. **Perplexity** (`PERPLEXITY_API_KEY`, already covered above) — live web search finds the business in the first place, and later searches for its public profiles/social links.
2. **Google Places** (`api/places.js`) — verifies the business is real and pulls its actual address, phone, rating, and website (or confirms it has none) directly from Google's own data.
3. **Website crawl** (`api/crawl.js`) — no extra key needed; fetches the business's own site (if it has one) for listed emails/socials.
4. **Hunter.io** (`api/hunter.js`) — domain-level email discovery from a broader database than what's listed on the site itself.
5. **Apollo.io** (`api/apollo-enrich.js`) — real firmographic data (industry, employee count, LinkedIn) and real people Apollo has on file at that domain with owner/founder/decision-maker titles. This is what replaces "AI-invented owner names" with an actual name Apollo has verified — or an honest empty result if Apollo has nothing on file. Apollo's search step doesn't return email addresses (a separate, credit-costing enrichment call would be needed for that); Hunter.io covers that gap instead.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `PERPLEXITY_API_KEY` | Already covered above — discovery is hard-blocked without it | ✅ For Discover tab at all |
| `GOOGLE_PLACES_API_KEY` | From Google Cloud Console → enable "Places API (New)" → create an API key | For Places verification step |
| `HUNTER_API_KEY` | From hunter.io → API dashboard | For Hunter email discovery step |
| `APOLLO_API_KEY` | From Apollo → Settings → Integrations → API Keys. This is Apollo's own REST API key — separate from any Apollo MCP connector a Claude session might have; the deployed app needs its own key since there's no Claude session in the loop for your actual users. | For Apollo firmographic/contact step |

Every step in the chain degrades gracefully and independently — if a given key isn't configured, that step is silently skipped (logged to the browser console) and the prospect keeps whatever real data the other steps found. Nothing is ever backfilled with a guess.

---

## How to Add Environment Variables in Vercel

### Option 1: Via Vercel Dashboard (Recommended)

1. **Go to your project** in the Vercel Dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variable:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: Your Claude API key (starts with `sk-ant-api...`)
   - **Environments**: Select all (Production, Preview, Development)
4. Click **Save**
5. **Redeploy** your application for changes to take effect

### Option 2: Via Vercel CLI

```bash
# Install Vercel CLI if you haven't already
npm i -g vercel

# Add the environment variable
vercel env add ANTHROPIC_API_KEY

# Follow the prompts to enter your API key
# Select all environments when prompted
```

---

## How to Get Your Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign in or create an account
3. Navigate to **API Keys**
4. Click **Create Key**
5. Copy your API key (format: `sk-ant-api...`)
6. Store it securely and add it to Vercel environment variables

---

## Architecture: Secure API Proxy

### Why We Use a Serverless Function

Your application uses a **secure server-side proxy** to protect your API key:

```
┌─────────────────────────────────────────────────────────────┐
│  OLD SETUP (Insecure) ❌                                     │
├─────────────────────────────────────────────────────────────┤
│  Browser → Anthropic API (with exposed API key)             │
│  ⚠️ API key visible in browser network tab                  │
│  ⚠️ Anyone can steal and abuse your API key                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NEW SETUP (Secure) ✅                                       │
├─────────────────────────────────────────────────────────────┤
│  Browser → /api/claude → Anthropic API                      │
│           (Vercel Function)                                  │
│  ✅ API key stored securely in Vercel environment variables │
│  ✅ Never exposed to browser                                │
│  ✅ Server-side only                                        │
└─────────────────────────────────────────────────────────────┘
```

### Files Modified

1. **`/api/claude.js`** (NEW)
   - Vercel serverless function
   - Proxies requests to Anthropic API
   - Uses `ANTHROPIC_API_KEY` from environment variables
   - Handles both streaming and non-streaming responses

2. **`/web/js/claude-service.js`** (UPDATED)
   - Changed from direct Anthropic API calls
   - Now calls `/api/claude` endpoint
   - Removed insecure client-side API key handling
   - Removed `getApiKey()` and `setApiKey()` functions

3. **`/vercel.json`** (UPDATED)
   - Added environment variable reference
   - Configured API routes

---

## Verifying Your Setup

### 1. Check Environment Variable

In Vercel Dashboard:
- Go to **Settings** → **Environment Variables**
- Confirm `ANTHROPIC_API_KEY` is listed
- Should be available for all environments

### 2. Test API Endpoint

After deployment, test the API:

```bash
# Replace YOUR_DOMAIN with your Vercel domain
curl -X POST https://YOUR_DOMAIN.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Expected response:
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hello! How can I help you today?"}],
  ...
}
```

### 3. Test in Browser

1. Open your deployed app
2. Navigate to the Hub or any agent
3. Try generating content
4. Open browser DevTools → Network tab
5. You should see requests to `/api/claude` (not `api.anthropic.com`)

---

## Troubleshooting

### Error: "API key not configured"

**Problem**: `ANTHROPIC_API_KEY` not found in environment variables

**Solution**:
1. Verify the variable is added in Vercel Dashboard
2. Check spelling: `ANTHROPIC_API_KEY` (must match exactly)
3. Redeploy your application after adding the variable

### Error: "Method not allowed"

**Problem**: GET request to API endpoint (only POST allowed)

**Solution**: Ensure you're making POST requests to `/api/claude`

### Error: "Invalid request: messages array required"

**Problem**: Missing or invalid `messages` in request body

**Solution**: Check request format in `claude-service.js`

### API calls timing out

**Problem**: Vercel serverless function timeout (default 10s)

**Solution**:
- For long-running requests, use streaming mode
- Or increase timeout in `vercel.json`:
  ```json
  {
    "functions": {
      "api/claude.js": {
        "maxDuration": 60
      }
    }
  }
  ```

---

## Security Best Practices

✅ **DO:**
- Store API keys in Vercel environment variables
- Use server-side API proxy
- Never commit API keys to git
- Rotate API keys periodically
- Monitor API usage in Anthropic Console

❌ **DON'T:**
- Hardcode API keys in source code
- Expose API keys in client-side code
- Share API keys in public repositories
- Use same API key across multiple projects

---

## Deployment Checklist

Before deploying:

- [ ] `ANTHROPIC_API_KEY` added to Vercel environment variables
- [ ] Environment variable set for all environments (Production, Preview, Development)
- [ ] `/api/claude.js` committed to repository
- [ ] `claude-service.js` updated to use `/api/claude` endpoint
- [ ] `vercel.json` configured with environment variable reference
- [ ] Test deployment on Preview environment first
- [ ] Verify API calls working in browser DevTools
- [ ] Check Anthropic Console for API usage

---

## Cost Monitoring

**Important**: Monitor your Claude API usage to avoid unexpected costs.

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to **Usage & Billing**
3. Set up usage alerts
4. Monitor daily API costs

**Recommended**: Set up budget alerts in Anthropic Console to prevent overages.

---

## Agent Audit — Bi-Monthly "Stay Current" Research Run

Every 2 months, `api/cron-agent-audit.js` runs a real, live web-search-backed research pass over all 15 specialist agents (Rex, Ink, CRO Lab, Nova, Pat, Beeker, Chase, Pulse, Mex, Reel, Scout, Vera, Shield, Lock, Deck Maker), asking Claude to check each one's current approach against up-to-date (not training-data-stale) marketing best practices, security considerations, and platform/compliance rules — then writes the findings to Supabase so Scotty can surface them.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `ANTHROPIC_API_KEY` | Already required above — reused for the audit's Claude + web-search calls | ✅ Yes |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Already required above — the cron job writes with the service-role key, bypassing RLS | ✅ Yes |
| `CRON_SECRET` | Already used by `api/cron-auto-publish.js` — the same bearer token gates this endpoint too | ✅ Yes |

### Setup

1. Run `supabase-agent-audits.sql` in Supabase Dashboard → SQL Editor. This creates `agent_audit_runs` and `agent_audit_findings` — read-only for any signed-in user (it's meta-info about the product's own agents, not client data), writes only via the service-role key.
2. No new env vars if `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` are already set from earlier sections — this feature reuses all four.
3. The Vercel Cron entry (`vercel.json`) fires at `0 6 1 */2 *` — 06:00 UTC on the 1st of every odd month (Jan, Mar, May, Jul, Sep, Nov).
4. Scotty (`web/scotty.html`) shows an "🛰️ Agent Audit" card in Mission Control whenever a run exists, with agent/flagged counts and a "View Report" button that opens the full per-agent findings (gaps, recommendations, security notes, sources).

**What this job deliberately does NOT do**: it never modifies any other agent's code, prompts, or behavior — it only produces a research report for a human to act on. Auto-patching production files from an unsupervised cron job would be a real safety regression, not a step toward genuine autonomy; consequential changes stay gated behind human review.

Each of the 15 per-agent research calls runs concurrently (`Promise.allSettled`, 40s timeout each) to fit inside Vercel's 60s function budget. If an individual agent's research call fails (timeout, rate limit, etc.), it's recorded with an `error` field and `up_to_date: true` — a failed run is never mistaken for a "this agent needs work" flag.

---

## Scout — Monitored Competitors (Scheduled Change Detection)

Addresses a gap from the 2026 Agent Audit: Scout was fully on-demand — it could research a competitor when asked, but nothing tracked change over time the way a real competitive-intelligence platform (Crayon, Klue) does. `api/cron-competitor-watch.js` runs daily, fetches every user's actively-monitored competitor URLs, and flags when the page's title, meta description, or visible text content actually changes.

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Already required above — the cron job writes with the service-role key | ✅ Yes |
| `CRON_SECRET` | Already used by the other cron jobs — same bearer token gates this endpoint too | ✅ Yes |

No paid API required — it fetches the tracked page's HTML directly and extracts `<title>`/meta description via regex (this project has no npm dependencies in `api/*.js`, so there's no DOM parser), plus a hash of the stripped visible text. A changed content hash means "the page's visible text is different than last time," not a diff of what changed — good enough to prompt a human to go look.

### Setup

1. Run `supabase-competitor-watch.sql` in Supabase Dashboard → SQL Editor. Creates `competitor_watches`, `competitor_snapshots`, and `competitor_changes` — owner-scoped via RLS.
2. No new env vars beyond what's already configured for the other cron jobs.
3. The Vercel Cron entry fires daily at `0 7 * * *` (07:00 UTC). **Note**: this is the third cron job in `vercel.json` — Vercel's Hobby plan allows only 2 cron jobs; a Pro plan (or higher) is needed for all three to run.
4. Add competitors to monitor from the new "📡 Monitored Competitors" panel in Competitive Intel (`web/agents/competitive-agent.html`) — track a specific page (pricing, homepage) rather than a whole site for the clearest signal.
5. Capped at 150 watches per run to stay inside Vercel's 60s function budget; the response includes a `truncated` flag if more active watches exist than one run could cover.

---

## Additional Resources

- [Vercel Environment Variables Docs](https://vercel.com/docs/concepts/projects/environment-variables)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)

---

**Last Updated**: March 15, 2026
**Deployed by**: Claude (AI Assistant)
**Session**: https://claude.ai/code
