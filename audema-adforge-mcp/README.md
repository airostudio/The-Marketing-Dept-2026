# Audema AdForge MCP

An MCP (Model Context Protocol) server that helps Claude create **high-converting static ad concepts and production-ready ad images** for Audema Marketing clients — from a raw business description all the way to exported PNG/JPG creative sized for every major platform.

Every ad is built from a specific brand profile, a specific customer analysis, and a specific offer — the server is designed so it's structurally difficult to produce a generic, template-looking ad. Angle guidance, copy guidance, and scoring rubrics all force the calling model to reference real, concrete details from the brief rather than filling in a blank template.

---

## What it does

```
create_brand_profile ──▶ create_ad_brief ──▶ submit_customer_analysis
                                                        │
                                                        ▼
                                          generate_ad_angles (framework)
                                                        │
                                                        ▼
                                          save_ad_concepts (Claude writes them)
                                                        │
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                          score_ad_concepts    generate_ad_copy      generate_layout
                                    │                                       │
                                    │                                       ▼
                                    │                             export_ad_image(_all_sizes)
                                    ▼
                    generate_ab_test_recommendations

save_campaign_result ──▶ get_campaign_insights (recommends angles from real results)
```

1. **Create a static ad brief** from a business description (`create_ad_brief`).
2. **Analyse the target customer** — pain points, offer, objections, desired action (`submit_customer_analysis`).
3. **Generate ad angles** — pain-point, offer, proof, urgency, comparison, aspirational (`generate_ad_angles` returns the framework; Claude writes the actual concepts).
4. **Score each concept** on clarity, conversion intent, emotional pull, visual simplicity, platform fit, and CTA strength — computed deterministically from the copy itself, not guessed (`save_ad_concepts` auto-scores; `score_ad_concepts` re-ranks).
5. **Generate ad copy** — headline, subheadline, CTA, proof point, urgency line (`generate_ad_copy` for refining one concept in place).
6. **Generate layout instructions** for Square (1080×1080), Portrait (1080×1350), Landscape (1200×628), and Story (1080×1920) — pixel-precise, computed from the copy length and brand profile (`generate_layout`).
7. **Export static ad files** as PNG and JPG (`export_ad_image`, `export_ad_image_all_sizes`).
8. **Save brand profiles** for repeat use across campaigns (`create_brand_profile`, `update_brand_profile`).
9. **Read previous campaign results** and get angle recommendations backed by real CTR/ROAS data (`save_campaign_result`, `get_campaign_insights`).
10. **A/B test recommendations** — concrete pairings, hypotheses, budget splits, sample-size guidance (`generate_ab_test_recommendations`).

## Design choice: who writes the creative?

This server does **not** call an LLM internally to write ad copy. Angle generation and copywriting tools (`generate_ad_angles`, `generate_ad_copy`) return rich, brief-specific **guidance** — the calling model (Claude, already reasoning in your conversation) writes the actual concepts and submits them via `save_ad_concepts`, which validates every field against the full concept schema.

This keeps the server dependency-light (no required API key for the core workflow) and puts the creative judgment where it belongs — with the model that already has the full conversation context. Scoring, layout, and export **are** fully deterministic/computed in code, because those are genuinely mechanical tasks that don't need a model in the loop.

