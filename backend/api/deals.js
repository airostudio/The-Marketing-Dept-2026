const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../config/database');

const createDealSchema = Joi.object({
  customerId: Joi.string().uuid(),
  name: Joi.string().required(),
  amount: Joi.number().min(0).required(),
  stage: Joi.string().valid('lead', 'mql', 'sql', 'opportunity', 'closed_won', 'closed_lost').required(),
  closeProbability: Joi.number().min(0).max(1),
  expectedCloseDate: Joi.date().iso()
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const result = await db.query(
      'SELECT * FROM deals WHERE organization_id = $1 ORDER BY created_date DESC LIMIT $2 OFFSET $3',
      [req.organizationId, limit, offset]
    );
    res.json({ success: true, data: { deals: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get deals' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createDealSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: error.details[0].message });
    }
    const { customerId, name, amount, stage, closeProbability, expectedCloseDate } = value;

    // Verify customerId belongs to this organization if provided
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
      `INSERT INTO deals (organization_id, customer_id, name, amount, stage, close_probability, expected_close_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.organizationId, customerId || null, name, amount, stage, closeProbability || null, expectedCloseDate || null]
    );
    res.status(201).json({ success: true, data: { deal: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create deal' });
  }
});

module.exports = router;
