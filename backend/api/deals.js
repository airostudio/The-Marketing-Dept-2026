const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM deals WHERE organization_id = $1 ORDER BY created_date DESC LIMIT 50',
      [req.organizationId]
    );
    res.json({ success: true, data: { deals: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get deals' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customerId, name, amount, stage, closeProb ability, expectedCloseDate } = req.body;
    const result = await db.query(
      `INSERT INTO deals (organization_id, customer_id, name, amount, stage, close_probability, expected_close_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.organizationId, customerId, name, amount, stage, closeProbability, expectedCloseDate]
    );
    res.status(201).json({ success: true, data: { deal: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create deal' });
  }
});

module.exports = router;
