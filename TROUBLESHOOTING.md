# Troubleshooting Guide: Vercel Environment Variables

## Quick Diagnostic Check

### Step 1: Visit Health Endpoint

After deploying to Vercel, visit this URL in your browser:

```
https://YOUR-DOMAIN.vercel.app/api/health
```

This will show you diagnostic information about your environment variables.

**Expected Response (Healthy):**
```json
{
  "timestamp": "2026-03-15T...",
  "status": "healthy",
  "environment": "production",
  "checks": {
    "apiKeyConfigured": true,
    "apiKeyFormat": "valid",
    "apiKeyLength": 108,
    "apiKeyPreview": "sk-ant-api...xYz4",
    "environmentVariables": {
      "hasAnthropicApiKey": true
    }
  }
}
```

**Problem Response (Unhealthy):**
```json
{
  "status": "unhealthy",
  "error": "ANTHROPIC_API_KEY not found in environment variables",
  "checks": {
    "apiKeyConfigured": false
  }
}
```

---

## Common Issues & Solutions

### Issue 1: "ANTHROPIC_API_KEY not found"

**Symptom:** `/api/health` shows `"apiKeyConfigured": false`

**Cause:** Environment variable not set in Vercel

**Solution:**

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Select your project

2. **Navigate to Environment Variables**
   - Click **Settings** (top menu)
   - Click **Environment Variables** (left sidebar)

3. **Add the Variable**
   - Click **Add New**
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: Your Claude API key (starts with `sk-ant-api`)
   - **Environments**: Check ALL boxes
     - ✅ Production
     - ✅ Preview
     - ✅ Development

4. **Redeploy**
   - Go to **Deployments** tab
   - Click the three dots (...) on latest deployment
   - Click **Redeploy**
   - **OR** push a new commit to trigger deployment

5. **Verify**
   - Wait for deployment to complete
   - Visit `/api/health` again
   - Should now show `"apiKeyConfigured": true`

---

### Issue 2: "Invalid API key format"

**Symptom:** `/api/health` shows `"apiKeyFormat": "invalid"`

**Cause:** Wrong API key format or incorrect value

**Solution:**

1. **Get a Valid API Key**
   - Go to https://console.anthropic.com/
   - Sign in to your account
   - Navigate to **API Keys**
   - Copy an existing key OR create a new one

2. **Verify Format**
   - Claude API keys start with: `sk-ant-api`
   - Full format: `sk-ant-api03-...` (very long string)
   - Example: `sk-ant-api03-xxxxxxxxxxx...`

3. **Update in Vercel**
   - Go to Vercel Dashboard → Settings → Environment Variables
   - Find `ANTHROPIC_API_KEY`
   - Click **Edit**
   - Paste the correct key
   - Save and redeploy

---

### Issue 3: Environment Variable Not Available After Adding

**Symptom:** Added variable in Vercel, but still shows as missing

**Cause:** Deployment hasn't picked up the new environment variable

**Solution:**

1. **Trigger a Fresh Deployment**
   ```bash
   # Option 1: Via CLI
   vercel --prod

   # Option 2: Git push
   git commit --allow-empty -m "Trigger redeploy for env vars"
   git push origin main
   ```

2. **Wait for Build to Complete**
   - Check Vercel dashboard
   - Wait for "Building" → "Ready"
   - Usually takes 30-60 seconds

3. **Clear Cache (if needed)**
   - Sometimes Vercel caches old builds
   - Go to Deployments → ... → Redeploy
   - Check "Use existing Build Cache" → **Uncheck it**
   - Click Redeploy

---

### Issue 4: Works in Preview, Not in Production

**Symptom:** Preview deployments work, but production doesn't

**Cause:** Environment variable not set for Production environment

**Solution:**

1. **Check Environment Selection**
   - Vercel Dashboard → Settings → Environment Variables
   - Find `ANTHROPIC_API_KEY`
   - Verify checkboxes:
     - ✅ **Production** (MUST be checked)
     - ✅ Preview
     - ✅ Development

2. **Redeploy to Production**
   ```bash
   vercel --prod
   ```

---

### Issue 5: Different Variable Name

**Symptom:** You used a different variable name (not `ANTHROPIC_API_KEY`)

**Examples:**
- `CLAUDE_API_KEY`
- `NEXT_PUBLIC_ANTHROPIC_API_KEY`
- `API_KEY`

**Solution A: Rename in Vercel** (Recommended)
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Delete old variable
3. Add new variable with name: `ANTHROPIC_API_KEY`
4. Redeploy

**Solution B: Update Code to Match**
1. Edit `/api/claude.js` line 24-26
2. Change to your variable name:
   ```javascript
   const apiKey = process.env.YOUR_VARIABLE_NAME;
   ```
3. Commit and push

---

