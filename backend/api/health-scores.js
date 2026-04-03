const express = require('express');
const router = express.Router();
const db = require('../config/database');

// POST /api/health-scores - Calculate and save health score
router.post('/', async (req, res) => {
  try {
    const { customerId, healthScore, status, churnRisk, components, usageMetrics, engagementMetrics, billingMetrics, recommendations } = req.body;

    const result = await db.query(
      `INSERT INTO customer_health_scores (
        organization_id, customer_id, health_score, status, churn_risk,
        usage_score, nps_score, engagement_score, billing_score,
        usage_metrics, engagement_metrics, billing_metrics, recommendations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        req.organizationId, customerId, healthScore, status, churnRisk,
        components?.usage?.score, components?.nps?.score, components?.engagement?.score, components?.billing?.score,
        JSON.stringify(usageMetrics || {}), JSON.stringify(engagementMetrics || {}),
        JSON.stringify(billingMetrics || {}), JSON.stringify(recommendations || [])
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
    const { limit = 30 } = req.query;

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
