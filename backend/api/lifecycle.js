const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.post('/progress', async (req, res) => {
  try {
    const { customerId, fromStage, toStage, metadata } = req.body;
    await db.query(
      'INSERT INTO lifecycle_stage_history (organization_id, customer_id, from_stage, to_stage, metadata) VALUES ($1, $2, $3, $4, $5)',
      [req.organizationId, customerId, fromStage, toStage, JSON.stringify(metadata || {})]
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
