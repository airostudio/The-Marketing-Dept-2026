/**
 * Project Creation Wizard
 * Handles multi-step form navigation, validation, and data persistence
 */

(function() {
    'use strict';

    // Wizard State
    const WizardState = {
        currentStep: 1,
        totalSteps: 6,
        projectData: {
            // Step 1: Basic Info
            projectName: '',
            websiteUrl: '',
            industry: '',
            businessType: '',
            targetCountry: '',
            targetLanguage: '',
            additionalRegions: [],

            // Step 2: Website Analysis
            sitemapUrl: '',
            robotsTxtUrl: '',
            crawlDepth: '3',
            maxPages: '1000',
            crawlFrequency: 'weekly',
            pageTypes: [],
            techChecks: [],
            excludePatterns: '',

            // Step 3: Competitors
            competitors: [],
            competitorMetrics: [],

            // Step 4: Keywords
            seedKeywords: [],
            brandKeywords: [],
            keywordUpdateFrequency: 'weekly',
            searchEngine: 'google',
            additionalEngines: [],
            keywordDiscovery: [],
            keywordGroups: [],

            // Step 5: Integrations
            integrations: {},

            // Step 6: Goals & Alerts
            goals: {
                traffic: null,
                keywords: null,
                backlinks: null,
                domainAuthority: null
            },
            alertChannels: [],
            alertTypes: [],
            alertFrequency: 'daily',
            alertEmail: '',
            reports: []
        }
    };

    // DOM Elements
    const elements = {
        steps: document.querySelectorAll('.wizard-step'),
        progressSteps: document.querySelectorAll('.progress-step'),
        progressFill: document.querySelector('.progress-fill'),
        prevBtn: document.getElementById('prevStep'),
        nextBtn: document.getElementById('nextStep'),
        currentStepNum: document.getElementById('currentStepNum'),
        totalStepsNum: document.getElementById('totalSteps'),
        competitorsList: document.getElementById('competitorsList'),
        addCompetitorBtn: document.getElementById('addCompetitor')
    };

    // Initialize wizard
    function init() {
        setupEventListeners();
        updateProgressBar();
        loadSavedData();
        setupIntegrationToggles();
    }

    // Event Listeners
    function setupEventListeners() {
        // Navigation buttons
        elements.nextBtn.addEventListener('click', handleNext);
        elements.prevBtn.addEventListener('click', handlePrev);

        // Add competitor button
        if (elements.addCompetitorBtn) {
            elements.addCompetitorBtn.addEventListener('click', addCompetitorField);
        }

        // Remove competitor buttons (using event delegation)
        if (elements.competitorsList) {
            elements.competitorsList.addEventListener('click', function(e) {
                if (e.target.closest('.remove-competitor')) {
                    removeCompetitorField(e.target.closest('.competitor-item'));
                }
            });
        }

        // Form input changes - auto-save
        document.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('change', saveCurrentStepData);
            input.addEventListener('blur', saveCurrentStepData);
        });

        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.target.matches('textarea')) {
                e.preventDefault();
                handleNext();
            }
        });

        // Run first audit button
        const runAuditBtn = document.getElementById('runFirstAudit');
        if (runAuditBtn) {
            runAuditBtn.addEventListener('click', runFirstAudit);
        }
    }

    // Setup integration toggle behavior
    function setupIntegrationToggles() {
        document.querySelectorAll('.integration-card').forEach(card => {
            const toggle = card.querySelector('input[name="integration"]');
            const config = card.querySelector('.integration-config');

            if (toggle && config) {
                toggle.addEventListener('change', function() {
                    config.style.display = this.checked ? 'block' : 'none';
                });
            }
        });
    }

    // Handle next step
    function handleNext() {
        if (WizardState.currentStep <= WizardState.totalSteps) {
            // Validate current step
            if (!validateStep(WizardState.currentStep)) {
                return;
            }

            // Save current step data
            saveCurrentStepData();

            if (WizardState.currentStep === WizardState.totalSteps) {
                // Last step - create project
                createProject();
            } else {
                // Go to next step
                WizardState.currentStep++;
                showStep(WizardState.currentStep);
            }
        }
    }

    // Handle previous step
    function handlePrev() {
        if (WizardState.currentStep > 1) {
            WizardState.currentStep--;
            showStep(WizardState.currentStep);
        }
    }

    // Show specific step
    function showStep(stepNumber) {
        // Hide all steps
        elements.steps.forEach(step => {
            step.classList.remove('active');
        });

        // Show target step
        const targetStep = document.querySelector(`.wizard-step[data-step="${stepNumber}"]`);
        if (targetStep) {
            targetStep.classList.add('active');
        }

        // Update progress
        updateProgressBar();
        updateNavigationButtons();

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Focus first input in new step
        setTimeout(() => {
            const firstInput = targetStep?.querySelector('input:not([type="checkbox"]):not([type="hidden"]), select, textarea');
            if (firstInput) {
                firstInput.focus();
            }
        }, 300);
    }

    // Update progress bar
    function updateProgressBar() {
        const progress = (WizardState.currentStep / WizardState.totalSteps) * 100;
        elements.progressFill.style.width = `${progress}%`;

        // Update step indicators
        elements.progressSteps.forEach((step, index) => {
            const stepNum = index + 1;
            step.classList.remove('active', 'completed');

            if (stepNum < WizardState.currentStep) {
                step.classList.add('completed');
            } else if (stepNum === WizardState.currentStep) {
                step.classList.add('active');
            }
        });

        // Update step counter
        elements.currentStepNum.textContent = WizardState.currentStep;
    }

    // Update navigation buttons
    function updateNavigationButtons() {
        // Previous button visibility
        elements.prevBtn.style.visibility = WizardState.currentStep > 1 ? 'visible' : 'hidden';

        // Next button text
        if (WizardState.currentStep === WizardState.totalSteps) {
            elements.nextBtn.innerHTML = `
                Create Project
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
        } else {
            elements.nextBtn.innerHTML = `
                Next
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            `;
        }
    }

    // Validate current step
    function validateStep(stepNumber) {
        const step = document.querySelector(`.wizard-step[data-step="${stepNumber}"]`);
        if (!step) return true;

        const requiredFields = step.querySelectorAll('[required]');
        let isValid = true;
        let firstInvalidField = null;

        requiredFields.forEach(field => {
            // Remove previous error state
            field.classList.remove('error');
            const existingError = field.parentElement.querySelector('.error-message');
            if (existingError) {
                existingError.remove();
            }

            // Check validity
            if (!field.value.trim()) {
                isValid = false;
                field.classList.add('error');

                // Add error message
                const errorMsg = document.createElement('span');
                errorMsg.className = 'error-message';
                errorMsg.textContent = 'This field is required';
                field.parentElement.appendChild(errorMsg);

                if (!firstInvalidField) {
                    firstInvalidField = field;
                }
            }

            // Validate URL fields
            if (field.type === 'url' && field.value.trim()) {
                try {
                    new URL(field.value);
                } catch {
                    isValid = false;
                    field.classList.add('error');

                    const errorMsg = document.createElement('span');
                    errorMsg.className = 'error-message';
                    errorMsg.textContent = 'Please enter a valid URL';
                    field.parentElement.appendChild(errorMsg);

                    if (!firstInvalidField) {
                        firstInvalidField = field;
                    }
                }
            }
        });

        // Focus first invalid field
        if (firstInvalidField) {
            firstInvalidField.focus();
            firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return isValid;
    }

    // Save current step data
    function saveCurrentStepData() {
        const step = WizardState.currentStep;
        const data = WizardState.projectData;

        switch (step) {
            case 1:
                data.projectName = getValue('projectName');
                data.websiteUrl = getValue('websiteUrl');
                data.industry = getValue('industry');
                data.businessType = getValue('businessType');
                data.targetCountry = getValue('targetCountry');
                data.targetLanguage = getValue('targetLanguage');
                data.additionalRegions = getCheckedValues('regions');
                break;

            case 2:
                data.sitemapUrl = getValue('sitemapUrl');
                data.robotsTxtUrl = getValue('robotsTxtUrl');
                data.crawlDepth = getValue('crawlDepth');
                data.maxPages = getValue('maxPages');
                data.crawlFrequency = getValue('crawlFrequency');
                data.pageTypes = getCheckedValues('pageTypes');
                data.techChecks = getCheckedValues('techChecks');
                data.excludePatterns = getValue('excludePatterns');
                break;

            case 3:
                data.competitors = getCompetitors();
                data.competitorMetrics = getCheckedValues('competitorMetrics');
                break;

            case 4:
                data.seedKeywords = getTextareaLines('seedKeywords');
                data.brandKeywords = getTextareaLines('brandKeywords');
                data.keywordUpdateFrequency = getValue('keywordUpdateFrequency');
                data.searchEngine = getValue('searchEngine');
                data.additionalEngines = getCheckedValues('additionalEngines');
                data.keywordDiscovery = getCheckedValues('keywordDiscovery');
                data.keywordGroups = getCheckedValues('keywordGroups');
                break;

            case 5:
                data.integrations = getIntegrations();
                break;

            case 6:
                data.goals.traffic = getNumberValue('trafficGoal');
                data.goals.keywords = getNumberValue('keywordGoal');
                data.goals.backlinks = getNumberValue('backlinkGoal');
                data.goals.domainAuthority = getNumberValue('daGoal');
                data.alertChannels = getCheckedValues('alertChannels');
                data.alertTypes = getCheckedValues('alertTypes');
                data.alertFrequency = getValue('alertFrequency');
                data.alertEmail = getValue('alertEmail');
                data.reports = getCheckedValues('reports');
                break;
        }

        // Save to localStorage
        localStorage.setItem('wizard-draft', JSON.stringify(data));
    }

    // Helper functions
    function getValue(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function getNumberValue(id) {
        const val = getValue(id);
        return val ? parseInt(val, 10) : null;
    }

    function getCheckedValues(name) {
        const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
        return Array.from(checkboxes).map(cb => cb.value);
    }

    function getTextareaLines(id) {
        const el = document.getElementById(id);
        if (!el || !el.value.trim()) return [];
        return el.value.split('\n').map(line => line.trim()).filter(line => line);
    }

    function getCompetitors() {
        const competitors = [];
        document.querySelectorAll('.competitor-item').forEach(item => {
            const name = item.querySelector('.competitor-name')?.value.trim();
            const url = item.querySelector('.competitor-url')?.value.trim();
            if (name || url) {
                competitors.push({ name, url });
            }
        });
        return competitors;
    }

    function getIntegrations() {
        const integrations = {};
        document.querySelectorAll('.integration-card').forEach(card => {
            const toggle = card.querySelector('input[name="integration"]');
            if (toggle && toggle.checked) {
                const key = toggle.value;
                const config = {};
                card.querySelectorAll('.integration-config input').forEach(input => {
                    const label = input.previousElementSibling?.textContent || input.placeholder;
                    config[label] = input.value;
                });
                integrations[key] = config;
            }
        });
        return integrations;
    }

    // Load saved draft data
    function loadSavedData() {
        const saved = localStorage.getItem('wizard-draft');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                WizardState.projectData = { ...WizardState.projectData, ...data };
                populateFormFromData(data);
            } catch (e) {
                console.error('Error loading saved data:', e);
            }
        }
    }

    // Populate form fields from saved data
    function populateFormFromData(data) {
        // Step 1
        setFieldValue('projectName', data.projectName);
        setFieldValue('websiteUrl', data.websiteUrl);
        setFieldValue('industry', data.industry);
        setFieldValue('businessType', data.businessType);
        setFieldValue('targetCountry', data.targetCountry);
        setFieldValue('targetLanguage', data.targetLanguage);
        setCheckboxes('regions', data.additionalRegions || []);

        // Step 2
        setFieldValue('sitemapUrl', data.sitemapUrl);
        setFieldValue('robotsTxtUrl', data.robotsTxtUrl);
        setFieldValue('crawlDepth', data.crawlDepth);
        setFieldValue('maxPages', data.maxPages);
        setFieldValue('crawlFrequency', data.crawlFrequency);
        setCheckboxes('pageTypes', data.pageTypes || []);
        setCheckboxes('techChecks', data.techChecks || []);
        setFieldValue('excludePatterns', data.excludePatterns);

        // Step 3
        if (data.competitors && data.competitors.length > 0) {
            populateCompetitors(data.competitors);
        }
        setCheckboxes('competitorMetrics', data.competitorMetrics || []);

        // Step 4
        setFieldValue('seedKeywords', (data.seedKeywords || []).join('\n'));
        setFieldValue('brandKeywords', (data.brandKeywords || []).join('\n'));
        setFieldValue('keywordUpdateFrequency', data.keywordUpdateFrequency);
        setFieldValue('searchEngine', data.searchEngine);
        setCheckboxes('additionalEngines', data.additionalEngines || []);
        setCheckboxes('keywordDiscovery', data.keywordDiscovery || []);
        setCheckboxes('keywordGroups', data.keywordGroups || []);

        // Step 6
        if (data.goals) {
            setFieldValue('trafficGoal', data.goals.traffic);
            setFieldValue('keywordGoal', data.goals.keywords);
            setFieldValue('backlinkGoal', data.goals.backlinks);
            setFieldValue('daGoal', data.goals.domainAuthority);
        }
        setCheckboxes('alertChannels', data.alertChannels || []);
        setCheckboxes('alertTypes', data.alertTypes || []);
        setFieldValue('alertFrequency', data.alertFrequency);
        setFieldValue('alertEmail', data.alertEmail);
        setCheckboxes('reports', data.reports || []);
    }

    function setFieldValue(id, value) {
        const el = document.getElementById(id);
        if (el && value) {
            el.value = value;
        }
    }

    function setCheckboxes(name, values) {
        document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
            cb.checked = values.includes(cb.value);
        });
    }

    function populateCompetitors(competitors) {
        const list = document.getElementById('competitorsList');
        if (!list) return;

        // Clear existing items
        list.innerHTML = '';

        // Add competitors
        competitors.forEach((comp, index) => {
            const html = createCompetitorHtml(index + 1, comp.name, comp.url);
            list.insertAdjacentHTML('beforeend', html);
        });

        // Add empty slots up to 3
        for (let i = competitors.length; i < 3; i++) {
            const html = createCompetitorHtml(i + 1);
            list.insertAdjacentHTML('beforeend', html);
        }
    }

    // Add competitor field
    function addCompetitorField() {
        const list = document.getElementById('competitorsList');
        if (!list) return;

        const count = list.querySelectorAll('.competitor-item').length + 1;
        const html = createCompetitorHtml(count);
        list.insertAdjacentHTML('beforeend', html);

        // Focus new field
        const newItem = list.lastElementChild;
        const nameInput = newItem.querySelector('.competitor-name');
        if (nameInput) {
            nameInput.focus();
        }
    }

    // Remove competitor field
    function removeCompetitorField(item) {
        if (!item) return;

        const list = document.getElementById('competitorsList');
        const items = list.querySelectorAll('.competitor-item');

        // Keep at least one field
        if (items.length > 1) {
            item.remove();
            // Re-number remaining items
            list.querySelectorAll('.competitor-item').forEach((item, index) => {
                const label = item.querySelector('.form-label');
                if (label) {
                    label.textContent = `Competitor ${index + 1}`;
                }
            });
        } else {
            // Just clear the inputs
            item.querySelectorAll('input').forEach(input => {
                input.value = '';
            });
        }
    }

    function createCompetitorHtml(number, name = '', url = '') {
        return `
            <div class="competitor-item">
                <div class="form-group">
                    <label class="form-label">Competitor ${number}</label>
                    <div class="competitor-inputs">
                        <input type="text" class="form-input competitor-name" placeholder="Competitor name" value="${name}">
                        <input type="url" class="form-input competitor-url" placeholder="https://competitor.com" value="${url}">
                        <button type="button" class="btn-icon remove-competitor" title="Remove">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Create project
    function createProject() {
        // Save final step data
        saveCurrentStepData();

        const data = WizardState.projectData;

        // Generate project ID
        const projectId = 'proj_' + Date.now();

        // Create project object
        const project = {
            id: projectId,
            createdAt: new Date().toISOString(),
            ...data
        };

        // Save project to localStorage
        saveProject(project);

        // Update dashboard settings
        updateDashboardSettings(project);

        // Show completion step
        showCompletionStep(project);

        // Clear draft
        localStorage.removeItem('wizard-draft');
    }

    // Save project to storage
    function saveProject(project) {
        // Get existing projects
        const projects = JSON.parse(localStorage.getItem('seo-projects') || '[]');

        // Add new project
        projects.push(project);

        // Save back
        localStorage.setItem('seo-projects', JSON.stringify(projects));

        // Set as current project
        localStorage.setItem('seo-current-project', project.id);
    }

    // Update dashboard settings with project info
    function updateDashboardSettings(project) {
        const settings = JSON.parse(localStorage.getItem('seo-dashboard-settings') || '{}');

        settings.projectName = project.projectName;
        settings.websiteUrl = project.websiteUrl;
        settings.industry = project.industry;
        settings.targetCountry = project.targetCountry;
        settings.targetLanguage = project.targetLanguage;
        settings.crawlFrequency = project.crawlFrequency;

        localStorage.setItem('seo-dashboard-settings', JSON.stringify(settings));

        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('projectCreated', { detail: project }));
    }

    // Show completion step
    function showCompletionStep(project) {
        // Hide all steps
        elements.steps.forEach(step => {
            step.classList.remove('active');
        });

        // Show completion
        const completeStep = document.querySelector('.wizard-step[data-step="complete"]');
        if (completeStep) {
            completeStep.classList.add('active');
        }

        // Hide footer
        document.querySelector('.wizard-footer').style.display = 'none';

        // Update progress to 100%
        elements.progressFill.style.width = '100%';
        elements.progressSteps.forEach(step => {
            step.classList.add('completed');
        });

        // Populate summary
        document.getElementById('summaryProjectName').textContent = project.projectName || '-';
        document.getElementById('summaryWebsite').textContent = project.websiteUrl || '-';
        document.getElementById('summaryCompetitors').textContent = (project.competitors || []).filter(c => c.name || c.url).length;
        document.getElementById('summaryKeywords').textContent = (project.seedKeywords || []).length + (project.brandKeywords || []).length;
        document.getElementById('summaryIntegrations').textContent = Object.keys(project.integrations || {}).length;
        document.getElementById('summaryCrawlFrequency').textContent = formatFrequency(project.crawlFrequency);
    }

    function formatFrequency(freq) {
        const map = {
            'daily': 'Daily',
            'weekly': 'Weekly',
            'biweekly': 'Every 2 weeks',
            'monthly': 'Monthly',
            'manual': 'Manual only'
        };
        return map[freq] || freq;
    }

    // Run first audit
    function runFirstAudit() {
        const btn = document.getElementById('runFirstAudit');
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="spinner" viewBox="0 0 24 24" style="width:20px;height:20px;">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="60" stroke-linecap="round"/>
            </svg>
            Starting Audit...
        `;

        // Simulate audit start (in production, this would call the API)
        setTimeout(() => {
            // Store audit request
            localStorage.setItem('seo-pending-audit', 'true');

            // Redirect to dashboard
            window.location.href = 'dashboard.html?audit=started';
        }, 1500);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
