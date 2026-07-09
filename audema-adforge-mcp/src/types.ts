/**
 * Audema AdForge — shared schemas and types.
 *
 * Every tool in this server validates its input/output against these Zod
 * schemas. Keeping them in one file guarantees a brand profile, ad concept,
 * or campaign result means exactly the same thing everywhere it's used —
 * storage, rendering, and the tool layer all import from here.
 */

import { z } from 'zod';

// ─── Platform sizes ──────────────────────────────────────────────────────────

export const PLATFORM_SIZES = {
  square: { width: 1080, height: 1080, label: 'Square 1080×1080 (Feed / Meta / LinkedIn)' },
  portrait: { width: 1080, height: 1350, label: 'Portrait 1080×1350 (Instagram Feed)' },
  landscape: { width: 1200, height: 628, label: 'Landscape 1200×628 (Facebook / LinkedIn link ad)' },
  story: { width: 1080, height: 1920, label: 'Story 1080×1920 (Instagram / Facebook / TikTok Story)' },
} as const;

export type PlatformSizeKey = keyof typeof PLATFORM_SIZES;

export const PlatformSizeSchema = z.enum(['square', 'portrait', 'landscape', 'story']);

// ─── Brand Profile ───────────────────────────────────────────────────────────

export const BrandColoursSchema = z.object({
  primary: z.string().describe('Primary brand colour, hex e.g. #7C3AED'),
  secondary: z.string().optional().describe('Secondary brand colour, hex'),
  accent: z.string().optional().describe('Accent colour used for CTAs / highlights, hex'),
  background: z.string().optional().describe('Preferred background colour, hex'),
  text: z.string().optional().describe('Preferred body text colour, hex'),
});

export const BrandFontsSchema = z.object({
  heading: z.string().describe('Font family for headlines, e.g. "Poppins", "Montserrat"'),
  body: z.string().optional().describe('Font family for supporting copy'),
});

