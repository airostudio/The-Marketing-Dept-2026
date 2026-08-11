import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPlatformAdapter } from '../../src/campaigns/platformAdapters.js';
import type { CampaignDraft } from '../../src/types.js';

const ORIGINAL_ENV = { ...process.env };

function makeDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: 'draft-1',
    brandProfileId: 'brand-1',
    conceptId: 'concept-1',
    platform: 'meta',
    campaignName: 'Test Campaign',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudgetCents: 2500,
    targeting: { countries: ['US'], ageMin: 18, ageMax: 65, interests: [] },
    status: 'local_only',
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_AD_ACCOUNT_ID;
  delete process.env.META_API_VERSION;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('Meta adapter', () => {
  it('is not configured without both META_ACCESS_TOKEN and META_AD_ACCOUNT_ID', () => {
    const adapter = getPlatformAdapter('meta');
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.unavailableReason()).toMatch(/META_ACCESS_TOKEN/);

    process.env.META_ACCESS_TOKEN = 'token';
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.unavailableReason()).toMatch(/META_AD_ACCOUNT_ID/);

    process.env.META_AD_ACCOUNT_ID = '123456';
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.unavailableReason()).toBeNull();
  });

  it('throws rather than calling the API when not configured', async () => {
    const adapter = getPlatformAdapter('meta');
    await expect(adapter.createPausedCampaign(makeDraft())).rejects.toThrow(/META_ACCESS_TOKEN/);
  });

  it('POSTs to the documented campaign-creation endpoint with status hard-coded to PAUSED', async () => {
    process.env.META_ACCESS_TOKEN = 'test-token';
    process.env.META_AD_ACCOUNT_ID = 'act_123456';

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: '120210000000000' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = getPlatformAdapter('meta');
    const result = await adapter.createPausedCampaign(makeDraft({ dailyBudgetCents: 4200 }));

    expect(result.platformCampaignId).toBe('120210000000000');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/act_123456/campaigns');
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('status')).toBe('PAUSED'); // the one guarantee that must never break
    expect(body.get('name')).toBe('Test Campaign');
    expect(body.get('objective')).toBe('OUTCOME_TRAFFIC');
    expect(body.get('daily_budget')).toBe('4200');
    expect(body.get('special_ad_categories')).toBe('[]');
    expect(body.get('access_token')).toBe('test-token');
  });

  it('strips a redundant "act_" prefix from META_AD_ACCOUNT_ID rather than double-prefixing the URL', async () => {
    process.env.META_ACCESS_TOKEN = 'test-token';
    process.env.META_AD_ACCOUNT_ID = 'act_999';

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'x' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await getPlatformAdapter('meta').createPausedCampaign(makeDraft());
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/act_999/campaigns');
  });

  it('surfaces the platform error message on failure', async () => {
    process.env.META_ACCESS_TOKEN = 'test-token';
    process.env.META_AD_ACCOUNT_ID = '123456';

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid parameter' } }),
    })));

    await expect(getPlatformAdapter('meta').createPausedCampaign(makeDraft())).rejects.toThrow('Invalid parameter');
  });

  it('respects a META_API_VERSION override', async () => {
    process.env.META_ACCESS_TOKEN = 'test-token';
    process.env.META_AD_ACCOUNT_ID = '123456';
    process.env.META_API_VERSION = 'v99.0';

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'x' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await getPlatformAdapter('meta').createPausedCampaign(makeDraft());
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v99.0/');
  });
});

describe('LinkedIn / TikTok adapters', () => {
  it('are not configured and refuse to create anything (not implemented yet)', async () => {
    for (const platform of ['linkedin', 'tiktok'] as const) {
      const adapter = getPlatformAdapter(platform);
      expect(adapter.isConfigured()).toBe(false);
      await expect(adapter.createPausedCampaign(makeDraft({ platform }))).rejects.toThrow(/isn't implemented/i);
    }
  });
});
