# 🚀 Production Deployment Guide

**Audema Marketing Platform — Full Stack SaaS Deployment**

This guide shows how to deploy Audema to production with persistent PostgreSQL database, backend API, and frontend UI.

---

## ⚡ Quick Start (Local Development)

### Prerequisites
- Docker & Docker Compose installed
- Git clone this repository

### Run Entire Stack Locally

```bash
# Clone repository
git clone <repository-url>
cd The-Marketing-Dept-2026

# Start entire stack (PostgreSQL + Backend API + Frontend)
docker-compose up -d

# Check health
curl http://localhost:3000/health     # Backend API
curl http://localhost:8080             # Frontend

# View logs
docker-compose logs -f api

# Stop stack
docker-compose down
```

**Access:**
- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:3000/api`
- Database: `localhost:5432`

**Default Credentials:**
- Create account at: `http://localhost:8080/auth.html`

---

## 🌐 Production Deployment Options

### Option 1: Railway (Recommended — Easiest)

**Why Railway:**
- ✅ Free tier available ($5 credit/month)
- ✅ PostgreSQL included
- ✅ Auto HTTPS
- ✅ Deploy in 5 minutes

**Steps:**

1. **Create Railway Account:** https://railway.app

2. **Create New Project → Deploy from GitHub**
   - Connect your GitHub repository
   - Railway auto-detects Dockerfile

3. **Add PostgreSQL Database:**
   - Click "New" → "Database" → "PostgreSQL"
   - Railway creates database automatically

4. **Configure Environment Variables:**
   ```bash
   NODE_ENV=production
   DB_HOST=${{Postgres.PGHOST}}
   DB_PORT=${{Postgres.PGPORT}}
   DB_NAME=${{Postgres.PGDATABASE}}
   DB_USER=${{Postgres.PGUSER}}
   DB_PASSWORD=${{Postgres.PGPASSWORD}}
   JWT_SECRET=<generate-random-32-char-string>
   JWT_REFRESH_SECRET=<generate-random-32-char-string>
   CORS_ORIGIN=https://your-app.railway.app
   ```

5. **Run Database Migration:**
   - Connect to PostgreSQL service
   - Run: `psql $DATABASE_URL -f backend/database/schema.sql`

6. **Deploy:**
   - Railway automatically builds and deploys
   - Get public URL: `https://your-app.railway.app`

**Cost:** ~$5-10/month for production workload

---

### Option 2: Heroku

**Steps:**

1. **Install Heroku CLI:**
   ```bash
   brew install heroku/brew/heroku  # macOS
   # or visit: https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **Login:**
   ```bash
   heroku login
   ```

3. **Create App:**
   ```bash
   heroku create audema-production
   ```

4. **Add PostgreSQL:**
   ```bash
   heroku addons:create heroku-postgresql:essential-0
   ```

5. **Set Environment Variables:**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set JWT_SECRET=$(openssl rand -base64 32)
   heroku config:set JWT_REFRESH_SECRET=$(openssl rand -base64 32)
   heroku config:set CORS_ORIGIN=https://audema-production.herokuapp.com
   ```

6. **Create Procfile:**
   ```bash
   echo "web: cd backend && node server.js" > Procfile
   ```

7. **Deploy:**
   ```bash
   git push heroku main
   ```

8. **Run Database Migration:**
   ```bash
   heroku pg:psql < backend/database/schema.sql
   ```

9. **Open App:**
   ```bash
   heroku open
   ```

**Cost:** ~$7/month (Eco Dyno) + $5/month (PostgreSQL Essential)

---

### Option 3: Google Cloud Run + Cloud SQL

**Steps:**

1. **Install gcloud CLI:**
   ```bash
   brew install --cask google-cloud-sdk  # macOS
   gcloud init
   ```

2. **Create Cloud SQL PostgreSQL Instance:**
   ```bash
   gcloud sql instances create audema-db \
     --database-version=POSTGRES_16 \
     --tier=db-f1-micro \
     --region=us-central1
   ```

