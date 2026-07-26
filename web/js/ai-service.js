/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AI SERVICE - Unified AI Integration
 * Audema Marketing 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides AI-powered features using OpenAI GPT-4 and Google Gemini:
 * - SEO Analysis & Recommendations
 * - Content Generation & Optimization
 * - Keyword Research Enhancement
 * - Competitor Analysis Insights
 * - Report Generation
 * - Social Media Content
 * - Ad Copy Generation
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // AI PROVIDER CLIENTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Both provider clients below call this project's own server-side
     * proxies (api/openai.js, api/gemini.js) — never the provider's API
     * directly from the browser. Those proxies read the real key
     * exclusively from a Vercel environment variable (OPENAI_API_KEY /
     * GEMINI_API_KEY) and never return it to the client. The two clients
     * previously called https://api.openai.com / https://generativelanguage...
     * directly using window.APP_CONFIG.AI.{OPENAI,GEMINI}.API_KEY — a
     * client-side secret that must never actually be populated (doing so
     * would ship the real key to every visitor via view-source), which
     * meant this entire module (SEO/Content/Social/Ads/Reports below) was
     * silently dead in production: isAvailable() always false, every
     * method returning its empty fallback with no real AI call ever made.
     */
    async function callProxy(endpoint, messages, options = {}) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                systemPrompt: options.systemPrompt,
                model: options.model,
                stream: false,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.error || `AI request failed (HTTP ${res.status})`);
        }
        return data.text || '';
    }

    const OpenAI = {
        async chat(messages, options = {}) {
            return callProxy('/api/openai', messages, { ...options, model: options.model || 'gpt-4o' });
        },

        async complete(prompt, options = {}) {
            return this.chat([{ role: 'user', content: prompt }], options);
        }
    };

    const Gemini = {
        async generate(prompt, options = {}) {
            return this.chat([{ role: 'user', content: prompt }], options);
        },

        async chat(messages, options = {}) {
            return callProxy('/api/gemini', messages, { ...options, model: options.model || 'gemini-2.5-pro' });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIFIED AI CLIENT
    // ═══════════════════════════════════════════════════════════════════════════

    const AI = {
        /**
         * The preferred AI provider. Both providers are always "available"
         * from the client's perspective now — real availability (is the key
         * actually set in Vercel env vars) is a server-side fact surfaced
         * as a real error from the proxy on the actual call, not something
         * guessable from client config.
         */
        getProvider() {
            return window.APP_CONFIG?.AI?.DEFAULT_PROVIDER || 'openai';
        },

        /**
         * Whether the AI module itself is loaded and its proxy endpoints
         * are reachable in principle. Does NOT mean a real key is
         * configured server-side — that's only knowable by actually
         * calling prompt()/chat() and seeing whether it throws.
         */
        isAvailable() {
            return true;
        },

        /**
         * Send a prompt to the AI
         */
        async prompt(text, options = {}) {
            const provider = options.provider || this.getProvider();

            try {
                if (provider === 'openai') {
                    return await OpenAI.complete(text, options);
                } else {
                    return await Gemini.generate(text, options);
                }
            } catch (error) {
                console.error(`AI ${provider} error:`, error);

                // Try the other provider once — real availability can only
                // be determined by attempting the call, not by checking a
                // client-side config flag that's never actually populated.
                const fallback = provider === 'openai' ? 'gemini' : 'openai';
                try {
                    console.log(`Falling back to ${fallback}...`);
                    return fallback === 'openai'
                        ? await OpenAI.complete(text, options)
                        : await Gemini.generate(text, options);
                } catch (fallbackError) {
                    console.error(`AI ${fallback} fallback also failed:`, fallbackError);
                    throw error;
                }
            }
        },

        /**
         * Chat with context
         */
        async chat(messages, options = {}) {
            const provider = options.provider || this.getProvider();

            if (provider === 'openai') {
                return await OpenAI.chat(messages, options);
            } else if (provider === 'gemini') {
                return await Gemini.chat(messages, options);
            }

            throw new Error('No AI provider available');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SEO ANALYSIS FEATURES
    // ═══════════════════════════════════════════════════════════════════════════

    const SEOAnalysis = {
        /**
         * Generate fix recommendations for SEO issues
         */
        async getIssueRecommendations(issues) {
            if (!AI.isAvailable() || !issues?.length) return [];

            const issueList = issues.slice(0, 10).map((issue, i) =>
                `${i + 1}. [${issue.severity}] ${issue.title}: ${issue.description || ''}`
            ).join('\n');

            const prompt = `As an SEO expert, analyze these website issues and provide specific, actionable fixes for each:

${issueList}

For each issue, provide:
1. A brief explanation of why it matters for SEO
2. Step-by-step fix instructions
3. Priority level (immediate/soon/when possible)

Format as JSON array: [{"issue": "title", "explanation": "...", "steps": ["step1", "step2"], "priority": "immediate|soon|when_possible"}]`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.3,
                    maxTokens: 2000
                });

                // Parse JSON from response
                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return [];
            } catch (error) {
                console.error('AI recommendation error:', error);
                return [];
            }
        },

        /**
         * Analyze page content for SEO
         */
        async analyzeContent(content, targetKeyword = '') {
            if (!AI.isAvailable()) return null;

            const prompt = `Analyze this webpage content for SEO optimization${targetKeyword ? ` targeting the keyword "${targetKeyword}"` : ''}:

---
${content.substring(0, 3000)}
---

Provide analysis as JSON:
{
  "score": 0-100,
  "readability": "easy|moderate|difficult",
  "wordCount": number,
  "keywordDensity": percentage (if keyword provided),
  "strengths": ["strength1", "strength2"],
  "improvements": ["improvement1", "improvement2"],
  "suggestedKeywords": ["keyword1", "keyword2"],
  "metaDescription": "suggested meta description",
  "titleSuggestion": "suggested title tag"
}`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.3,
                    maxTokens: 1500
                });

                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return null;
            } catch (error) {
                console.error('Content analysis error:', error);
                return null;
            }
        },

        /**
         * Generate keyword suggestions
         */
        async suggestKeywords(topic, existingKeywords = []) {
            if (!AI.isAvailable()) return [];

            const existingList = existingKeywords.slice(0, 20).join(', ');

            const prompt = `As an SEO keyword researcher, suggest valuable keywords for the topic: "${topic}"

${existingList ? `Already targeting: ${existingList}` : ''}

Provide 20 keyword suggestions as JSON array, including:
- Long-tail variations
- Question-based keywords
- Related topics
- Local variations (if applicable)

Format: [{"keyword": "...", "type": "long-tail|question|related|local", "difficulty": "low|medium|high", "intent": "informational|transactional|navigational"}]`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.6,
                    maxTokens: 1500,
                    provider: 'gemini'  // Use Gemini for high-volume keyword tasks
                });

                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return [];
            } catch (error) {
                console.error('Keyword suggestion error:', error);
                return [];
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTENT GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    const ContentGenerator = {
        /**
         * Generate meta description
         */
        async generateMetaDescription(pageTitle, content) {
            if (!AI.isAvailable()) return '';

            const prompt = `Write an SEO-optimized meta description for this page:

Title: ${pageTitle}
Content summary: ${content.substring(0, 500)}

Requirements:
- 150-160 characters
- Include a call-to-action
- Naturally incorporate the main topic
- Compelling and click-worthy

Respond with just the meta description, no quotes.`;

            try {
                return await AI.prompt(prompt, {
                    temperature: 0.6,
                    maxTokens: 100,
                    provider: 'gemini'  // Fast for simple generations
                });
            } catch (error) {
                console.error('Meta description generation error:', error);
                return '';
            }
        },

        /**
         * Generate blog post outline
         */
        async generateBlogOutline(topic, targetKeyword, wordCount = 1500) {
            if (!AI.isAvailable()) return null;

            const prompt = `Create a detailed blog post outline for:

Topic: ${topic}
Target Keyword: ${targetKeyword}
Target Word Count: ${wordCount}

Provide as JSON:
{
  "title": "SEO-optimized title with keyword",
  "metaDescription": "150-160 char description",
  "introduction": "Brief intro summary",
  "sections": [
    {
      "heading": "H2 heading",
      "subheadings": ["H3 subheading 1", "H3 subheading 2"],
      "keyPoints": ["point 1", "point 2"],
      "wordCount": estimated words
    }
  ],
  "conclusion": "Conclusion summary",
  "callToAction": "Suggested CTA"
}`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.5,
                    maxTokens: 2000
                });

                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return null;
            } catch (error) {
                console.error('Blog outline generation error:', error);
                return null;
            }
        },

        /**
         * Improve existing content
         */
        async improveContent(content, instructions = '') {
            if (!AI.isAvailable()) return content;

            const prompt = `Improve this content for better engagement and SEO:

${instructions ? `Instructions: ${instructions}\n\n` : ''}Original content:
---
${content.substring(0, 4000)}
---

Improve by:
1. Making it more engaging and readable
2. Adding relevant transition words
3. Breaking up long paragraphs
4. Strengthening the opening and closing
5. Maintaining the original meaning and tone

Return the improved content only.`;

            try {
                return await AI.prompt(prompt, {
                    temperature: 0.5,
                    maxTokens: 4000
                });
            } catch (error) {
                console.error('Content improvement error:', error);
                return content;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SOCIAL MEDIA FEATURES
    // ═══════════════════════════════════════════════════════════════════════════

    const SocialMedia = {
        /**
         * Generate social media posts
         */
        async generatePosts(content, platforms = ['twitter', 'linkedin', 'facebook']) {
            if (!AI.isAvailable()) return {};

            const prompt = `Create engaging social media posts for this content:

---
${content.substring(0, 1000)}
---

Generate posts for: ${platforms.join(', ')}

For each platform, consider:
- Character limits (Twitter: 280, LinkedIn: 3000, Facebook: 500 optimal)
- Platform tone (Twitter: casual/witty, LinkedIn: professional, Facebook: friendly)
- Hashtag usage
- Emoji usage (moderate)

Format as JSON:
{
  "twitter": {"post": "...", "hashtags": ["#tag1"]},
  "linkedin": {"post": "...", "hashtags": ["#tag1"]},
  "facebook": {"post": "...", "hashtags": []}
}`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.7,
                    maxTokens: 1500,
                    provider: 'gemini'  // Good for creative content
                });

                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return {};
            } catch (error) {
                console.error('Social post generation error:', error);
                return {};
            }
        },

        /**
         * Generate content calendar suggestions
         */
        async generateContentCalendar(topics, duration = 'week') {
            if (!AI.isAvailable()) return [];

            const prompt = `Create a social media content calendar for ${duration}:

Topics/Themes: ${topics.join(', ')}

Generate a posting schedule with:
- Mix of content types (educational, promotional, engaging, curated)
- Best posting times
- Platform recommendations
- Content ideas for each post

Format as JSON array:
[{
  "day": "Monday",
  "time": "9:00 AM",
  "platform": "linkedin",
  "type": "educational",
  "topic": "...",
  "postIdea": "...",
  "hashtags": ["#tag"]
}]`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.6,
                    maxTokens: 2000,
                    provider: 'gemini'
                });

                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return [];
            } catch (error) {
                console.error('Content calendar error:', error);
                return [];
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AD COPY GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    const AdCopy = {
        /**
         * Generate Google Ads copy
         */
        async generateGoogleAds(product, keywords, landingPage = '') {
            if (!AI.isAvailable()) return [];

            const prompt = `Create Google Ads copy for:

Product/Service: ${product}
Target Keywords: ${keywords.join(', ')}
${landingPage ? `Landing Page: ${landingPage}` : ''}

Generate 3 ad variations with:
- Headlines (max 30 characters each, need 3 headlines)
- Descriptions (max 90 characters each, need 2 descriptions)
- Include keywords naturally
- Strong CTAs

Format as JSON array:
[{
  "headlines": ["Headline 1", "Headline 2", "Headline 3"],
  "descriptions": ["Description 1", "Description 2"],
  "displayUrl": "example.com/path"
}]`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.6,
                    maxTokens: 1500
                });

                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return [];
            } catch (error) {
                console.error('Google Ads generation error:', error);
                return [];
            }
        },

        /**
         * Generate Meta/Facebook ad copy
         */
        async generateMetaAds(product, audience, objective = 'conversions') {
            if (!AI.isAvailable()) return [];

            const prompt = `Create Meta (Facebook/Instagram) ad copy for:

Product/Service: ${product}
Target Audience: ${audience}
Objective: ${objective}

Generate 3 ad variations with:
- Primary text (engaging, 125 chars optimal)
- Headline (max 40 chars)
- Description (max 30 chars)
- Call to action suggestion

Format as JSON array:
[{
  "primaryText": "...",
  "headline": "...",
  "description": "...",
  "cta": "Learn More|Shop Now|Sign Up|etc"
}]`;

            try {
                const response = await AI.prompt(prompt, {
                    temperature: 0.7,
                    maxTokens: 1500
                });

                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return [];
            } catch (error) {
                console.error('Meta Ads generation error:', error);
                return [];
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // REPORT GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    const Reports = {
        /**
         * Generate executive summary from analysis data
         */
        async generateExecutiveSummary(analysisData) {
            if (!AI.isAvailable()) return '';

            const prompt = `Generate an executive summary for this SEO analysis:

Website: ${analysisData.url}
Health Score: ${analysisData.healthScore}/100
Pages Analyzed: ${analysisData.pages?.length || 0}
Issues Found: ${analysisData.issues?.length || 0}
- Critical: ${analysisData.issues?.filter(i => i.severity === 'critical').length || 0}
- High: ${analysisData.issues?.filter(i => i.severity === 'high').length || 0}
- Medium: ${analysisData.issues?.filter(i => i.severity === 'medium').length || 0}

Top Issues:
${analysisData.issues?.slice(0, 5).map(i => `- ${i.title}`).join('\n') || 'None'}

Keywords Found: ${analysisData.keywords?.length || 0}
Backlinks: ${analysisData.backlinks?.length || 0}

Write a 2-3 paragraph executive summary that:
1. Summarizes the overall SEO health
2. Highlights the most critical issues
3. Provides prioritized recommendations
4. Ends with next steps

Use professional but accessible language.`;

            try {
                return await AI.prompt(prompt, {
                    temperature: 0.4,
                    maxTokens: 1000
                });
            } catch (error) {
                console.error('Executive summary error:', error);
                return '';
            }
        },

        /**
         * Generate competitor comparison insights
         */
        async generateCompetitorInsights(ourData, competitorData) {
            if (!AI.isAvailable()) return '';

            const prompt = `Analyze this competitive SEO comparison:

Our Website:
- Domain Authority: ${ourData.domainAuthority || 'N/A'}
- Keywords: ${ourData.keywords || 'N/A'}
- Backlinks: ${ourData.backlinks || 'N/A'}

Competitor (${competitorData.domain}):
- Domain Authority: ${competitorData.domainAuthority || 'N/A'}
- Keywords: ${competitorData.keywords || 'N/A'}
- Backlinks: ${competitorData.backlinks || 'N/A'}

Provide:
1. Key competitive gaps
2. Opportunities to exploit
3. Threats to address
4. Strategic recommendations

Be specific and actionable.`;

            try {
                return await AI.prompt(prompt, {
                    temperature: 0.4,
                    maxTokens: 1500
                });
            } catch (error) {
                console.error('Competitor insights error:', error);
                return '';
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════════════

    window.AIService = {
        // Core
        AI,
        OpenAI,
        Gemini,

        // Features
        SEO: SEOAnalysis,
        Content: ContentGenerator,
        Social: SocialMedia,
        Ads: AdCopy,
        Reports,

        // Utilities
        isAvailable: () => AI.isAvailable(),
        getProvider: () => AI.getProvider()
    };

    // Log availability on load
    setTimeout(() => {
        const provider = AI.getProvider();
        if (provider) {
            console.log(`AI Service: Using ${provider} as primary provider`);
        } else {
            console.log('AI Service: No API keys configured. Add keys in config.js to enable AI features.');
        }
    }, 100);

})();
