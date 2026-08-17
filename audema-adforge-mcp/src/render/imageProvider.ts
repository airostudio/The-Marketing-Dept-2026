/**
 * AI-generated background images for export_ad_image.
 *
 * Uses the same OPENAI_API_KEY environment variable name as the main
 * Audema web app (api/openai.js, api/generate-ad-image.js) — if you've
 * already configured that key in Vercel for the live product, the exact
 * same value works here too. This server never runs on Vercel itself
 * (MCP servers are local stdio processes started by Claude Desktop/Cursor,
 * not deployed web services) — "in Vercel" only matters for the value of
 * the key, not for where this code executes.
 *
 * ADFORGE_IMAGE_PROVIDER selects which provider to call:
 *   'openai'    — gpt-image-1 (OPENAI_API_KEY)
 *   'replicate' — a hosted diffusion model (REPLICATE_API_TOKEN)
 *   'none' (default) — export_ad_image falls back to a flat/gradient
 *                        background; no network call is made.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from '../storage/index.js';

export type ImageProvider = 'none' | 'openai' | 'replicate';

export function getConfiguredProvider(): ImageProvider {
  const raw = (process.env.ADFORGE_IMAGE_PROVIDER || 'none').toLowerCase();
  return raw === 'openai' || raw === 'replicate' ? raw : 'none';
}

export function isImageProviderConfigured(): boolean {
  const provider = getConfiguredProvider();
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  if (provider === 'replicate') return !!process.env.REPLICATE_API_TOKEN;
  return false;
}

/** Human-readable reason generation isn't available, or null if it is. */
export function unavailableReason(): string | null {
  const provider = getConfiguredProvider();
  if (provider === 'none') {
    return 'ADFORGE_IMAGE_PROVIDER is not set (or is "none") — set it to "openai" or "replicate" in .env to enable AI-generated backgrounds.';
  }
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    return 'ADFORGE_IMAGE_PROVIDER=openai but OPENAI_API_KEY is not set in .env.';
  }
  if (provider === 'replicate' && !process.env.REPLICATE_API_TOKEN) {
    return 'ADFORGE_IMAGE_PROVIDER=replicate but REPLICATE_API_TOKEN is not set in .env.';
  }
  return null;
}

const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'generated-images');

function cacheFilePath(prompt: string, width: number, height: number): string {
  const hash = createHash('sha256').update(`${prompt}|${width}x${height}`).digest('hex').slice(0, 24);
  return path.join(IMAGE_CACHE_DIR, `${hash}.png`);
}

async function generateWithOpenAI(prompt: string, width: number, height: number): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  // gpt-image-1 only accepts these three request sizes — pick the closest
  // match for the ad's aspect ratio rather than distorting a fixed size.
  const ratio = width / height;
  const size = ratio > 1.2 ? '1536x1024' : ratio < 0.85 ? '1024x1536' : '1024x1024';

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt,
      size,
      quality: 'high',
      output_format: 'png',
      n: 1,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  interface OpenAIImageResponse {
    error?: { message?: string };
    data?: { b64_json?: string }[];
  }
  const data = (await res.json().catch(() => ({}))) as OpenAIImageResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI image generation failed (${res.status})`);
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data.');
  return Buffer.from(b64, 'base64');
}

async function generateWithReplicate(prompt: string, width: number, height: number): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN is not set.');

  const model = process.env.REPLICATE_IMAGE_MODEL || 'black-forest-labs/flux-schnell';

  const createRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Prefer': 'wait',
    },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatioFor(width, height), output_format: 'png' } }),
    signal: AbortSignal.timeout(120_000),
  });

  interface ReplicatePrediction {
    detail?: string;
    error?: string;
    output?: string | string[];
  }
  const prediction = (await createRes.json().catch(() => ({}))) as ReplicatePrediction;
  if (!createRes.ok) {
    throw new Error(prediction.detail || `Replicate request failed (${createRes.status})`);
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) {
    throw new Error(prediction.error || 'Replicate returned no output image.');
  }

  const imgRes = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`Failed to download generated image (${imgRes.status})`);
  return Buffer.from(await imgRes.arrayBuffer());
}

export function aspectRatioFor(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.6) return '16:9';
  if (ratio > 1.2) return '3:2';
  if (ratio < 0.6) return '9:16';
  if (ratio < 0.85) return '2:3';
  return '1:1';
}

/**
 * Generates (or returns a cached) background image for the given prompt and
 * canvas size. Throws a clear, specific error on failure — callers must
 * surface it, never silently fall back to a flat background without saying
 * so (a user who explicitly asked for a generated background should know
 * when they didn't get one).
 */
export async function generateBackgroundImage(prompt: string, width: number, height: number): Promise<string> {
  const reason = unavailableReason();
  if (reason) throw new Error(reason);

  if (!existsSync(IMAGE_CACHE_DIR)) mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  const filePath = cacheFilePath(prompt, width, height);
  if (existsSync(filePath)) return filePath;

  const provider = getConfiguredProvider();
  const buffer = provider === 'openai'
    ? await generateWithOpenAI(prompt, width, height)
    : await generateWithReplicate(prompt, width, height);

  writeFileSync(filePath, buffer);
  return filePath;
}
