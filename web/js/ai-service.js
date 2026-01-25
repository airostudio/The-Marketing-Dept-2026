/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AI SERVICE - Unified AI Integration
 * The Marketing Department 2026
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

    const OpenAI = {
        baseUrl: 'https://api.openai.com/v1',

        async chat(messages, options = {}) {
            const config = window.APP_CONFIG?.AI?.OPENAI;
            if (!config?.API_KEY) throw new Error('OpenAI API key not configured');

            const model = options.model || config.MODEL || 'gpt-4o';
            const maxTokens = options.maxTokens || window.APP_CONFIG?.AI?.SETTINGS?.MAX_TOKENS?.MEDIUM || 1500;
            const temperature = options.temperature ?? window.APP_CONFIG?.AI?.SETTINGS?.TEMPERATURE?.BALANCED ?? 0.5;

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.API_KEY}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: maxTokens,
                    temperature
                })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error?.message || 'OpenAI API request failed');
            }

            const data = await response.json();
            return data.choices[0]?.message?.content || '';
        },

        async complete(prompt, options = {}) {
            return this.chat([{ role: 'user', content: prompt }], options);
        }
    };

    const Gemini = {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',

        async generate(prompt, options = {}) {
            const config = window.APP_CONFIG?.AI?.GEMINI;
            if (!config?.API_KEY) throw new Error('Gemini API key not configured');

            const model = options.model || config.MODEL || 'gemini-1.5-flash';
            const maxTokens = options.maxTokens || window.APP_CONFIG?.AI?.SETTINGS?.MAX_TOKENS?.MEDIUM || 1500;
            const temperature = options.temperature ?? window.APP_CONFIG?.AI?.SETTINGS?.TEMPERATURE?.BALANCED ?? 0.5;

            const response = await fetch(
                `${this.baseUrl}/models/${model}:generateContent?key=${config.API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: maxTokens,
                            temperature
                        }
                    })
                }
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error?.message || 'Gemini API request failed');
            }

            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        },

        async chat(messages, options = {}) {
            // Convert OpenAI format to Gemini format
            const prompt = messages.map(m => {
                const role = m.role === 'assistant' ? 'Model' : 'User';
                return `${role}: ${m.content}`;
            }).join('\n\n');

            return this.generate(prompt, options);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIFIED AI CLIENT
    // ═══════════════════════════════════════════════════════════════════════════

    const AI = {
        /**
         * Get the preferred AI provider
         */
        getProvider() {
            const config = window.APP_CONFIG?.AI;
            const preferred = config?.DEFAULT_PROVIDER || 'openai';

            // Check if preferred provider is available
            if (preferred === 'openai' && config?.OPENAI?.ENABLED && config?.OPENAI?.API_KEY) {
                return 'openai';
            }
            if (preferred === 'gemini' && config?.GEMINI?.ENABLED && config?.GEMINI?.API_KEY) {
                return 'gemini';
            }

            // Fallback to any available provider
            if (config?.OPENAI?.ENABLED && config?.OPENAI?.API_KEY) return 'openai';
            if (config?.GEMINI?.ENABLED && config?.GEMINI?.API_KEY) return 'gemini';

            return null;
        },

        /**
         * Check if AI is available
         */
        isAvailable() {
            return this.getProvider() !== null;
        },

        /**
         * Send a prompt to the AI
         */
        async prompt(text, options = {}) {
            const provider = options.provider || this.getProvider();

            if (!provider) {
                throw new Error('No AI provider configured. Add API keys in config.js');
            }

            try {
                if (provider === 'openai') {
                    return await OpenAI.complete(text, options);
                } else if (provider === 'gemini') {
                    return await Gemini.generate(text, options);
                }
            } catch (error) {
                console.error(`AI ${provider} error:`, error);

                // Try fallback provider
                const fallback = provider === 'openai' ? 'gemini' : 'openai';
                const fallbackConfig = window.APP_CONFIG?.AI?.[fallback.toUpperCase()];

                if (fallbackConfig?.ENABLED && fallbackConfig?.API_KEY) {
                    console.log(`Falling back to ${fallback}...`);
                    if (fallback === 'openai') {
                        return await OpenAI.complete(text, options);
                    } else {
                        return await Gemini.generate(text, options);
                    }
                }

                throw error;
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
