const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../config/database');

const VALID_STAGES = ['trial', 'onboarding', 'active', 'growth', 'at_risk', 'churned', 'champion'];

const progressSchema = Joi.object({
  customerId: Joi.string().uuid().required(),
  fromStage: Joi.string().valid(...VALID_STAGES),
  toStage: Joi.string().valid(...VALID_STAGES).required(),
  metadata: Joi.object().default({})
});

router.post('/progress', async (req, res) => {
  try {
    const { error, value } = progressSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { customerId, fromStage, toStage, metadata } = value;

    // Verify customer belongs to this organization
    const customerCheck = await db.query(
      'SELECT id FROM customers WHERE id = $1 AND organization_id = $2',
      [customerId, req.organizationId]
    );
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    await db.query(
      'INSERT INTO lifecycle_stage_history (organization_id, customer_id, from_stage, to_stage, metadata) VALUES ($1, $2, $3, $4, $5)',
      [req.organizationId, customerId, fromStage || null, toStage, JSON.stringify(metadata)]
    );
    await db.query(
      'UPDATE customers SET lifecycle_stage = $1 WHERE id = $2 AND organization_id = $3',
      [toStage, customerId, req.organizationId]
    );
    res.json({ success: true, message: 'Lifecycle stage updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update lifecycle stage' });
  }
});

router.get('/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;

    // Verify customer belongs to this organization
    const customerCheck = await db.query(
      'SELECT id FROM customers WHERE id = $1 AND organization_id = $2',
      [customerId, req.organizationId]
    );
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const result = await db.query(
      'SELECT * FROM lifecycle_stage_history WHERE customer_id = $1 AND organization_id = $2 ORDER BY timestamp DESC',
      [customerId, req.organizationId]
    );
    res.json({ success: true, data: { history: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get lifecycle history' });
  }
});

module.exports = router;
