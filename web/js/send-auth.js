/**
 * send-auth.js — attach the caller's session to a send request.
 *
 * api/send-campaign.js and api/send-email.js used to accept anyone. They now
 * identify the sending account from the caller's own Supabase access token,
 * which means every client call site has to carry it. This is that one line,
 * in one place, so a new call site cannot quietly omit it and a future change
 * to how sessions are read touches a single function.
 *
 * Exposes: window.sendAuthHeaders()
 */
(function () {
  'use strict';

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  /**
   * client.auth.getSession() can reject with "Acquiring an exclusive
   * Navigator LockManager lock ... immediately failed" — supabase-js's own
   * cross-tab coordination for refreshing the session, documented in
   * web/js/supabase-client.js as benign and self-resolving: whichever tab
   * loses the race just has to wait a moment for the other one to finish.
   * A single attempt right at that moment used to be treated the same as
   * "there is no session" — silently sending the request with no
   * Authorization header, which the server then correctly (but confusingly)
   * rejects as an expired/missing session, even though a real, valid session
   * exists and would have been found a fraction of a second later. Two short
   * retries give the other side time to finish and release the lock before
   * this genuinely gives up.
   */
  async function getSessionWithRetry(client) {
    const delays = [120, 250];
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.auth.getSession();
      } catch (e) {
        if (!e || !e.isAcquireTimeout || attempt >= delays.length) throw e;
        await sleep(delays[attempt]);
      }
    }
  }

  /**
   * Content-Type plus Authorization when a session is available.
   *
   * Returns without the header rather than throwing when there is no session:
   * the server is the thing that must refuse an unauthenticated send, and a
   * client-side throw here would just produce a worse error message than the
   * server's own "Sign in to send".
   */
  window.sendAuthHeaders = async function sendAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (window.Supabase && window.Supabase.ready) await window.Supabase.ready();
      const client = window.Supabase && window.Supabase.getClient && window.Supabase.getClient();
      const session = client && await getSessionWithRetry(client);
      const token = session && session.data && session.data.session
        && session.data.session.access_token;
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (e) {
      // No session, or the auth client is not loaded on this page. The send
      // will come back 401 with a message that says what to do.
    }
    return headers;
  };
})();