Background image generation (a real photo/illustration instead of a brand-colour gradient) is the one genuinely optional integration point — see [Optional: AI background images](#optional-ai-background-images).

---

## Project structure

```
audema-adforge-mcp/
├── src/
│   ├── index.ts              # MCP server bootstrap (stdio transport)
│   ├── types.ts               # All Zod schemas: BrandProfile, AdBrief, AdConcept, LayoutSpec, CampaignResult
│   ├── tools/                 # One file per tool group, registered in tools/index.ts
│   │   ├── brandTools.ts
│   │   ├── briefTools.ts
│   │   ├── angleTools.ts
│   │   ├── conceptTools.ts
│   │   ├── copyTools.ts
│   │   ├── layoutTools.ts
│   │   ├── exportTools.ts
│   │   ├── campaignTools.ts
│   │   ├── campaignDraftTools.ts
│   │   ├── optimizationTools.ts # suggest_pause_candidates
│   │   ├── dcoTools.ts          # generate_creative_combinations
│   │   ├── complianceTools.ts   # check_brand_compliance
│   │   ├── calibrationTools.ts  # get_brand_score_calibration
│   │   ├── teardownTools.ts     # analyze_competitor_ad
│   │   └── abTestTools.ts
│   ├── render/
│   │   ├── layout.ts           # Deterministic layout spec generator
│   │   ├── svgTemplate.ts      # Builds the SVG for a concept + layout + brand
│   │   ├── renderer.ts         # Sharp: SVG → PNG/JPG, logo/background compositing
│   │   ├── imageProvider.ts    # Optional AI-generated background images (OpenAI/Replicate)
│   │   └── compliance.ts       # Logo overlap + WCAG contrast + forbidden-phrase checks
│   ├── campaigns/
│   │   ├── guardrails.ts       # Budget ceiling + basic ad-copy policy checks
│   │   ├── platformAdapters.ts # Real ad-platform integration (Meta only so far), PAUSED-only
│   │   ├── statistics.ts       # Real A/B test sample-size + significance math
│   │   ├── optimizationRules.ts# Rules engine for suggest_pause_candidates
│   │   └── dco.ts              # Combinatorial creative variant generation
│   ├── storage/
│   │   ├── jsonStore.ts        # Tiny typed JSON file store (atomic writes, cross-process locking)
│   │   ├── index.ts            # brandStore, briefStore, conceptStore, layoutStore, campaignStore, campaignDraftStore
│   │   └── r2.ts               # Optional Cloudflare R2 upload for exported creative (hand-rolled SigV4)
│   └── prompts/
│       ├── angles.ts           # The 6 angle definitions + guidance builder
│       ├── analysis.ts         # Customer-analysis guidance builder
│       ├── copywriting.ts      # Headline formulas, CTA power verbs, copy guidance builder
│       ├── scoring.ts          # Heuristic scoring functions for the 6 criteria
│       ├── calibration.ts      # Per-brand scoring-weight calibration from real results
│       └── teardown.ts         # Competitor ad analysis (angle guess + scoring)
├── scripts/
│   └── smoke-test.mjs          # End-to-end test: drives the built server over stdio
├── test/                       # Unit tests (vitest) — 133 tests across storage, render, campaigns, prompts
├── data/                       # JSON storage (gitignored, created on first run)
├── exports/                    # Rendered PNG/JPG output (gitignored, created on first run)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── README.md
```

---

## Setup

```bash
cd audema-adforge-mcp
npm install
cp .env.example .env     # optional — defaults work with zero configuration
npm run build
```

Run the unit test suite (storage, layout math, scoring, SVG generation, image provider — no build required, no external calls made):

```bash
npm test
```

Verify everything works end-to-end (creates a brand, brief, concepts, layouts, and real exported images under `exports/`):

```bash
npm run test:e2e
```

Run both in one command:

```bash
npm run test:all
```

Run the server directly (for debugging — real MCP clients spawn this for you):

```bash
npm start
```

Inspect it interactively with the official MCP Inspector:

```bash
npm run inspect
```

---

## Claude Desktop configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "audema-adforge": {
      "command": "node",
      "args": ["/absolute/path/to/audema-adforge-mcp/dist/index.js"],
      "env": {
        "ADFORGE_DATA_DIR": "/absolute/path/to/audema-adforge-mcp/data",
        "ADFORGE_EXPORT_DIR": "/absolute/path/to/audema-adforge-mcp/exports"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "audema-adforge" listed under the 🔌 tools icon, with 22 tools available.

**Cursor** (`.cursor/mcp.json` in your project, or the global MCP settings) uses the same shape:

```json
{
  "mcpServers": {
    "audema-adforge": {
      "command": "node",
      "args": ["/absolute/path/to/audema-adforge-mcp/dist/index.js"]
    }
  }
}
```

---

## Example tool calls

A full campaign from a plain-English business description to exported ad images:

```
You: "I run Frostbite HVAC, a residential heating and cooling repair company.
      I want a static ad campaign for a mid-winter furnace-failure emergency
      promo. Set up a brand profile first — our colours are navy #1E3A8A and
      orange #F97316, we're direct and reassuring in tone, we've got 4.9 stars
      from 1,200+ reviews and 15 years in the metro area, and we waive the $49
      diagnostic fee with any repair."

Claude → create_brand_profile({
  businessName: "Frostbite HVAC",
  industry: "Residential HVAC repair",
  targetAudience: "Homeowners aged 35-65 whose heating or AC has just failed",
  brandVoice: "Direct, reassuring, no-nonsense",
  colours: { primary: "#1E3A8A", secondary: "#F97316", accent: "#F97316" },
  fonts: { heading: "Montserrat", body: "Inter" },
  proofPoints: ["4.9 stars from 1,200+ local reviews", "15 years serving the metro area"],
  commonOffers: ["$49 diagnostic fee waived with repair"]
})
→ returns brandProfileId

Claude → create_ad_brief({
  businessDescription: "Frostbite HVAC — mid-winter furnace-failure emergency promo",
  campaignGoal: "Drive same-day emergency furnace repair calls during a cold snap",
  brandProfileId: "<id from above>"
})
→ returns briefId + a customer-analysis prompt

Claude analyses the business and calls:
submit_customer_analysis({
  briefId: "<id>",
  targetCustomer: "A homeowner whose furnace just died on the coldest night of the year...",
  painPoints: ["Furnace stopped working overnight", "Worried about frozen pipes", "Bad past experience with no-shows"],
  offer: "Same-day emergency furnace repair, $49 diagnostic fee waived",
  objections: ["Will they actually come today?", "Is this going to cost a fortune?"],
  desiredAction: "Call now for same-day emergency service"
})

Claude → generate_ad_angles({ briefId: "<id>", angleTypes: ["pain-point", "offer", "urgency"] })
→ returns the angle-writing framework

Claude writes 3 concepts and calls:
save_ad_concepts({ concepts: [ {...}, {...}, {...} ] })
→ each concept is validated and auto-scored on all 6 criteria

Claude → score_ad_concepts({ briefId: "<id>" })
→ ranked list, highest overall score first

Claude → generate_layout({ conceptId: "<best concept id>", platformSize: "square" })
→ pixel-precise layout spec

Claude → export_ad_image_all_sizes({ conceptId: "<best concept id>", format: "png" })
→ Square, Portrait, Landscape, and Story PNGs written to ./exports/
```

Later, once the campaign has run:

```
Claude → save_campaign_result({
  brandProfileId: "<id>",
  conceptId: "<concept id>",
  platform: "Meta",
  dateRange: "2026-01-01 to 2026-01-14",
  spend: 850, impressions: 42000, clicks: 1260, leads: 38, revenue: 5700,
  winningCreativeNotes: "The frost-covered window visual stopped the scroll."
})
→ CTR, CPC, CPA, and ROAS computed automatically (3% CTR, $22.37 CPA, 6.71x ROAS)

Claude → get_campaign_insights({ brandProfileId: "<id>" })
→ "pain-point angles are your strongest performer — lean into that for the next campaign"

Claude → generate_ab_test_recommendations({ conceptIds: ["<id1>", "<id2>", "<id3>"] })
→ concrete test pairings, hypotheses, budget splits, minimum sample size guidance
```

---

## Full tool reference

| Tool | Purpose |
|---|---|
| `create_brand_profile` | Save a reusable brand profile |
| `update_brand_profile` | Update fields on an existing brand profile |
| `get_brand_profile` / `list_brand_profiles` | Retrieve brand profiles |
| `create_ad_brief` | Start a campaign from a business description |
| `submit_customer_analysis` | Attach target customer / pain points / offer / objections / desired action |
| `get_ad_brief` / `list_ad_briefs` | Retrieve briefs |
| `generate_ad_angles` | Get the angle-writing framework (pain-point, offer, proof, urgency, comparison, aspirational) |
| `save_ad_concepts` | Submit fully-written concepts; validated + auto-scored |
| `score_ad_concepts` | Re-score / rank existing concepts |
| `get_ad_concept` / `list_ad_concepts` | Retrieve concepts |
| `generate_ad_copy` | Get copy-refinement guidance for one concept |
| `generate_layout` | Compute a pixel-precise layout spec for a platform size |
| `list_layouts` | Retrieve generated layouts for a concept |
| `export_ad_image` | Render one concept at one size to PNG/JPG |
| `export_ad_image_all_sizes` | Render one concept to all 4 standard sizes |
| `save_campaign_result` | Record real campaign performance |
| `list_campaign_results` | Retrieve campaign results for a brand |
| `get_campaign_insights` | Data-driven angle recommendations from past results |
| `generate_ab_test_recommendations` | Concrete A/B test pairings for a set of concepts |
| `create_campaign_draft` | Create a paused/draft campaign from a scored concept — never active, see Guardrails below |
| `list_campaign_drafts` / `get_campaign_draft` | Retrieve campaign drafts for a brand |
| `calculate_test_sample_size` | Real two-proportion power calculation — how many visitors per variant before you can trust a result |
| `check_test_significance` | Real two-proportion z-test on actual conversion counts — p-value, lift, and a small-sample warning, not just a verdict |
| `suggest_pause_candidates` | Revealbot-style rule engine flagging underperforming results for human review — recommendation only, never pauses anything itself |
| `generate_creative_combinations` | Dynamic Creative Optimization — auto-assemble headline × subheadline × CTA × visual-direction combinations as scored concepts, capped at 60 |
| `check_brand_compliance` | Logo safe-zone overlap, WCAG AA contrast, and forbidden-phrase checks against a concept's actual computed layout |
| `get_brand_score_calibration` | Shows how this brand's own real campaign results have (or haven't yet) calibrated its scoring weights |
| `analyze_competitor_ad` | Run a pasted-in competitor ad through the same scoring engine — angle guess, full score breakdown, what to borrow/avoid |

## Platform sizes

| Key | Dimensions | Typical use |
|---|---|---|
| `square` | 1080×1080 | Meta / LinkedIn feed |
| `portrait` | 1080×1350 | Instagram feed |
| `landscape` | 1200×628 | Facebook / LinkedIn link ads |
| `story` | 1080×1920 | Instagram / Facebook / TikTok Stories |

## Schemas

**Brand profile:** `businessName`, `industry`, `targetAudience`, `brandVoice`, `colours` (primary/secondary/accent/background/text), `fonts` (heading/body), `logoPath`, `forbiddenPhrases`, `preferredCTA`, `proofPoints`, `guarantees`, `commonOffers`.

**Ad concept:** `conceptName`, `angleType`, `targetEmotion`, `customerPainPoint`, `hook`, `headline`, `subheadline`, `cta`, `proofPoint`, `urgencyLine`, `visualDirection`, `layoutNotes`, `platformSize`, `conversionRationale`, `abTestSuggestion`, `scores` (clarity, conversionIntent, emotionalPull, visualSimplicity, platformFit, ctaStrength, overall).

**Campaign result:** `platform`, `dateRange`, `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `leads`, `cpa`, `purchases`, `roas`, `winningCreativeNotes`, `losingCreativeNotes`. `ctr`/`cpc`/`cpa`/`roas` are computed automatically from the raw numbers if you don't supply them directly.

See `src/types.ts` for the full Zod definitions — every field has an inline description that's also surfaced to the calling model.

---

## Optional: AI background images

By default, ads render with a brand-colour solid or gradient background — genuinely fine for most static ads, and zero-config. If you want a photographic or illustrated background instead, there are two ways to get one:

**Bring your own image.** Generate or source it yourself (any provider, a stock photo, a real product shot), save it to disk, and pass its path as `backgroundImagePath` to `export_ad_image`. No configuration needed — this always works.

**Generate one inline.** Pass a `backgroundPrompt` to `export_ad_image` instead of `backgroundImagePath`, and the server will call the configured AI image provider itself (`src/render/imageProvider.ts`), cache the result under `ADFORGE_DATA_DIR/generated-images`, and render with it. Requires setting `ADFORGE_IMAGE_PROVIDER` in `.env` to one of:

- `openai` — calls `gpt-image-1` using `OPENAI_API_KEY`. **Uses the exact same environment variable name as the main Audema web app** — if you already have that key set for the live product, the same value works here too (this server never runs on Vercel itself; only the key value is shared).
- `replicate` — calls a hosted diffusion model (`black-forest-labs/flux-schnell` by default, override with `REPLICATE_IMAGE_MODEL`) using `REPLICATE_API_TOKEN`.
- `none` (default) — `backgroundPrompt` is rejected with a clear, specific error telling you which env var to set, rather than silently falling back to a flat background. If you asked for a generated image, you'll know when you didn't get one.

Every call is cached by prompt + canvas size, so re-exporting the same concept at the same platform size never re-generates (or re-bills) the image.

---

## Campaign drafts & guardrails

`create_campaign_draft` pushes a scored concept toward a real ad platform — but only ever as far as a **paused, non-spending draft**. This is the one part of the server with real financial and compliance consequence, so it's built around three guardrails rather than caller discipline:

**1. Draft mode is not optional — there is no code path to "active".** `create_campaign_draft` hard-codes `status: 'PAUSED'` in the request to every platform adapter (`src/campaigns/platformAdapters.ts`); nothing in this server can flip a campaign live. Publishing is a deliberate action you take yourself in the platform's ads manager after reviewing the draft.

**2. A hard budget ceiling, enforced server-side.** `ADFORGE_MAX_DAILY_BUDGET_CENTS` (default $100/day) is read from the environment, never from a tool argument — so an LLM asked (or tricked, e.g. via prompt injection in a brief) to request an oversized budget can't get past it. A request over the ceiling is **rejected outright**, never silently reduced to fit — you'll get a clear error, not a surprise.

**3. A basic ad-copy policy pre-check.** Before anything is created, the concept's copy is scanned for the most obvious risk patterns (unsubstantiated guarantees, medical cure claims, excessive capitalization — `src/campaigns/guardrails.ts`). **This is not a substitute for the platform's own review** — Meta/LinkedIn run far more sophisticated policy checks server-side on submission — it exists to catch the obvious problems before spending an API call, not to certify compliance.

**Platform status today: Meta only, and unverified against a live account.** `src/campaigns/platformAdapters.ts` implements Meta's Marketing API contract (`POST /act_{account}/campaigns`) from Meta's published docs, but no MCP tool call in this codebase has ever hit the real endpoint — there were no developer credentials to test against when this was built. LinkedIn and TikTok aren't implemented at all yet (drafts for those platforms always save locally). Before trusting the Meta adapter with real spend:

1. Get a Meta developer app with Marketing API access approved (this can take a while — it's Meta's process, not something this server can shortcut).
2. Set `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` in `.env`.
3. Run `create_campaign_draft` once against a real, low/zero-budget test campaign and **confirm in Meta Ads Manager that it actually landed in PAUSED status** before relying on it for anything real.

Without `META_ACCESS_TOKEN`/`META_AD_ACCOUNT_ID` set, drafts save locally only (`campaign-drafts.json`) — still genuinely useful for planning and review, just not pushed anywhere.

---

## Competitive feature set

These six were built after a competitive scan of AdCreative.ai, Foreplay.co, Motion/Madgicx, Revealbot, Smartly.io/Celtra, and AdEspresso — keeping only what's honestly buildable with deterministic logic on data this server actually has, and explicitly skipping what would require faking a claim (a "predicts CTR with 90% accuracy" model needs proprietary cross-account training data this server doesn't have and never will on its own; a scraped competitor-ad library needs ongoing scraping infrastructure this is not).

- **Real A/B test statistics** (`calculate_test_sample_size`, `check_test_significance`) — an actual two-proportion power calculation and z-test, not a rule-of-thumb ("wait for ~100 conversions"). `generate_ab_test_recommendations` now computes a real sample-size number automatically when the brand has historical conversion data (`src/campaigns/statistics.ts`).
- **Rules-based pause recommendations** (`suggest_pause_candidates`) — a Revealbot-style rules engine over saved campaign results (CPA/ROAS/CTR/CPC thresholds), with sensible defaults auto-derived from the brand's *own* historical average rather than an arbitrary industry number. Recommendation-only, by design — this server has no live write access to pause real spend, and even once it does, that should stay a human decision (`src/campaigns/optimizationRules.ts`).
- **Dynamic Creative Optimization** (`generate_creative_combinations`) — Smartly.io/Celtra-style combinatorial variant generation: headline × subheadline × CTA × visual direction, auto-assembled and scored, capped at 60 combinations, with brand-forbidden phrases filtered out before anything is saved (`src/campaigns/dco.ts`).
- **Structural brand compliance** (`check_brand_compliance`, and non-blocking warnings baked into `export_ad_image`) — logo safe-zone overlap and real WCAG AA contrast-ratio math against the actual rendered layout and colours, not a visual-ML guess (`src/render/compliance.ts`).
- **Per-brand score calibration** (`get_brand_score_calibration`, applied automatically by `score_ad_concepts`) — as a brand's own real campaign results accumulate (linked via `conceptId` in `save_campaign_result`), the 6 scoring dimensions' weights are nudged, within a bounded ±20%, toward whatever has actually correlated with that brand's real outcomes. Requires a minimum of 5 linked results before adjusting anything at all — below that, or with no meaningful correlation, it says so plainly rather than pretending to have signal it doesn't (`src/prompts/calibration.ts`).
- **Competitor ad teardown** (`analyze_competitor_ad`) — paste in a competitor's actual ad copy and it runs through the exact same scoring engine used on your own concepts, plus a best-effort angle-type guess and concrete "what to borrow / what to avoid" notes. The honest substitute for a scraped ad library this server doesn't have (`src/prompts/teardown.ts`).

## Storage

Brand profiles, briefs, concepts, layouts, and campaign results are stored as JSON files under `ADFORGE_DATA_DIR` (default `./data`), one file per entity type. No database server, no native SQLite build step — just plain files you can back up, inspect, or version-control if you want to.

### Optional: hosted exports via Cloudflare R2

`export_ad_image`/`export_ad_image_all_sizes` always write to local disk regardless of configuration — R2 is purely additive. When `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` are set, the rendered file is also uploaded to the **same shared R2 bucket the main Audema web app uses** (under an `adforge/` prefix, alongside the web app's `social-creatives/` prefix), so a creative built here can be handed straight to a publish flow that needs a real fetchable URL instead of a local file path. Set `R2_PUBLIC_BASE_URL` (a custom domain or the bucket's `r2.dev` URL) to actually get that URL back — without it, uploads still succeed but there's no way to build a public link to the raw S3 API endpoint.

Implemented via hand-rolled AWS SigV4 request signing (`src/storage/r2.ts`, Node's built-in `crypto` only — no `aws-sdk` dependency), since R2 exposes an S3-compatible API. SigV4 itself is a stable, long-documented public standard, not a shifting vendor contract — but verify with one real upload after adding credentials and confirm the object actually appears in the R2 dashboard; a signing bug fails loudly (403 `SignatureDoesNotMatch`), never silently.

## Notes on rendering

- Rendering uses [Sharp](https://sharp.pixelplumbing.com/), which rasterizes an SVG (background + text, built per-concept in `src/render/svgTemplate.ts`) to PNG or JPG.
- Custom fonts named in a brand profile (`fonts.heading` / `fonts.body`) are used as the SVG `font-family` with a generic fallback. For the exact font to render, it needs to be installed as a system font where the server runs — Sharp/librsvg picks up fonts from the OS font registry, the same way a browser would. If a named font isn't installed, the renderer falls back gracefully to the platform default sans-serif rather than failing.
- Text wrapping uses a character-width heuristic (no real font metrics loaded) — accurate enough for ad-copy-length headlines/subheadlines at the font sizes used here.
