const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../config/database');

const VALID_PROVIDERS = ['salesforce', 'hubspot', 'sendgrid', 'google_ads', 'linkedin_ads'];

const createIntegrationSchema = Joi.object({
  provider: Joi.string().valid(...VALID_PROVIDERS).required(),
  credentials: Joi.object().required()
});

router.get('/', async (req, res) => {
  try {
    // Never return credentials in list responses
    const result = await db.query(
      'SELECT id, provider, status, sync_enabled, last_sync_at FROM integrations WHERE organization_id = $1',
      [req.organizationId]
    );
    res.json({ success: true, data: { integrations: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get integrations' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createIntegrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { provider, credentials } = value;

    // Prevent duplicate integrations for the same provider
    const existing = await db.query(
      'SELECT id FROM integrations WHERE organization_id = $1 AND provider = $2',
      [req.organizationId, provider]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: `Integration for ${provider} already exists` });
    }

    const result = await db.query(
      `INSERT INTO integrations (organization_id, provider, credentials, status)
       VALUES ($1, $2, $3, $4) RETURNING id, provider, status`,
      [req.organizationId, provider, JSON.stringify(credentials), 'active']
    );
    res.status(201).json({ success: true, data: { integration: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create integration' });
  }
});

module.exports = router;
