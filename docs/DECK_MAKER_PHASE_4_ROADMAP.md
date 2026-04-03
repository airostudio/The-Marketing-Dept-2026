# Deck Maker Phase 4: Real-Time Collaboration Roadmap

**Estimated Effort:** 200-300 hours
**Status:** 📋 Planning Phase
**Prerequisites:** Backend infrastructure, database, authentication system

---

## Overview

Phase 4 transforms Deck Maker into a **full collaborative presentation platform** like Google Slides, Tome, or Gamma. Users can work together in real-time, see each other's cursors, comment on slides, track versions, and present live.

**Current Status:**
- ✅ Phase 1: AI Content Generation (COMPLETE)
- ✅ Phase 2: Visual Design AI + PowerPoint Export (COMPLETE)
- ✅ Phase 3: Advanced Visuals (Charts, Icons, AI Images) (COMPLETE)
- 📋 Phase 4: Real-Time Collaboration (THIS DOCUMENT)

---

## Feature Requirements

### 1. Multi-User Editing (80-100 hours)

**Capability:** Multiple users can edit the same deck simultaneously without conflicts.

**Technical Implementation:**

#### Backend Architecture
```
Technology Stack:
- Node.js + Express (WebSocket server)
- Socket.IO or ws (WebSocket library)
- Operational Transform (OT) or CRDT for conflict resolution
  * Yjs (recommended) - CRDT framework
  * ShareDB (alternative) - OT framework
```

#### Frontend Changes
```javascript
// Real-time sync engine
class CollaborationEngine {
  constructor(deckId, userId) {
    this.socket = io('wss://api.audema.ai/collab');
    this.yDoc = new Y.Doc();
    this.deckState = this.yDoc.getMap('deck');

    // WebSocket provider for Yjs
    this.provider = new WebsocketProvider(
      'wss://api.audema.ai/collab',
      `deck-${deckId}`,
      this.yDoc
    );
  }

  updateSlide(slideId, changes) {
    // Yjs automatically handles conflict resolution
    this.deckState.get(slideId).set('content', changes);
  }

  onRemoteUpdate(callback) {
    this.deckState.observe(callback);
  }
}
```

#### Database Schema
```sql
-- Decks table
CREATE TABLE decks (
  id UUID PRIMARY KEY,
  company VARCHAR(255),
  deck_type VARCHAR(100),
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  content JSONB, -- Deck structure
  design JSONB,  -- Design system
  permissions JSONB -- Access control
);

-- Deck collaborators
CREATE TABLE deck_collaborators (
  deck_id UUID REFERENCES decks(id),
  user_id UUID REFERENCES users(id),
  role VARCHAR(50), -- 'owner', 'editor', 'viewer'
  joined_at TIMESTAMP,
  PRIMARY KEY (deck_id, user_id)
);

-- Real-time sessions
CREATE TABLE active_sessions (
  session_id UUID PRIMARY KEY,
  deck_id UUID REFERENCES decks(id),
  user_id UUID REFERENCES users(id),
  cursor_position JSONB,
  last_active TIMESTAMP
);
```

#### API Endpoints
```
WebSocket Events:
- deck:join         → User joins editing session
- deck:leave        → User leaves session
- deck:update       → User makes a change
- deck:cursor       → User moves cursor
- deck:selection    → User selects element

REST API:
- POST   /api/decks                  → Create deck
- GET    /api/decks/:id              → Get deck
- PATCH  /api/decks/:id              → Update deck
- DELETE /api/decks/:id              → Delete deck
- POST   /api/decks/:id/collaborators → Add collaborator
- GET    /api/decks/:id/sessions     → Get active sessions
```

---

### 2. Real-Time Presence Indicators (20-30 hours)

**Capability:** See who else is viewing/editing the deck with avatars and cursors.

**UI Components:**

```javascript
// Presence indicator component
class PresenceIndicator {
  render(activeSessions) {
    return `
      <div class="presence-bar">
        ${activeSessions.map(session => `
          <div class="user-avatar" style="background:${session.color}">
            <img src="${session.avatar}" />
            <span>${session.name}</span>
          </div>
        `).join('')}
        <div class="active-count">
          ${activeSessions.length} viewing
        </div>
      </div>
    `;
  }
}

// Cursor tracking
class RemoteCursor {
  constructor(userId, userName, color) {
    this.element = document.createElement('div');
    this.element.className = 'remote-cursor';
    this.element.style.borderColor = color;
    this.label = document.createElement('span');
    this.label.textContent = userName;
    this.element.appendChild(this.label);
  }

  updatePosition(x, y) {
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }
}
```