3. **Create Database:**
   ```bash
   gcloud sql databases create audema --instance=audema-db
   ```

4. **Build and Push Docker Image:**
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/audema-api
   ```

5. **Deploy to Cloud Run:**
   ```bash
   gcloud run deploy audema-api \
     --image gcr.io/YOUR_PROJECT_ID/audema-api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars "NODE_ENV=production,DB_HOST=/cloudsql/YOUR_PROJECT_ID:us-central1:audema-db,DB_NAME=audema,JWT_SECRET=$(openssl rand -base64 32)"
   ```

6. **Run Database Migration:**
   ```bash
   gcloud sql connect audema-db --user=postgres
   \i backend/database/schema.sql
   ```

**Cost:** ~$10-15/month (Cloud Run + Cloud SQL f1-micro)

---

### Option 4: AWS (EC2 + RDS)

**Steps:**

1. **Create RDS PostgreSQL Instance:**
   - Go to AWS Console → RDS
   - Create PostgreSQL database (db.t3.micro for free tier)
   - Note down endpoint and credentials

2. **Create EC2 Instance:**
   - Launch Ubuntu 22.04 instance (t2.micro for free tier)
   - Security group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (API)

3. **SSH into EC2 and Install Dependencies:**
   ```bash
   ssh -i your-key.pem ubuntu@ec2-instance-ip

   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Install PostgreSQL client
   sudo apt-get install -y postgresql-client

   # Clone repository
   git clone <repository-url>
   cd The-Marketing-Dept-2026/backend
   npm install --production
   ```

4. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env with RDS credentials
   nano .env
   ```

5. **Run Database Migration:**
   ```bash
   psql -h your-rds-endpoint.amazonaws.com -U postgres -d audema -f database/schema.sql
   ```

6. **Start Server with PM2:**
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name audema-api
   pm2 startup
   pm2 save
   ```

7. **Setup Nginx Reverse Proxy:**
   ```bash
   sudo apt-get install -y nginx
   sudo nano /etc/nginx/sites-available/audema

   # Add configuration (see nginx.conf)
   server {
       listen 80;
       server_name your-domain.com;

       location /api/ {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }

       location / {
           root /var/www/audema/web;
           try_files $uri $uri/ /index.html;
       }
   }

   sudo ln -s /etc/nginx/sites-available/audema /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

8. **Setup HTTPS with Let's Encrypt:**
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

**Cost:** Free tier eligible (EC2 t2.micro + RDS t3.micro) for 12 months, then ~$20-30/month

---

### Option 5: DigitalOcean App Platform

**Steps:**

1. **Create DigitalOcean Account:** https://digitalocean.com

2. **Create App:**
   - Click "Create" → "Apps"
   - Connect GitHub repository
   - Select branch

3. **Add PostgreSQL Database:**
   - Click "Add Resource" → "Database"
   - Select "Dev Database" (free) or "Managed Database" ($15/month)

4. **Configure Environment:**
   ```bash
   NODE_ENV=production
   DB_HOST=${db.HOSTNAME}
   DB_PORT=${db.PORT}
   DB_NAME=${db.DATABASE}
   DB_USER=${db.USERNAME}
   DB_PASSWORD=${db.PASSWORD}
   JWT_SECRET=<generate-random-string>
   JWT_REFRESH_SECRET=<generate-random-string>
   ```

5. **Deploy:**
   - DigitalOcean builds Dockerfile automatically
   - Get public URL

6. **Run Database Migration:**
   - Use DigitalOcean Console to connect to database
   - Run schema.sql

**Cost:** $5/month (basic app) + $15/month (managed PostgreSQL) = $20/month

---

## 🔐 Security Checklist

Before deploying to production:

- [ ] **Change JWT Secrets:** Generate strong random secrets
  ```bash
  openssl rand -base64 32  # Run twice for JWT_SECRET and JWT_REFRESH_SECRET
  ```

