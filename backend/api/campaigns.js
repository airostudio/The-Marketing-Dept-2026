const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../config/database');

const createCampaignSchema = Joi.object({
  customerId: Joi.string().uuid(),
  campaignType: Joi.string().valid('onboarding', 'expansion', 'churn_prevention', 'advocacy').required(),
  name: Joi.string().max(255).required(),
  sequence: Joi.array().items(Joi.object()).default([])
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const result = await db.query(
      'SELECT * FROM campaigns WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.organizationId, limit, offset]
    );
    res.json({ success: true, data: { campaigns: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get campaigns' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createCampaignSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { customerId, campaignType, name, sequence } = value;

    if (customerId) {
      const customerCheck = await db.query(
        'SELECT id FROM customers WHERE id = $1 AND organization_id = $2',
        [customerId, req.organizationId]
      );
      if (customerCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
      }
    }

    const result = await db.query(
      `INSERT INTO campaigns (organization_id, customer_id, campaign_type, name, sequence, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.organizationId, customerId || null, campaignType, name, JSON.stringify(sequence), 'active']
    );
    res.status(201).json({ success: true, data: { campaign: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

module.exports = router;
