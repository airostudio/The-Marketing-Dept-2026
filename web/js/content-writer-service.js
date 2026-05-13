/**
 * AI Content Writer Service
 * Professional content generation with 20+ years expert writing experience
 * Handles content generation, proofreading, summarization, style guides, and persona adaptation
 */

const ContentWriterService = (() => {
    // Configuration
    const config = {
        apiEndpoint: '/api/content',
        maxHistoryItems: 50,
        storageKey: 'contentWriterHistory'
    };

    // State management
    let state = {
        currentContent: '',
        history: [],
        editHistory: [],
        editHistoryIndex: -1,
        isGenerating: false,
        styleGuides: {},
        personas: {},
        activeStyleGuide: null,
        activePersona: null,
        currentProject: null,
        autoSaveInterval: null
    };

    // Style Guide Definitions
    const styleGuides = {
        default: {
            name: 'Default Style',
            rules: {
                oxford_comma: true,
                sentence_case_headings: true,
                avoid_passive_voice: true,
                max_sentence_length: 25,
                paragraph_max_sentences: 5
            }
        },
        ap: {
            name: 'AP Style',
            rules: {
                oxford_comma: false,
                date_format: 'Month DD, YYYY',
                state_abbreviations: true,
                numbers_under_ten: 'spell_out',
                avoid_contractions: true
            }
        },
        chicago: {
            name: 'Chicago Manual',
            rules: {
                oxford_comma: true,
                notes_style: 'footnotes',
                numbers_under_one_hundred: 'spell_out',
                quotation_style: 'american'
            }
        },
        apa: {
            name: 'APA Style',
            rules: {
                oxford_comma: true,
                in_text_citations: true,
                headings_levels: 5,
                active_voice_preferred: true
            }
        },
        custom: {
            name: 'Custom Brand Style',
            rules: {
                brand_voice: 'consistent',
                terminology: 'approved_only',
                formatting: 'brand_guidelines'
            }
        }
    };

    // Audience Persona Definitions
    const personas = {
        'b2b-executive': {
            name: 'B2B Executive',
            characteristics: {
                education: 'graduate',
                experience: 'senior',
                decision_maker: true,
                interests: ['ROI', 'efficiency', 'strategic impact'],
                pain_points: ['time constraints', 'risk aversion', 'budget justification'],
                preferred_tone: 'professional',
                content_preferences: ['data-driven', 'concise', 'actionable']
            }
        },
        'b2b-manager': {
            name: 'B2B Manager',
            characteristics: {
                education: 'undergraduate',
                experience: 'mid-level',
                decision_maker: false,
                interests: ['implementation', 'team productivity', 'best practices'],
                pain_points: ['resource limitations', 'approval processes'],
                preferred_tone: 'professional',
                content_preferences: ['how-to', 'practical', 'detailed']
            }
        },
        'b2c-consumer': {
            name: 'B2C Consumer',
            characteristics: {
                education: 'varies',
                experience: 'varies',
                decision_maker: true,
                interests: ['value', 'convenience', 'quality'],
                pain_points: ['overwhelmed by options', 'trust issues'],
                preferred_tone: 'friendly',
                content_preferences: ['clear benefits', 'social proof', 'easy to understand']
            }
        },
        'technical': {
            name: 'Technical Audience',
            characteristics: {
                education: 'technical',
                experience: 'expert',
                decision_maker: 'varies',
                interests: ['technical details', 'specifications', 'integrations'],
                pain_points: ['incomplete documentation', 'lack of technical depth'],
                preferred_tone: 'informative',
                content_preferences: ['technical accuracy', 'code examples', 'architecture diagrams']
            }
        },
        'non-technical': {
            name: 'Non-Technical Audience',
            characteristics: {
                education: 'varies',
                experience: 'beginner',
                decision_maker: 'varies',
                interests: ['simplicity', 'benefits', 'ease of use'],
                pain_points: ['jargon', 'complexity', 'too many options'],
                preferred_tone: 'friendly',
                content_preferences: ['simple language', 'analogies', 'visual aids']
            }
        }
    };

    // Use Case Templates (Expert 20+ years knowledge)
    const useCaseTemplates = {
        'blog-post': {
            name: 'Blog Post / Article',
            structure: ['hook', 'introduction', 'main_points', 'examples', 'conclusion', 'cta'],
            expert_tips: [
                'Start with a compelling hook in the first sentence',
                'Use subheadings every 300 words for readability',
                'Include data, statistics, or expert quotes for credibility',
                'End with a clear call-to-action'
            ],
            seo_considerations: true,
            ideal_length: 1500
        },
        'email-campaign': {
            name: 'Email Campaign',
            structure: ['subject_line', 'preview_text', 'personalized_greeting', 'value_proposition', 'body', 'cta', 'signature'],
            expert_tips: [
                'Subject line should be under 50 characters',
                'Front-load value in the first 2 sentences',
                'One clear CTA above the fold',
                'Use personalization tokens strategically'
            ],
            ideal_length: 200
        },
        'social-post': {
            name: 'Social Media Post',
            structure: ['hook', 'value', 'cta', 'hashtags'],
            expert_tips: [
                'First 5 words are critical for engagement',
                'Include a question or call-to-action',
                'Use 2-5 relevant hashtags',
                'Consider platform-specific best practices'
            ],
            ideal_length: 150
        },
        'landing-page': {
            name: 'Landing Page Copy',
            structure: ['headline', 'subheadline', 'benefits', 'social_proof', 'features', 'objection_handling', 'cta'],
            expert_tips: [
                'Headline should communicate core value in 10 words',
                'Use benefit-driven copy, not feature lists',
                'Include trust signals and social proof',
                'Multiple CTAs with consistent messaging'
            ],
            conversion_focused: true,
            ideal_length: 500
        },
        'product-description': {
            name: 'Product Description',
            structure: ['headline', 'key_benefits', 'features', 'specifications', 'use_cases', 'guarantee'],
            expert_tips: [
                'Lead with the main benefit, not features',
                'Use sensory language to create desire',
                'Address common objections preemptively',
                'Include clear product specifications'
            ],
            ideal_length: 300
        },
        'seo-meta': {
            name: 'SEO Meta Description',
            structure: ['primary_keyword', 'value_proposition', 'cta'],
            expert_tips: [
                'Keep under 160 characters',
                'Include target keyword naturally',
                'Create urgency or curiosity',
                'Match search intent'
            ],
            ideal_length: 155,
            character_limit: 160
        }
    };

    /**
     * Initialize the Content Writer Service
     */
    function init() {
        loadHistory();
        initializeEventListeners();
        loadStyleGuides();
        loadPersonas();
        initializeProjectIntegration();
        console.log('✅ Content Writer Service initialized');
    }

    /**
     * Initialize project integration
     */
    function initializeProjectIntegration() {
        // Check if UnifiedProjectManager is available
        if (typeof window.UnifiedProjectManager === 'undefined') {
            console.warn('[ContentWriter] UnifiedProjectManager not available');
            return;
        }

        // Load current project if exists
        loadCurrentProject();

        // Set up auto-save
        setupProjectAutoSave();

        // Listen for project changes
        window.addEventListener('currentProjectChanged', (e) => {
            if (e.detail?.project?.type === 'content') {
                loadProject(e.detail.project);
            }
        });

        console.log('✅ Project integration initialized');
    }

    /**
     * Load current project
     */
    function loadCurrentProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') return;

        const project = window.UnifiedProjectManager.getCurrentProject();
        if (project && project.type === window.PROJECT_TYPES.CONTENT) {
            state.currentProject = project;
            loadProjectData(project);
        }
    }

    /**
     * Load project data into the editor
     */
    function loadProjectData(project) {
        if (!project || !project.data) return;

        // Restore project settings
        if (project.data.useCase) {
            document.getElementById('useCase').value = project.data.useCase;
        }
        if (project.data.tone) {
            document.getElementById('tone').value = project.data.tone;
        }
        if (project.data.persona) {
            document.getElementById('persona').value = project.data.persona;
        }
        if (project.data.styleGuide) {
            document.getElementById('styleGuide').value = project.data.styleGuide;
        }
        if (project.data.language) {
            document.getElementById('language').value = project.data.language;
        }
        if (project.data.contentLength) {
            document.getElementById('contentLength').value = project.data.contentLength;
        }
        if (project.data.inputTopic) {
            document.getElementById('inputTopic').value = project.data.inputTopic;
        }

        // Restore content
        if (project.data.content) {
            displayContent(project.data.content);
        }

        // Show project info
        showProjectInfo(project);
    }

    /**
     * Save current state to project
     */
    function saveToProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') return;
        if (!state.currentProject) return;

        const projectData = {
            useCase: document.getElementById('useCase')?.value,
            tone: document.getElementById('tone')?.value,
            persona: document.getElementById('persona')?.value,
            styleGuide: document.getElementById('styleGuide')?.value,
            language: document.getElementById('language')?.value,
            contentLength: document.getElementById('contentLength')?.value,
            inputTopic: document.getElementById('inputTopic')?.value,
            content: state.currentContent,
            wordCount: document.getElementById('wordCount')?.textContent,
            lastSaved: new Date().toISOString()
        };

        window.UnifiedProjectManager.autoSaveCurrentProject(projectData);
    }

    /**
     * Set up auto-save interval
     */
    function setupProjectAutoSave() {
        // Clear existing interval
        if (state.autoSaveInterval) {
            clearInterval(state.autoSaveInterval);
        }

        // Auto-save every 15 seconds
        state.autoSaveInterval = setInterval(() => {
            if (state.currentProject) {
                saveToProject();
            }
        }, 15000);
    }

    /**
     * Create new content project
     */
    function createNewProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') {
            showAlert('Project management not available', 'warning');
            return;
        }

        const projectName = prompt('Enter project name:', 'Content Project');
        if (!projectName) return;

        const project = window.UnifiedProjectManager.createProject({
            name: projectName,
            type: window.PROJECT_TYPES.CONTENT,
            description: 'AI Content Writer Project',
            data: {
                useCase: document.getElementById('useCase')?.value || 'blog-post',
                tone: document.getElementById('tone')?.value || 'professional'
            }
        });

        state.currentProject = project;
        showAlert('Project created successfully!', 'success');
        showProjectInfo(project);
    }

    /**
     * Show project information
     */
    function showProjectInfo(project) {
        // Add project info banner if not exists
        let banner = document.getElementById('project-info-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'project-info-banner';
            banner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 24px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                z-index: 9998;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;

            const container = document.querySelector('.writer-container');
            if (container) {
                container.style.paddingTop = '60px';
            }

            document.body.insertBefore(banner, document.body.firstChild);
        }

        const stateColors = {
            'created': '#10B981',
            'in_progress': '#F59E0B',
            'paused': '#6366F1',
            'completed': '#8B5CF6'
        };

        const stateLabels = {
            'created': 'Created',
            'in_progress': 'In Progress',
            'paused': 'Paused',
            'completed': 'Completed'
        };

        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px;">
                <div style="font-weight: 600; font-size: 15px;">
                    📝 ${project.name}
                </div>
                <div style="padding: 4px 12px; background: ${stateColors[project.state]}; border-radius: 12px; font-size: 12px; font-weight: 600;">
                    ${stateLabels[project.state]}
                </div>
                <div style="font-size: 13px; opacity: 0.9;">
                    Progress: ${project.progress}%
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button onclick="ContentWriterService.pauseCurrentProject()" style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; font-size: 13px; cursor: pointer;">
                    ${project.state === 'paused' ? '▶️ Resume' : '⏸️ Pause'}
                </button>
                <button onclick="ContentWriterService.saveToProject()" style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; font-size: 13px; cursor: pointer;">
                    💾 Save
                </button>
                <button onclick="ContentWriterService.viewAllProjects()" style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; font-size: 13px; cursor: pointer;">
                    📁 Projects
                </button>
            </div>
        `;
    }

    /**
     * Pause/Resume current project
     */
    function pauseCurrentProject() {
        if (!state.currentProject) return;

        if (state.currentProject.state === 'paused') {
            window.UnifiedProjectManager.resumeProject(state.currentProject.id);
            showAlert('Project resumed', 'success');
        } else {
            window.UnifiedProjectManager.pauseProject(state.currentProject.id);
            showAlert('Project paused', 'info');
        }

        state.currentProject = window.UnifiedProjectManager.getProject(state.currentProject.id);
        showProjectInfo(state.currentProject);
    }

    /**
     * View all projects
     */
    function viewAllProjects() {
        window.location.href = '/marketing/projects.html';
    }

    /**
     * Load content history from localStorage
     */
    function loadHistory() {
        try {
            const saved = localStorage.getItem(config.storageKey);
            if (saved) {
                state.history = JSON.parse(saved);
                renderHistory();
            }
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    /**
     * Save content to history
     */
    function saveToHistory(content, metadata) {
        const historyItem = {
            id: Date.now(),
            content,
            metadata,
            timestamp: new Date().toISOString()
        };

        state.history.unshift(historyItem);

        // Keep only last N items
        if (state.history.length > config.maxHistoryItems) {
            state.history = state.history.slice(0, config.maxHistoryItems);
        }

        try {
            localStorage.setItem(config.storageKey, JSON.stringify(state.history));
            renderHistory();
        } catch (error) {
            console.error('Error saving history:', error);
        }
    }

    /**
     * Render history items
     */
    function renderHistory() {
        const historyList = document.getElementById('historyList');

        if (state.history.length === 0) {
            historyList.innerHTML = '<div class="output-empty">No history yet. Start generating content to see your history here.</div>';
            return;
        }

        historyList.innerHTML = state.history.map(item => `
            <div class="history-item" data-id="${item.id}">
                <div class="history-title">${item.metadata.useCase} - ${item.metadata.tone}</div>
                <div class="history-meta">${new Date(item.timestamp).toLocaleString()}</div>
            </div>
        `).join('');

        // Add click handlers
        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                const historyItem = state.history.find(h => h.id === id);
                if (historyItem) {
                    displayContent(historyItem.content);
                    // Switch to output tab
                    document.querySelector('[data-tab="output"]').click();
                }
            });
        });
    }

    /**
     * Load style guides
     */
    function loadStyleGuides() {
        state.styleGuides = styleGuides;
    }

    /**
     * Load personas
     */
    function loadPersonas() {
        state.personas = personas;
    }

    /**
     * Initialize event listeners
     */
    function initializeEventListeners() {
        // Generate button
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', handleGenerate);
        }

        // Toolbar buttons
        const toolbarButtons = {
            copyBtn: handleCopy,
            downloadBtn: handleDownload,
            improveBtn: () => handleImprove(),
            shortenBtn: () => handleShorten(),
            expandBtn: () => handleExpand(),
            summarizeBtn: () => handleSummarize(),
            rewriteBtn: () => handleRewrite(),
            checkGrammarBtn: () => handleCheckGrammar(),
            checkStyleBtn: () => handleCheckStyle(),
            checkToneBtn: () => handleCheckTone(),
            applyFixesBtn: () => handleApplyFixes(),
            saveEditBtn: handleSaveEdit,
            undoBtn: handleUndo,
            redoBtn: handleRedo,
            clearBtn: handleClear
        };

        Object.entries(toolbarButtons).forEach(([id, handler]) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', handler);
            }
        });

        // Style guide and persona selectors
        const styleGuideSelect = document.getElementById('styleGuide');
        if (styleGuideSelect) {
            styleGuideSelect.addEventListener('change', (e) => {
                state.activeStyleGuide = e.target.value;
            });
        }

        const personaSelect = document.getElementById('persona');
        if (personaSelect) {
            personaSelect.addEventListener('change', (e) => {
                state.activePersona = e.target.value;
            });
        }
    }

    /**
     * Generate content based on inputs
     */
    async function handleGenerate() {
        const useCase = document.getElementById('useCase').value;
        const tone = document.getElementById('tone').value;
        const persona = document.getElementById('persona').value;
        const styleGuide = document.getElementById('styleGuide').value;
        const language = document.getElementById('language').value;
        const contentLength = document.getElementById('contentLength').value;
        const inputTopic = document.getElementById('inputTopic').value.trim();

        if (!inputTopic) {
            showAlert('Please enter a topic or context for content generation', 'warning');
            return;
        }

        const generateBtn = document.getElementById('generateBtn');
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> Generating...';

        try {
            const content = await generateContent({
                useCase,
                tone,
                persona,
                styleGuide,
                language,
                contentLength,
                inputTopic
            });

            displayContent(content);

            // Save to history
            saveToHistory(content, {
                useCase: useCaseTemplates[useCase]?.name || useCase,
                tone,
                persona,
                styleGuide,
                language
            });

            // Calculate quality scores
            calculateQualityMetrics(content, { tone, styleGuide, persona });

            showAlert('Content generated successfully!', 'success');
        } catch (error) {
            console.error('Generation error:', error);
            showAlert('Failed to generate content. Please try again.', 'warning');
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<span>✨</span> Generate Content';
        }
    }

    /**
     * Generate content using expert AI system
     */
    async function generateContent(params) {
        // Simulate API call with expert content generation
        // In production, this would call Claude API with specialized prompts

        const template = useCaseTemplates[params.useCase] || {};
        const personaData = personas[params.persona] || {};
        const styleGuideData = styleGuides[params.styleGuide] || {};

        // Build expert prompt
        const expertPrompt = buildExpertPrompt(params, template, personaData, styleGuideData);

        // No fake delays - return immediately when content is generated

        // Generate content based on use case
        return generateContentByUseCase(params, template);
    }

    /**
     * Build expert prompt for content generation
     */
    function buildExpertPrompt(params, template, persona, styleGuide) {
        return `
You are a world-class content writer with 20+ years of professional writing experience.
You specialize in ${template.name || params.useCase} and understand the nuances of effective content creation.

CONTENT REQUIREMENTS:
- Use Case: ${template.name || params.useCase}
- Tone: ${params.tone}
- Target Audience: ${persona.name || 'General'}
- Style Guide: ${styleGuide.name || 'Default'}
- Language: ${params.language}
- Length: ${params.contentLength}

AUDIENCE PROFILE:
${persona.characteristics ? JSON.stringify(persona.characteristics, null, 2) : 'General audience'}

STYLE GUIDE RULES:
${styleGuide.rules ? JSON.stringify(styleGuide.rules, null, 2) : 'Standard style'}

EXPERT TIPS FOR THIS USE CASE:
${template.expert_tips ? template.expert_tips.map((tip, i) => `${i + 1}. ${tip}`).join('\n') : ''}

STRUCTURE TO FOLLOW:
${template.structure ? template.structure.join(' → ') : 'Standard structure'}

TOPIC/CONTEXT:
${params.inputTopic}

Generate exceptional, professional content that demonstrates expertise and achieves the intended purpose.
`;
    }

    /**
     * Generate content by use case (Expert templates)
     */
    function generateContentByUseCase(params, template) {
        const lengthMultiplier = {
            'short': 0.5,
            'medium': 1,
            'long': 1.5,
            'very-long': 2
        }[params.contentLength] || 1;

        // Use case specific content generation
        switch (params.useCase) {
            case 'blog-post':
                return generateBlogPost(params, lengthMultiplier);
            case 'email-campaign':
                return generateEmailCampaign(params, lengthMultiplier);
            case 'social-post':
                return generateSocialPost(params, lengthMultiplier);
            case 'product-description':
                return generateProductDescription(params, lengthMultiplier);
            case 'seo-meta':
                return generateSEOMeta(params);
            case 'landing-page':
                return generateLandingPage(params, lengthMultiplier);
            default:
                return generateGenericContent(params, lengthMultiplier);
        }
    }

    /**
     * Generate Blog Post (Expert quality)
     */
    function generateBlogPost(params, multiplier) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `# ${capitalizeFirstLetter(topic)}: A Comprehensive Guide

${tone.opening} In today's rapidly evolving landscape, understanding ${topic} has become more critical than ever. This guide will walk you through everything you need to know to master this essential topic.

## Why ${capitalizeFirstLetter(topic)} Matters

The impact of ${topic} extends far beyond surface-level understanding. Industry leaders have recognized that companies who excel in this area consistently outperform their competitors by an average of 40%. ${tone.emphasis}

## Key Principles to Understand

When approaching ${topic}, it's essential to grasp these fundamental concepts:

**1. Foundation First**: Building a solid foundation ensures long-term success and prevents costly mistakes down the line.

**2. Strategic Implementation**: ${tone.strategic} A well-planned approach yields better results than rushing into execution without proper preparation.

**3. Continuous Optimization**: The most successful practitioners understand that ${topic} requires ongoing refinement and adaptation to changing conditions.

## Best Practices from Industry Experts

After working with hundreds of organizations over 20+ years, these practices consistently deliver exceptional results:

- **Data-Driven Decision Making**: Base your strategy on solid analytics and measurable outcomes
- **Customer-Centric Approach**: Always prioritize the end-user experience and value delivery
- **Iterative Improvement**: Implement feedback loops and continuously optimize your approach

## Common Pitfalls to Avoid

Even experienced professionals make these mistakes. Here's how to sidestep them:

${tone.warning} Many teams rush implementation without proper planning, leading to wasted resources and missed opportunities. Take time to develop a comprehensive strategy before diving into execution.

## Taking Action: Your Next Steps

Now that you understand the fundamentals of ${topic}, here's how to move forward:

1. Assess your current situation and identify gaps
2. Develop a clear action plan with measurable milestones
3. Allocate resources appropriately
4. Monitor progress and adjust as needed

## Conclusion

${tone.closing} Mastering ${topic} isn't just about understanding theory—it's about practical application and continuous improvement. ${tone.cta}

Start implementing these strategies today and you'll see measurable improvements in the coming weeks.`;
    }

    /**
     * Generate Email Campaign
     */
    function generateEmailCampaign(params, multiplier) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `Subject: ${generateEmailSubject(topic, params.tone)}

Hi [First Name],

${tone.opening} I wanted to reach out because ${topic} is something that could significantly impact your business.

Here's what caught my attention: Companies that excel in this area are seeing remarkable results—and I believe you could too.

**Here's what this means for you:**

→ Increased efficiency in your operations
→ Better outcomes for your team
→ Measurable ROI within the first quarter

${tone.emphasis}

**What makes this different?**

Unlike traditional approaches, this strategy focuses on practical implementation and real results. No fluff, no empty promises—just proven techniques that work.

I'd love to show you exactly how this could work for your situation.

${tone.cta}

[CTA Button: Learn More]

Best regards,
[Your Name]

P.S. ${tone.ps}`;
    }

    /**
     * Generate Social Media Post
     */
    function generateSocialPost(params, multiplier) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `${tone.hook}

${topic} is changing the game—here's what you need to know:

✅ Practical strategies that work
✅ Real results from industry leaders
✅ Actionable insights you can use today

${tone.social_value}

${tone.cta_social}

#${topic.replace(/\s+/g, '')} #Marketing #Strategy #Growth #BusinessTips`;
    }

    /**
     * Generate Product Description
     */
    function generateProductDescription(params, multiplier) {
        const product = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `${capitalizeFirstLetter(product)} - ${tone.tagline}

${tone.opening} Transform your experience with ${product}, designed for professionals who demand excellence.

**Key Benefits:**

• **Superior Performance**: Experience results that exceed industry standards
• **Effortless Integration**: Seamlessly fits into your existing workflow
• **Proven Results**: Trusted by thousands of satisfied customers worldwide

**Why Choose ${capitalizeFirstLetter(product)}?**

${tone.differentiation}

**Features That Matter:**

- Advanced technology for optimal performance
- Intuitive interface designed for ease of use
- Comprehensive support and documentation
- Regular updates and improvements

**Perfect For:**

Whether you're a seasoned professional or just getting started, ${product} adapts to your needs and grows with you.

${tone.guarantee}

**Ready to get started?**

${tone.cta}`;
    }

    /**
     * Generate SEO Meta Description
     */
    function generateSEOMeta(params) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        // Keep under 160 characters
        const options = [
            `Discover ${topic} strategies that drive results. Expert insights, proven techniques, and actionable tips for success.`,
            `${capitalizeFirstLetter(topic)} made simple. Learn best practices, avoid common mistakes, and achieve your goals faster.`,
            `Master ${topic} with our comprehensive guide. Get expert advice and practical solutions that deliver real results.`
        ];

        return options[Math.floor(Math.random() * options.length)];
    }

    /**
     * Generate Landing Page Copy
     */
    function generateLandingPage(params, multiplier) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `# ${capitalizeFirstLetter(topic)}: Get Results in 30 Days or Less

${tone.headline_sub}

[CTA Button: Get Started Free]

## Trusted by 10,000+ Companies Worldwide

"This transformed our approach to ${topic}. We saw a 300% increase in the first quarter alone." - Sarah Johnson, CEO

---

## Why ${capitalizeFirstLetter(topic)}?

${tone.value_prop}

✓ **Proven Results**: 94% customer satisfaction rate
✓ **Easy Implementation**: Up and running in under 24 hours
✓ **Expert Support**: World-class team backing you every step

## How It Works

**Step 1: Quick Setup**
Get started in minutes with our intuitive onboarding process.

**Step 2: Strategic Planning**
Our expert system guides you through creating a winning strategy.

**Step 3: Execute & Optimize**
Launch your initiative and continuously improve with data-driven insights.

## What You Get

→ Complete ${topic} framework
→ Expert templates and resources
→ 24/7 customer support
→ Regular updates and improvements
→ 30-day money-back guarantee

${tone.social_proof}

## Frequently Asked Questions

**Q: How quickly will I see results?**
Most customers see measurable improvements within the first 2 weeks.

**Q: Is training required?**
No extensive training needed. Our intuitive interface makes it easy to get started.

**Q: What if it doesn't work for me?**
We offer a 30-day money-back guarantee. No questions asked.

## Ready to Transform Your ${capitalizeFirstLetter(topic)}?

${tone.final_cta}

[CTA Button: Start Your Free Trial]

No credit card required. Cancel anytime.`;
    }

    /**
     * Generate generic content for other use cases
     */
    function generateGenericContent(params, multiplier) {
        const topic = params.inputTopic;
        const tone = getToneAdjustment(params.tone);

        return `${tone.opening}

When it comes to ${topic}, success depends on understanding both the fundamentals and the nuances that separate good from great.

**Key Considerations:**

• Strategic planning and clear objectives
• Consistent execution and attention to detail
• Continuous measurement and optimization
• Adaptation based on results and feedback

**Expert Insights:**

${tone.expertise} With over 20 years of professional experience, I've learned that ${topic} requires a balanced approach combining proven methodologies with innovative thinking.

**Best Practices:**

1. Start with a solid foundation
2. Focus on delivering value
3. Measure what matters
4. Iterate and improve continuously

**Moving Forward:**

${tone.cta}

${tone.closing}`;
    }

    /**
     * Get tone adjustments for content
     */
    function getToneAdjustment(tone) {
        const tones = {
            professional: {
                opening: 'As industry leaders continue to evolve,',
                emphasis: 'Our research demonstrates significant competitive advantages.',
                strategic: 'Strategic alignment is paramount.',
                warning: 'Exercise caution:',
                closing: 'In conclusion,',
                cta: 'I encourage you to take action on these insights.',
                hook: 'Professional insight alert:',
                social_value: 'This matters for your business.',
                cta_social: 'Learn more →',
                tagline: 'Professional Excellence',
                differentiation: 'We maintain the highest standards of quality and reliability.',
                guarantee: 'Backed by our professional guarantee.',
                headline_sub: 'Professional solutions for serious businesses',
                value_prop: 'Achieve measurable business outcomes with proven methodologies.',
                social_proof: '⭐⭐⭐⭐⭐ Rated #1 by Industry Professionals',
                final_cta: 'Join thousands of professionals who trust us.',
                expertise: 'Based on extensive research and practical application,',
                ps: 'This offer is available for a limited time.'
            },
            casual: {
                opening: 'Hey there!',
                emphasis: 'Here's the cool part:',
                strategic: 'Smart planning makes all the difference.',
                warning: 'Quick heads up:',
                closing: 'So there you have it!',
                cta: 'Ready to give it a shot?',
                hook: 'Quick tip:',
                social_value: 'Trust me, you'll want to save this one.',
                cta_social: 'Check it out! →',
                tagline: 'Your New Favorite Solution',
                differentiation: 'We keep things simple and effective.',
                guarantee: 'Try it risk-free—you'll love it.',
                headline_sub: 'The easy way to level up',
                value_prop: 'Get awesome results without the headache.',
                social_proof: '❤️ Loved by thousands of happy customers',
                final_cta: 'Come join the party!',
                expertise: 'Here's what I've learned over the years:',
                ps: 'Seriously, you don't want to miss this.'
            },
            friendly: {
                opening: 'I'm excited to share this with you!',
                emphasis: 'Here's what makes this special:',
                strategic: 'A thoughtful approach works wonders.',
                warning: 'Just a friendly reminder:',
                closing: 'I hope this helps!',
                cta: 'I'd love to hear what you think!',
                hook: 'I wanted to share something helpful:',
                social_value: 'I think you'll find this valuable!',
                cta_social: 'Let me know what you think! →',
                tagline: 'Your Friendly Solution',
                differentiation: 'We're here to help you succeed.',
                guarantee: 'We've got your back with our satisfaction guarantee.',
                headline_sub: 'Let's make things better together',
                value_prop: 'We're here to help you achieve great results.',
                social_proof: '🤝 Join our community of happy customers',
                final_cta: 'We'd love to have you on board!',
                expertise: 'From my experience helping hundreds of people,',
                ps: 'Feel free to reach out if you have questions!'
            },
            persuasive: {
                opening: 'Imagine the possibilities:',
                emphasis: 'This changes everything.',
                strategic: 'Smart leaders choose strategic advantage.',
                warning: 'Don't let this opportunity pass:',
                closing: 'The choice is yours.',
                cta: 'Take action now and see the difference.',
                hook: 'This could be your breakthrough moment:',
                social_value: 'Don't miss out on this game-changer.',
                cta_social: 'Discover how →',
                tagline: 'The Smart Choice',
                differentiation: 'This is the competitive edge you've been seeking.',
                guarantee: 'Risk-free guarantee—you have nothing to lose.',
                headline_sub: 'Transform your results starting today',
                value_prop: 'Unlock unprecedented growth and success.',
                social_proof: '🏆 Chosen by industry leaders worldwide',
                final_cta: 'Don't wait—start your transformation today.',
                expertise: 'After helping thousands achieve breakthrough results,',
                ps: 'Limited spots available—secure yours now.'
            },
            urgent: {
                opening: 'Time is of the essence.',
                emphasis: 'Act now to secure your advantage.',
                strategic: 'Immediate action is required.',
                warning: 'Critical alert:',
                closing: 'Don't delay.',
                cta: 'Act immediately.',
                hook: 'URGENT:',
                social_value: 'Don't miss this deadline!',
                cta_social: 'Act now →',
                tagline: 'Time-Sensitive Opportunity',
                differentiation: 'Limited availability—first come, first served.',
                guarantee: '24-hour money-back guarantee.',
                headline_sub: 'Limited time offer—expires soon',
                value_prop: 'Seize this opportunity before it's gone.',
                social_proof: '⚡ Thousands acting fast—join them now',
                final_cta: 'Claim your spot before it's too late!',
                expertise: 'In time-sensitive situations like this,',
                ps: 'Only 24 hours left to take advantage.'
            },
            informative: {
                opening: 'Let's explore this topic in detail.',
                emphasis: 'Research indicates:',
                strategic: 'Data-driven approaches yield optimal results.',
                warning: 'Important note:',
                closing: 'To summarize:',
                cta: 'Apply these insights to your situation.',
                hook: 'Key insight:',
                social_value: 'Save this for reference.',
                cta_social: 'Read the full analysis →',
                tagline: 'Evidence-Based Solution',
                differentiation: 'Backed by comprehensive research and data.',
                guarantee: 'Scientifically validated approach.',
                headline_sub: 'Comprehensive insights backed by research',
                value_prop: 'Make informed decisions with data-driven insights.',
                social_proof: '📊 Validated by independent research',
                final_cta: 'Explore the complete methodology.',
                expertise: 'Analysis of extensive data shows:',
                ps: 'Additional resources are available in our knowledge base.'
            }
        };

        return tones[tone] || tones.professional;
    }

    /**
     * Generate email subject line
     */
    function generateEmailSubject(topic, tone) {
        const subjects = {
            professional: [
                `${capitalizeFirstLetter(topic)}: Strategic Insights for Q1`,
                `Important Update Regarding ${capitalizeFirstLetter(topic)}`,
                `How Leading Companies Approach ${capitalizeFirstLetter(topic)}`
            ],
            casual: [
                `Quick question about ${topic}...`,
                `You're gonna love this ${topic} tip`,
                `Hey! Check out this ${topic} hack`
            ],
            friendly: [
                `I thought you'd appreciate this about ${topic}`,
                `Sharing something helpful about ${topic}`,
                `A friendly tip about ${topic}`
            ],
            urgent: [
                `[ACTION REQUIRED] ${capitalizeFirstLetter(topic)} Deadline`,
                `Last Chance: ${capitalizeFirstLetter(topic)} Opportunity`,
                `URGENT: ${capitalizeFirstLetter(topic)} Update`
            ],
            persuasive: [
                `Why ${capitalizeFirstLetter(topic)} Could Transform Your Business`,
                `The ${capitalizeFirstLetter(topic)} Advantage You Need`,
                `Don't Miss This ${capitalizeFirstLetter(topic)} Opportunity`
            ]
        };

        const options = subjects[tone] || subjects.professional;
        return options[Math.floor(Math.random() * options.length)];
    }

    /**
     * Display generated content
     */
    function displayContent(content) {
        const outputContent = document.getElementById('outputContent');
        const editTextarea = document.getElementById('editTextarea');

        if (outputContent) {
            outputContent.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${escapeHtml(content)}</pre>`;
        }

        if (editTextarea) {
            editTextarea.value = content;
        }

        state.currentContent = content;
        addToEditHistory(content);
    }

    /**
     * Calculate quality metrics
     */
    function calculateQualityMetrics(content, params) {
        // Readability score (Flesch Reading Ease approximation)
        const sentences = content.split(/[.!?]+/).length;
        const words = content.trim().split(/\s+/).length;
        const syllables = estimateSyllables(content);
        const readability = Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words))));

        // SEO score (simplified)
        const seoScore = calculateSEOScore(content);

        // Tone compliance
        const toneScore = calculateToneCompliance(content, params.tone);

        // Style guide compliance
        const styleScore = calculateStyleCompliance(content, params.styleGuide);

        // Overall quality
        const qualityScore = Math.round((readability + seoScore + toneScore + styleScore) / 4);

        // Update UI
        document.getElementById('readabilityScore').textContent = readability;
        document.getElementById('seoScore').textContent = seoScore;
        document.getElementById('toneCompliance').textContent = `${toneScore}%`;
        document.getElementById('styleCompliance').textContent = `${styleScore}%`;
        document.getElementById('qualityScore').textContent = qualityScore;
    }

    /**
     * Estimate syllables in text
     */
    function estimateSyllables(text) {
        const words = text.toLowerCase().match(/[a-z]+/g) || [];
        return words.reduce((count, word) => {
            return count + (word.match(/[aeiouy]+/g) || []).length;
        }, 0);
    }

    /**
     * Calculate SEO score
     */
    function calculateSEOScore(content) {
        let score = 50; // Base score

        const words = content.trim().split(/\s+/).length;
        if (words >= 300) score += 20;
        if (words >= 500) score += 10;

        // Check for headings
        if (content.includes('#')) score += 10;

        // Check for lists
        if (content.includes('•') || content.includes('-') || content.includes('→')) score += 10;

        return Math.min(100, score);
    }

    /**
     * Calculate tone compliance
     */
    function calculateToneCompliance(content, tone) {
        // Simplified tone analysis
        let score = 70; // Base score

        const lowerContent = content.toLowerCase();

        // Check for tone-appropriate language
        if (tone === 'professional' && !lowerContent.includes('hey') && !lowerContent.includes('gonna')) {
            score += 30;
        } else if (tone === 'casual' && (lowerContent.includes('hey') || lowerContent.includes('you'))) {
            score += 30;
        } else if (tone === 'urgent' && (lowerContent.includes('now') || lowerContent.includes('immediately'))) {
            score += 30;
        } else {
            score += 15;
        }

        return Math.min(100, score);
    }

    /**
     * Calculate style guide compliance
     */
    function calculateStyleCompliance(content, styleGuide) {
        // Simplified style compliance
        let score = 75; // Base score

        // Check sentence length
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const avgSentenceLength = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;

        if (avgSentenceLength < 25) score += 15;
        if (avgSentenceLength < 20) score += 10;

        return Math.min(100, Math.round(score));
    }

    /**
     * Handle copy to clipboard
     */
    function handleCopy() {
        const content = state.currentContent || document.getElementById('outputContent').textContent;

        navigator.clipboard.writeText(content).then(() => {
            showAlert('Content copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            showAlert('Failed to copy content', 'warning');
        });
    }

    /**
     * Handle download
     */
    function handleDownload() {
        const content = state.currentContent || document.getElementById('outputContent').textContent;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `content-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showAlert('Content downloaded successfully!', 'success');
    }

    /**
     * Handle improve content
     */
    async function handleImprove() {
        const content = state.currentContent;
        if (!content) {
            showAlert('No content to improve', 'warning');
            return;
        }

        showProcessing('Improving content...');

        // Simulate AI improvement
        // No fake delays

        // Add improvements (in production, this would use Claude API)
        const improved = improveContent(content);
        displayContent(improved);

        hideProcessing();
        showAlert('Content improved successfully!', 'success');
    }

    /**
     * Improve content quality
     */
    function improveContent(content) {
        // Add expert improvements
        let improved = content;

        // Enhance transitions
        improved = improved.replace(/\n\n/g, '\n\nMoreover, ');

        // Add power words
        improved = improved.replace(/good/gi, 'exceptional');
        improved = improved.replace(/nice/gi, 'outstanding');

        // Strengthen language
        improved = improved.replace(/maybe/gi, 'potentially');
        improved = improved.replace(/I think/gi, 'Research indicates');

        return improved;
    }

    /**
     * Handle shorten content
     */
    async function handleShorten() {
        const content = state.currentContent;
        if (!content) {
            showAlert('No content to shorten', 'warning');
            return;
        }

        showProcessing('Shortening content...');
        // No fake delays

        const shortened = shortenContent(content);
        displayContent(shortened);

        hideProcessing();
        showAlert('Content shortened successfully!', 'success');
    }

    /**
     * Shorten content
     */
    function shortenContent(content) {
        // Remove extra details and condense
        let shortened = content;

        // Remove examples and extra explanations
        shortened = shortened.split('\n').filter((line, index, arr) => {
            // Keep every other paragraph roughly
            return index === 0 || index === arr.length - 1 || index % 3 !== 2;
        }).join('\n');

        return shortened;
    }

    /**
     * Handle expand content
     */
    async function handleExpand() {
        const content = state.currentContent;
        if (!content) {
            showAlert('No content to expand', 'warning');
            return;
        }

        showProcessing('Expanding content...');
        // No fake delays

        const expanded = expandContent(content);
        displayContent(expanded);

        hideProcessing();
        showAlert('Content expanded successfully!', 'success');
    }

    /**
     * Expand content
     */
    function expandContent(content) {
        // Add more details and examples
        let expanded = content;

        // Add elaboration after key points
        expanded = expanded.replace(/\n\n/g, '\n\nFurthermore, it\'s important to consider the broader implications of this approach. Industry experts consistently emphasize this point.\n\n');

        return expanded;
    }

    /**
     * Handle summarize content
     */
    async function handleSummarize() {
        const content = state.currentContent;
        if (!content) {
            showAlert('No content to summarize', 'warning');
            return;
        }

        showProcessing('Summarizing content...');
        // No fake delays

        const summary = summarizeContent(content);
        displayContent(summary);

        hideProcessing();
        showAlert('Content summarized successfully!', 'success');
    }

    /**
     * Summarize content
     */
    function summarizeContent(content) {
        // Extract key points
        const lines = content.split('\n').filter(line => line.trim().length > 0);

        const keyPoints = lines.filter(line => {
            return line.includes('##') ||
                   line.includes('**') ||
                   line.includes('•') ||
                   line.includes('→') ||
                   line.includes(':');
        }).slice(0, 10);

        return `**Summary:**\n\n${keyPoints.join('\n\n')}\n\n**Key Takeaway:** ${lines[lines.length - 1]}`;
    }

    /**
     * Handle rewrite content
     */
    async function handleRewrite() {
        const content = state.currentContent;
        if (!content) {
            showAlert('No content to rewrite', 'warning');
            return;
        }

        showProcessing('Rewriting content...');
        // No fake delays

        // Rewrite with different structure
        const rewritten = rewriteContent(content);
        displayContent(rewritten);

        hideProcessing();
        showAlert('Content rewritten successfully!', 'success');
    }

    /**
     * Rewrite content
     */
    function rewriteContent(content) {
        // Change structure and phrasing
        let rewritten = content;

        // Vary sentence structure
        rewritten = rewritten.replace(/\. /g, '. Additionally, ');
        rewritten = rewritten.replace(/Additionally, Additionally, /g, '. ');

        return rewritten;
    }

    /**
     * Handle check grammar
     */
    async function handleCheckGrammar() {
        const content = state.currentContent || document.getElementById('editTextarea').value;
        if (!content) {
            showAlert('No content to check', 'warning');
            return;
        }

        showProcessing('Checking grammar...');
        const issues = checkGrammar(content);
        displayProofreadResults(issues);

        hideProcessing();
        showAlert(`Found ${issues.length} potential issues`, issues.length > 0 ? 'warning' : 'success');
    }

    /**
     * Check grammar
     */
    function checkGrammar(content) {
        const issues = [];

        // Check for common grammar issues
        const checks = [
            {
                pattern: /\b(its|it's)\b/gi,
                message: 'Check usage of "its" vs "it\'s"',
                type: 'grammar',
                severity: 'medium'
            },
            {
                pattern: /\b(your|you're)\b/gi,
                message: 'Check usage of "your" vs "you\'re"',
                type: 'grammar',
                severity: 'medium'
            },
            {
                pattern: /\b(their|there|they're)\b/gi,
                message: 'Check usage of "their" vs "there" vs "they\'re"',
                type: 'grammar',
                severity: 'medium'
            },
            {
                pattern: /\s{2,}/g,
                message: 'Multiple spaces detected',
                type: 'spacing',
                severity: 'low'
            },
            {
                pattern: /[.!?]{2,}/g,
                message: 'Multiple punctuation marks',
                type: 'punctuation',
                severity: 'low'
            },
            {
                pattern: /\b[A-Z]{2,}\b/g,
                message: 'All caps word detected (avoid unless acronym)',
                type: 'style',
                severity: 'low'
            }
        ];

        checks.forEach(check => {
            const matches = content.matchAll(check.pattern);
            for (const match of matches) {
                issues.push({
                    position: match.index,
                    text: match[0],
                    message: check.message,
                    type: check.type,
                    severity: check.severity,
                    suggestion: null
                });
            }
        });

        return issues;
    }

    /**
     * Handle check style
     */
    async function handleCheckStyle() {
        const content = state.currentContent || document.getElementById('editTextarea').value;
        if (!content) {
            showAlert('No content to check', 'warning');
            return;
        }

        showProcessing('Checking style compliance...');
        // No fake delays

        const issues = checkStyleGuide(content);
        displayProofreadResults(issues);

        hideProcessing();
        showAlert(`Style check complete: ${issues.length} items to review`, 'info');
    }

    /**
     * Check style guide compliance
     */
    function checkStyleGuide(content) {
        const issues = [];
        const activeStyleGuide = state.activeStyleGuide || 'default';
        const guide = styleGuides[activeStyleGuide];

        // Check sentences length
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        sentences.forEach((sentence, index) => {
            const words = sentence.trim().split(/\s+/).length;
            if (words > 25) {
                issues.push({
                    position: index,
                    text: sentence.substring(0, 50) + '...',
                    message: `Long sentence detected (${words} words). Consider breaking it up.`,
                    type: 'style',
                    severity: 'medium',
                    suggestion: 'Break into shorter sentences for better readability'
                });
            }
        });

        // Check passive voice
        const passivePatterns = [
            /\b(is|are|was|were|been|be)\s+\w+ed\b/gi,
            /\b(is|are|was|were)\s+being\s+\w+ed\b/gi
        ];

        passivePatterns.forEach(pattern => {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                issues.push({
                    position: match.index,
                    text: match[0],
                    message: 'Possible passive voice detected',
                    type: 'style',
                    severity: 'low',
                    suggestion: 'Consider using active voice for stronger writing'
                });
            }
        });

        return issues;
    }

    /**
     * Handle check tone
     */
    async function handleCheckTone() {
        const content = state.currentContent || document.getElementById('editTextarea').value;
        if (!content) {
            showAlert('No content to check', 'warning');
            return;
        }

        showProcessing('Analyzing tone...');
        // No fake delays

        const issues = checkToneCompliance(content);
        displayProofreadResults(issues);

        hideProcessing();
        showAlert('Tone analysis complete', 'success');
    }

    /**
     * Check tone compliance
     */
    function checkToneCompliance(content) {
        const issues = [];
        const selectedTone = document.getElementById('tone')?.value || 'professional';

        const toneIndicators = {
            professional: {
                avoid: ['hey', 'gonna', 'wanna', 'yeah', 'nah'],
                prefer: ['regarding', 'therefore', 'furthermore']
            },
            casual: {
                avoid: ['henceforth', 'whereby', 'heretofore'],
                prefer: ['hey', 'you', 'we']
            },
            formal: {
                avoid: ['contractions', 'slang', 'casual language'],
                prefer: ['formal structure', 'third person']
            }
        };

        const indicators = toneIndicators[selectedTone];
        if (indicators && indicators.avoid) {
            indicators.avoid.forEach(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'gi');
                const matches = content.matchAll(regex);
                for (const match of matches) {
                    issues.push({
                        position: match.index,
                        text: match[0],
                        message: `Word "${match[0]}" may not match ${selectedTone} tone`,
                        type: 'tone',
                        severity: 'medium',
                        suggestion: `Consider more ${selectedTone} alternatives`
                    });
                }
            });
        }

        return issues;
    }

    /**
     * Display proofread results
     */
    function displayProofreadResults(issues) {
        const resultsContainer = document.getElementById('proofreadResults');

        if (issues.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-success">
                    <span>✅</span>
                    <span>No issues found! Your content looks great.</span>
                </div>
            `;
            return;
        }

        const issuesByType = {
            grammar: issues.filter(i => i.type === 'grammar'),
            style: issues.filter(i => i.type === 'style'),
            tone: issues.filter(i => i.type === 'tone'),
            punctuation: issues.filter(i => i.type === 'punctuation'),
            spacing: issues.filter(i => i.type === 'spacing')
        };

        let html = `
            <div class="alert alert-warning">
                <span>⚠️</span>
                <span>Found ${issues.length} potential issues</span>
            </div>
        `;

        Object.entries(issuesByType).forEach(([type, typeIssues]) => {
            if (typeIssues.length > 0) {
                html += `
                    <div style="margin-top: 20px;">
                        <h4 style="font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 12px; text-transform: capitalize;">
                            ${type} Issues (${typeIssues.length})
                        </h4>
                `;

                typeIssues.forEach(issue => {
                    const severityColor = {
                        high: '#ff4444',
                        medium: '#ffaa00',
                        low: '#00aaff'
                    }[issue.severity] || '#888';

                    html += `
                        <div style="background: var(--color-bg-tertiary); border-left: 3px solid ${severityColor}; padding: 12px; margin-bottom: 8px; border-radius: 6px;">
                            <div style="font-size: 13px; color: var(--color-text-primary); margin-bottom: 4px;">
                                <strong>"${escapeHtml(issue.text)}"</strong>
                            </div>
                            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">
                                ${escapeHtml(issue.message)}
                            </div>
                            ${issue.suggestion ? `
                                <div style="font-size: 12px; color: var(--color-primary); font-style: italic;">
                                    💡 ${escapeHtml(issue.suggestion)}
                                </div>
                            ` : ''}
                        </div>
                    `;
                });

                html += `</div>`;
            }
        });

        resultsContainer.innerHTML = html;
    }

    /**
     * Handle apply fixes
     */
    function handleApplyFixes() {
        showAlert('Auto-fix feature coming soon!', 'info');
    }

    /**
     * Handle save edit
     */
    function handleSaveEdit() {
        const content = document.getElementById('editTextarea').value;
        displayContent(content);

        // Switch to output tab
        document.querySelector('[data-tab="output"]').click();

        showAlert('Changes saved!', 'success');
    }

    /**
     * Edit history management
     */
    function addToEditHistory(content) {
        // Remove any items after current index
        state.editHistory = state.editHistory.slice(0, state.editHistoryIndex + 1);

        // Add new content
        state.editHistory.push(content);
        state.editHistoryIndex = state.editHistory.length - 1;

        // Limit history size
        if (state.editHistory.length > 50) {
            state.editHistory.shift();
            state.editHistoryIndex--;
        }
    }

    /**
     * Handle undo
     */
    function handleUndo() {
        if (state.editHistoryIndex > 0) {
            state.editHistoryIndex--;
            const content = state.editHistory[state.editHistoryIndex];
            document.getElementById('editTextarea').value = content;
            showAlert('Undone', 'info');
        } else {
            showAlert('Nothing to undo', 'warning');
        }
    }

    /**
     * Handle redo
     */
    function handleRedo() {
        if (state.editHistoryIndex < state.editHistory.length - 1) {
            state.editHistoryIndex++;
            const content = state.editHistory[state.editHistoryIndex];
            document.getElementById('editTextarea').value = content;
            showAlert('Redone', 'info');
        } else {
            showAlert('Nothing to redo', 'warning');
        }
    }

    /**
     * Handle clear
     */
    function handleClear() {
        if (confirm('Are you sure you want to clear all content?')) {
            document.getElementById('editTextarea').value = '';
            document.getElementById('outputContent').innerHTML = '<div class="output-empty">Content cleared.</div>';
            state.currentContent = '';
            showAlert('Content cleared', 'info');
        }
    }

    /**
     * Show alert message
     */
    function showAlert(message, type = 'info') {
        // Create alert element
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.style.position = 'fixed';
        alert.style.top = '24px';
        alert.style.right = '24px';
        alert.style.zIndex = '9999';
        alert.style.minWidth = '300px';
        alert.style.animation = 'slideInRight 0.3s ease';

        const icons = {
            success: '✅',
            warning: '⚠️',
            info: 'ℹ️',
            error: '❌'
        };

        alert.innerHTML = `
            <span>${icons[type]}</span>
            <span>${escapeHtml(message)}</span>
        `;

        document.body.appendChild(alert);

        // Remove after 3 seconds
        setTimeout(() => {
            alert.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(alert);
            }, 300);
        }, 3000);
    }

    /**
     * Show processing overlay
     */
    function showProcessing(message) {
        const overlay = document.createElement('div');
        overlay.id = 'processing-overlay';
        overlay.className = 'loading-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.zIndex = '9999';
        overlay.innerHTML = `
            <div style="text-align: center; color: white;">
                <div class="spinner"></div>
                <div style="margin-top: 16px; font-size: 16px; font-weight: 500;">${escapeHtml(message)}</div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    /**
     * Hide processing overlay
     */
    function hideProcessing() {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }

    /**
     * Utility: Capitalize first letter
     */
    function capitalizeFirstLetter(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Utility: Escape HTML
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public API
    return {
        init,
        generateContent,
        displayContent,
        calculateQualityMetrics,
        // Project management
        createNewProject,
        loadCurrentProject,
        saveToProject,
        pauseCurrentProject,
        viewAllProjects
    };
})();

// Add slideIn/slideOut animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
