const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM icp_profiles WHERE organization_id = $1',
      [req.organizationId]
    );
    res.json({ success: true, data: { icpProfiles: result.rows } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get ICP profiles' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, companySizeMin, companySizeMax, industries, painPoints } = req.body;
    const result = await db.query(
      `INSERT INTO icp_profiles (organization_id, name, description, company_size_min, company_size_max, industries, pain_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.organizationId, name, description, companySizeMin, companySizeMax, industries, painPoints]
    );
    res.status(201).json({ success: true, data: { icpProfile: result.rows[0] } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create ICP profile' });
  }
});

module.exports = router;
