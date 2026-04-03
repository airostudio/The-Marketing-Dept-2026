const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
  try {
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
    const { provider, credentials } = req.body;
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
