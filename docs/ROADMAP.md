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
text posts) and SEO (competitor and keyword research, topics, drafted
articles). Blade, Chase and Pat run in that order within a
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
