/**
 * AI Content Writer Service
 * Real AI content generation via Claude API
 */

const ContentWriterService = (() => {
    const config = {
        maxHistoryItems: 50,
        storageKey: 'contentWriterHistory'
    };

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

    const styleGuides = {
        default: {
            name: 'Default Style',
            rules: { oxford_comma: true, sentence_case_headings: true, avoid_passive_voice: true, max_sentence_length: 25, paragraph_max_sentences: 5 }
        },
        ap: {
            name: 'AP Style',
            rules: { oxford_comma: false, date_format: 'Month DD, YYYY', state_abbreviations: true, numbers_under_ten: 'spell_out', avoid_contractions: true }
        },
        chicago: {
            name: 'Chicago Manual',
            rules: { oxford_comma: true, notes_style: 'footnotes', numbers_under_one_hundred: 'spell_out', quotation_style: 'american' }
        },
        apa: {
            name: 'APA Style',
            rules: { oxford_comma: true, in_text_citations: true, headings_levels: 5, active_voice_preferred: true }
        },
        custom: {
            name: 'Custom Brand Style',
            rules: { brand_voice: 'consistent', terminology: 'approved_only', formatting: 'brand_guidelines' }
        }
    };

    const personas = {
        'b2b-executive': {
            name: 'B2B Executive',
            characteristics: {
                education: 'graduate', experience: 'senior', decision_maker: true,
                interests: ['ROI', 'efficiency', 'strategic impact'],
                pain_points: ['time constraints', 'risk aversion', 'budget justification'],
                preferred_tone: 'professional', content_preferences: ['data-driven', 'concise', 'actionable']
            }
        },
        'b2b-manager': {
            name: 'B2B Manager',
            characteristics: {
                education: 'undergraduate', experience: 'mid-level', decision_maker: false,
                interests: ['implementation', 'team productivity', 'best practices'],
                pain_points: ['resource limitations', 'approval processes'],
                preferred_tone: 'professional', content_preferences: ['how-to', 'practical', 'detailed']
            }
        },
        'b2c-consumer': {
            name: 'B2C Consumer',
            characteristics: {
                education: 'varies', experience: 'varies', decision_maker: true,
                interests: ['value', 'convenience', 'quality'],
                pain_points: ['overwhelmed by options', 'trust issues'],
                preferred_tone: 'friendly', content_preferences: ['clear benefits', 'social proof', 'easy to understand']
            }
        },
        'technical': {
            name: 'Technical Audience',
            characteristics: {
                education: 'technical', experience: 'expert', decision_maker: 'varies',
                interests: ['technical details', 'specifications', 'integrations'],
                pain_points: ['incomplete documentation', 'lack of technical depth'],
                preferred_tone: 'informative', content_preferences: ['technical accuracy', 'code examples', 'architecture diagrams']
            }
        },
        'non-technical': {
            name: 'Non-Technical Audience',
            characteristics: {
                education: 'varies', experience: 'beginner', decision_maker: 'varies',
                interests: ['simplicity', 'benefits', 'ease of use'],
                pain_points: ['jargon', 'complexity', 'too many options'],
                preferred_tone: 'friendly', content_preferences: ['simple language', 'analogies', 'visual aids']
            }
        }
    };

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

    // ─── AI helpers ───────────────────────────────────────────────────────────

    function getBrainContext() {
        try {
            const brain = JSON.parse(localStorage.getItem('intel_business_brain') || '{}');
            if (!brain || Object.keys(brain).length === 0) return '';
            const parts = [];
            if (brain.company?.name) parts.push(`Company: ${brain.company.name}`);
            if (brain.company?.industry) parts.push(`Industry: ${brain.company.industry}`);
            if (brain.icp?.primaryBuyer?.role) {
                const b = brain.icp.primaryBuyer;
                let buyer = b.role;
                if (b.companySize) buyer += ` at ${b.companySize} companies`;
                if (b.industry) buyer += ` in ${b.industry}`;
                parts.push(`Target Buyer: ${buyer}`);
            }
            if (brain.icp?.painPoints) parts.push(`Customer Pain Points: ${brain.icp.painPoints}`);
            if (brain.positioning?.uniqueValue) parts.push(`Unique Value Proposition: ${brain.positioning.uniqueValue}`);
            if (brain.positioning?.competitorGap) parts.push(`Competitive Advantage: ${brain.positioning.competitorGap}`);
            if (brain.objectives?.annualGoal) parts.push(`Business Goal: ${brain.objectives.annualGoal}`);
            if (brain.objectives?.currentChallenge) parts.push(`Current Challenge: ${brain.objectives.currentChallenge}`);
            return parts.length > 0
                ? `\n\nCOMPANY CONTEXT (incorporate naturally into content where relevant):\n${parts.join('\n')}`
                : '';
        } catch (e) {
            return '';
        }
    }

    function getClaudeService() {
        if (typeof window.ClaudeService === 'undefined') {
            throw new Error('AI service not available. Please check your API configuration.');
        }
        return window.ClaudeService;
    }

    async function streamAndUpdateOutput(systemPrompt, userMessage) {
        const claude = getClaudeService();
        const outputContent = document.getElementById('outputContent');
        outputContent.innerHTML = '<pre id="cw-stream" style="white-space: pre-wrap; font-family: inherit; margin: 0; min-height: 60px;"></pre>';
        const streamEl = document.getElementById('cw-stream');
        document.querySelector('[data-tab="output"]')?.click();
        const fullText = await claude.streamResponse({
            systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            outputEl: streamEl,
        });
        return fullText;
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    function init() {
        loadHistory();
        initializeEventListeners();
        loadStyleGuides();
        loadPersonas();
        initializeProjectIntegration();
        console.log('✅ Content Writer Service initialized');
    }

    function initializeProjectIntegration() {
        if (typeof window.UnifiedProjectManager === 'undefined') {
            console.warn('[ContentWriter] UnifiedProjectManager not available');
            return;
        }
        loadCurrentProject();
        setupProjectAutoSave();
        window.addEventListener('currentProjectChanged', (e) => {
            if (e.detail?.project?.type === 'content') loadProject(e.detail.project);
        });
    }

    function loadCurrentProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') return;
        const project = window.UnifiedProjectManager.getCurrentProject();
        if (project && project.type === window.PROJECT_TYPES?.CONTENT) {
            state.currentProject = project;
            loadProjectData(project);
        }
    }

    function loadProjectData(project) {
        if (!project || !project.data) return;
        const fields = ['useCase', 'tone', 'persona', 'styleGuide', 'language', 'contentLength', 'inputTopic'];
        fields.forEach(f => {
            if (project.data[f]) {
                const el = document.getElementById(f);
                if (el) el.value = project.data[f];
            }
        });
        if (project.data.content) displayContent(project.data.content);
    }

    function saveToProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') return;
        if (!state.currentProject) return;
        window.UnifiedProjectManager.autoSaveCurrentProject({
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
        });
    }

    function setupProjectAutoSave() {
        if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
        state.autoSaveInterval = setInterval(() => {
            if (state.currentProject) saveToProject();
        }, 15000);
    }

    function createNewProject() {
        if (typeof window.UnifiedProjectManager === 'undefined') {
            showAlert('Project management not available', 'warning');
            return;
        }
        const projectName = prompt('Enter project name:', 'Content Project');
        if (!projectName) return;
        const project = window.UnifiedProjectManager.createProject({
            name: projectName,
            type: window.PROJECT_TYPES?.CONTENT,
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

    function showProjectInfo(project) {
        let banner = document.getElementById('project-info-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'project-info-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9998;box-shadow:0 2px 8px rgba(0,0,0,.2);';
            document.querySelector('.writer-container')?.style.setProperty('padding-top', '60px');
            document.body.insertBefore(banner, document.body.firstChild);
        }
        const stateColors = { created: '#10B981', in_progress: '#F59E0B', paused: '#6366F1', completed: '#8B5CF6' };
        const stateLabels = { created: 'Created', in_progress: 'In Progress', paused: 'Paused', completed: 'Completed' };
        banner.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;">
                <div style="font-weight:600;font-size:15px;">📝 ${escapeHtml(project.name)}</div>
                <div style="padding:4px 12px;background:${stateColors[project.state]};border-radius:12px;font-size:12px;font-weight:600;">${stateLabels[project.state]}</div>
                <div style="font-size:13px;opacity:.9;">Progress: ${project.progress}%</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="ContentWriterService.pauseCurrentProject()" style="padding:6px 12px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);border-radius:6px;color:white;font-size:13px;cursor:pointer;">${project.state === 'paused' ? '▶️ Resume' : '⏸️ Pause'}</button>
                <button onclick="ContentWriterService.saveToProject()" style="padding:6px 12px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);border-radius:6px;color:white;font-size:13px;cursor:pointer;">💾 Save</button>
            </div>`;
    }

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

    // ─── History ──────────────────────────────────────────────────────────────

    function loadHistory() {
        try {
            const saved = localStorage.getItem(config.storageKey);
            if (saved) { state.history = JSON.parse(saved); renderHistory(); }
        } catch (e) { console.error('Error loading history:', e); }
    }

    function saveToHistory(content, metadata) {
        state.history.unshift({ id: Date.now(), content, metadata, timestamp: new Date().toISOString() });
        if (state.history.length > config.maxHistoryItems) state.history = state.history.slice(0, config.maxHistoryItems);
        try { localStorage.setItem(config.storageKey, JSON.stringify(state.history)); renderHistory(); } catch (e) {}
    }

    function renderHistory() {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        if (state.history.length === 0) {
            historyList.innerHTML = '<div class="output-empty">No history yet. Start generating content to see your history here.</div>';
            return;
        }
        historyList.innerHTML = state.history.map(item => `
            <div class="history-item" data-id="${item.id}" style="padding:12px;border-bottom:1px solid var(--color-border);cursor:pointer;">
                <div style="font-size:13px;font-weight:600;">${escapeHtml(item.metadata?.useCase || 'Content')}</div>
                <div style="font-size:11px;color:var(--color-text-secondary);">${escapeHtml(item.metadata?.tone || '')} · ${new Date(item.timestamp).toLocaleString()}</div>
            </div>`).join('');
        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                const historyItem = state.history.find(h => h.id === id);
                if (historyItem) { displayContent(historyItem.content); document.querySelector('[data-tab="output"]')?.click(); }
            });
        });
    }

    function loadStyleGuides() { state.styleGuides = styleGuides; }
    function loadPersonas() { state.personas = personas; }

    // ─── Event listeners ──────────────────────────────────────────────────────

    function initializeEventListeners() {
        const buttons = {
            generateBtn: handleGenerate,
            copyBtn: handleCopy,
            downloadBtn: handleDownload,
            improveBtn: handleImprove,
            shortenBtn: handleShorten,
            expandBtn: handleExpand,
            summarizeBtn: handleSummarize,
            rewriteBtn: handleRewrite,
            checkGrammarBtn: handleCheckGrammar,
            checkStyleBtn: handleCheckStyle,
            checkToneBtn: handleCheckTone,
            applyFixesBtn: handleApplyFixes,
            saveEditBtn: handleSaveEdit,
            undoBtn: handleUndo,
            redoBtn: handleRedo,
            clearBtn: handleClear
        };
        Object.entries(buttons).forEach(([id, fn]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        });
        const styleGuideSelect = document.getElementById('styleGuide');
        if (styleGuideSelect) styleGuideSelect.addEventListener('change', e => { state.activeStyleGuide = e.target.value; });
        const personaSelect = document.getElementById('persona');
        if (personaSelect) personaSelect.addEventListener('change', e => { state.activePersona = e.target.value; });
    }

    // ─── Generate ─────────────────────────────────────────────────────────────

    async function handleGenerate() {
        const useCase = document.getElementById('useCase').value;
        const tone = document.getElementById('tone').value;
        const persona = document.getElementById('persona').value;
        const styleGuide = document.getElementById('styleGuide').value;
        const language = document.getElementById('language').value;
        const contentLength = document.getElementById('contentLength').value;
        const inputTopic = document.getElementById('inputTopic').value.trim();

        if (!inputTopic) { showAlert('Please enter a topic or context for content generation', 'warning'); return; }

        const btn = document.getElementById('generateBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;display:inline-block;"></div> Generating...';

        try {
            const content = await generateContent({ useCase, tone, persona, styleGuide, language, contentLength, inputTopic });
            displayContent(content);
            saveToHistory(content, { useCase: useCaseTemplates[useCase]?.name || useCase, tone, persona, styleGuide, language });
            calculateQualityMetrics(content, { tone, styleGuide, persona });
            showAlert('Content generated!', 'success');
        } catch (err) {
            console.error('Generation error:', err);
            showAlert(err.message || 'Failed to generate content. Please try again.', 'warning');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span>✨</span> Generate Content';
        }
    }

    async function generateContent(params) {
        const template = useCaseTemplates[params.useCase] || {};
        const personaData = personas[params.persona] || {};
        const styleGuideData = styleGuides[params.styleGuide] || {};
        const brainContext = getBrainContext();

        const langNames = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', zh: 'Chinese', ko: 'Korean' };
        const lengthGuide = { short: '50–150 words', medium: '150–300 words', long: '300–500 words', 'very-long': '500+ words' }[params.contentLength] || '150–300 words';

        const systemPrompt = `You are a world-class content writer with 20+ years of professional writing experience. You specialise in ${template.name || params.useCase}.

Write in ${langNames[params.language] || params.language} with a ${params.tone} tone.
Target audience: ${personaData.name || 'General audience'}${personaData.characteristics?.interests ? ' (interested in: ' + personaData.characteristics.interests.join(', ') + ')' : ''}.
Style guide: ${styleGuideData.name || 'Default'}.
Content length: ${lengthGuide}.${template.character_limit ? ` Hard limit: ${template.character_limit} characters.` : ''}
${template.expert_tips ? '\nExpert tips:\n' + template.expert_tips.map((t, i) => `${i + 1}. ${t}`).join('\n') : ''}
${template.structure ? '\nStructure: ' + template.structure.join(' → ') : ''}

Output only the finished content — no preamble, no "Here is your content:", just the content itself.${brainContext}`;

        const content = await streamAndUpdateOutput(systemPrompt, `Create ${template.name || params.useCase} content about: ${params.inputTopic}`);
        if (!content || !content.trim()) {
            throw new Error('AI returned empty content. Please try again.');
        }
        return content;
    }

    // ─── Refinement actions ───────────────────────────────────────────────────

    async function runRefinement(btn, label, instruction) {
        const content = state.currentContent;
        if (!content) { showAlert('No content to ' + label.toLowerCase(), 'warning'); return; }
        const el = document.getElementById(btn);
        if (el) { el.disabled = true; }
        try {
            const systemPrompt = `You are an expert content editor. ${instruction} Output only the revised content — no preamble.${getBrainContext()}`;
            const fullText = await streamAndUpdateOutput(systemPrompt, `${label} this content:\n\n${content}`);
            displayContent(fullText);
            showAlert(`${label} complete!`, 'success');
        } catch (err) {
            showAlert(err.message || `Failed to ${label.toLowerCase()} content.`, 'warning');
        } finally {
            if (el) el.disabled = false;
        }
    }

    function handleImprove() {
        return runRefinement('improveBtn', 'Improve', 'Improve the content for clarity, impact, and professionalism. Strengthen transitions, use more precise language, improve structure, and make every sentence count.');
    }

    function handleShorten() {
        return runRefinement('shortenBtn', 'Shorten', 'Shorten the content by removing redundant sentences, tightening wordy phrases, and cutting anything that does not add value — while preserving all key points and the core message.');
    }

    function handleExpand() {
        return runRefinement('expandBtn', 'Expand', 'Expand the content by adding relevant supporting detail, examples, statistics, or explanations that strengthen the argument and provide more value to the reader.');
    }

    function handleSummarize() {
        return runRefinement('summarizeBtn', 'Summarize', 'Summarize the content into a concise, punchy executive summary that captures the key points, main argument, and primary takeaway.');
    }

    function handleRewrite() {
        return runRefinement('rewriteBtn', 'Rewrite', 'Rewrite the content with fresh phrasing, a different structure, and varied sentence patterns — keeping the same core message and tone but making it feel entirely new.');
    }

    // ─── Proofread ────────────────────────────────────────────────────────────

    async function runProofCheck(label, instruction) {
        const content = state.currentContent || document.getElementById('editTextarea')?.value;
        if (!content) { showAlert('No content to check', 'warning'); return; }
        const resultsEl = document.getElementById('proofreadResults');
        resultsEl.innerHTML = '<div class="output-empty">Analysing with AI…</div>';
        try {
            const claude = getClaudeService();
            const result = await claude.callAgent({
                systemPrompt: `You are an expert ${label.toLowerCase()} checker. ${instruction} Return your findings as a JSON object with this shape: { "score": <0-100>, "summary": "<one line>", "issues": [ { "text": "<quoted text>", "message": "<explanation>", "suggestion": "<fix>", "severity": "high|medium|low", "type": "<type>" } ] }. Return only valid JSON, no markdown fences.`,
                messages: [{ role: 'user', content: `Check this content:\n\n${content}` }]
            });
            let parsed;
            try { parsed = JSON.parse(result); } catch (_) {
                const m = result.match(/\{[\s\S]*\}/);
                parsed = m ? JSON.parse(m[0]) : null;
            }
            if (parsed) { displayProofreadResults(parsed, label); } else {
                resultsEl.innerHTML = `<div style="white-space:pre-wrap;font-size:13px;">${escapeHtml(result)}</div>`;
            }
        } catch (err) {
            resultsEl.innerHTML = `<div class="alert alert-warning"><span>⚠️</span><span>${escapeHtml(err.message || 'Analysis failed')}</span></div>`;
        }
    }

    function handleCheckGrammar() {
        return runProofCheck('Grammar', 'Check the content for grammar, spelling, and punctuation errors. Flag each issue with the exact text, a clear explanation, and a suggested correction.');
    }

    function handleCheckStyle() {
        return runProofCheck('Style', 'Check the content for style issues: passive voice, overly long sentences, weak word choices, and readability problems. Suggest concrete improvements.');
    }

    function handleCheckTone() {
        return runProofCheck('Tone', 'Analyse the tone of the content and check whether it is consistent and matches the intended tone. Flag any passages that feel off-brand or inconsistent, and explain why.');
    }

    function displayProofreadResults(data, label) {
        const resultsEl = document.getElementById('proofreadResults');
        const issues = data.issues || [];
        state.lastIssues = issues;
        const scoreColor = data.score >= 80 ? '#10B981' : data.score >= 60 ? '#F59E0B' : '#EF4444';

        let html = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <div style="font-size:32px;font-weight:800;color:${scoreColor};">${data.score ?? '--'}</div>
                <div>
                    <div style="font-weight:600;font-size:14px;">${escapeHtml(label)} Score</div>
                    <div style="font-size:13px;color:var(--color-text-secondary);">${escapeHtml(data.summary || '')}</div>
                </div>
            </div>`;

        if (issues.length === 0) {
            html += '<div class="alert alert-success"><span>✅</span><span>No issues found — your content looks great!</span></div>';
        } else {
            const severityColor = { high: '#EF4444', medium: '#F59E0B', low: '#3B82F6' };
            issues.forEach(issue => {
                html += `
                    <div style="background:var(--color-bg-tertiary);border-left:3px solid ${severityColor[issue.severity] || '#888'};padding:12px;margin-bottom:8px;border-radius:6px;">
                        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">"${escapeHtml(issue.text || '')}"</div>
                        <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">${escapeHtml(issue.message || '')}</div>
                        ${issue.suggestion ? `<div style="font-size:12px;color:var(--color-primary);font-style:italic;">💡 ${escapeHtml(issue.suggestion)}</div>` : ''}
                    </div>`;
            });
        }
        resultsEl.innerHTML = html;
    }

    async function handleApplyFixes() {
        const content = state.currentContent;
        const issues = state.lastIssues || [];
        if (!content) { showAlert('No content to fix. Generate or paste content first.', 'warning'); return; }
        if (!issues.length) { showAlert('Run a Grammar, Style, or Tone check first to identify issues.', 'info'); return; }
        const claudeService = getClaudeService();
        const issueList = issues.map(i => `- "${i.text || ''}" → ${i.suggestion || i.message || ''}`).join('\n');
        const systemPrompt = 'You are an expert editor. Apply the provided fixes to the content precisely and return only the corrected content with no explanation.';
        const userMessage = `Apply these fixes to the content below:\n\nFIXES:\n${issueList}\n\nCONTENT:\n${content}`;
        try {
            showAlert('Applying fixes…', 'info');
            await streamAndUpdateOutput(systemPrompt, userMessage);
        } catch (err) {
            showAlert('Could not apply fixes: ' + err.message, 'error');
        }
    }

    // ─── Display & state ──────────────────────────────────────────────────────

    function displayContent(content) {
        const outputContent = document.getElementById('outputContent');
        const editTextarea = document.getElementById('editTextarea');
        if (outputContent) {
            outputContent.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(content)}</pre>`;
        }
        if (editTextarea) editTextarea.value = content;
        state.currentContent = content;
        addToEditHistory(content);
    }

    function calculateQualityMetrics(content, params) {
        const sentences = content.split(/[.!?]+/).filter(s => s.trim()).length || 1;
        const words = content.trim().split(/\s+/).filter(w => w).length;
        const syllables = content.toLowerCase().match(/[a-z]+/g)?.reduce((n, w) => n + (w.match(/[aeiouy]+/g) || []).length, 0) || 1;
        const readability = Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words))));

        let seoScore = 50;
        if (words >= 300) seoScore += 20;
        if (words >= 500) seoScore += 10;
        if (content.includes('#')) seoScore += 10;
        if (content.includes('•') || content.includes('-') || content.includes('→')) seoScore += 10;
        seoScore = Math.min(100, seoScore);

        let toneScore = 70;
        const lc = content.toLowerCase();
        if (params.tone === 'professional' && !lc.includes('hey') && !lc.includes('gonna')) toneScore += 30;
        else if (params.tone === 'casual' && (lc.includes('hey') || lc.includes('you'))) toneScore += 30;
        else toneScore += 15;
        toneScore = Math.min(100, toneScore);

        let styleScore = 75;
        const avgSentLen = sentences > 0 ? words / sentences : 0;
        if (avgSentLen < 25) styleScore += 15;
        if (avgSentLen < 20) styleScore += 10;
        styleScore = Math.min(100, Math.round(styleScore));

        const qualityScore = Math.round((readability + seoScore + toneScore + styleScore) / 4);

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('readabilityScore', readability);
        set('seoScore', seoScore);
        set('toneCompliance', toneScore + '%');
        set('styleCompliance', styleScore + '%');
        set('qualityScore', qualityScore);
    }

    // ─── Toolbar operations ───────────────────────────────────────────────────

    function handleCopy() {
        const content = state.currentContent || document.getElementById('outputContent')?.textContent || '';
        navigator.clipboard.writeText(content).then(() => showAlert('Copied to clipboard!', 'success')).catch(() => showAlert('Copy failed', 'warning'));
    }

    function handleDownload() {
        const content = state.currentContent || document.getElementById('outputContent')?.textContent || '';
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: `content-${Date.now()}.txt` });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert('Downloaded!', 'success');
    }

    function handleSaveEdit() {
        const content = document.getElementById('editTextarea')?.value;
        if (content !== undefined) displayContent(content);
        document.querySelector('[data-tab="output"]')?.click();
        showAlert('Changes saved!', 'success');
    }

    function addToEditHistory(content) {
        state.editHistory = state.editHistory.slice(0, state.editHistoryIndex + 1);
        state.editHistory.push(content);
        state.editHistoryIndex = state.editHistory.length - 1;
        if (state.editHistory.length > 50) { state.editHistory.shift(); state.editHistoryIndex--; }
    }

    function handleUndo() {
        if (state.editHistoryIndex > 0) {
            state.editHistoryIndex--;
            const el = document.getElementById('editTextarea');
            if (el) el.value = state.editHistory[state.editHistoryIndex];
            showAlert('Undone', 'info');
        } else { showAlert('Nothing to undo', 'warning'); }
    }

    function handleRedo() {
        if (state.editHistoryIndex < state.editHistory.length - 1) {
            state.editHistoryIndex++;
            const el = document.getElementById('editTextarea');
            if (el) el.value = state.editHistory[state.editHistoryIndex];
            showAlert('Redone', 'info');
        } else { showAlert('Nothing to redo', 'warning'); }
    }

    function handleClear() {
        if (confirm('Clear all content?')) {
            const el = document.getElementById('editTextarea');
            if (el) el.value = '';
            const oc = document.getElementById('outputContent');
            if (oc) oc.innerHTML = '<div class="output-empty">Content cleared.</div>';
            state.currentContent = '';
            showAlert('Cleared', 'info');
        }
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    function showAlert(message, type = 'info') {
        const icons = { success: '✅', warning: '⚠️', info: 'ℹ️', error: '❌' };
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        Object.assign(alert.style, { position: 'fixed', top: '24px', right: '24px', zIndex: '9999', minWidth: '300px', animation: 'slideInRight 0.3s ease' });
        alert.innerHTML = `<span>${icons[type]}</span><span>${escapeHtml(message)}</span>`;
        document.body.appendChild(alert);
        setTimeout(() => {
            alert.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => { if (alert.parentNode) alert.parentNode.removeChild(alert); }, 300);
        }, 3500);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    return {
        init,
        generateContent,
        displayContent,
        calculateQualityMetrics,
        createNewProject,
        loadCurrentProject,
        saveToProject,
        pauseCurrentProject
    };
})();

// Slide animations
const _cwStyle = document.createElement('style');
_cwStyle.textContent = `
    @keyframes slideInRight { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
`;
document.head.appendChild(_cwStyle);
