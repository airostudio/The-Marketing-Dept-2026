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

## Additional Resources

- [Vercel Environment Variables Docs](https://vercel.com/docs/concepts/projects/environment-variables)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)

---

**Last Updated**: March 15, 2026
**Deployed by**: Claude (AI Assistant)
**Session**: https://claude.ai/code