- [ ] **Setup HTTPS:** Use Let's Encrypt or cloud provider SSL
- [ ] **Enable Database Backups:** Configure automatic backups
- [ ] **Setup Firewall:** Only allow necessary ports (80, 443, 3000)
- [ ] **Environment Variables:** Never commit .env files to Git
- [ ] **CORS Configuration:** Set `CORS_ORIGIN` to your frontend domain
- [ ] **Rate Limiting:** Verify rate limits are enabled (default: 100 req/15min)
- [ ] **Database Connection Pool:** Adjust pool size for production load
- [ ] **Monitoring:** Setup error tracking (Sentry, DataDog, etc.)
- [ ] **Logging:** Configure production logging (Papertrail, Loggly, etc.)

---

## 📊 Environment Variables Reference

**Required:**
```bash
NODE_ENV=production
DB_HOST=<database-host>
DB_PORT=5432
DB_NAME=audema
DB_USER=postgres
DB_PASSWORD=<strong-password>
JWT_SECRET=<32-char-random-string>
JWT_REFRESH_SECRET=<32-char-random-string>
```

**Optional:**
```bash
PORT=3000                              # API server port
CORS_ORIGIN=https://yourdomain.com     # Allowed frontend origin
RATE_LIMIT_WINDOW_MS=900000            # Rate limit window (15 min)
RATE_LIMIT_MAX_REQUESTS=100            # Max requests per window
```

**Generate Secrets:**
```bash
# JWT secrets (32 characters)
openssl rand -base64 32

# Database password (16 characters)
openssl rand -base64 16
```

---

## 🧪 Testing Production Deployment

After deploying, test these endpoints:

```bash
# Health check
curl https://your-domain.com/health

# Signup
curl -X POST https://your-domain.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123456",
    "firstName": "Test",
    "lastName": "User",
    "organizationName": "Test Org"
  }'

# Login
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123456"
  }'

# Get customers (requires auth token from login)
curl https://your-domain.com/api/customers \
  -H "Authorization: Bearer <access-token>"
```

---

## 🔄 CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build and push Docker image
        run: |
          docker build -t audema-api .
          docker push registry.railway.app/audema-api:latest

      - name: Deploy to Railway
        run: railway up
```

---

## 📈 Scaling for Production

**When to scale:**
- > 1,000 customers
- > 10,000 API requests/day
- Database size > 10GB

**Scaling options:**
1. **Horizontal Scaling:**
   - Add more API server instances (load balancer)
   - Use Redis for session management
   - Enable connection pooling (PgBouncer)

2. **Database Scaling:**
   - Upgrade to larger RDS instance
   - Enable read replicas
   - Add caching layer (Redis/Memcached)

3. **CDN:**
   - CloudFlare for frontend assets
   - Reduce API server load

---

## 🆘 Troubleshooting

### Database Connection Failed
```bash
# Check database is running
docker-compose ps

# Test connection
psql -h localhost -U postgres -d audema -c "SELECT 1"

# Check logs
docker-compose logs postgres
```

### API Server Not Starting
```bash
# Check environment variables
docker-compose exec api env

# Check logs
docker-compose logs api

# Test locally
cd backend && npm start
```

### Frontend Can't Connect to API
- Check `CORS_ORIGIN` matches your frontend URL
- Verify nginx proxy configuration
- Check browser console for CORS errors

---

## 📚 Additional Resources

- **Backend API Docs:** `backend/README.md`
- **Database Schema:** `backend/database/schema.sql`
- **Docker Compose:** `docker-compose.yml`
- **Nginx Config:** `nginx.conf`

---

## ✅ Production Readiness Checklist

- [ ] Docker deployment working locally
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] HTTPS enabled
- [ ] Backups configured
- [ ] Monitoring setup
- [ ] Error tracking configured
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] JWT secrets changed from defaults
- [ ] Database password strong and secure
- [ ] Frontend authenticated access working
- [ ] API endpoints responding correctly
- [ ] Health check endpoint working

---

**Your platform is now PRODUCTION-READY! 🎉**

Choose your deployment option above and go live in minutes.
