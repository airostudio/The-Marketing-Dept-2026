const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../config/database');

const componentScoreSchema = Joi.object({
  score: Joi.number().integer().min(0).max(100)
}).unknown(true);

const createHealthScoreSchema = Joi.object({
  customerId: Joi.string().uuid().required(),
  healthScore: Joi.number().integer().min(0).max(100).required(),
  status: Joi.string().valid('green', 'yellow', 'red').required(),
  churnRisk: Joi.number().min(0).max(1).required(),
  components: Joi.object({
    usage: componentScoreSchema,
    nps: componentScoreSchema,
    engagement: componentScoreSchema,
    billing: componentScoreSchema
  }).default({}),
  usageMetrics: Joi.object().default({}),
  engagementMetrics: Joi.object().default({}),
  billingMetrics: Joi.object().default({}),
  recommendations: Joi.array().default([])
});

// POST /api/health-scores - Calculate and save health score
router.post('/', async (req, res) => {
  try {
    const { error, value } = createHealthScoreSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { customerId, healthScore, status, churnRisk, components, usageMetrics, engagementMetrics, billingMetrics, recommendations } = value;

    // Verify customer belongs to this organization
    const customerCheck = await db.query(
      'SELECT id FROM customers WHERE id = $1 AND organization_id = $2',
      [customerId, req.organizationId]
    );
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const result = await db.query(
      `INSERT INTO customer_health_scores (
        organization_id, customer_id, health_score, status, churn_risk,
        usage_score, nps_score, engagement_score, billing_score,
        usage_metrics, engagement_metrics, billing_metrics, recommendations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        req.organizationId, customerId, healthScore, status, churnRisk,
        components?.usage?.score ?? null, components?.nps?.score ?? null,
        components?.engagement?.score ?? null, components?.billing?.score ?? null,
        JSON.stringify(usageMetrics), JSON.stringify(engagementMetrics),
        JSON.stringify(billingMetrics), JSON.stringify(recommendations)
      ]
    );

    res.status(201).json({ success: true, data: { healthScore: result.rows[0] } });
  } catch (error) {
    console.error('Create health score error:', error);
    res.status(500).json({ success: false, error: 'Failed to create health score' });
  }
});

// GET /api/health-scores/:customerId - Get health score history
router.get('/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    // Verify customer belongs to this organization
    const customerCheck = await db.query(
      'SELECT id FROM customers WHERE id = $1 AND organization_id = $2',
      [customerId, req.organizationId]
    );
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const result = await db.query(
      `SELECT * FROM customer_health_scores
       WHERE customer_id = $1 AND organization_id = $2
       ORDER BY calculated_at DESC
       LIMIT $3`,
      [customerId, req.organizationId, limit]
    );

    res.json({ success: true, data: { healthScores: result.rows } });
  } catch (error) {
    console.error('Get health scores error:', error);
    res.status(500).json({ success: false, error: 'Failed to get health scores' });
  }
});

module.exports = router;