export const BrandProfileSchema = z.object({
  id: z.string().optional().describe('Set automatically on create; pass it back to update'),
  businessName: z.string().min(1),
  industry: z.string().min(1),
  targetAudience: z.string().min(1).describe('Who this business sells to, in a sentence or two'),
  brandVoice: z.string().min(1).describe('Tone descriptors, e.g. "Direct, confident, no fluff, occasionally witty"'),
  colours: BrandColoursSchema,
  fonts: BrandFontsSchema,
  logoPath: z.string().optional().describe('Absolute path to a logo image file (PNG/SVG) to composite onto ads'),
  forbiddenPhrases: z.array(z.string()).default([]).describe('Words/claims this brand must never use (compliance, legal, tone)'),
  preferredCTA: z.array(z.string()).default([]).describe('CTA phrases this brand likes, e.g. ["Get Your Free Quote", "Book a Call"]'),
  proofPoints: z.array(z.string()).default([]).describe('Real, factual proof points: review counts, years in business, results delivered'),
  guarantees: z.array(z.string()).default([]).describe('Real guarantees/warranties the business actually offers'),
  commonOffers: z.array(z.string()).default([]).describe('Offers this business runs regularly, e.g. "20% off first order", "Free consultation"'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BrandProfile = z.infer<typeof BrandProfileSchema>;

// ─── Ad Brief + Customer Analysis ────────────────────────────────────────────

export const CustomerAnalysisSchema = z.object({
  targetCustomer: z.string().describe('Specific description of the ideal customer for this campaign — not generic demographics, their situation and mindset'),
  painPoints: z.array(z.string()).min(1).describe('Concrete, specific pains in the customer\'s own language — not abstractions'),
  offer: z.string().describe('What is actually being sold/promoted in this campaign'),
  objections: z.array(z.string()).default([]).describe('Real reasons this customer hesitates to buy'),
  desiredAction: z.string().describe('The single action the ad should drive, e.g. "Call now", "Book a free quote", "Shop the sale"'),
});

export type CustomerAnalysis = z.infer<typeof CustomerAnalysisSchema>;

export const AdBriefSchema = z.object({
  id: z.string().optional(),
  brandProfileId: z.string().optional().describe('Link to a saved brand profile, if one exists'),
  businessDescription: z.string().min(1),
  campaignGoal: z.string().optional().describe('e.g. "Drive bookings for Q2 promo", "Launch new product line"'),
  analysis: CustomerAnalysisSchema.optional().describe('Filled in by submit_customer_analysis after create_ad_brief'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AdBrief = z.infer<typeof AdBriefSchema>;

// ─── Ad Angles ───────────────────────────────────────────────────────────────

export const AD_ANGLE_TYPES = [
  'pain-point',
  'offer',
  'proof',
  'urgency',
  'comparison',
  'aspirational',
] as const;

export const AdAngleTypeSchema = z.enum(AD_ANGLE_TYPES);
export type AdAngleType = z.infer<typeof AdAngleTypeSchema>;

// ─── Ad Concept ──────────────────────────────────────────────────────────────

export const AdConceptScoresSchema = z.object({
  clarity: z.number().min(0).max(10),
  conversionIntent: z.number().min(0).max(10),
  emotionalPull: z.number().min(0).max(10),
  visualSimplicity: z.number().min(0).max(10),
  platformFit: z.number().min(0).max(10),
  ctaStrength: z.number().min(0).max(10),
  overall: z.number().min(0).max(10).optional().describe('Weighted average, computed automatically'),
});

export type AdConceptScores = z.infer<typeof AdConceptScoresSchema>;

export const AdConceptSchema = z.object({
  id: z.string().optional(),
  briefId: z.string(),
  conceptName: z.string().describe('Short internal name, e.g. "The 2am Panic"'),
  angleType: AdAngleTypeSchema,
  targetEmotion: z.string().describe('The single dominant emotion this ad should evoke, e.g. "relief", "urgency", "envy", "trust"'),
  customerPainPoint: z.string().describe('The specific pain point from the brief this concept attacks'),
  hook: z.string().describe('The scroll-stopping opening idea/line — the pattern interrupt'),
  headline: z.string().describe('Primary headline — the biggest text on the ad'),
  subheadline: z.string().describe('Supporting line beneath the headline'),
  cta: z.string().describe('Call to action button/line text'),
  proofPoint: z.string().optional().describe('Optional social proof / credibility line'),
  urgencyLine: z.string().optional().describe('Optional scarcity/urgency line'),
  visualDirection: z.string().describe('Specific art direction: subject, composition, mood, colour treatment — concrete enough for a designer to execute'),
  layoutNotes: z.string().optional().describe('Notes on how text and visual should be arranged for this concept specifically'),
  platformSize: PlatformSizeSchema.default('square'),
  conversionRationale: z.string().describe('Why this concept should convert for THIS business/audience — not generic ad theory'),
  abTestSuggestion: z.string().optional().describe('What this concept should be tested against, and what the test would prove'),
  scores: AdConceptScoresSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AdConcept = z.infer<typeof AdConceptSchema>;

// ─── Layout Spec (deterministic, computed) ──────────────────────────────────

export const TextBlockSchema = z.object({
  role: z.enum(['headline', 'subheadline', 'cta', 'proofPoint', 'urgencyLine']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  fontSize: z.number(),
  fontWeight: z.number(),
  lineHeight: z.number(),
  align: z.enum(['left', 'center', 'right']),
  color: z.string(),
});

export const LayoutSpecSchema = z.object({
  id: z.string().optional(),
  conceptId: z.string(),
  platformSize: PlatformSizeSchema,
  width: z.number(),
  height: z.number(),
  safeZone: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
  backgroundStyle: z.enum(['solid', 'gradient', 'image']),
  textBlocks: z.array(TextBlockSchema),
  logoPlacement: z.object({ x: z.number(), y: z.number(), maxWidth: z.number(), maxHeight: z.number() }).optional(),
  notes: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

// ─── Campaign Result ─────────────────────────────────────────────────────────

export const CampaignResultSchema = z.object({
  id: z.string().optional(),
  brandProfileId: z.string(),
  briefId: z.string().optional(),
  conceptId: z.string().optional().describe('Which concept this result is for, if tracked at that granularity'),
  platform: z.string().describe('e.g. "Meta", "Google Display", "LinkedIn", "TikTok"'),
  dateRange: z.string().describe('e.g. "2026-01-01 to 2026-01-31"'),
  spend: z.number().min(0),
  impressions: z.number().min(0),
  clicks: z.number().min(0),
  ctr: z.number().min(0).optional().describe('Click-through rate, %. Computed automatically if omitted.'),
  cpc: z.number().min(0).optional().describe('Cost per click. Computed automatically if omitted.'),
  leads: z.number().min(0).optional(),
  cpa: z.number().min(0).optional().describe('Cost per acquisition. Computed automatically if omitted and leads/purchases provided.'),
  purchases: z.number().min(0).optional(),
  roas: z.number().min(0).optional().describe('Return on ad spend (revenue / spend)'),
  revenue: z.number().min(0).optional().describe('Total revenue attributed, used to compute ROAS if roas is omitted'),
  winningCreativeNotes: z.string().optional().describe('What worked in the best-performing creative and why'),
  losingCreativeNotes: z.string().optional().describe('What underperformed and the likely reason'),
  createdAt: z.string().optional(),
});

export type CampaignResult = z.infer<typeof CampaignResultSchema>;

// ─── A/B Test Recommendation ─────────────────────────────────────────────────

export const ABTestRecommendationSchema = z.object({
  variantAConceptId: z.string(),
  variantBConceptId: z.string(),
  hypothesis: z.string(),
  primaryMetric: z.string(),
  whatItProves: z.string(),
  recommendedBudgetSplit: z.string(),
  minimumSampleGuidance: z.string(),
});

export type ABTestRecommendation = z.infer<typeof ABTestRecommendationSchema>;
