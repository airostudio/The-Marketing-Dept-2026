/**
 * SEO Projects API
 * Persists the project-wizard output to the seo_projects table.
 *
 * All routes are scoped to the authenticated user's organization. The router
 * is mounted with `authenticate` middleware in server.js, so req.user and
 * req.organizationId are guaranteed to be present.
 */

const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const { encryptIntegrations } = require('../config/secrets');

const router = express.Router();

// ─── Validation ──────────────────────────────────────────────────────────────

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'manual'];
const SEARCH_ENGINES = ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu'];

const competitorRule = Joi.object({
  name: Joi.string().allow('').max(255),
  url: Joi.string().uri({ allowRelative: false }).allow('').max(2048)
});

const stringArray = (max = 64, len = 200) =>
  Joi.array().items(Joi.string().max(len)).max(max);

const projectSchema = Joi.object({
  projectName: Joi.string().min(1).max(255).required(),
  websiteUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).required(),
  industry: Joi.string().max(100).allow('', null),
  businessType: Joi.string().max(100).allow('', null),

  targetCountry: Joi.string().max(10).allow('', null),
  targetLanguage: Joi.string().max(10).allow('', null),
  additionalRegions: stringArray(64, 50).default([]),

  sitemapUrl: Joi.string().uri().max(2048).allow('', null),
  robotsTxtUrl: Joi.string().uri().max(2048).allow('', null),
  crawlDepth: Joi.number().integer().min(1).max(10).default(3),
  maxPages: Joi.number().integer().min(1).max(100000).default(1000),
  crawlFrequency: Joi.string().valid(...FREQUENCIES).default('weekly'),
  pageTypes: stringArray(32, 50).default([]),
  techChecks: stringArray(32, 50).default([]),
  excludePatterns: Joi.string().max(4000).allow('', null),

  seedKeywords: stringArray(500, 200).default([]),
  brandKeywords: stringArray(100, 200).default([]),
  keywordUpdateFrequency: Joi.string().valid(...FREQUENCIES).default('weekly'),
  searchEngine: Joi.string().valid(...SEARCH_ENGINES).default('google'),
  additionalEngines: Joi.array().items(Joi.string().valid(...SEARCH_ENGINES)).max(6).default([]),

  competitors: Joi.array().items(competitorRule).max(50).default([]),

  trafficGoal: Joi.number().integer().min(0).max(1e9).allow(null),
  keywordGoal: Joi.number().integer().min(0).max(1e6).allow(null),
  backlinkGoal: Joi.number().integer().min(0).max(1e7).allow(null),
  daGoal: Joi.number().integer().min(0).max(100).allow(null),

  alertChannels: stringArray(16, 50).default([]),
  alertTypes: stringArray(32, 50).default([]),
  alertFrequency: Joi.string().valid(...FREQUENCIES, 'realtime').default('daily'),
  alertEmail: Joi.string().email().max(255).allow('', null),

  // Integration credentials. Stored as JSONB blob; encrypted at rest by the
  // app layer (see config/secrets.js — credentials should never reach the DB
  // in plaintext in production).
  integrations: Joi.object().unknown(true).default({})
});

// Convert validated camelCase payload into snake_case DB columns + values.
function rowFromInput(value, userId, organizationId) {
  return {
    organization_id: organizationId,
    user_id: userId,
    project_name: value.projectName,
    website_url: value.websiteUrl,
    industry: value.industry || null,
    business_type: value.businessType || null,
    target_country: value.targetCountry || null,
    target_language: value.targetLanguage || null,
    additional_regions: value.additionalRegions,
    sitemap_url: value.sitemapUrl || null,
    robots_txt_url: value.robotsTxtUrl || null,
    crawl_depth: value.crawlDepth,
    max_pages: value.maxPages,
    crawl_frequency: value.crawlFrequency,
    page_types: value.pageTypes,
    tech_checks: value.techChecks,
    exclude_patterns: value.excludePatterns || null,
    seed_keywords: value.seedKeywords,
    brand_keywords: value.brandKeywords,
    keyword_update_frequency: value.keywordUpdateFrequency,
    search_engine: value.searchEngine,
    additional_engines: value.additionalEngines,
    competitors: JSON.stringify(value.competitors || []),
    traffic_goal: value.trafficGoal ?? null,
    keyword_goal: value.keywordGoal ?? null,
    backlink_goal: value.backlinkGoal ?? null,
    da_goal: value.daGoal ?? null,
    alert_channels: value.alertChannels,
    alert_types: value.alertTypes,
    alert_frequency: value.alertFrequency,
    alert_email: value.alertEmail || null,
    integrations: JSON.stringify(encryptIntegrations(value.integrations || {}))
  };
}

