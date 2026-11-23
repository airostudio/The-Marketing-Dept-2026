# Roadmap — coming soon

Things that are decided but not built yet. Each says what is missing today so
nobody assumes it works.

## Autopilot

SEO Autopilot writes and publishes to WordPress, Webflow, Shopify and Wix on a schedule. Analytics Brain, CRO Lab and Social Studio run on the same engine and hand their work over for approval. It earns trust first, repairs what it can, asks for logins and approvals, and reports in What happened.

- **Not yet included:**
  - **Search Console screens.** The weekly Search report reads real Search Console data through each business's Google sign-in. The older Search Console screens in the SEO section still use the unfinished browser sign-in and show no real data.
  - **Technical fixes on the site.** Changing titles, meta descriptions, image alt text or schema on existing pages. Today the audits recommend these changes but don't apply them.
  - **Featured images** on published articles.
  - **Sign-in buttons for the platforms.** Logins are pasted (application password, token or API key) rather than connected by a one-click sign-in (OAuth app). Shopify and Wix one-click sign-in need a registered public app.
  - **Social sign-in gaps.** LinkedIn, Facebook Pages and X publish through each business's own sign-in. Still missing: images on LinkedIn and X posts, Instagram and TikTok sign-in, and LinkedIn Company Pages.
  - **Not yet on autopilot:** Nancy's illustrated week (its images are made step by step from the browser), Pat's email campaigns (sending stays behind Pat's own checks), Blade discovery runs outside area sweeps, and the Deck Maker.
  - **Analytics scoped by business.** Analytics Brain's facts are gathered for the account owner's whole login, not one business profile.
  - **Wix drafts on retry.** Before a retry posts again, the duplicate check looks for an existing post. On Wix it can only find published posts, so a Wix *draft* that timed out after it was created could be saved twice.

## Automation flows

- **Teammate-created contacts in automatic enrolment.** Today the
  contact-created and segment-entry triggers (`api/cron-flow-triggers.js`)
  only see contacts added under the flow owner's own login. Contacts a
  teammate adds on a shared business profile are not picked up. Doing it
  properly means both the trigger job and the flow sender
  (`api/cron-email-flows.js`, whose contact lookup is scoped to the flow
  owner) resolve contacts through the shared profile, so a teammate's
  unsubscribed contact is still seen as unsubscribed. The flow screen says so
  under the automatic triggers.
- **Flow editing.** A saved flow cannot be edited from the screen; create a
  new one.
- **Live enrolment counts** after "Enrol this segment" (currently refresh the
  page).

## Blade area sweeps

Blade can sweep every town in a county, a state or a whole country (GeoNames)
for the chosen trades, in the background, within a search budget
(`/agents/blade-sweeps.html`). For Webese, qualified businesses go into the
state's "Webese <State> Outreach Tracker" the way the Outreach platform
expects: business columns only, HOLD + CONTACT_ENRICHMENT_REQUIRED_LIVE,
duplicates skipped, the research cursor and Run History kept up to date.

- **Not yet included:** marking a state FIRST_PASS_COMPLETE (left to the
  operator, because a sweep covers only the trades chosen, not every
  category); creating a missing tracker sheet; writing Business Time Zone /
  Local Send Time; a Webese tracker outside the US (the Outreach platform only
  reads US state trackers); posting a heartbeat to the Outreach platform's
  task board; areas with more than about 5,000 towns in one go (sweep them
  county by county, or raise the minimum population); a Scotty mission step
  that starts a sweep.

## Scorecards & waitlists

Hosted question pages at `/s/<slug>` that campaigns can point to (Marketing →
Scorecards & Waitlists). A scorecard scores visitors and shows a personal
result; a waitlist validates an idea before it is built, and waitlists in the
same comparison group can be compared. Only visitors who tick the consent box
become contacts, tagged so the segments made on publish can trigger email
flows.

- **Not yet included:** embedding a scorecard on the business's own website
  (our pages forbid framing; a hosted link only for now); a custom domain or
  branding per business; editing answer options of a live scorecard without
  affecting earlier answers' counts; a CAPTCHA (bots are slowed by a hidden
  field, a minimum fill time and rate limits); Scotty using a live scorecard
  link as the default destination for Pat, Nancy, Social Studio and Ads (paste
  a share link for now); statistical significance in waitlist comparisons
  (it shows real counts only); emailing the visitor a copy of their result.
- **Webese:** its `/for` pages live in another repository. When marketing
  Webese, a scorecard or waitlist here can be linked from those pages.

