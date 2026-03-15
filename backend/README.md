# Audema Backend API

**Phase 6: Backend Integration & Persistence Layer**

Production-ready REST API with PostgreSQL database, JWT authentication, and third-party integrations.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (web/)                                        │
│    ├─ api-client.js (replaces localStorage)            │
│    └─ Makes authenticated API calls                    │
└─────────────────────────────────────────────────────────┘
                      ↓ HTTP/JSON
┌─────────────────────────────────────────────────────────┐
│  BACKEND API (backend/)                                 │
│    ├─ Express.js REST API                               │
│    ├─ JWT authentication                                │
│    ├─ Rate limiting, CORS, security                     │
│    └─ API routes:                                       │
│        • /api/auth (signup, login, logout)              │
│        • /api/customers (CRUD)                          │
│        • /api/health-scores                             │
│        • /api/campaigns                                 │
│        • /api/lifecycle                                 │
│        • /api/deals                                     │
│        • /api/icp                                       │
│        • /api/integrations                              │
└─────────────────────────────────────────────────────────┘
                      ↓ SQL
┌─────────────────────────────────────────────────────────┐
│  DATABASE (PostgreSQL)                                  │
│    ├─ Multi-tenant schema (organizations, users)       │
│    ├─ Customer data (lifecycle, health, campaigns)     │
│    ├─ Revenue tracking (deals, attribution)            │
│    └─ Integrations (CRM, ESP, ad platforms)            │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Setup Database

```bash
# Create PostgreSQL database
createdb audema

# Run schema migration
psql -U postgres -d audema -f database/schema.sql
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

**Required environment variables:**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=audema
DB_USER=postgres
DB_PASSWORD=your_password

JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
```

### 4. Start Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

### 5. Test API

```bash
# Health check
curl http://localhost:3000/health

# Response:
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "version": "1.0.0"
}
```

---

## API Documentation

### Authentication

All endpoints (except `/auth/signup` and `/auth/login`) require authentication via JWT Bearer token.

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

#### POST /api/auth/signup
Create new account and organization.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "secure123",
  "firstName": "John",
  "lastName": "Doe",
  "organizationName": "Acme Corp"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "owner",
      "organizationId": "uuid"
    },
    "accessToken": "jwt_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

#### POST /api/auth/login
Login with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "secure123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "accessToken": "jwt_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

#### POST /api/auth/refresh
Refresh expired access token.

**Request:**
```json
{
  "refreshToken": "jwt_refresh_token"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "new_jwt_token"
  }
}
```

---

### Customers

#### GET /api/customers
List customers with filtering and pagination.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 50)
- `lifecycle_stage` - Filter by stage (trial, onboarding, active, etc.)
- `current_plan` - Filter by plan (basic, pro, enterprise)
- `search` - Search by email, company name, or name

**Response:**
```json
{
  "success": true,
  "data": {
    "customers": [
      {
        "id": "uuid",
        "email": "customer@example.com",
        "company_name": "Example Inc",
        "lifecycle_stage": "active",
        "current_plan": "pro",
        "mrr": 3000,
        "health_score": 85,
        "health_status": "green",
        "churn_risk": 0.15
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 245,
      "totalPages": 5
    }
  }
}
```

#### POST /api/customers
Create new customer.

**Request:**
```json
{
  "email": "customer@example.com",
  "companyName": "Example Inc",
  "firstName": "Jane",
  "lastName": "Smith",
  "lifecycleStage": "trial",
  "currentPlan": "basic",
  "mrr": 1000,
  "source": "organic"
}
```

#### PUT /api/customers/:id
Update customer.

#### DELETE /api/customers/:id
Delete customer.

---

### Health Scores

#### POST /api/health-scores
Save customer health score.

**Request:**
```json
{
  "customerId": "uuid",
  "healthScore": 87,
  "status": "green",
  "churnRisk": 0.13,
  "components": {
    "usage": { "score": 92, "weight": 35 },
    "nps": { "score": 100, "weight": 30 },
    "engagement": { "score": 78, "weight": 20 },
    "billing": { "score": 100, "weight": 15 }
  },
  "usageMetrics": { "loginsLast30Days": 45 },
  "recommendations": [...]
}
```

#### GET /api/health-scores/:customerId
Get health score history for customer.

---

### Campaigns

#### GET /api/campaigns
List campaigns.

#### POST /api/campaigns
Create new campaign.

**Request:**
```json
{
  "customerId": "uuid",
  "campaignType": "onboarding",
  "name": "Welcome Series",
  "sequence": [
    { "day": 0, "type": "email", "name": "Welcome Email" },
    { "day": 3, "type": "email", "name": "Getting Started" }
  ]
}
```