**CSS Styling:**
```css
.presence-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0,0,0,0.05);
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  position: relative;
  cursor: pointer;
}

.remote-cursor {
  position: absolute;
  pointer-events: none;
  z-index: 9999;
  transition: all 0.1s ease;
}

.remote-cursor::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-left: 8px solid;
  border-top: 12px solid transparent;
  border-bottom: 12px solid transparent;
}

.remote-cursor span {
  position: absolute;
  left: 12px;
  top: -20px;
  background: inherit;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
}
```

---

### 3. Version History & Rollback (40-50 hours)

**Capability:** Track every change, see who made it, and restore previous versions.

**Database Schema:**
```sql
CREATE TABLE deck_versions (
  id UUID PRIMARY KEY,
  deck_id UUID REFERENCES decks(id),
  version_number INTEGER,
  content JSONB,
  design JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP,
  change_summary TEXT,
  parent_version UUID REFERENCES deck_versions(id)
);

CREATE INDEX idx_deck_versions ON deck_versions(deck_id, created_at DESC);
```

**Version Tracking System:**
```javascript
class VersionControl {
  async createSnapshot(deckId, userId, changeSummary) {
    const currentContent = await this.getDeckContent(deckId);

    const version = {
      id: generateUUID(),
      deck_id: deckId,
      version_number: await this.getNextVersionNumber(deckId),
      content: currentContent,
      created_by: userId,
      created_at: new Date(),
      change_summary: changeSummary
    };

    await db.insert('deck_versions', version);
    return version;
  }

  async getHistory(deckId, limit = 50) {
    return db.query(`
      SELECT v.*, u.name, u.avatar
      FROM deck_versions v
      JOIN users u ON v.created_by = u.id
      WHERE v.deck_id = $1
      ORDER BY v.created_at DESC
      LIMIT $2
    `, [deckId, limit]);
  }

  async rollback(deckId, versionId, userId) {
    const version = await db.findOne('deck_versions', { id: versionId });

    // Create rollback snapshot
    await this.createSnapshot(deckId, userId, `Rolled back to version ${version.version_number}`);

    // Restore content
    await db.update('decks', { id: deckId }, {
      content: version.content,
      design: version.design,
      updated_at: new Date()
    });

    // Broadcast to all connected clients
    this.broadcastUpdate(deckId, 'rollback', version);
  }
}
```

**UI Component:**
```javascript
// Version history sidebar
<div class="version-history-panel">
  <h3>Version History</h3>
  <div class="version-list">
    {versions.map(v => (
      <div class="version-item">
        <div class="version-avatar">
          <img src={v.user.avatar} />
        </div>
        <div class="version-details">
          <div class="version-summary">{v.change_summary}</div>
          <div class="version-meta">
            {v.user.name} • {formatTime(v.created_at)}
          </div>
        </div>
        <button onclick="restoreVersion('{v.id}')">
          Restore
        </button>
      </div>
    ))}
  </div>
</div>
```

---

### 4. Comments & Feedback System (30-40 hours)

**Capability:** Leave comments on specific slides, reply to threads, resolve discussions.

**Database Schema:**
```sql
CREATE TABLE deck_comments (
  id UUID PRIMARY KEY,
  deck_id UUID REFERENCES decks(id),
  slide_number INTEGER,
  user_id UUID REFERENCES users(id),
  parent_comment_id UUID REFERENCES deck_comments(id), -- For threads
  content TEXT,
  position JSONB, -- {x, y} for pinned comments
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX idx_deck_comments ON deck_comments(deck_id, slide_number);
```

