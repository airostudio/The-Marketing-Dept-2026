/**
 * Platform adapters for pushing a CampaignDraft to a real ad platform as a
 * PAUSED/draft campaign. Never creates anything in an active, spending
 * state — createPausedCampaign() is the only method these adapters expose.
 *
 * ── Status: Meta only, and UNVERIFIED against a live ad account ────────────
 * Only Meta (Graph Marketing API) is implemented. LinkedIn and TikTok throw
 * "not implemented" until built the same way. The Meta adapter's request
 * shape (POST /act_{account_id}/campaigns with name, objective, status,
 * special_ad_categories, daily_budget, access_token) is built from Meta's
 * published Marketing API documentation, but this codebase has never had
 * real Meta developer credentials to test it against — no MCP tool call
 * here has hit the live endpoint. Before relying on this for real spend:
 *   1. Get a Meta developer app + Marketing API access approved.
 *   2. Set META_ACCESS_TOKEN / META_AD_ACCOUNT_ID / META_API_VERSION.
 *   3. Run create_campaign_draft once against a real (low/zero budget) test
 *      campaign and confirm the created campaign actually lands in PAUSED
 *      status in Meta Ads Manager before trusting this for anything real.
 */

import type { CampaignDraft } from '../types.js';

export interface PlatformAdapterResult {
  platformCampaignId: string;
}

export interface PlatformAdapter {
  isConfigured(): boolean;
  unavailableReason(): string | null;
  /** Must only ever create the campaign in a paused/draft state — never active. */
  createPausedCampaign(draft: CampaignDraft): Promise<PlatformAdapterResult>;
}

interface MetaCampaignResponse {
  id?: string;
  error?: { message?: string; error_user_msg?: string };
}

class MetaAdapter implements PlatformAdapter {
  isConfigured(): boolean {
    return !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
  }

  unavailableReason(): string | null {
    if (!process.env.META_ACCESS_TOKEN) return 'META_ACCESS_TOKEN is not set in .env.';
    if (!process.env.META_AD_ACCOUNT_ID) return 'META_AD_ACCOUNT_ID is not set in .env.';
    return null;
  }

  async createPausedCampaign(draft: CampaignDraft): Promise<PlatformAdapterResult> {
    const reason = this.unavailableReason();
    if (reason) throw new Error(reason);

    const accountId = process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, '');
    const version = process.env.META_API_VERSION || 'v21.0';
    const url = `https://graph.facebook.com/${version}/act_${accountId}/campaigns`;

    const body = new URLSearchParams({
      name: draft.campaignName,
      objective: draft.objective,
      status: 'PAUSED', // hard-coded — this adapter has no code path that can request ACTIVE
      special_ad_categories: JSON.stringify([]), // required by the API; empty unless this campaign is housing/employment/credit/social-issue, which this server does not currently detect or handle
      daily_budget: String(draft.dailyBudgetCents),
      access_token: process.env.META_ACCESS_TOKEN!,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json().catch(() => ({}))) as MetaCampaignResponse;
    if (!res.ok || !data.id) {
      throw new Error(data.error?.error_user_msg || data.error?.message || `Meta campaign creation failed (${res.status})`);
    }

    return { platformCampaignId: data.id };
  }
}

class NotImplementedAdapter implements PlatformAdapter {
  constructor(private platformName: string) {}
  isConfigured(): boolean {
    return false;
  }
  unavailableReason(): string | null {
    return `${this.platformName} isn't implemented yet — only Meta is wired up today. This draft will be saved locally instead.`;
  }
  async createPausedCampaign(): Promise<PlatformAdapterResult> {
    throw new Error(this.unavailableReason()!);
  }
}

const ADAPTERS: Record<CampaignDraft['platform'], PlatformAdapter> = {
  meta: new MetaAdapter(),
  linkedin: new NotImplementedAdapter('LinkedIn'),
  tiktok: new NotImplementedAdapter('TikTok'),
};

export function getPlatformAdapter(platform: CampaignDraft['platform']): PlatformAdapter {
  return ADAPTERS[platform];
}
