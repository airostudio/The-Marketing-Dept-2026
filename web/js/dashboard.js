/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DASHBOARD JAVASCRIPT
 * The Marketing Department 2026 - SEO Agent Dashboard
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        refreshInterval: 30000, // 30 seconds
        animationDuration: 300,
        chartColors: {
            primary: '#6366f1',
            secondary: '#8b5cf6',
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    const state = {
        sidebarCollapsed: false,
        currentView: 'overview',
        filters: {
            dateRange: '30d',
            device: 'all'
        },
        data: {
            healthScore: 87,
            organicTraffic: 124589,
            rankings: [],
            issues: [],
            backlinks: [],
            competitors: []
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM READY
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', function() {
        initSidebar();
        initHeader();
        initDropdowns();
        initTabs();
        initCharts();
        initHealthScore();
        initDataTables();
        initSearch();
        initNotifications();
        initTooltips();
        initKeyboardShortcuts();
        initAutoRefresh();
        loadDashboardData();
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // SIDEBAR
    // ═══════════════════════════════════════════════════════════════════════════

    function initSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const toggleBtn = document.querySelector('.header-toggle');
        const navItems = document.querySelectorAll('.nav-item');

        // Toggle sidebar
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                state.sidebarCollapsed = !state.sidebarCollapsed;
                sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
                localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed);
            });
        }

        // Restore sidebar state
        const savedState = localStorage.getItem('sidebarCollapsed');
        if (savedState === 'true') {
            state.sidebarCollapsed = true;
            sidebar.classList.add('collapsed');
        }

        // Nav item click handling
        navItems.forEach(item => {
            item.addEventListener('click', function(e) {
                // Check if it's a coming soon item
                if (this.querySelector('.nav-item-badge.coming-soon')) {
                    e.preventDefault();
                    showNotification('Coming Soon', 'This feature is under development.', 'info');
                    return;
                }

                navItems.forEach(nav => nav.classList.remove('active'));
                this.classList.add('active');
            });
        });

        // Mobile sidebar
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════════════════════════════════════

    function initHeader() {
        const refreshBtn = document.querySelector('.header-refresh');
        const actionBtns = document.querySelectorAll('.header-action');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshDashboard();
            });
        }

        actionBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                const action = this.dataset.action;
                handleHeaderAction(action);
            });
        });
    }

    function handleHeaderAction(action) {
        switch(action) {
            case 'notifications':
                toggleNotificationsPanel();
                break;
            case 'settings':
                openSettingsModal();
                break;
            case 'help':
                openHelpPanel();
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DROPDOWNS
    // ═══════════════════════════════════════════════════════════════════════════

    function initDropdowns() {
        const dropdowns = document.querySelectorAll('.dropdown');

        dropdowns.forEach(dropdown => {
            const toggle = dropdown.querySelector('.dropdown-toggle');
            const menu = dropdown.querySelector('.dropdown-menu');

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllDropdowns();
                dropdown.classList.toggle('open');
            });

            // Menu item click
            const items = menu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                item.addEventListener('click', function() {
                    const value = this.dataset.value;
                    handleDropdownSelect(dropdown, value, this.textContent);
                    dropdown.classList.remove('open');
                });
            });
        });

        // Close on click outside
        document.addEventListener('click', closeAllDropdowns);
    }

    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown.open').forEach(dropdown => {
            dropdown.classList.remove('open');
        });
    }

    function handleDropdownSelect(dropdown, value, text) {
        const toggleText = dropdown.querySelector('.dropdown-toggle-text');
        if (toggleText) {
            toggleText.textContent = text;
        }

        const filter = dropdown.dataset.filter;
        if (filter) {
            state.filters[filter] = value;
            refreshDashboard();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TABS
    // ═══════════════════════════════════════════════════════════════════════════

    function initTabs() {
        const tabContainers = document.querySelectorAll('.tabs');

        tabContainers.forEach(container => {
            const tabs = container.querySelectorAll('.tab');
            const panels = container.parentElement.querySelectorAll('.tab-panel');

            tabs.forEach(tab => {
                tab.addEventListener('click', function() {
                    const target = this.dataset.tab;

                    // Update tabs
                    tabs.forEach(t => t.classList.remove('active'));
                    this.classList.add('active');

                    // Update panels
                    panels.forEach(panel => {
                        panel.classList.toggle('active', panel.dataset.panel === target);
                    });
                });
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CHARTS
    // ═══════════════════════════════════════════════════════════════════════════

    function initCharts() {
        // Traffic Chart
        initTrafficChart();

        // Rankings Distribution Chart
        initRankingsChart();

        // Backlinks Trend Chart
        initBacklinksChart();
    }

    function initTrafficChart() {
        const canvas = document.getElementById('trafficChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Sample data
        const data = {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            organic: [28500, 32100, 35400, 38200],
            referral: [4200, 4800, 5100, 5600],
            direct: [8900, 9200, 9800, 10400]
        };

        // Draw chart (simplified SVG-based chart)
        drawLineChart(ctx, canvas, data);
    }

    function initRankingsChart() {
        const container = document.getElementById('rankingsChart');
        if (!container) return;

        // Create donut chart for ranking distribution
        const data = [
            { label: 'Top 3', value: 45, color: CONFIG.chartColors.success },
            { label: 'Top 10', value: 120, color: CONFIG.chartColors.primary },
            { label: 'Top 20', value: 85, color: CONFIG.chartColors.info },
            { label: 'Top 50', value: 60, color: CONFIG.chartColors.warning },
            { label: '50+', value: 30, color: CONFIG.chartColors.error }
        ];

        createDonutChart(container, data);
    }

    function initBacklinksChart() {
        const canvas = document.getElementById('backlinksChart');
        if (!canvas) return;

        // Draw backlinks trend chart
        const ctx = canvas.getContext('2d');
        const data = {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            values: [1250, 1380, 1520, 1780, 2100, 2450]
        };

        drawAreaChart(ctx, canvas, data);
    }

    function drawLineChart(ctx, canvas, data) {
        const width = canvas.width = canvas.offsetWidth * 2;
        const height = canvas.height = canvas.offsetHeight * 2;
        ctx.scale(2, 2);

        const actualWidth = width / 2;
        const actualHeight = height / 2;
        const padding = { top: 20, right: 20, bottom: 40, left: 60 };
        const chartWidth = actualWidth - padding.left - padding.right;
        const chartHeight = actualHeight - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, actualWidth, actualHeight);

        // Find max value
        const allValues = [...data.organic, ...data.referral, ...data.direct];
        const maxValue = Math.max(...allValues) * 1.1;

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;

        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(actualWidth - padding.right, y);
            ctx.stroke();

            // Y-axis labels
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '11px Inter';
            ctx.textAlign = 'right';
            const value = Math.round(maxValue - (maxValue / 4) * i);
            ctx.fillText(formatNumber(value), padding.left - 10, y + 4);
        }

        // Draw lines
        const drawLine = (values, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            values.forEach((value, index) => {
                const x = padding.left + (chartWidth / (values.length - 1)) * index;
                const y = padding.top + chartHeight - (value / maxValue) * chartHeight;

                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // Draw points
            values.forEach((value, index) => {
                const x = padding.left + (chartWidth / (values.length - 1)) * index;
                const y = padding.top + chartHeight - (value / maxValue) * chartHeight;

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#0a0a0f';
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            });
        };

        drawLine(data.organic, CONFIG.chartColors.primary);
        drawLine(data.referral, CONFIG.chartColors.success);
        drawLine(data.direct, CONFIG.chartColors.info);

        // X-axis labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';

        data.labels.forEach((label, index) => {
            const x = padding.left + (chartWidth / (data.labels.length - 1)) * index;
            ctx.fillText(label, x, actualHeight - 15);
        });
    }

    function drawAreaChart(ctx, canvas, data) {
        const width = canvas.width = canvas.offsetWidth * 2;
        const height = canvas.height = canvas.offsetHeight * 2;
        ctx.scale(2, 2);

        const actualWidth = width / 2;
        const actualHeight = height / 2;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartWidth = actualWidth - padding.left - padding.right;
        const chartHeight = actualHeight - padding.top - padding.bottom;

        ctx.clearRect(0, 0, actualWidth, actualHeight);

        const maxValue = Math.max(...data.values) * 1.1;

        // Create gradient
        const gradient = ctx.createLinearGradient(0, padding.top, 0, actualHeight - padding.bottom);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

        // Draw area
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(padding.left, actualHeight - padding.bottom);

        data.values.forEach((value, index) => {
            const x = padding.left + (chartWidth / (data.values.length - 1)) * index;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            ctx.lineTo(x, y);
        });

        ctx.lineTo(actualWidth - padding.right, actualHeight - padding.bottom);
        ctx.closePath();
        ctx.fill();

        // Draw line
        ctx.strokeStyle = CONFIG.chartColors.primary;
        ctx.lineWidth = 2;
        ctx.beginPath();

        data.values.forEach((value, index) => {
            const x = padding.left + (chartWidth / (data.values.length - 1)) * index;
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';

        data.labels.forEach((label, index) => {
            const x = padding.left + (chartWidth / (data.labels.length - 1)) * index;
            ctx.fillText(label, x, actualHeight - 15);
        });
    }

    function createDonutChart(container, data) {
        const total = data.reduce((sum, item) => sum + item.value, 0);
        let currentAngle = -90;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        svg.style.width = '100%';
        svg.style.height = '100%';

        data.forEach(item => {
            const percentage = (item.value / total) * 360;
            const path = createArcPath(100, 100, 70, 50, currentAngle, currentAngle + percentage);

            const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathElement.setAttribute('d', path);
            pathElement.setAttribute('fill', item.color);
            pathElement.style.transition = 'opacity 0.2s';
            pathElement.style.cursor = 'pointer';

            pathElement.addEventListener('mouseenter', () => {
                pathElement.style.opacity = '0.8';
                showChartTooltip(container, item.label, item.value, percentage);
            });

            pathElement.addEventListener('mouseleave', () => {
                pathElement.style.opacity = '1';
                hideChartTooltip();
            });

            svg.appendChild(pathElement);
            currentAngle += percentage;
        });

        // Center text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '100');
        text.setAttribute('y', '95');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-size', '24');
        text.setAttribute('font-weight', 'bold');
        text.textContent = total;
        svg.appendChild(text);

        const subtext = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subtext.setAttribute('x', '100');
        subtext.setAttribute('y', '115');
        subtext.setAttribute('text-anchor', 'middle');
        subtext.setAttribute('fill', 'rgba(255,255,255,0.5)');
        subtext.setAttribute('font-size', '12');
        subtext.textContent = 'Keywords';
        svg.appendChild(subtext);

        container.innerHTML = '';
        container.appendChild(svg);
    }

    function createArcPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + outerRadius * Math.cos(startRad);
        const y1 = cy + outerRadius * Math.sin(startRad);
        const x2 = cx + outerRadius * Math.cos(endRad);
        const y2 = cy + outerRadius * Math.sin(endRad);
        const x3 = cx + innerRadius * Math.cos(endRad);
        const y3 = cy + innerRadius * Math.sin(endRad);
        const x4 = cx + innerRadius * Math.cos(startRad);
        const y4 = cy + innerRadius * Math.sin(startRad);

        const largeArc = endAngle - startAngle > 180 ? 1 : 0;

        return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTH SCORE
    // ═══════════════════════════════════════════════════════════════════════════

    function initHealthScore() {
        const gauge = document.querySelector('.health-score-ring-progress');
        if (!gauge) return;

        // Animate the health score on load
        const score = state.data.healthScore;
        gauge.style.setProperty('--score', score);

        // Animate number
        const numberEl = document.querySelector('.health-score-number');
        if (numberEl) {
            animateNumber(numberEl, 0, score, 1500);
        }
    }

    function animateNumber(element, start, end, duration) {
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.round(start + (end - start) * easeOutQuart);

            element.textContent = current;

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA TABLES
    // ═══════════════════════════════════════════════════════════════════════════

    function initDataTables() {
        const tables = document.querySelectorAll('.rankings-table');

        tables.forEach(table => {
            const headers = table.querySelectorAll('th[data-sort]');

            headers.forEach(header => {
                header.addEventListener('click', function() {
                    const column = this.dataset.sort;
                    const direction = this.classList.contains('asc') ? 'desc' : 'asc';

                    headers.forEach(h => h.classList.remove('asc', 'desc'));
                    this.classList.add(direction);

                    sortTable(table, column, direction);
                });
            });
        });
    }

    function sortTable(table, column, direction) {
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
            const aValue = a.querySelector(`td[data-${column}]`)?.dataset[column] || a.cells[getColumnIndex(table, column)]?.textContent;
            const bValue = b.querySelector(`td[data-${column}]`)?.dataset[column] || b.cells[getColumnIndex(table, column)]?.textContent;

            const aNum = parseFloat(aValue);
            const bNum = parseFloat(bValue);

            if (!isNaN(aNum) && !isNaN(bNum)) {
                return direction === 'asc' ? aNum - bNum : bNum - aNum;
            }

            return direction === 'asc'
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        });

        rows.forEach(row => tbody.appendChild(row));
    }

    function getColumnIndex(table, column) {
        const headers = table.querySelectorAll('th');
        return Array.from(headers).findIndex(h => h.dataset.sort === column);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH
    // ═══════════════════════════════════════════════════════════════════════════

    function initSearch() {
        const searchInput = document.querySelector('.header-search-input');
        if (!searchInput) return;

        let searchTimeout;

        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);

            searchTimeout = setTimeout(() => {
                performSearch(this.value);
            }, 300);
        });

        // Keyboard shortcut (Cmd/Ctrl + K)
        document.addEventListener('keydown', function(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInput.focus();
            }
        });
    }

    function performSearch(query) {
        if (query.length < 2) return;

        // Simulate search
        console.log('Searching for:', query);

        // Show search results panel
        showSearchResults(query);
    }

    function showSearchResults(query) {
        let panel = document.querySelector('.search-results-panel');

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'search-results-panel';
            document.body.appendChild(panel);
        }

        panel.innerHTML = `
            <div class="search-results-header">
                <span>Results for "${query}"</span>
                <button class="search-results-close">&times;</button>
            </div>
            <div class="search-results-content">
                <div class="search-loading">
                    <div class="spinner"></div>
                    <span>Searching...</span>
                </div>
            </div>
        `;

        panel.classList.add('visible');

        // Close button
        panel.querySelector('.search-results-close').addEventListener('click', () => {
            panel.classList.remove('visible');
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function initNotifications() {
        // Create notification container
        const container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }

    function showNotification(title, message, type = 'info') {
        const container = document.querySelector('.notification-container');

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-icon">
                ${getNotificationIcon(type)}
            </div>
            <div class="notification-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
            <button class="notification-close">&times;</button>
        `;

        container.appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.classList.add('visible');
        });

        // Auto dismiss
        const timeout = setTimeout(() => {
            dismissNotification(notification);
        }, 5000);

        // Close button
        notification.querySelector('.notification-close').addEventListener('click', () => {
            clearTimeout(timeout);
            dismissNotification(notification);
        });
    }

    function dismissNotification(notification) {
        notification.classList.remove('visible');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }

    function getNotificationIcon(type) {
        const icons = {
            success: '&#10003;',
            error: '&#10005;',
            warning: '&#9888;',
            info: '&#8505;'
        };
        return icons[type] || icons.info;
    }

    function toggleNotificationsPanel() {
        // Toggle notifications panel
        let panel = document.querySelector('.notifications-panel');

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'notifications-panel';
            panel.innerHTML = `
                <div class="notifications-header">
                    <h3>Notifications</h3>
                    <button class="mark-all-read">Mark all read</button>
                </div>
                <div class="notifications-list">
                    <div class="notification-item unread">
                        <div class="notification-item-icon success">&#10003;</div>
                        <div class="notification-item-content">
                            <p>Technical audit completed</p>
                            <span>2 minutes ago</span>
                        </div>
                    </div>
                    <div class="notification-item unread">
                        <div class="notification-item-icon warning">&#9888;</div>
                        <div class="notification-item-content">
                            <p>3 new ranking drops detected</p>
                            <span>15 minutes ago</span>
                        </div>
                    </div>
                    <div class="notification-item">
                        <div class="notification-item-icon info">&#8505;</div>
                        <div class="notification-item-content">
                            <p>Weekly report generated</p>
                            <span>1 hour ago</span>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);
        }

        panel.classList.toggle('visible');

        // Close on click outside
        document.addEventListener('click', function closePanel(e) {
            if (!panel.contains(e.target) && !e.target.closest('.header-action')) {
                panel.classList.remove('visible');
                document.removeEventListener('click', closePanel);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TOOLTIPS
    // ═══════════════════════════════════════════════════════════════════════════

    function initTooltips() {
        const tooltipElements = document.querySelectorAll('[data-tooltip]');

        tooltipElements.forEach(element => {
            element.addEventListener('mouseenter', function() {
                const text = this.dataset.tooltip;
                showTooltip(this, text);
            });

            element.addEventListener('mouseleave', hideTooltip);
        });
    }

    function showTooltip(element, text) {
        let tooltip = document.querySelector('.tooltip');

        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            document.body.appendChild(tooltip);
        }

        tooltip.textContent = text;
        tooltip.classList.add('visible');

        const rect = element.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;
    }

    function hideTooltip() {
        const tooltip = document.querySelector('.tooltip');
        if (tooltip) {
            tooltip.classList.remove('visible');
        }
    }

    function showChartTooltip(container, label, value, percentage) {
        let tooltip = container.querySelector('.chart-tooltip');

        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'chart-tooltip';
            container.appendChild(tooltip);
        }

        tooltip.innerHTML = `
            <strong>${label}</strong>
            <span>${value} (${Math.round(percentage / 3.6)}%)</span>
        `;
        tooltip.classList.add('visible');
    }

    function hideChartTooltip() {
        document.querySelectorAll('.chart-tooltip').forEach(tooltip => {
            tooltip.classList.remove('visible');
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════════════════════

    function initKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Escape - close modals/panels
            if (e.key === 'Escape') {
                closeAllPanels();
            }

            // R - Refresh
            if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
                refreshDashboard();
            }

            // ? - Help
            if (e.key === '?') {
                showKeyboardShortcutsModal();
            }
        });
    }

    function showKeyboardShortcutsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>Keyboard Shortcuts</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="shortcuts-list">
                        <div class="shortcut-item">
                            <kbd>⌘</kbd> + <kbd>K</kbd>
                            <span>Search</span>
                        </div>
                        <div class="shortcut-item">
                            <kbd>R</kbd>
                            <span>Refresh dashboard</span>
                        </div>
                        <div class="shortcut-item">
                            <kbd>Esc</kbd>
                            <span>Close panels</span>
                        </div>
                        <div class="shortcut-item">
                            <kbd>?</kbd>
                            <span>Show shortcuts</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        requestAnimationFrame(() => modal.classList.add('visible'));

        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.classList.remove('visible');
            setTimeout(() => modal.remove(), 300);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('visible');
                setTimeout(() => modal.remove(), 300);
            }
        });
    }

    function closeAllPanels() {
        document.querySelectorAll('.notifications-panel.visible, .search-results-panel.visible').forEach(panel => {
            panel.classList.remove('visible');
        });

        closeAllDropdowns();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO REFRESH
    // ═══════════════════════════════════════════════════════════════════════════

    function initAutoRefresh() {
        // Auto refresh every 30 seconds
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                silentRefresh();
            }
        }, CONFIG.refreshInterval);
    }

    function refreshDashboard() {
        const refreshBtn = document.querySelector('.header-refresh');

        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
            refreshBtn.disabled = true;
        }

        // Simulate refresh
        setTimeout(() => {
            loadDashboardData();

            if (refreshBtn) {
                refreshBtn.classList.remove('refreshing');
                refreshBtn.disabled = false;
            }

            showNotification('Dashboard Refreshed', 'Data has been updated.', 'success');
        }, 1500);
    }

    function silentRefresh() {
        // Silent background refresh
        loadDashboardData();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA LOADING
    // ═══════════════════════════════════════════════════════════════════════════

    function loadDashboardData() {
        // Simulate API call
        // In production, this would fetch from actual API endpoints

        // Update stat cards with animations
        updateStatCards();

        // Update charts
        updateCharts();

        // Update activity feed
        updateActivityFeed();
    }

    function updateStatCards() {
        const statCards = document.querySelectorAll('.stat-card');

        statCards.forEach(card => {
            const valueEl = card.querySelector('.stat-card-value');
            if (valueEl) {
                // Add update animation
                valueEl.classList.add('updating');
                setTimeout(() => {
                    valueEl.classList.remove('updating');
                }, 500);
            }
        });
    }

    function updateCharts() {
        // Reinitialize charts with new data
        initCharts();
    }

    function updateActivityFeed() {
        // Add new activity items
        const timeline = document.querySelector('.activity-timeline');
        if (!timeline) return;

        // Check for new activities
        // In production, this would compare with previous data
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MODALS
    // ═══════════════════════════════════════════════════════════════════════════

    function openSettingsModal() {
        showNotification('Settings', 'Settings panel coming soon.', 'info');
    }

    function openHelpPanel() {
        showNotification('Help', 'Documentation and support coming soon.', 'info');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ISSUE ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('click', function(e) {
        const fixBtn = e.target.closest('.issue-action');
        if (fixBtn) {
            const issueItem = fixBtn.closest('.issue-item');
            handleIssueFix(issueItem, fixBtn);
        }

        const recommendationBtn = e.target.closest('.recommendation-btn');
        if (recommendationBtn) {
            const recommendation = recommendationBtn.closest('.recommendation-item');
            handleRecommendationAction(recommendation, recommendationBtn);
        }
    });

    function handleIssueFix(issueItem, button) {
        button.textContent = 'Fixing...';
        button.disabled = true;

        setTimeout(() => {
            issueItem.classList.add('resolved');
            button.textContent = 'Fixed!';
            button.classList.add('success');

            setTimeout(() => {
                issueItem.style.opacity = '0';
                setTimeout(() => issueItem.remove(), 300);
            }, 1000);

            showNotification('Issue Fixed', 'The issue has been resolved.', 'success');
        }, 2000);
    }

    function handleRecommendationAction(recommendation, button) {
        if (button.classList.contains('primary')) {
            button.textContent = 'Implementing...';
            button.disabled = true;

            setTimeout(() => {
                recommendation.classList.add('implemented');
                button.textContent = 'Done!';

                showNotification('Recommendation Applied', 'The optimization has been implemented.', 'success');
            }, 2000);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT FOR GLOBAL ACCESS
    // ═══════════════════════════════════════════════════════════════════════════

    window.SEODashboard = {
        refresh: refreshDashboard,
        showNotification,
        state
    };

})();

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL CSS FOR DYNAMIC ELEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const dynamicStyles = document.createElement('style');
dynamicStyles.textContent = `
    /* Notification Container */
    .notification-container {
        position: fixed;
        top: 80px;
        right: 24px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .notification {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        background: #1a1a25;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        min-width: 320px;
        max-width: 400px;
        transform: translateX(120%);
        opacity: 0;
        transition: all 0.3s ease;
    }

    .notification.visible {
        transform: translateX(0);
        opacity: 1;
    }

    .notification-icon {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .notification-success .notification-icon {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }

    .notification-error .notification-icon {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
    }

    .notification-warning .notification-icon {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
    }

    .notification-info .notification-icon {
        background: rgba(99, 102, 241, 0.15);
        color: #6366f1;
    }

    .notification-content h4 {
        font-size: 0.9375rem;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .notification-content p {
        font-size: 0.8125rem;
        color: #a1a1aa;
    }

    .notification-close {
        background: none;
        border: none;
        color: #71717a;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0;
        margin-left: auto;
    }

    .notification-close:hover {
        color: #fff;
    }

    /* Notifications Panel */
    .notifications-panel {
        position: fixed;
        top: 72px;
        right: 24px;
        width: 360px;
        background: #12121a;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all 0.2s ease;
    }

    .notifications-panel.visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .notifications-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .notifications-header h3 {
        font-size: 1rem;
        font-weight: 600;
    }

    .mark-all-read {
        background: none;
        border: none;
        color: #6366f1;
        font-size: 0.8125rem;
        cursor: pointer;
    }

    .notifications-list {
        max-height: 400px;
        overflow-y: auto;
    }

    .notification-item {
        display: flex;
        gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        cursor: pointer;
        transition: background 0.15s;
    }

    .notification-item:hover {
        background: rgba(255, 255, 255, 0.03);
    }

    .notification-item.unread {
        background: rgba(99, 102, 241, 0.05);
    }

    .notification-item-icon {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
    }

    .notification-item-icon.success {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }

    .notification-item-icon.warning {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
    }

    .notification-item-icon.info {
        background: rgba(59, 130, 246, 0.15);
        color: #3b82f6;
    }

    .notification-item-content p {
        font-size: 0.875rem;
        margin-bottom: 4px;
    }

    .notification-item-content span {
        font-size: 0.75rem;
        color: #71717a;
    }

    /* Tooltip */
    .tooltip {
        position: fixed;
        padding: 8px 12px;
        background: #1a1a25;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        font-size: 0.8125rem;
        color: #fff;
        z-index: 1001;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .tooltip.visible {
        opacity: 1;
    }

    /* Chart Tooltip */
    .chart-tooltip {
        position: absolute;
        padding: 8px 12px;
        background: #1a1a25;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        font-size: 0.75rem;
        z-index: 10;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
    }

    .chart-tooltip.visible {
        opacity: 1;
    }

    .chart-tooltip strong {
        display: block;
        margin-bottom: 4px;
    }

    .chart-tooltip span {
        color: #a1a1aa;
    }

    /* Modal */
    .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .modal-overlay.visible {
        opacity: 1;
    }

    .modal {
        background: #12121a;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        width: 100%;
        max-width: 480px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .modal-header h3 {
        font-size: 1.125rem;
        font-weight: 600;
    }

    .modal-close {
        background: none;
        border: none;
        color: #71717a;
        font-size: 1.5rem;
        cursor: pointer;
        padding: 0;
    }

    .modal-close:hover {
        color: #fff;
    }

    .modal-body {
        padding: 24px;
    }

    .shortcuts-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .shortcut-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 8px;
    }

    .shortcut-item kbd {
        padding: 4px 8px;
        background: #1a1a25;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.75rem;
    }

    .shortcut-item span {
        margin-left: auto;
        color: #a1a1aa;
        font-size: 0.875rem;
    }

    /* Sidebar Overlay */
    .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 99;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s;
    }

    .sidebar-overlay.visible {
        opacity: 1;
        visibility: visible;
    }

    /* Refresh Animation */
    .header-refresh.refreshing {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* Stat Card Update Animation */
    .stat-card-value.updating {
        animation: pulse 0.5s ease;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    /* Issue Resolved Animation */
    .issue-item.resolved {
        background: rgba(16, 185, 129, 0.1);
    }

    .issue-action.success {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        border-color: #10b981;
    }

    /* Recommendation Implemented */
    .recommendation-item.implemented {
        border-left-color: #10b981;
        background: rgba(16, 185, 129, 0.05);
    }

    /* Search Results Panel */
    .search-results-panel {
        position: fixed;
        top: 72px;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        width: 100%;
        max-width: 600px;
        background: #12121a;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transition: all 0.2s ease;
    }

    .search-results-panel.visible {
        opacity: 1;
        visibility: visible;
        transform: translateX(-50%) translateY(0);
    }

    .search-results-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .search-results-close {
        background: none;
        border: none;
        color: #71717a;
        font-size: 1.25rem;
        cursor: pointer;
    }

    .search-results-content {
        padding: 24px;
    }

    .search-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: #a1a1aa;
    }

    .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
`;
document.head.appendChild(dynamicStyles);
