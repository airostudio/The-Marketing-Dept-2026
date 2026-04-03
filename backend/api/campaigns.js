const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM campaigns WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.organizationId]
    );
    res.json({ success: true, data: { campaigns: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get campaigns' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customerId, campaignType, name, sequence } = req.body;
    const result = await db.query(
      `INSERT INTO campaigns (organization_id, customer_id, campaign_type, name, sequence, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.organizationId, customerId, campaignType, name, JSON.stringify(sequence || []), 'active']
    );
    res.status(201).json({ success: true, data: { campaign: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

module.exports = router;
