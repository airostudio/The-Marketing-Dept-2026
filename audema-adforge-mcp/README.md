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
│   │   └── abTestTools.ts
│   ├── render/
│   │   ├── layout.ts           # Deterministic layout spec generator
│   │   ├── svgTemplate.ts      # Builds the SVG for a concept + layout + brand
│   │   └── renderer.ts         # Sharp: SVG → PNG/JPG, logo/background compositing
│   ├── storage/
│   │   ├── jsonStore.ts        # Tiny typed JSON file store (no native deps)
│   │   └── index.ts            # brandStore, briefStore, conceptStore, layoutStore, campaignStore
│   └── prompts/
│       ├── angles.ts           # The 6 angle definitions + guidance builder
│       ├── analysis.ts         # Customer-analysis guidance builder
│       ├── copywriting.ts      # Headline formulas, CTA power verbs, copy guidance builder
│       └── scoring.ts          # Heuristic scoring functions for the 6 criteria
├── scripts/
│   └── smoke-test.mjs          # End-to-end test: drives the built server over stdio
├── test/                       # Unit tests (vitest) for storage, layout, scoring, SVG, image provider
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

## Storage

Brand profiles, briefs, concepts, layouts, and campaign results are stored as JSON files under `ADFORGE_DATA_DIR` (default `./data`), one file per entity type. No database server, no native SQLite build step — just plain files you can back up, inspect, or version-control if you want to.

## Notes on rendering

- Rendering uses [Sharp](https://sharp.pixelplumbing.com/), which rasterizes an SVG (background + text, built per-concept in `src/render/svgTemplate.ts`) to PNG or JPG.
- Custom fonts named in a brand profile (`fonts.heading` / `fonts.body`) are used as the SVG `font-family` with a generic fallback. For the exact font to render, it needs to be installed as a system font where the server runs — Sharp/librsvg picks up fonts from the OS font registry, the same way a browser would. If a named font isn't installed, the renderer falls back gracefully to the platform default sans-serif rather than failing.
- Text wrapping uses a character-width heuristic (no real font metrics loaded) — accurate enough for ad-copy-length headlines/subheadlines at the font sizes used here.
