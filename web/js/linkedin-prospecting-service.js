/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LINKEDIN PROSPECTING SERVICE
 * Aduma Marketing 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages LinkedIn prospect tracking, outreach campaigns, and sales funnel
 * management for the sales team.
 *
 * Features:
 * - Add/edit/delete prospects
 * - Track prospect status through sales funnel
 * - Set follow-up reminders
 * - Add notes and tags
 * - Filter and search prospects
 * - Generate prospect reports
 * - LinkedIn profile integration
 */

(function() {
    'use strict';

    const LinkedInProspectingService = {
        prospects: [],
        currentEditId: null,
        filters: {
            search: '',
            status: 'all',
            sortBy: 'recent'
        },

        /**
         * Initialize the service
         */
        init() {
            this.loadFromStorage();
            console.log('LinkedIn Prospecting Service initialized');
        },

        /**
         * Load prospects from localStorage
         */
        loadFromStorage() {
            const stored = localStorage.getItem('linkedin_prospects');
            if (stored) {
                try {
                    this.prospects = JSON.parse(stored);
                    console.log(`Loaded ${this.prospects.length} prospects from storage`);
                } catch (e) {
                    console.error('Error loading prospects:', e);
                    this.prospects = [];
                }
            }
        },

        /**
         * Save prospects to localStorage
         */
        saveToStorage() {
            try {
                localStorage.setItem('linkedin_prospects', JSON.stringify(this.prospects));
                console.log('Prospects saved to storage');
            } catch (e) {
                console.error('Error saving prospects:', e);
            }
        },

        /**
         * Open the add/edit modal
         */
        openModal(prospectId = null) {
            const modal = document.getElementById('prospectModal');
            const modalTitle = document.getElementById('modalTitle');
            const form = document.getElementById('prospectForm');

            if (prospectId) {
                // Edit mode
                this.currentEditId = prospectId;
                const prospect = this.prospects.find(p => p.id === prospectId);
                if (prospect) {
                    modalTitle.textContent = 'Edit Prospect';
                    this.populateForm(prospect);
                }
            } else {
                // Add mode
                this.currentEditId = null;
                modalTitle.textContent = 'Add New Prospect';
                form.reset();
            }

            modal.classList.add('active');
        },

        /**
         * Close the modal
         */
        closeModal() {
            const modal = document.getElementById('prospectModal');
            modal.classList.remove('active');
            this.currentEditId = null;
            document.getElementById('prospectForm').reset();
        },

        /**
         * Populate form with prospect data
         */
        populateForm(prospect) {
            document.getElementById('linkedinUrl').value = prospect.linkedinUrl || '';
            document.getElementById('prospectName').value = prospect.name || '';
            document.getElementById('jobTitle').value = prospect.jobTitle || '';
            document.getElementById('company').value = prospect.company || '';
            document.getElementById('email').value = prospect.email || '';
            document.getElementById('phone').value = prospect.phone || '';
            document.getElementById('status').value = prospect.status || 'new';
            document.getElementById('notes').value = prospect.notes || '';
            document.getElementById('followUpDate').value = prospect.followUpDate || '';
            document.getElementById('tags').value = prospect.tags ? prospect.tags.join(', ') : '';
        },

        /**
         * Extract LinkedIn username from URL
         */
        extractLinkedInUsername(url) {
            try {
                const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
                return match ? match[1] : null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Save prospect (add or update)
         */
        saveProspect() {
            const linkedinUrl = document.getElementById('linkedinUrl').value.trim();
            const name = document.getElementById('prospectName').value.trim();
            const jobTitle = document.getElementById('jobTitle').value.trim();
            const company = document.getElementById('company').value.trim();
            const email = document.getElementById('email').value.trim();
            const phone = document.getElementById('phone').value.trim();
            const status = document.getElementById('status').value;
            const notes = document.getElementById('notes').value.trim();
            const followUpDate = document.getElementById('followUpDate').value;
            const tagsInput = document.getElementById('tags').value.trim();
            const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

            // Validation
            if (!linkedinUrl) {
                alert('LinkedIn URL is required');
                return;
            }
            if (!name) {
                alert('Name is required');
                return;
            }

            // Extract LinkedIn username
            const linkedinUsername = this.extractLinkedInUsername(linkedinUrl);

            const prospectData = {
                linkedinUrl,
                linkedinUsername,
                name,
                jobTitle,
                company,
                email,
                phone,
                status,
                notes,
                followUpDate,
                tags,
                lastUpdated: new Date().toISOString()
            };

            if (this.currentEditId) {
                // Update existing prospect
                const index = this.prospects.findIndex(p => p.id === this.currentEditId);
                if (index !== -1) {
                    this.prospects[index] = {
                        ...this.prospects[index],
                        ...prospectData
                    };
                }
            } else {
                // Add new prospect
                const newProspect = {
                    id: 'prospect_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    ...prospectData,
                    createdAt: new Date().toISOString(),
                    interactions: []
                };
                this.prospects.push(newProspect);
            }

            this.saveToStorage();
            this.closeModal();
            this.renderProspects();
            this.updateStats();
        },

        /**
         * Delete prospect
         */
        deleteProspect(prospectId) {
            const prospect = this.prospects.find(p => p.id === prospectId);
            if (!prospect) return;

            if (confirm(`Are you sure you want to delete ${prospect.name}?`)) {
                this.prospects = this.prospects.filter(p => p.id !== prospectId);
                this.saveToStorage();
                this.renderProspects();
                this.updateStats();
            }
        },

        /**
         * Add interaction/note to prospect
         */
        addInteraction(prospectId, type, note) {
            const prospect = this.prospects.find(p => p.id === prospectId);
            if (!prospect) return;

            if (!prospect.interactions) {
                prospect.interactions = [];
            }

            prospect.interactions.push({
                id: 'interaction_' + Date.now(),
                type, // 'note', 'email', 'call', 'meeting', 'message'
                note,
                timestamp: new Date().toISOString()
            });

            prospect.lastUpdated = new Date().toISOString();
            this.saveToStorage();
            this.renderProspects();
        },

        /**
         * Get prospect initials for avatar
         */
        getInitials(name) {
            if (!name) return '?';
            const parts = name.split(' ');
            if (parts.length >= 2) {
                return parts[0][0] + parts[parts.length - 1][0];
            }
            return name.substring(0, 2);
        },

        /**
         * Format date for display
         */
        formatDate(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            const now = new Date();
            const diffTime = Math.abs(now - date);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return `${diffDays} days ago`;
            if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
            if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
            return `${Math.floor(diffDays / 365)} years ago`;
        },

        /**
         * Filter and sort prospects
         */
        getFilteredProspects() {
            let filtered = [...this.prospects];

            // Apply search filter
            if (this.filters.search) {
                const search = this.filters.search.toLowerCase();
                filtered = filtered.filter(p =>
                    (p.name && p.name.toLowerCase().includes(search)) ||
                    (p.company && p.company.toLowerCase().includes(search)) ||
                    (p.jobTitle && p.jobTitle.toLowerCase().includes(search)) ||
                    (p.email && p.email.toLowerCase().includes(search))
                );
            }

            // Apply status filter
            if (this.filters.status !== 'all') {
                filtered = filtered.filter(p => p.status === this.filters.status);
            }

            // Apply sorting
            switch (this.filters.sortBy) {
                case 'name':
                    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    break;
                case 'company':
                    filtered.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
                    break;
                case 'follow-up':
                    filtered.sort((a, b) => {
                        if (!a.followUpDate && !b.followUpDate) return 0;
                        if (!a.followUpDate) return 1;
                        if (!b.followUpDate) return -1;
                        return new Date(a.followUpDate) - new Date(b.followUpDate);
                    });
                    break;
                case 'recent':
                default:
                    filtered.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
                    break;
            }

            return filtered;
        },

        /**
         * Update filters and re-render
         */
        filterProspects() {
            this.filters.search = document.getElementById('searchInput').value.trim();
            this.filters.status = document.getElementById('statusFilter').value;
            this.filters.sortBy = document.getElementById('sortBy').value;
            this.renderProspects();
        },

        /**
         * Render prospects list
         */
        renderProspects() {
            const container = document.getElementById('prospectsList');
            const prospects = this.getFilteredProspects();

            if (prospects.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;padding:80px 20px;color:#94a3b8;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        <p style="margin:0;font-size:16px;">No prospects found</p>
                        <p style="margin:8px 0 0;font-size:14px;opacity:0.8;">Try adjusting your filters or add a new prospect</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = prospects.map(prospect => {
                const initials = this.getInitials(prospect.name);
                const statusClass = `tag-status-${prospect.status}`;
                const followUpText = prospect.followUpDate ?
                    `Follow-up: ${new Date(prospect.followUpDate).toLocaleDateString()}` :
                    'No follow-up set';

                return `
                    <div class="prospect-card">
                        <div class="prospect-avatar">${initials.toUpperCase()}</div>
                        <div class="prospect-info">
                            <div class="prospect-name">${this.escapeHtml(prospect.name)}</div>
                            <div class="prospect-title">
                                ${prospect.jobTitle ? this.escapeHtml(prospect.jobTitle) : 'No title'}
                                ${prospect.company ? ' at ' + this.escapeHtml(prospect.company) : ''}
                            </div>
                            ${prospect.email ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">${this.escapeHtml(prospect.email)}</div>` : ''}
                            <div class="prospect-tags">
                                <span class="tag ${statusClass}">${this.formatStatus(prospect.status)}</span>
                                ${prospect.tags.map(tag => `<span class="tag" style="background:#f1f5f9;color:#475569;">${this.escapeHtml(tag)}</span>`).join('')}
                            </div>
                            <div style="font-size:12px;color:#94a3b8;margin-top:8px;">
                                ${followUpText} • Updated ${this.formatDate(prospect.lastUpdated)}
                            </div>
                        </div>
                        <div class="prospect-actions">
                            <a href="${prospect.linkedinUrl}" target="_blank" rel="noopener" class="action-btn action-btn-secondary" title="View LinkedIn Profile">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                                </svg>
                            </a>
                            <button class="action-btn action-btn-secondary" onclick="LinkedInProspectingService.openModal('${prospect.id}')" title="Edit">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="action-btn action-btn-secondary" onclick="LinkedInProspectingService.viewDetails('${prospect.id}')" title="View Details">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </button>
                            <button class="action-btn action-btn-secondary" onclick="LinkedInProspectingService.deleteProspect('${prospect.id}')" title="Delete" style="color:#ef4444;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * View prospect details (opens in alert for now, can be enhanced to modal)
         */
        viewDetails(prospectId) {
            const prospect = this.prospects.find(p => p.id === prospectId);
            if (!prospect) return;

            let details = `
═══════════════════════════════════════
PROSPECT DETAILS
═══════════════════════════════════════

Name: ${prospect.name}
Title: ${prospect.jobTitle || 'Not specified'}
Company: ${prospect.company || 'Not specified'}
Email: ${prospect.email || 'Not specified'}
Phone: ${prospect.phone || 'Not specified'}
Status: ${this.formatStatus(prospect.status)}

LinkedIn: ${prospect.linkedinUrl}

Notes:
${prospect.notes || 'No notes'}

Follow-up Date: ${prospect.followUpDate ? new Date(prospect.followUpDate).toLocaleDateString() : 'Not set'}

Tags: ${prospect.tags.length > 0 ? prospect.tags.join(', ') : 'None'}

Created: ${new Date(prospect.createdAt).toLocaleString()}
Last Updated: ${new Date(prospect.lastUpdated).toLocaleString()}

Interactions: ${prospect.interactions ? prospect.interactions.length : 0}
`;

            if (prospect.interactions && prospect.interactions.length > 0) {
                details += '\n\nRecent Interactions:\n';
                prospect.interactions.slice(-5).reverse().forEach(int => {
                    details += `\n[${new Date(int.timestamp).toLocaleString()}] ${int.type}: ${int.note}`;
                });
            }

            alert(details);
        },

        /**
         * Format status for display
         */
        formatStatus(status) {
            const statusMap = {
                'new': 'New',
                'contacted': 'Contacted',
                'responded': 'Responded',
                'meeting': 'Meeting Scheduled',
                'customer': 'Customer',
                'lost': 'Lost/Not Interested'
            };
            return statusMap[status] || status;
        },

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
         * Get statistics
         */
        getStats() {
            const total = this.prospects.length;
            const active = this.prospects.filter(p =>
                p.status === 'contacted' || p.status === 'responded'
            ).length;
            const meetings = this.prospects.filter(p => p.status === 'meeting').length;
            const customers = this.prospects.filter(p => p.status === 'customer').length;
            const conversionRate = total > 0 ? Math.round((customers / total) * 100) : 0;

            // Calculate new this week
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            const newThisWeek = this.prospects.filter(p =>
                new Date(p.createdAt) > oneWeekAgo
            ).length;

            return {
                total,
                active,
                meetings,
                customers,
                conversionRate,
                newThisWeek
            };
        },

        /**
         * Update statistics display
         */
        updateStats() {
            const stats = this.getStats();
            const totalEl = document.getElementById('totalProspects');
            const activeEl = document.getElementById('activeConvos');
            const meetingsEl = document.getElementById('meetingsScheduled');
            const conversionEl = document.getElementById('conversionRate');
            const trendEl = document.getElementById('newProspectsTrend');

            if (totalEl) totalEl.textContent = stats.total;
            if (activeEl) activeEl.textContent = stats.active;
            if (meetingsEl) meetingsEl.textContent = stats.meetings;
            if (conversionEl) conversionEl.textContent = stats.conversionRate + '%';
            if (trendEl) trendEl.textContent = '+' + stats.newThisWeek + ' this week';
        },

        /**
         * Export prospects to CSV
         */
        exportToCSV() {
            const prospects = this.getFilteredProspects();
            if (prospects.length === 0) {
                alert('No prospects to export');
                return;
            }

            const headers = ['Name', 'Job Title', 'Company', 'Email', 'Phone', 'LinkedIn URL', 'Status', 'Tags', 'Notes', 'Follow-up Date', 'Created At'];
            const rows = prospects.map(p => [
                p.name,
                p.jobTitle || '',
                p.company || '',
                p.email || '',
                p.phone || '',
                p.linkedinUrl,
                this.formatStatus(p.status),
                p.tags.join('; '),
                p.notes || '',
                p.followUpDate || '',
                new Date(p.createdAt).toLocaleString()
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `linkedin-prospects-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    // Expose to global scope
    window.LinkedInProspectingService = LinkedInProspectingService;

})();
