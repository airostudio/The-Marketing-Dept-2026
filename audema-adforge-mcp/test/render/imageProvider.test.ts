import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import {
  getConfiguredProvider,
  isImageProviderConfigured,
  unavailableReason,
  generateBackgroundImage,
  aspectRatioFor,
} from '../../src/render/imageProvider.js';
import { DATA_DIR } from '../../src/storage/index.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ADFORGE_IMAGE_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.REPLICATE_API_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('getConfiguredProvider', () => {
  it('defaults to "none" when unset', () => {
    expect(getConfiguredProvider()).toBe('none');
  });

  it('respects a valid ADFORGE_IMAGE_PROVIDER value', () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'openai';
    expect(getConfiguredProvider()).toBe('openai');
  });

  it('falls back to "none" for an unrecognized value', () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'midjourney';
    expect(getConfiguredProvider()).toBe('none');
  });
});

describe('isImageProviderConfigured / unavailableReason', () => {
  it('is unconfigured with no provider set', () => {
    expect(isImageProviderConfigured()).toBe(false);
    expect(unavailableReason()).toMatch(/not set/i);
  });

  it('is unconfigured when openai is selected but no key is present', () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'openai';
    expect(isImageProviderConfigured()).toBe(false);
    expect(unavailableReason()).toMatch(/OPENAI_API_KEY/);
  });

  it('is configured when openai is selected and a key is present', () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isImageProviderConfigured()).toBe(true);
    expect(unavailableReason()).toBeNull();
  });

  it('is unconfigured when replicate is selected but no token is present', () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'replicate';
    expect(isImageProviderConfigured()).toBe(false);
    expect(unavailableReason()).toMatch(/REPLICATE_API_TOKEN/);
  });
});

describe('aspectRatioFor', () => {
  it('maps square dimensions to 1:1', () => {
    expect(aspectRatioFor(1080, 1080)).toBe('1:1');
  });

  it('maps wide landscape dimensions to 16:9', () => {
    expect(aspectRatioFor(1920, 1080)).toBe('16:9');
  });

  it('maps tall story dimensions to 9:16', () => {
    expect(aspectRatioFor(1080, 1920)).toBe('9:16');
  });
});

describe('generateBackgroundImage', () => {
  it('throws a clear error instead of silently returning nothing when no provider is configured', async () => {
    await expect(generateBackgroundImage('a cozy coffee shop', 1080, 1080)).rejects.toThrow(/ADFORGE_IMAGE_PROVIDER/);
  });

  it('calls the OpenAI images endpoint, writes and caches the result, and does not re-call on a repeat prompt', async () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    const fakePngBase64 = Buffer.from('fake-png-bytes').toString('base64');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakePngBase64 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const path1 = await generateBackgroundImage('a cozy coffee shop', 1080, 1080);
    expect(existsSync(path1)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const path2 = await generateBackgroundImage('a cozy coffee shop', 1080, 1080);
    expect(path2).toBe(path1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached — no second network call
  });

  it('surfaces the OpenAI error message on a failed request', async () => {
    process.env.ADFORGE_IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Your request was rejected.' } }),
    })));

    await expect(generateBackgroundImage('a cozy coffee shop', 1080, 1080)).rejects.toThrow('Your request was rejected.');
  });
});
