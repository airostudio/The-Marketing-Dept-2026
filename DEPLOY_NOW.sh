#!/bin/bash

echo "🚀 Deploying to Vercel Production"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "vercel.json" ]; then
    echo "❌ Error: vercel.json not found. Run this script from the project root."
    exit 1
fi

echo "📍 Current branch: $(git branch --show-current)"
echo ""

# Merge claude branch to master
echo "1️⃣ Merging claude/ai-content-writer-GqF4t to master..."
git checkout master || { echo "❌ Failed to checkout master"; exit 1; }
git pull origin claude/ai-content-writer-GqF4t || { echo "❌ Failed to pull claude branch"; exit 1; }

echo ""
echo "2️⃣ Pushing to master (triggers Vercel auto-deploy)..."
git push origin master || { echo "❌ Failed to push to master"; exit 1; }

echo ""
echo "✅ DEPLOYED!"
echo ""
echo "📋 Next steps:"
echo "   1. Go to Vercel Dashboard → Deployments"
echo "   2. Wait for build to complete (~2-3 minutes)"
echo "   3. Test: www.audema.com.au/api-test-simple.html"
echo ""
echo "🔑 Don't forget:"
echo "   • Vercel env var ANTHROPIC_API_KEY must be set"
echo "   • Must start with: sk-ant-api"
echo "   • Must be enabled for Production environment"
echo ""