**Comment System:**
```javascript
class CommentSystem {
  async addComment(deckId, slideNumber, userId, content, position) {
    const comment = {
      id: generateUUID(),
      deck_id: deckId,
      slide_number: slideNumber,
      user_id: userId,
      content: content,
      position: position,
      created_at: new Date()
    };

    await db.insert('deck_comments', comment);

    // Real-time broadcast
    this.socket.to(`deck-${deckId}`).emit('comment:new', comment);

    return comment;
  }

  async getCommentsForSlide(deckId, slideNumber) {
    return db.query(`
      SELECT c.*, u.name, u.avatar
      FROM deck_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.deck_id = $1
        AND c.slide_number = $2
        AND c.parent_comment_id IS NULL
      ORDER BY c.created_at ASC
    `, [deckId, slideNumber]);
  }

  async resolveComment(commentId, userId) {
    await db.update('deck_comments', { id: commentId }, {
      resolved: true,
      resolved_by: userId,
      updated_at: new Date()
    });

    this.socket.to(`deck-${this.deckId}`).emit('comment:resolved', commentId);
  }
}
```

**UI Component:**
```html
<!-- Comment thread -->
<div class="comment-thread" data-slide="3" style="left: 200px; top: 150px;">
  <div class="comment-indicator">
    <i class="fa fa-comment"></i>
    <span class="comment-count">3</span>
  </div>

  <div class="comment-popover">
    <div class="comment-item">
      <img src="user1.jpg" class="comment-avatar" />
      <div class="comment-body">
        <div class="comment-header">
          <strong>Sarah Chen</strong>
          <span class="comment-time">2 hours ago</span>
        </div>
        <div class="comment-text">
          Can we add a chart showing the growth trajectory here?
        </div>
      </div>
    </div>

    <!-- Replies -->
    <div class="comment-replies">
      <div class="comment-item reply">
        <img src="user2.jpg" class="comment-avatar" />
        <div class="comment-body">
          <div class="comment-header">
            <strong>Mike Rodriguez</strong>
            <span class="comment-time">1 hour ago</span>
          </div>
          <div class="comment-text">
            Good idea! I'll add a line chart with Q1-Q4 data.
          </div>
        </div>
      </div>
    </div>

    <!-- Reply input -->
    <div class="comment-input">
      <textarea placeholder="Add a reply..."></textarea>
      <button>Reply</button>
    </div>

    <button class="btn-resolve">Resolve Thread</button>
  </div>
</div>
```

---

### 5. Live Presentation Mode (30-40 hours)

**Capability:** Present to remote viewers who follow your slides in real-time.

**Presentation Session:**
```javascript
class PresentationSession {
  async startPresentation(deckId, presenterId) {
    const session = {
      id: generateUUID(),
      deck_id: deckId,
      presenter_id: presenterId,
      current_slide: 1,
      started_at: new Date(),
      viewers: []
    };

    await db.insert('presentation_sessions', session);

    // Create shareable link
    const shareLink = `https://audema.ai/present/${session.id}`;

    return { session, shareLink };
  }

  async navigateToSlide(sessionId, slideNumber) {
    await db.update('presentation_sessions', { id: sessionId }, {
      current_slide: slideNumber
    });

    // Broadcast to all viewers
    this.socket.to(`presentation-${sessionId}`).emit('slide:change', {
      slideNumber: slideNumber,
      timestamp: new Date()
    });
  }

  async addViewer(sessionId, userId) {
    const session = await db.findOne('presentation_sessions', { id: sessionId });

    this.socket.to(`presentation-${sessionId}`).emit('viewer:joined', {
      userId: userId,
      viewerCount: session.viewers.length + 1
    });
  }
}
```

**Presentation UI:**
```html
<!-- Presenter view -->
<div class="presentation-mode">
  <div class="presenter-controls">
    <button onclick="previousSlide()">
      <i class="fa fa-chevron-left"></i> Previous
    </button>
    <span class="slide-counter">Slide 3 of 15</span>
    <button onclick="nextSlide()">
      Next <i class="fa fa-chevron-right"></i>
    </button>

    <div class="viewer-count">
      <i class="fa fa-users"></i> 23 viewing
    </div>

    <button onclick="endPresentation()">End Presentation</button>
  </div>

  <div class="presenter-main">
    <div class="current-slide">
      <!-- Current slide content -->
    </div>
    <div class="presenter-notes">
      <h4>Speaker Notes</h4>
      <p>{currentSlide.speakerNotes}</p>
    </div>
  </div>

  <div class="presenter-sidebar">
    <div class="next-slide-preview">
      <h4>Next Slide</h4>
      <!-- Next slide preview -->
    </div>
    <div class="presenter-timer">
      <i class="fa fa-clock"></i> 12:34
    </div>
  </div>
