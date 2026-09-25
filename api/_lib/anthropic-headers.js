/**
 * api/_lib/anthropic-headers.js — one place for the headers every Anthropic
 * call sends.
 *
 * An organization-level API key (one created with no workspace selected)
 * is rejected by Anthropic with a 400 unless the request also carries
 * `anthropic-workspace-id`. A workspace-scoped key does not need it. Which
 * kind of key is live depends on how it was generated in the Anthropic
 * Console — a detail easy to get wrong on a rotation and invisible until
 * the first request fails.
 *
 * ANTHROPIC_WORKSPACE_ID is optional. Set it only if ANTHROPIC_API_KEY is
 * an org-level key; a workspace-scoped key ignores the header if present.
 */
'use strict';

function anthropicHeaders(apiKey, extra) {
  const headers = Object.assign(
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    extra || {}
  );
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;
  return headers;
}

module.exports = { anthropicHeaders };