---

### Lifecycle

#### POST /api/lifecycle/progress
Progress customer to new lifecycle stage.

**Request:**
```json
{
  "customerId": "uuid",
  "fromStage": "onboarding",
  "toStage": "active",
  "metadata": {
    "reason": "Completed onboarding checklist"
  }
}
```

#### GET /api/lifecycle/:customerId
Get lifecycle stage history.

---

## Database Schema

See `database/schema.sql` for complete schema.

**Key Tables:**
- `organizations` - Multi-tenant organizations
- `users` - User accounts with authentication
- `customers` - Customer records (CRM-like)
- `customer_health_scores` - Health tracking
- `nps_responses` - NPS survey responses
- `campaigns` - Marketing campaigns
- `lifecycle_stage_history` - Lifecycle progression
- `deals` - Revenue opportunities
- `icp_profiles` - Ideal Customer Profile definitions
- `integrations` - Third-party API credentials
- `audit_logs` - Complete audit trail

---

## Security

- **JWT Authentication:** Access tokens (1h expiry) + Refresh tokens (7d expiry)
- **Password Hashing:** bcrypt with 10 rounds
- **Rate Limiting:** 100 requests per 15 minutes per IP
- **CORS:** Configurable allowed origins
- **Helmet:** Security headers (XSS, HSTS, etc.)
- **SQL Injection Prevention:** Parameterized queries
- **Audit Logging:** All data changes tracked

---

## Frontend Integration

### Before (Phase 1-5): localStorage

```javascript
// Old way - browser-only storage
localStorage.setItem('customers', JSON.stringify(customers));
const customers = JSON.parse(localStorage.getItem('customers'));
```

**Problems:**
- ❌ Lost when switching browsers/devices
- ❌ No team collaboration
- ❌ 5-10MB limit
- ❌ No backup/sync

### After (Phase 6): Backend API

```javascript
// New way - persistent backend storage
const apiClient = new APIClient();

// Create customer
await apiClient.createCustomer({
  email: 'customer@example.com',
  companyName: 'Example Inc'
});

// Get customers
const { customers } = await apiClient.getCustomers({
  lifecycle_stage: 'active',
  page: 1,
  limit: 50
});

// Save health score
await apiClient.saveHealthScore({
  customerId: 'uuid',
  healthScore: 87,
  status: 'green'
});
```

**Benefits:**
- ✅ Persistent across browsers/devices
- ✅ Multi-user team collaboration
- ✅ Unlimited storage
- ✅ Automatic backup
- ✅ Real-time sync

---

## Environment Variables

See `.env.example` for all configuration options.

**Required:**
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`

**Optional:**
- `NODE_ENV` (development/production)
- `PORT` (default: 3000)
- `CORS_ORIGIN` (default: *)
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`
- Integration API keys (Salesforce, HubSpot, SendGrid, etc.)

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run tests
npm test

# Reset database
psql -U postgres -d audema -f database/schema.sql
```

---

## Production Deployment

### Recommended Stack:
- **Hosting:** AWS EC2, Google Cloud Run, or Heroku
- **Database:** AWS RDS (PostgreSQL), Supabase, or Neon
- **Load Balancer:** AWS ELB or Nginx
- **Monitoring:** DataDog, New Relic, or Sentry

### Deployment Steps:

1. **Setup PostgreSQL database** (e.g., AWS RDS)
2. **Run migrations:**
   ```bash
   psql -h db-host -U postgres -d audema -f database/schema.sql
   ```
3. **Set environment variables** (use production values)
4. **Build and deploy:**
   ```bash
   npm install --production
   NODE_ENV=production node server.js
   ```
5. **Setup HTTPS** (Let's Encrypt or AWS Certificate Manager)
6. **Configure monitoring** (error tracking, performance monitoring)

---

## Troubleshooting

### Database connection failed
```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql -U postgres -d audema -c "SELECT 1"
```

### Token expired
- Access tokens expire after 1 hour
- Use refresh token to get new access token
- Frontend API client handles this automatically

### CORS errors
- Set `CORS_ORIGIN` in `.env` to your frontend URL
- For development: `CORS_ORIGIN=http://localhost:8080`

---

## Next Steps

**Phase 7 Ideas:**
- Real integrations (Salesforce, HubSpot, SendGrid sync)
- WebSocket for real-time updates
- Advanced analytics dashboard
- Email template builder
- A/B testing framework
- Predictive churn modeling (ML)

---

## License

MIT
