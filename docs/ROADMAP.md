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
(audit each shortlisted website and score the opportunity) and Pat (draft,
QA-check and prepare outreach), and run in that order within a mission. Every
other agent still produces a written plan rather than running its pipeline.
