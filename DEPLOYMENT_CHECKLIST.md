# 🚀 Deployment Checklist

## Current Status
❌ **Site is running OLD code without API endpoints**  
❌ **Getting error: "No Claude API key configured"**

---

## Option 1: Auto-Deploy Script (Easiest)

```bash
cd /path/to/The-Marketing-Dept-2026
./DEPLOY_NOW.sh
```

This script will:
1. ✅ Checkout master branch
2. ✅ Merge claude/ai-content-writer-GqF4t
3. ✅ Push to master (triggers Vercel auto-deploy)

---

## Option 2: Manual Deploy (If script fails)

### Step 1: Merge to Master
```bash
cd /path/to/The-Marketing-Dept-2026
git checkout master
git pull origin claude/ai-content-writer-GqF4t
git push origin master
```

### Step 2: Wait for Vercel
- Go to https://vercel.com/dashboard
- Click your project
- Go to "Deployments" tab
- Wait 2-3 minutes for build to complete
- Status should show: ✅ Ready

### Step 3: Verify Deployment
Visit: **www.audema.com.au/api-test-simple.html**

Should see:
- ✅ Health Check: SUCCESS
- ✅ Claude API: SUCCESS
- Response: "API key is working!"

---

## Option 3: Manual Vercel Redeploy

If git push doesn't trigger deployment:

1. Go to Vercel Dashboard
2. Click your project
3. Go to "Deployments" tab
4. Click ⋮ (three dots) on latest deployment
5. Click "Redeploy"
6. Wait for build to complete

---

## Vercel Environment Variable Setup

### Required Variable
- **Name:** `ANTHROPIC_API_KEY`
- **Value:** `sk-ant-api03-...` (your Claude API key)
- **Environments:** ✅ Production, ✅ Preview, ✅ Development

### How to Add/Check:
1. Vercel Dashboard → Your Project
2. Settings → Environment Variables
3. Verify `ANTHROPIC_API_KEY` exists
4. Must be enabled for **Production**
5. After adding/changing: **Must redeploy**

---

## Testing After Deployment

### Test Page
**URL:** www.audema.com.au/api-test-simple.html

This page auto-tests:
1. `/api/health` - Shows if API key is configured
2. `/api/claude` - Makes actual API call to verify it works

### Expected Results

✅ **SUCCESS:**
```
Health Check: ✅ SUCCESS
API Key Status: ✅ Configured
Claude API: ✅ SUCCESS
Response: "API key is working!"
```

❌ **FAILURE (API key not found):**
```
Health Check: ❌ FAILED
Error: "API key not configured"
FIX: Add ANTHROPIC_API_KEY to Vercel and redeploy
```

❌ **FAILURE (Endpoint 404):**
```
ERROR: 404 NOT FOUND
FIX: Deployment didn't include /api directory
Solution: Redeploy from master branch
```

---

## Troubleshooting

### Problem: Still getting 404 on /api/health
**Cause:** Old deployment, /api directory not deployed  
**Fix:** Run deployment script or manually push to master

### Problem: "API key not configured" 
**Cause:** ANTHROPIC_API_KEY not in Vercel env vars  
**Fix:** Add to Vercel → Settings → Environment Variables → Redeploy

### Problem: Git push fails with 403
**Cause:** Trying to push to wrong branch  
**Fix:** Must push to master, not claude/* branch

### Problem: Site shows old content
**Cause:** Browser cache  
**Fix:** Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

---

## What's New in This Deployment

✅ `/api/claude` - Secure Claude API proxy (uses Vercel env vars)  
✅ `/api/health` - API health check endpoint  
✅ `/api-test-simple.html` - API testing page  
✅ Settings page - Login modal with 50% blur overlay  
✅ All agents - Use secure server-side API calls  
✅ Auth flow - Login/Signup → Dashboard (hub.html)  
✅ Public homepage - No auth wall, pricing section, demo area  

---

## Next Steps After Successful Deployment

1. ✅ Test API at www.audema.com.au/api-test-simple.html
2. ✅ Try agents (Scotty, Content Writer, etc.)
3. ✅ Verify settings page login modal
4. ✅ Test authentication flow
5. ✅ Check all navigation works

---

## Contact

If deployment fails after trying all options:
1. Check Vercel build logs for errors
2. Verify git branch configuration
3. Confirm ANTHROPIC_API_KEY is valid (test at console.anthropic.com)
