import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isR2Configured, uploadToR2 } from '../../src/storage/r2.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_PUBLIC_BASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('isR2Configured', () => {
  it('is false when nothing is set', () => {
    expect(isR2Configured()).toBe(false);
  });

  it('is false when only some vars are set', () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    expect(isR2Configured()).toBe(false);
  });

  it('is true once all four required vars are set', () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    expect(isR2Configured()).toBe(true);
  });
});

describe('uploadToR2', () => {
  function configure() {
    process.env.R2_ACCOUNT_ID = 'testaccount123';
    process.env.R2_ACCESS_KEY_ID = 'AKIDEXAMPLE';
    process.env.R2_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.R2_BUCKET_NAME = 'test-bucket';
  }

  it('throws when not configured, without attempting a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadToR2('adforge/foo.png', Buffer.from('x'), 'image/png')).rejects.toThrow(/R2_ACCOUNT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs to the correct R2 endpoint with a well-formed SigV4 Authorization header', async () => {
    configure();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadToR2('adforge/foo.png', Buffer.from('hello world'), 'image/png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://testaccount123.r2.cloudflarestorage.com/test-bucket/adforge/foo.png');
    expect(init.method).toBe('PUT');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
    // SHA256("hello world") — a well-known reference hash, independent of this implementation.
    expect(headers['x-amz-content-sha256']).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['Authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
  });

  it('URL-encodes special characters in the object key', async () => {
    configure();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadToR2('adforge/my file (1).png', Buffer.from('x'), 'image/png');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://testaccount123.r2.cloudflarestorage.com/test-bucket/adforge/${encodeURIComponent('my file (1).png')}`);
  });

  it('returns null when R2_PUBLIC_BASE_URL is not set, even on a successful upload', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
    const result = await uploadToR2('adforge/foo.png', Buffer.from('x'), 'image/png');
    expect(result).toBeNull();
  });

  it('returns the built public URL when R2_PUBLIC_BASE_URL is set', async () => {
    configure();
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com/';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
    const result = await uploadToR2('adforge/foo.png', Buffer.from('x'), 'image/png');
    expect(result).toBe('https://cdn.example.com/adforge/foo.png');
  });

  it('throws with the response body on a failed upload', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'SignatureDoesNotMatch' })));
    await expect(uploadToR2('adforge/foo.png', Buffer.from('x'), 'image/png')).rejects.toThrow(/403/);
  });

  it('produces a different signature for different content, same key/time — content is actually part of what is signed', async () => {
    configure();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadToR2('adforge/foo.png', Buffer.from('content A'), 'image/png');
    await uploadToR2('adforge/foo.png', Buffer.from('content B'), 'image/png');

    const sig1 = (fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers['Authorization'];
    const sig2 = (fetchMock.mock.calls[1][1] as RequestInit & { headers: Record<string, string> }).headers['Authorization'];
    expect(sig1).not.toBe(sig2);
  });
});