// Inverse: DB row → API response. Camel-case + decoded JSONB fields.
function rowToProject(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    projectName: row.project_name,
    websiteUrl: row.website_url,
    industry: row.industry,
    businessType: row.business_type,
    targetCountry: row.target_country,
    targetLanguage: row.target_language,
    additionalRegions: row.additional_regions || [],
    sitemapUrl: row.sitemap_url,
    robotsTxtUrl: row.robots_txt_url,
    crawlDepth: row.crawl_depth,
    maxPages: row.max_pages,
    crawlFrequency: row.crawl_frequency,
    pageTypes: row.page_types || [],
    techChecks: row.tech_checks || [],
    excludePatterns: row.exclude_patterns,
    seedKeywords: row.seed_keywords || [],
    brandKeywords: row.brand_keywords || [],
    keywordUpdateFrequency: row.keyword_update_frequency,
    searchEngine: row.search_engine,
    additionalEngines: row.additional_engines || [],
    competitors: row.competitors || [],
    trafficGoal: row.traffic_goal,
    keywordGoal: row.keyword_goal,
    backlinkGoal: row.backlink_goal,
    daGoal: row.da_goal,
    alertChannels: row.alert_channels || [],
    alertTypes: row.alert_types || [],
    alertFrequency: row.alert_frequency,
    alertEmail: row.alert_email,
    // Don't leak raw credentials back to clients — return only which
    // providers are configured.
    integrations: Object.keys(row.integrations || {}),
    isActive: row.is_active,
    lastAuditAt: row.last_audit_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const COLUMN_ORDER = [
  'organization_id', 'user_id', 'project_name', 'website_url', 'industry', 'business_type',
  'target_country', 'target_language', 'additional_regions',
  'sitemap_url', 'robots_txt_url', 'crawl_depth', 'max_pages', 'crawl_frequency',
  'page_types', 'tech_checks', 'exclude_patterns',
  'seed_keywords', 'brand_keywords', 'keyword_update_frequency', 'search_engine', 'additional_engines',
  'competitors',
  'traffic_goal', 'keyword_goal', 'backlink_goal', 'da_goal',
  'alert_channels', 'alert_types', 'alert_frequency', 'alert_email',
  'integrations'
];

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM seo_projects WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.organizationId]
    );
    res.json({ success: true, data: result.rows.map(rowToProject) });
  } catch (error) {
    console.error('[projects:list]', error.message);
    res.status(500).json({ success: false, error: 'Failed to list projects' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM seo_projects WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organizationId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, data: rowToProject(result.rows[0]) });
  } catch (error) {
    if (error.code === '22P02') { // invalid UUID
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    console.error('[projects:get]', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch project' });
  }
});

router.post('/', async (req, res) => {
  const { error, value } = projectSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ success: false, error: error.details[0].message });
  }

  const row = rowFromInput(value, req.user.id, req.organizationId);
  const placeholders = COLUMN_ORDER.map((_, i) => `$${i + 1}`).join(', ');
  const values = COLUMN_ORDER.map((col) => row[col]);

  try {
    const result = await db.query(
      `INSERT INTO seo_projects (${COLUMN_ORDER.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      values
    );
    res.status(201).json({ success: true, data: rowToProject(result.rows[0]) });
  } catch (err) {
    console.error('[projects:create]', err.message);
    res.status(500).json({ success: false, error: 'Failed to create project' });
  }
});

router.put('/:id', async (req, res) => {
  const { error, value } = projectSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ success: false, error: error.details[0].message });
  }

  const row = rowFromInput(value, req.user.id, req.organizationId);
  const setClauses = COLUMN_ORDER
    .filter((c) => c !== 'organization_id' && c !== 'user_id')
    .map((col, i) => `${col} = $${i + 1}`);
  const values = COLUMN_ORDER
    .filter((c) => c !== 'organization_id' && c !== 'user_id')
    .map((col) => row[col]);

  values.push(req.params.id, req.organizationId);

  try {
    const result = await db.query(
      `UPDATE seo_projects
       SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND organization_id = $${values.length}
       RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, data: rowToProject(result.rows[0]) });
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    console.error('[projects:update]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM seo_projects WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [req.params.id, req.organizationId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true });
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    console.error('[projects:delete]', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete project' });
  }
});

module.exports = router;
