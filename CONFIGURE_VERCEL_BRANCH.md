# 🔧 Configure Vercel to Deploy from Claude Branch

## Why This Works Better

✅ I can push updates directly to `claude/ai-content-writer-GqF4t`  
✅ No need for you to manually merge to master  
✅ Vercel auto-deploys when I push  
✅ Faster iteration and fixes  

---

## 📋 Step-by-Step Instructions

### Step 1: Go to Vercel Dashboard
1. Open https://vercel.com/dashboard
2. Click on your project (The-Marketing-Dept-2026)

### Step 2: Change Production Branch
1. Click **Settings** (in top navigation)
2. Click **Git** (in left sidebar)
3. Scroll to **Production Branch** section
4. Current value: `master` or `main`
5. Click **Edit** or the input field
6. Change to: `claude/ai-content-writer-GqF4t`
7. Click **Save**

### Step 3: Trigger Deployment
1. Go to **Deployments** tab
2. Click **Create Deployment** button
   - Or click ⋮ (three dots) on latest deployment
   - Select **Redeploy**
3. Confirm the deployment
4. Wait 2-3 minutes for build to complete

### Step 4: Verify Deployment
1. Check deployment status shows: ✅ **Ready**
2. Visit: **www.audema.com.au/api-test-simple.html**
3. Should see:
   ```
   ✅ Health Check: SUCCESS
   ✅ Claude API: SUCCESS
   ```

---

## 🎯 What This Achieves

**Before:**
1. I push to `claude/` branch
2. You manually merge to `master`
3. You push to trigger Vercel
4. ❌ Multiple manual steps

**After:**
1. I push to `claude/` branch
2. ✅ Vercel auto-deploys immediately
3. ✅ No manual intervention needed

---

## ⚠️ Important Notes

- The `claude/ai-content-writer-GqF4t` branch **is already up to date** with all fixes
- Environment variable `ANTHROPIC_API_KEY` is already set
- After changing the production branch, **must trigger one manual redeploy**
- After that, all future pushes to `claude/` branch auto-deploy

---

## 🚀 After Configuration

Once Vercel is configured to watch `claude/ai-content-writer-GqF4t`:

- When you report an issue → I fix it → Push → **Auto-deploys**
- No more manual git merges
- No more deployment delays
- Faster feedback loop

---

## 📸 Visual Guide

**Production Branch Setting Location:**
```
Vercel Dashboard
  └── Your Project
      └── Settings
          └── Git
              └── Production Branch: [claude/ai-content-writer-GqF4t]
                  └── [Save]
```

---

## ✅ Verification Checklist

After configuration, verify:

- [ ] Vercel Settings → Git → Production Branch = `claude/ai-content-writer-GqF4t`
- [ ] Triggered manual redeploy
- [ ] Deployment status shows "Ready"
- [ ] www.audema.com.au/api-test-simple.html shows ✅ SUCCESS
- [ ] Agents work without "API key not configured" errors

---

**Ready to configure? Just change the production branch in Vercel settings and trigger a redeploy.**
