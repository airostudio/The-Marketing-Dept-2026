import { JsonStore } from './jsonStore.js';
import type { BrandProfile, AdBrief, AdConcept, LayoutSpec, CampaignResult } from '../types.js';

export const DATA_DIR = process.env.ADFORGE_DATA_DIR || './data';

export const brandStore = new JsonStore<BrandProfile>(DATA_DIR, 'brand-profiles.json');
export const briefStore = new JsonStore<AdBrief>(DATA_DIR, 'ad-briefs.json');
export const conceptStore = new JsonStore<AdConcept>(DATA_DIR, 'ad-concepts.json');
export const layoutStore = new JsonStore<LayoutSpec>(DATA_DIR, 'layout-specs.json');
export const campaignStore = new JsonStore<CampaignResult>(DATA_DIR, 'campaign-results.json');

export const EXPORT_DIR = process.env.ADFORGE_EXPORT_DIR || './exports';
