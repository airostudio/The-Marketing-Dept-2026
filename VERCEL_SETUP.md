# Vercel Deployment Setup Guide

## Environment Variables Configuration

### Required Environment Variables

Your Audema application requires the following environment variable to be set in Vercel:

| Variable Name | Description | Required |
|--------------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Claude API key from Anthropic | ✅ Yes |
| `CONVERT_API_KEY` | Convert.com API key (from app.convert.com/account/api) | For A/B data |
| `CONVERT_API_SECRET` | Convert.com API secret | For A/B data |

---

## How to Add Environment Variables in Vercel

### Option 1: Via Vercel Dashboard (Recommended)

1. **Go to your project** in the Vercel Dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variable:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: Your Claude API key (starts with `sk-ant-api...`)
   - **Environments**: Select all (Production, Preview, Development)
4. Click **Save**
5. **Redeploy** your application for changes to take effect

### Option 2: Via Vercel CLI

```bash
# Install Vercel CLI if you haven't already
npm i -g vercel

# Add the environment variable
vercel env add ANTHROPIC_API_KEY

# Follow the prompts to enter your API key
# Select all environments when prompted
```

---

## How to Get Your Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign in or create an account
3. Navigate to **API Keys**
4. Click **Create Key**
5. Copy your API key (format: `sk-ant-api...`)
6. Store it securely and add it to Vercel environment variables

---

## Architecture: Secure API Proxy

### Why We Use a Serverless Function

Your application uses a **secure server-side proxy** to protect your API key:

```
┌─────────────────────────────────────────────────────────────┐
│  OLD SETUP (Insecure) ❌                                     │
├─────────────────────────────────────────────────────────────┤
│  Browser → Anthropic API (with exposed API key)             │
│  ⚠️ API key visible in browser network tab                  │
│  ⚠️ Anyone can steal and abuse your API key                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NEW SETUP (Secure) ✅                                       │
├─────────────────────────────────────────────────────────────┤
│  Browser → /api/claude → Anthropic API                      │
│           (Vercel Function)                                  │
│  ✅ API key stored securely in Vercel environment variables │
│  ✅ Never exposed to browser                                │
│  ✅ Server-side only                                        │
└─────────────────────────────────────────────────────────────┘
```

### Files Modified

1. **`/api/claude.js`** (NEW)
   - Vercel serverless function
   - Proxies requests to Anthropic API
   - Uses `ANTHROPIC_API_KEY` from environment variables
   - Handles both streaming and non-streaming responses

2. **`/web/js/claude-service.js`** (UPDATED)
   - Changed from direct Anthropic API calls
   - Now calls `/api/claude` endpoint
   - Removed insecure client-side API key handling
   - Removed `getApiKey()` and `setApiKey()` functions

3. **`/vercel.json`** (UPDATED)
   - Added environment variable reference
   - Configured API routes

---

## Verifying Your Setup

### 1. Check Environment Variable

In Vercel Dashboard:
- Go to **Settings** → **Environment Variables**
- Confirm `ANTHROPIC_API_KEY` is listed
- Should be available for all environments

### 2. Test API Endpoint

After deployment, test the API:

```bash
# Replace YOUR_DOMAIN with your Vercel domain
curl -X POST https://YOUR_DOMAIN.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Expected response:
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hello! How can I help you today?"}],
  ...
}
```

### 3. Test in Browser

1. Open your deployed app
2. Navigate to the Hub or any agent
3. Try generating content
4. Open browser DevTools → Network tab
5. You should see requests to `/api/claude` (not `api.anthropic.com`)

---

## Troubleshooting

### Error: "API key not configured"

**Problem**: `ANTHROPIC_API_KEY` not found in environment variables

**Solution**:
1. Verify the variable is added in Vercel Dashboard
2. Check spelling: `ANTHROPIC_API_KEY` (must match exactly)
3. Redeploy your application after adding the variable

### Error: "Method not allowed"

**Problem**: GET request to API endpoint (only POST allowed)

**Solution**: Ensure you're making POST requests to `/api/claude`

### Error: "Invalid request: messages array required"

**Problem**: Missing or invalid `messages` in request body

**Solution**: Check request format in `claude-service.js`

### API calls timing out

**Problem**: Vercel serverless function timeout (default 10s)

**Solution**:
- For long-running requests, use streaming mode
- Or increase timeout in `vercel.json`:
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

## Security Best Practices

✅ **DO:**
- Store API keys in Vercel environment variables
- Use server-side API proxy
- Never commit API keys to git
- Rotate API keys periodically
- Monitor API usage in Anthropic Console

❌ **DON'T:**
- Hardcode API keys in source code
- Expose API keys in client-side code
- Share API keys in public repositories
- Use same API key across multiple projects

---

## Deployment Checklist

Before deploying:

- [ ] `ANTHROPIC_API_KEY` added to Vercel environment variables
- [ ] Environment variable set for all environments (Production, Preview, Development)
- [ ] `/api/claude.js` committed to repository
- [ ] `claude-service.js` updated to use `/api/claude` endpoint
- [ ] `vercel.json` configured with environment variable reference
- [ ] Test deployment on Preview environment first
- [ ] Verify API calls working in browser DevTools
- [ ] Check Anthropic Console for API usage

---

## Cost Monitoring

**Important**: Monitor your Claude API usage to avoid unexpected costs.

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to **Usage & Billing**
3. Set up usage alerts
4. Monitor daily API costs

**Recommended**: Set up budget alerts in Anthropic Console to prevent overages.

---

## Additional Resources

- [Vercel Environment Variables Docs](https://vercel.com/docs/concepts/projects/environment-variables)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)

---

**Last Updated**: March 15, 2026
**Deployed by**: Claude (AI Assistant)
**Session**: https://claude.ai/code