### Issue 6: API Key Exposed in Frontend

**Symptom:** Getting CORS errors or security warnings

**Cause:** Trying to call Anthropic API directly from browser

**Solution:**

✅ **DO:** Use the proxy endpoint
```javascript
// CORRECT
fetch('/api/claude', {
  method: 'POST',
  body: JSON.stringify({ messages: [...] })
})
```

❌ **DON'T:** Call Anthropic directly
```javascript
// WRONG - Never do this!
fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'x-api-key': 'sk-ant-api...' } // Exposes your key!
})
```

---

### Issue 7: Vercel Function Timeout

**Symptom:** Requests timeout after 10 seconds

**Cause:** Default Vercel function timeout is 10s on Hobby plan

**Solution:**

1. **Use Streaming Mode**
   - Already implemented in `/api/claude`
   - Streaming doesn't timeout as long as data flows

2. **Upgrade Vercel Plan** (if needed)
   - Hobby: 10s timeout
   - Pro: 60s timeout
   - Enterprise: 900s timeout

3. **Add Timeout Configuration** (Pro+ only)
   - Edit `vercel.json`:
     ```json
     {
       "functions": {
         "api/claude.js": {
           "maxDuration": 60
         }
       }
     }
     ```

---

## Viewing Logs in Vercel

### Real-time Logs

1. **Via Dashboard**
   - Go to Vercel Dashboard → Your Project
   - Click **Deployments**
   - Click on latest deployment
   - Click **Functions** tab
   - Click on `/api/claude`
   - View logs in real-time

2. **Via CLI**
   ```bash
   # Install Vercel CLI
   npm i -g vercel

   # Login
   vercel login

   # View logs
   vercel logs YOUR-PROJECT-URL --follow
   ```

### What to Look For

**Successful Request:**
```
✅ API key found (sk-ant-api...xYz4)
📍 Environment: production
🚀 Calling Anthropic API...
Model: claude-sonnet-4-6
Stream: true
📡 Anthropic API response status: 200
✅ Anthropic API success
```

**Failed Request (No API Key):**
```
❌ API key not found in environment variables
Checked variables: ANTHROPIC_API_KEY, CLAUDE_API_KEY, NEXT_PUBLIC_ANTHROPIC_API_KEY
Available env vars: []
```

**Failed Request (Invalid Key):**
```
⚠️ API key format looks incorrect. Should start with sk-ant-api
```

---

## Testing Your Setup

### Test 1: Health Check

```bash
curl https://YOUR-DOMAIN.vercel.app/api/health
```

**Expected:** `"status": "healthy"`

### Test 2: Simple API Call

```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [
      {
        "role": "user",
        "content": "Say hello in one word"
      }
    ]
  }'
```

**Expected:** JSON response with Claude's answer

### Test 3: In Browser

1. Open your deployed app
2. Open DevTools (F12)
3. Go to **Console** tab
4. Paste and run:
   ```javascript
   fetch('/api/health')
     .then(r => r.json())
     .then(data => console.log(data))
   ```
5. Check output for `"status": "healthy"`

---

## Environment Variable Checklist

Before asking for help, verify:

- [ ] Variable name is **exactly** `ANTHROPIC_API_KEY`
- [ ] Value starts with `sk-ant-api`
- [ ] Applied to **all environments** (Production, Preview, Development)
- [ ] Deployment completed after adding variable
- [ ] `/api/health` endpoint returns `"healthy"`
- [ ] Vercel logs don't show environment variable errors
- [ ] Not using `NEXT_PUBLIC_` prefix (that's for client-side only)
- [ ] No spaces or quotes around the API key value

---

## Still Having Issues?

### Check Vercel Status

Sometimes Vercel itself has issues:
- https://www.vercel-status.com/

### Check Anthropic API Status

Claude API might be down:
- https://status.anthropic.com/

### Get More Help

1. **Check Vercel Logs**
   - Look for specific error messages
   - Share them when asking for help

2. **Check Browser Console**
   - Open DevTools → Console
   - Look for network errors

3. **Test Locally First**
   ```bash
   # Create .env file locally
   echo "ANTHROPIC_API_KEY=sk-ant-api-your-key" > .env

   # Install dependencies
   npm install

   # Run locally (if you have a dev server)
   npm run dev

   # Test endpoint
   curl http://localhost:3000/api/health
   ```

---

## Quick Reference: Vercel CLI Commands

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Link project
vercel link

# Add environment variable
vercel env add ANTHROPIC_API_KEY

# Pull environment variables to local
vercel env pull

# Deploy to production
vercel --prod

# View logs
vercel logs --follow

# List all environment variables
vercel env ls
```

---

**Last Updated:** March 15, 2026
**Related Docs:** [VERCEL_SETUP.md](./VERCEL_SETUP.md)
