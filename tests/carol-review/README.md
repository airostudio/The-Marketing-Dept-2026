# Carol → Scotty review handoff

```bash
export PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright   # if needed
node tests/carol-review/run.js           # the data path, end to end
node tests/carol-review/carol-page.js    # Carol's real page renders + sends
node tests/carol-review/scotty-inbox.js  # Scotty's inbox reviews + decides
```

## What broke

Carol listed work that needed reviewing, but each card carried only a
~100-character snippet and a link to the *agent*, not to the item. Clicking
"Open" landed you on an agent page with no idea which post was meant — a blank
page. You could see that something needed review, but not what.

## What the tests hold in place

**The content is real.** Cards carry the whole post — hook, headline, body,
CTA, hashtags — and outreach items carry the actual subject and body of the
email that would be sent. `run.js` asserts the preview contains the real body
text rather than a truncation, and that the link deep-links to the specific
record.

**Scotty reviews the thing, not the label.** Items are queued with a snapshot
of the content as it was when sent. A review of "post #4f2c" that re-fetches
the record is a review of whatever that record says *now*, and the reasoning
would quietly stop matching what it was about. `scotty-inbox.js` asserts the
prompt Scotty receives contains the actual post body.

**A verdict is not a decision.** Scotty recommends; the owner decides. The
tests assert an item stays `reviewed` (not `approved`) after Scotty's verdict,
and only reaches `approved` once the owner clicks — at which point the
decision is written back to the originating record, so approving a post
actually makes it `approved` rather than just annotating a queue.

## Note on the harnesses

Both page tests stub the stores, and both stubs must be injected *after* the
real store scripts — otherwise the real module overwrites the stub and the
test silently exercises the offline path instead. Both `carol-page.js` and
`scotty-inbox.js` hit exactly that during development.
