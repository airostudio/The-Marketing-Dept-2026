import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { brandStore, campaignStore, conceptStore } from '../storage/index.js';
import { computeCalibration } from '../prompts/calibration.js';
import type { BrandCalibration, CalibrationSample } from '../prompts/calibration.js';
import { DEFAULT_WEIGHTS } from '../prompts/scoring.js';

/**
 * Bridges storage → the pure computeCalibration() function: pairs each
 * campaign result linked to a scored concept with that result's outcome
 * metric (ROAS preferred, CTR as fallback). Shared by the standalone
 * calibration tool and score_ad_concepts (which applies it automatically).
 */
export function getBrandCalibration(brandProfileId: string): BrandCalibration {
  const results = campaignStore.find((r) => r.brandProfileId === brandProfileId);
  const samples: CalibrationSample[] = [];
  for (const r of results) {
    if (!r.conceptId) continue;
    const concept = conceptStore.get(r.conceptId);
    const outcome = r.roas ?? r.ctr;
    if (!concept?.scores || outcome === undefined) continue;
    samples.push({ scores: concept.scores, outcome });
  }

  return computeCalibration(samples);
}

export function registerCalibrationTools(server: McpServer) {
  server.tool(
    'get_brand_score_calibration',
    'Shows how this brand\'s concept-scoring weights have been calibrated from its own real campaign results (via save_campaign_result linked to a conceptId) — which of the 6 scoring dimensions actually correlate with this brand\'s real performance, and by how much. Honest about small samples: says plainly when there isn\'t enough data yet rather than guessing. score_ad_concepts applies this automatically when enough data exists.',
    { brandProfileId: z.string() },
    async ({ brandProfileId }) => {
      const brand = brandStore.get(brandProfileId);
      if (!brand) return { content: [{ type: 'text', text: `No brand profile found with id ${brandProfileId}.` }], isError: true };

      const calibration = getBrandCalibration(brandProfileId);
      const lines = [calibration.note, ''];

      if (calibration.calibrated) {
        lines.push('**Calibrated weights (vs. default):**');
        (Object.entries(calibration.weights) as [keyof typeof DEFAULT_WEIGHTS, number][]).forEach(([dim, w]) => {
          const defaultPct = DEFAULT_WEIGHTS[dim] * 100;
          const calibratedPct = w * 100;
          const arrow = calibratedPct > defaultPct + 0.05 ? '↑' : calibratedPct < defaultPct - 0.05 ? '↓' : '=';
          lines.push(`- ${dim}: ${calibratedPct.toFixed(1)}% ${arrow} (default: ${defaultPct.toFixed(1)}%)`);
        });
        if (calibration.insights.length) {
          lines.push('', '**Insights:**');
          calibration.insights.forEach((i) => lines.push(`- ${i}`));
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