## Scotty (autonomous missions)

Real executors exist for Blade (find and enrich local prospects), Chase
(audit each shortlisted website and score the opportunity), Pat (draft,
QA-check and prepare outreach) and Nancy (research a website, write and design
a week of Instagram posts) Social Studio (a batch of LinkedIn / X / Facebook
text posts) SEO (competitor and keyword research, topics, drafted
articles) Ads (platform-checked ad copy) and Analytics (a performance report written only
from the account's own recorded numbers, every figure checked) and
Competitive Intelligence (quote-verified battlecards from competitors' own
websites, with daily change-watching) and CRO (citation-checked A/B test ideas for real
pages, added to the ICE backlog) and LinkedIn Outreach (checked connection
notes and follow-ups as drafts) and Video Studio (one short AI clip from a
checked shot prompt, added to the Video Studio gallery) and Compliance Guard
(screens the mission's own outputs before approval; every finding quotes the
words it is about, and an output with a critical finding needs a confirmed
read before it can be approved). Compliance always runs last. Blade, Chase and Pat run in that order within a
mission; Nancy is independent. Every
other agent still produces a written plan rather than running its pipeline.

- **Nancy in missions — not yet included:** uploaded photos and the logo overlay
  (a mission has no one to supply them), avoiding topics used in earlier weeks,
  and choosing platforms other than Instagram. Needs image hosting (R2) set up.
- **Social Studio in missions — not yet included:** Instagram and TikTok posts
  (they need artwork; Instagram is Nancy's), X threads (a thread cannot be
  posted automatically, so over-length X posts are left out on approval), and
  images or video on any post.
- **SEO in missions — not yet included:** technical site audits, backlink
  prospecting and outreach (still done on the SEO Content Engine page), the
  daily task plan, and more than three articles per mission.
- **Ads in missions — not yet included:** ad images and video (the Ad Creative
  Lab page still makes those), A/B test setup, and anything that talks to a real
  ad account (Meta, Google, LinkedIn): there is no ad-platform connection, so
  approved ad copy is kept for pasting into an ad manager, not launched.
- **Analytics in missions — not yet included:** anything that needs data the
  platform does not record — website traffic, social reach/likes/followers,
  ad spend, and forecasts or attribution models. Reports cover the calling
  user's own email campaigns (campaigns sent by a teammate on a shared profile
  are not included), the audience, flows, social posts and shop-reported
  revenue, for the last 7, 30 or 90 days.
- **Competitive Intelligence in missions — not yet included:** finding
  competitors for you (it only reads sites you name or already keep in your
  Business Brain), reviews/social/ad-library monitoring, and anything beyond a
  competitor's public website pages (pricing behind a login, JavaScript-only
  pages and PDFs are not read). Findings are only as complete as the pages that
  could be fetched, and the report says which pages were read.
- **CRO in missions — not yet included:** building or launching an A/B test
  (a test is only added to the backlog; the CRO Lab page sets up the
  experiment), judging running experiments' results, and anything that needs
  real visitor behaviour data (heatmaps, funnels, session recordings) — the
  audit reads the page's own HTML and text, at most two pages per mission, and
  cannot see how it renders or how visitors use it.
- **LinkedIn Outreach in missions — not yet included, and partly deliberately:**
  sending. LinkedIn's terms forbid automated connection requests and messages,
  so drafts are always sent by hand. It also does not search LinkedIn or read
  profiles — it only knows what you give it (up to 10 people per mission). The
  approved drafts are filed in this browser's LinkedIn Outreach prospect list
  (which is stored in the browser, not the cloud).
- **Compliance Guard in missions — not yet included:** a lawyer (it is an
  AI-assisted screen, and says so everywhere), fixing the content for you (it
  suggests wording; the person edits and re-runs the agent), images and the
  video's own frames (it reads text, image text Nancy wrote, and the video's
  shot prompt — not pixels), landing pages and links the content points to,
  and outputs a teammate owns on a shared profile unless you can edit them.
  Enterprise compliance automation (SOC 2, ISO 27001) is a separate agent and
  still produces a written plan.
- **Video Studio in missions — not yet included:** more than one clip per
  mission, image-to-video from your own photo, scripts, voiceover, music,
  captions and editing several shots together, and putting the clip on a social
  post (done by hand from the Video Studio gallery; the social publishers do
  not upload video yet). On-screen words and logos are refused on purpose —
  video models garble them — so they are added in the edit. Each render is
  paid; without R2 storage set up the clip is only on the generator's expiring
  link, and is labelled that way.
