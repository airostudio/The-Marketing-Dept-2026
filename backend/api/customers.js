/**
 * Customer API Routes
 * CRUD operations for customer management
 */

const express = require('express');
const Joi = require('joi');
const db = require('../config/database');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const LIFECYCLE_STAGES = ['trial', 'onboarding', 'active', 'growth', 'at_risk', 'churned', 'champion'];
const PLANS = ['basic', 'pro', 'enterprise'];
const CUSTOM_FIELDS_MAX_BYTES = 16 * 1024; // 16 KB JSON

const customFieldsRule = Joi.object().custom((value, helpers) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CUSTOM_FIELDS_MAX_BYTES) {
    return helpers.error('any.invalid', { message: 'customFields exceeds 16KB limit' });
  }
  return value;
}, 'customFields size limit');

const createCustomerSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
  companyName: Joi.string().max(255).required(),
  firstName: Joi.string().max(100),
  lastName: Joi.string().max(100),
  title: Joi.string().max(100),
  lifecycleStage: Joi.string().valid(...LIFECYCLE_STAGES),
  currentPlan: Joi.string().valid(...PLANS),
  mrr: Joi.number().min(0).max(1e9),
  source: Joi.string().max(100),
  customFields: customFieldsRule
});

const updateCustomerSchema = Joi.object({
  email: Joi.string().email().max(255),
  companyName: Joi.string().max(255),
  firstName: Joi.string().max(100),
  lastName: Joi.string().max(100),
  title: Joi.string().max(100),
  lifecycleStage: Joi.string().valid(...LIFECYCLE_STAGES),
  currentPlan: Joi.string().valid(...PLANS),
  mrr: Joi.number().min(0).max(1e9),
  ltv: Joi.number().min(0).max(1e10),
  source: Joi.string().max(100),
  customFields: customFieldsRule
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/customers - List all customers
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      lifecycle_stage,
      current_plan,
      search
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query
    let query = `
      SELECT c.*, lch.health_score, lch.status AS health_status, lch.churn_risk
      FROM customers c
      LEFT JOIN latest_customer_health lch ON c.id = lch.customer_id
      WHERE c.organization_id = $1
    `;
    const params = [req.organizationId];
    let paramIndex = 2;

    if (lifecycle_stage) {
      query += ` AND c.lifecycle_stage = $${paramIndex}`;
      params.push(lifecycle_stage);
      paramIndex++;
    }

    if (current_plan) {
      query += ` AND c.current_plan = $${paramIndex}`;
      params.push(current_plan);
      paramIndex++;
    }

    if (search) {
      query += ` AND (c.email ILIKE $${paramIndex} OR c.company_name ILIKE $${paramIndex} OR c.first_name ILIKE $${paramIndex} OR c.last_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM customers WHERE organization_id = $1';
    const countParams = [req.organizationId];
    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        customers: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get customers'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/customers/:id - Get customer by ID
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT c.*, lch.health_score, lch.status AS health_status, lch.churn_risk,
              lch.calculated_at AS health_calculated_at
       FROM customers c
       LEFT JOIN latest_customer_health lch ON c.id = lch.customer_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, req.organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      data: {
        customer: result.rows[0]
      }
    });

  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get customer'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/customers - Create new customer
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  try {
    // Validate input
    const { error, value } = createCustomerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const {
      email,
      companyName,
      firstName,
      lastName,
      title,
      lifecycleStage = 'trial',
      currentPlan,
      mrr = 0,
      source,
      customFields = {}
    } = value;

    const result = await db.query(
      `INSERT INTO customers (
        organization_id, email, company_name, first_name, last_name, title,
        lifecycle_stage, current_plan, mrr, source, custom_fields,
        trial_start_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        req.organizationId,
        email,
        companyName,
        firstName,
        lastName,
        title,
        lifecycleStage,
        currentPlan,
        mrr,
        source,
        JSON.stringify(customFields)
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        customer: result.rows[0]
      }
    });

  } catch (error) {
    console.error('Create customer error:', error);

    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        success: false,
        error: 'Customer with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create customer'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/customers/:id - Update customer
// ═══════════════════════════════════════════════════════════════════════════════

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate input
    const { error, value } = updateCustomerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    // Build UPDATE query dynamically
    const updates = [];
    const params = [id, req.organizationId];
    let paramIndex = 3;

    const fieldMapping = {
      email: 'email',
      companyName: 'company_name',
      firstName: 'first_name',
      lastName: 'last_name',
      title: 'title',
      lifecycleStage: 'lifecycle_stage',
      currentPlan: 'current_plan',
      mrr: 'mrr',
      ltv: 'ltv',
      source: 'source',
      customFields: 'custom_fields'
    };

    Object.keys(value).forEach(key => {
      const dbField = fieldMapping[key];
      if (dbField) {
        updates.push(`${dbField} = $${paramIndex}`);
        params.push(key === 'customFields' ? JSON.stringify(value[key]) : value[key]);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    const query = `
      UPDATE customers
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
      RETURNING *
    `;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      data: {
        customer: result.rows[0]
      }
    });

  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/customers/:id - Delete customer
// ═══════════════════════════════════════════════════════════════════════════════

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM customers WHERE id = $1 AND organization_id = $2 RETURNING id',
      [id, req.organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });

  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete customer'
    });
  }
});

module.exports = router;
