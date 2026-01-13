/**
 * CRO Checklist for Shopify Stores
 * Handles checklist state, progress tracking, and export functionality
 */

(function() {
    'use strict';

    const STORAGE_KEY = 'shopify-cro-checklist';

    // State
    let checklistState = {};

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        loadState();
        initCheckboxes();
        initSectionToggles();
        initExportMenu();
        initResetButton();
        updateAllProgress();
    });

    /**
     * Load saved state from localStorage
     */
    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            checklistState = saved ? JSON.parse(saved) : {};
        } catch (e) {
            checklistState = {};
        }

        // Apply saved state to checkboxes
        Object.keys(checklistState).forEach(id => {
            if (checklistState[id]) {
                const item = document.querySelector(`[data-id="${id}"]`);
                if (item) {
                    item.classList.add('completed');
                    item.querySelector('.checklist-checkbox').classList.add('checked');
                }
            }
        });
    }

    /**
     * Save state to localStorage
     */
    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(checklistState));
    }

    /**
     * Initialize checkbox click handlers
     */
    function initCheckboxes() {
        document.querySelectorAll('.checklist-item').forEach(item => {
            const checkbox = item.querySelector('.checklist-checkbox');
            const id = item.dataset.id;

            checkbox.addEventListener('click', function() {
                const isChecked = !checkbox.classList.contains('checked');

                checkbox.classList.toggle('checked', isChecked);
                item.classList.toggle('completed', isChecked);

                checklistState[id] = isChecked;
                saveState();

                // Update section progress
                const section = item.closest('.checklist-section');
                if (section) {
                    updateSectionProgress(section);
                }

                // Update overall progress
                updateOverallProgress();
            });
        });
    }

    /**
     * Initialize section toggle (expand/collapse)
     */
    function initSectionToggles() {
        document.querySelectorAll('.checklist-section-header').forEach(header => {
            header.addEventListener('click', function() {
                const section = header.closest('.checklist-section');
                section.classList.toggle('collapsed');
            });
        });
    }

    /**
     * Update progress for a single section
     */
    function updateSectionProgress(section) {
        const items = section.querySelectorAll('.checklist-item');
        const completed = section.querySelectorAll('.checklist-item.completed').length;
        const total = items.length;
        const percentage = total > 0 ? (completed / total) * 100 : 0;

        const progressFill = section.querySelector('.section-progress-fill');
        const progressText = section.querySelector('.section-progress-text');

        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        if (progressText) {
            progressText.textContent = `${completed}/${total}`;
        }
    }

    /**
     * Update overall progress
     */
    function updateOverallProgress() {
        const allItems = document.querySelectorAll('.checklist-item');
        const completedItems = document.querySelectorAll('.checklist-item.completed');
        const total = allItems.length;
        const completed = completedItems.length;
        const percentage = total > 0 ? (completed / total) * 100 : 0;

        // Update count display
        const completedCount = document.getElementById('completedCount');
        const totalCount = document.getElementById('totalCount');
        if (completedCount) completedCount.textContent = completed;
        if (totalCount) totalCount.textContent = `of ${total}`;

        // Update progress ring
        const progressCircle = document.getElementById('progressCircle');
        if (progressCircle) {
            const circumference = 2 * Math.PI * 26; // radius = 26
            const offset = circumference - (percentage / 100) * circumference;
            progressCircle.style.strokeDashoffset = offset;
        }
    }

    /**
     * Update all progress indicators
     */
    function updateAllProgress() {
        document.querySelectorAll('.checklist-section').forEach(section => {
            updateSectionProgress(section);
        });
        updateOverallProgress();
    }

    /**
     * Initialize export menu
     */
    function initExportMenu() {
        const exportBtn = document.getElementById('exportBtn');
        const exportDropdown = document.getElementById('exportDropdown');

        if (exportBtn && exportDropdown) {
            exportBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                exportDropdown.classList.toggle('show');
            });

            document.addEventListener('click', function() {
                exportDropdown.classList.remove('show');
            });

            // Export handlers
            document.getElementById('exportPDF')?.addEventListener('click', exportAsPDF);
            document.getElementById('exportCSV')?.addEventListener('click', exportAsCSV);
            document.getElementById('copyChecklist')?.addEventListener('click', copyToClipboard);
        }
    }

    /**
     * Export as PDF (generates printable version)
     */
    function exportAsPDF() {
        // Create a printable version
        const printContent = generatePrintableHTML();
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }

    /**
     * Generate printable HTML
     */
    function generatePrintableHTML() {
        const sections = document.querySelectorAll('.checklist-section');
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Shopify CRO Checklist</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; }
                    h1 { color: #1a1a2e; margin-bottom: 8px; }
                    .subtitle { color: #666; margin-bottom: 32px; }
                    .section { margin-bottom: 24px; page-break-inside: avoid; }
                    .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; padding: 8px; background: #f5f5f5; }
                    .item { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .checkbox { width: 18px; height: 18px; border: 2px solid #ccc; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
                    .checkbox.checked { background: #10B981; border-color: #10B981; color: white; }
                    .item-title { font-weight: 500; }
                    .item-desc { color: #666; font-size: 14px; }
                    .completed .item-title { text-decoration: line-through; color: #999; }
                    @media print { body { padding: 20px; } }
                </style>
            </head>
            <body>
                <h1>Shopify CRO Checklist</h1>
                <p class="subtitle">Conversion Rate Optimization Checklist - Generated ${new Date().toLocaleDateString()}</p>
        `;

        sections.forEach(section => {
            const title = section.querySelector('.checklist-section-title h3')?.textContent || 'Section';
            const items = section.querySelectorAll('.checklist-item');

            html += `<div class="section"><div class="section-title">${title}</div>`;

            items.forEach(item => {
                const isCompleted = item.classList.contains('completed');
                const itemTitle = item.querySelector('.checklist-item-title')?.textContent || '';
                const itemDesc = item.querySelector('.checklist-item-desc')?.textContent || '';

                html += `
                    <div class="item ${isCompleted ? 'completed' : ''}">
                        <div class="checkbox ${isCompleted ? 'checked' : ''}">${isCompleted ? '✓' : ''}</div>
                        <div>
                            <div class="item-title">${itemTitle}</div>
                            <div class="item-desc">${itemDesc}</div>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
        });

        html += '</body></html>';
        return html;
    }

    /**
     * Export as CSV
     */
    function exportAsCSV() {
        const sections = document.querySelectorAll('.checklist-section');
        let csv = 'Section,Item,Description,Status\n';

        sections.forEach(section => {
            const sectionTitle = section.querySelector('.checklist-section-title h3')?.textContent || 'Section';
            const items = section.querySelectorAll('.checklist-item');

            items.forEach(item => {
                const isCompleted = item.classList.contains('completed');
                const itemTitle = item.querySelector('.checklist-item-title')?.textContent || '';
                const itemDesc = item.querySelector('.checklist-item-desc')?.textContent || '';

                // Escape quotes and wrap in quotes
                const escapedTitle = `"${itemTitle.replace(/"/g, '""')}"`;
                const escapedDesc = `"${itemDesc.replace(/"/g, '""')}"`;
                const escapedSection = `"${sectionTitle.replace(/"/g, '""')}"`;

                csv += `${escapedSection},${escapedTitle},${escapedDesc},${isCompleted ? 'Completed' : 'Pending'}\n`;
            });
        });

        downloadFile(csv, 'shopify-cro-checklist.csv', 'text/csv');
    }

    /**
     * Copy to clipboard as markdown
     */
    function copyToClipboard() {
        const sections = document.querySelectorAll('.checklist-section');
        let markdown = '# Shopify CRO Checklist\n\n';

        sections.forEach(section => {
            const sectionTitle = section.querySelector('.checklist-section-title h3')?.textContent || 'Section';
            const items = section.querySelectorAll('.checklist-item');

            markdown += `## ${sectionTitle}\n\n`;

            items.forEach(item => {
                const isCompleted = item.classList.contains('completed');
                const itemTitle = item.querySelector('.checklist-item-title')?.textContent || '';
                const checkbox = isCompleted ? '[x]' : '[ ]';

                markdown += `- ${checkbox} ${itemTitle}\n`;
            });

            markdown += '\n';
        });

        navigator.clipboard.writeText(markdown).then(() => {
            showToast('Copied to clipboard!');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    }

    /**
     * Download file helper
     */
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Initialize reset button
     */
    function initResetButton() {
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                if (confirm('Reset all checklist progress? This cannot be undone.')) {
                    checklistState = {};
                    saveState();

                    document.querySelectorAll('.checklist-item').forEach(item => {
                        item.classList.remove('completed');
                        item.querySelector('.checklist-checkbox').classList.remove('checked');
                    });

                    updateAllProgress();
                    showToast('Checklist reset');
                }
            });
        }
    }

    /**
     * Show toast notification
     */
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10B981' : '#EF4444'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 9999;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

})();