</div>

<!-- Viewer (follower) view -->
<div class="viewer-mode">
  <div class="viewer-header">
    <div class="presenter-info">
      <img src="presenter.jpg" />
      <span>Sarah Chen is presenting</span>
    </div>
    <button onclick="leavePresentation()">Leave</button>
  </div>

  <div class="slide-display">
    <!-- Current slide follows presenter -->
  </div>

  <div class="slide-progress">
    <div class="progress-bar" style="width: 20%;"></div>
    <span>Slide 3 of 15</span>
  </div>
</div>
```

---

## Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Browser)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Deck Editor  │  │   Presence   │  │  Comments    │      │
│  │   (Yjs)      │  │  Indicators  │  │   System     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          │        WebSocket Connection         │
          └──────────────────┼──────────────────┘
                             │
┌─────────────────────────────┼─────────────────────────────┐
│                             ▼                              │
│              WebSocket Server (Socket.IO/ws)              │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Collaboration Engine (Yjs Provider / ShareDB)     │   │
│  └────────────────────────────────────────────────────┘   │
│                             │                              │
│         ┌───────────────────┼───────────────────┐          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │   Session   │   │   Version    │   │  Comment     │   │
│  │   Manager   │   │   Control    │   │  Handler     │   │
│  └─────────────┘   └──────────────┘   └──────────────┘   │
│                             │                              │
└─────────────────────────────┼──────────────────────────────┘
                              │
┌─────────────────────────────┼──────────────────────────────┐
│                             ▼                              │
│                    PostgreSQL Database                     │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   decks    │  │deck_versions │  │ deck_comments   │   │
│  └────────────┘  └──────────────┘  └─────────────────┘   │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   users    │  │active_sessions│  │presentation_    │   │
│  │            │  │               │  │sessions         │   │
│  └────────────┘  └──────────────┘  └─────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- Yjs (CRDT for conflict-free sync)
- Socket.IO client (WebSocket communication)
- Existing: PptxGenJS, Chart.js, Font Awesome

**Backend:**
- Node.js + Express
- Socket.IO server
- y-websocket (Yjs WebSocket provider)
- PostgreSQL (primary database)
- Redis (session storage, real-time state)

**Infrastructure:**
- Docker (containerization)
- Kubernetes or AWS ECS (orchestration)
- AWS RDS or Heroku Postgres (managed database)
- Redis Cloud or AWS ElastiCache (managed Redis)
- CloudFlare or AWS CloudFront (CDN)

---

## Implementation Timeline

### Phase 4.1: Foundation (60-80 hours)

**Weeks 1-2:**
- Set up Node.js backend with Express
- Configure PostgreSQL database
- Implement user authentication (JWT + bcrypt)
- Create REST API for decks CRUD
- Basic deck storage and retrieval

**Deliverables:**
- ✅ Backend server running
- ✅ Database schema created
- ✅ Authentication working
- ✅ API endpoints functional

---

### Phase 4.2: Real-Time Sync (50-60 hours)

**Weeks 3-4:**
- Integrate Yjs for CRDT sync
- Set up WebSocket server with y-websocket
- Implement deck state synchronization
- Handle conflict resolution
- Test multi-user editing

**Deliverables:**
- ✅ WebSocket connections established
- ✅ Real-time deck updates working
- ✅ Conflict resolution tested
- ✅ Multi-user editing functional

---

### Phase 4.3: Presence & Comments (40-50 hours)

**Weeks 5-6:**
- Build presence indicator UI
- Implement cursor tracking
- Create comment system (database + API)
- Build comment UI components
- Thread replies and resolution

**Deliverables:**
- ✅ User avatars showing who's online
- ✅ Real-time cursor positions
- ✅ Comment threads working
- ✅ Comment resolution functional

---

### Phase 4.4: Versions & Presentation (50-60 hours)

**Weeks 7-8:**
- Implement version tracking
- Build version history UI
- Create rollback functionality
- Build presentation mode (presenter + viewer)
- Implement slide navigation sync
- Create shareable presentation links

**Deliverables:**
- ✅ Version history accessible
- ✅ Rollback working
- ✅ Presentation mode functional
- ✅ Viewer sync working

---

## Estimated Costs

### Development Costs
- Backend Developer (200 hours @ $75/hr): **$15,000**
- Frontend Developer (100 hours @ $75/hr): **$7,500**
- DevOps/Infrastructure (30 hours @ $100/hr): **$3,000**
- **Total Development: $25,500**

### Infrastructure Costs (Monthly)
- AWS ECS (t3.medium instances x2): ~$60/mo
- AWS RDS PostgreSQL (db.t3.small): ~$30/mo
- Redis Cloud (1GB): ~$15/mo
- CloudFront CDN: ~$20/mo
- WebSocket server bandwidth: ~$50/mo
- **Total Monthly: ~$175/mo**

### Annual Infrastructure Cost
- $175/mo × 12 = **$2,100/year**

---

## Risks & Challenges

### 1. **Scaling WebSocket Connections**
   - **Risk:** High concurrent user count may overwhelm single server
   - **Mitigation:** Horizontal scaling with Redis pub/sub, load balancing

### 2. **Data Sync Conflicts**
   - **Risk:** Complex conflicts in simultaneous edits
   - **Mitigation:** Yjs handles this automatically with CRDT

### 3. **Database Performance**
   - **Risk:** Version history table grows very large
   - **Mitigation:** Archive old versions, implement pagination

### 4. **WebSocket Reliability**
   - **Risk:** Connection drops, network issues
   - **Mitigation:** Automatic reconnection, offline queue

### 5. **Security**
   - **Risk:** Unauthorized access to decks, XSS attacks
   - **Mitigation:** JWT auth, role-based permissions, input sanitization

---

## Alternative: Serverless Approach

Instead of a full backend, could use:

**Firebase (Google):**
- Firebase Realtime Database (real-time sync)
- Firebase Authentication (user auth)
- Cloud Firestore (deck storage)
- Cloud Functions (serverless API)

**Pros:**
- ✅ Much faster to implement (40-50% time savings)
- ✅ Auto-scaling included
- ✅ Built-in authentication
- ✅ Pay-per-use pricing

**Cons:**
- ❌ Vendor lock-in
- ❌ Less control over architecture
- ❌ Potentially higher costs at scale

**Firebase Cost Estimate:**
- Spark (free tier): Up to 100 concurrent users
- Blaze (pay-as-you-go): ~$50-150/mo for 1000-5000 users

---

## Success Metrics

### User Engagement
- 🎯 Active collaboration sessions per day
- 🎯 Comments per deck
- 🎯 Version history rollbacks
- 🎯 Live presentations delivered

### Performance
- 🎯 < 100ms latency for real-time updates
- 🎯 < 500ms for slide navigation
- 🎯 99.9% WebSocket uptime
- 🎯 Support 100+ concurrent users per deck

### Business Impact
- 🎯 Increase user retention by 40%
- 🎯 Drive team/enterprise plan upgrades
- 🎯 Reduce churn by 25%
- 🎯 Enable viral collaboration invites

---

## Conclusion

**Phase 4 transforms Deck Maker into a full collaborative platform** competing directly with Google Slides, Tome, and Gamma. It's a massive undertaking requiring:

✅ **200-300 development hours**
✅ **$25,000 development investment**
✅ **$2,100/year infrastructure costs**
✅ **Full-stack architecture (backend, database, WebSockets)**

**Recommendation:**
- Start with Firebase for rapid MVP (Phase 4.1 + 4.2)
- Validate user demand for collaboration
- Migrate to custom backend if usage scales
- Prioritize real-time sync + presence (high value, lower complexity)
- Defer advanced features (version history, presentation mode) to Phase 4.5

**Current Feature Parity (After Phase 3):** ~85%
**After Phase 4:** ~100% (full Tome/Gamma competitor)

---

**Next Steps:**
1. Secure funding/budget for Phase 4 development
2. Choose architecture: Custom backend vs. Firebase
3. Hire backend developer or allocate internal resources
4. Begin Phase 4.1 foundation work
5. Launch beta with limited collaboration features
6. Iterate based on user feedback

**Questions?** Contact the engineering team for detailed technical planning.
