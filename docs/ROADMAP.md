# Roadmap — coming soon

Things that are decided but not built yet. Each says what is missing today so
nobody assumes it works.

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
pages, added to the ICE backlog). Blade, Chase and Pat run in that order within a
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
