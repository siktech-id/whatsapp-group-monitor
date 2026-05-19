# WhatsApp Group Monitor - Message Sending Feature Context

## Project Overview

**Repository:** https://github.com/marinaglancy/whatsapp-group-monitor

**Current Status:** Read-only monitoring tool that tracks WhatsApp group activity (messages, members, reactions, polls)

**Goal:** Extend the tool to enable **sending messages** to individuals and groups

---

## Current Architecture

### Tech Stack
- **Backend:** Fastify (Node.js web framework) + TypeScript
- **WhatsApp Integration:** Baileys library (reverse-engineered WhatsApp Web protocol)
- **Database:** SQLite with Drizzle ORM
- **Frontend:** Web dashboard (static files served by Fastify)
- **Session Management:** File-based auth state storage in `./data/{phone_number}/`

### Project Structure
```
whatsapp-group-monitor/
├── src/
│   ├── index.ts              # Main entry point, Fastify server setup
│   ├── baileys-client.ts     # WhatsApp connection logic (Baileys wrapper)
│   ├── web/
│   │   ├── routes/           # API endpoints (GET/POST handlers)
│   │   ├── static/           # Frontend UI (HTML, CSS, JS)
│   │   └── middleware/       # Authentication, session handling
│   ├── db/
│   │   ├── schema.ts         # Database schema (Drizzle)
│   │   └── index.ts          # DB client initialization
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

### Environment Variables
```bash
DATA_DIR=./data              # Auth state and database location
PORT=3000                    # Web server port
LOG_LEVEL=info              # Logging level
ADMIN_USERNAME=admin        # Dashboard login
ADMIN_PASSWORD=             # Dashboard password
```

---

## How It Currently Works

### WhatsApp Connection (Baileys)
1. **QR Code Pairing:** User scans QR code to link WhatsApp account (similar to web.whatsapp.com)
2. **Session Persistence:** Credentials stored in `./data/{phone_number}/` for auto-reconnect
3. **Event Listening:** Listens for incoming messages, group updates, reactions, etc.
4. **Passive Monitoring:** Receives and logs all group activity to SQLite database

### API Endpoints (Current - Read Only)
- `GET /api/groups` - List all groups
- `GET /api/groups/:id/messages` - Get group messages
- `GET /api/groups/:id/members` - Get group members
- `POST /api/auth/login` - Dashboard login
- `GET /api/status` - Connection status

### Database Schema (SQLite)
- `messages` - Message content, sender, timestamp, group_id
- `groups` - Group metadata (name, description, member count)
- `members` - Group members and their details
- `reactions` - Message reactions and polls
- `users` - WhatsApp account info

---

## Data Flow (Current - Read Only)

```
WhatsApp Server
    ↓
Baileys Library (reverse-engineered protocol)
    ↓
baileys-client.ts (event handlers)
    ↓
SQLite Database (store messages, groups, members)
    ↓
Fastify API routes (serve data)
    ↓
Web Dashboard (display groups and messages)
```

---

## Security Analysis

### Current Security Posture
- ✅ **No unauthorized outbound connections** - Only connects to WhatsApp servers (by design)
- ✅ **No telemetry/analytics** - No tracking or data exfiltration
- ✅ **No supply chain risk** - Clean dependency list, no suspicious packages
- ✅ **Password-protected dashboard** - Basic auth with ADMIN_USERNAME/ADMIN_PASSWORD
- ✅ **Self-hosted** - All data stays local (no cloud sync)
- ✅ **Passive only** - Doesn't interfere with normal WhatsApp use

### Key Concern: Baileys Library
- Baileys *can* send messages (full-featured WhatsApp Web client)
- Current codebase doesn't expose sending functionality
- Adding this feature will enable message sending capability

---

## Feature Request: Add Message Sending

### Goal
Add the ability to send messages to:
1. **Individual contacts** - Direct messages
2. **Groups** - Group messages
3. **With authentication** - Only authenticated admin can send

### Proposed Implementation Strategy

#### 1. New API Endpoints Needed
```typescript
// POST /api/messages/send
// Body: { to: "phoneNumber or groupId", text: "message content", mediaUrl?: "..." }
// Response: { success: true, messageId: "..." }

// POST /api/groups/:id/send
// Body: { text: "group message" }
// Response: { success: true, messageId: "..." }

// GET /api/conversations
// List all open conversations (groups + DMs)

// GET /api/conversations/:id/messages
// Get conversation history
```

#### 2. Database Schema Updates
```typescript
// Add outgoing_messages table
outgoing_messages: {
  id: string (PK)
  phoneNumber: string (FK to users)
  recipient: string (phone or group ID)
  message_text: string
  sent_at: timestamp
  status: "pending" | "sent" | "failed"
  messageId: string (WhatsApp message ID)
  error?: string
}

// Add message_templates (optional)
message_templates: {
  id: string
  name: string
  content: string
  created_at: timestamp
}
```

#### 3. Frontend Changes
```
Dashboard additions:
- "Send Message" button on conversations
- Modal/form to compose message
- Message history (sent + received)
- Conversation list view
- Status indicators (pending, sent, failed)
```

#### 4. Baileys Integration
```typescript
// Use existing Baileys sendMessage method:
await socket.sendMessage(
  "phoneNumber@s.whatsapp.net" or "groupId@g.us",
  { text: "Your message" }
);

// Error handling for:
// - Invalid recipient
// - Connection lost
// - Rate limiting
// - Message too long
```

#### 5. Authentication & Authorization
```typescript
// Only allow authenticated admin users to send
// Check ADMIN_USERNAME + SESSION before allowing POST to /api/messages/send
// Rate limiting to prevent spam
```

---

## Implementation Checklist

### Phase 1: Backend API
- [ ] Add `/api/messages/send` endpoint
- [ ] Add `/api/groups/:id/send` endpoint
- [ ] Create `outgoing_messages` database table
- [ ] Integrate Baileys `sendMessage()` method
- [ ] Add error handling (invalid recipients, rate limits, etc.)
- [ ] Add logging for sent messages

### Phase 2: Database & Persistence
- [ ] Run Drizzle migrations for new schema
- [ ] Add message status tracking (pending → sent → failed)
- [ ] Store sender, recipient, timestamp, status

### Phase 3: Frontend UI
- [ ] Add "Send Message" button to group/contact view
- [ ] Create message compose form/modal
- [ ] Display sent/received message history
- [ ] Show delivery status (pending/sent/failed)
- [ ] Add message templates (optional)

### Phase 4: Testing & Security
- [ ] Test sending to individuals
- [ ] Test sending to groups
- [ ] Test error cases (invalid numbers, network failures)
- [ ] Add rate limiting to prevent spam
- [ ] Verify authentication on send endpoints
- [ ] Test with large message volumes

---

## Key Files to Modify/Create

### Must Modify
1. **src/index.ts** - Add new routes for message sending
2. **src/baileys-client.ts** - Expose sendMessage() method
3. **src/db/schema.ts** - Add outgoing_messages table
4. **src/web/routes/** - Create `/messages` and `/conversations` routes

### Will Create
1. **src/web/routes/messages.ts** - Message sending endpoints
2. **src/web/routes/conversations.ts** - Conversation listing
3. **src/services/message-sender.ts** - Business logic for sending

### Optional Updates
1. **src/web/static/index.html** - Add send message UI
2. **src/web/static/compose.js** - Frontend compose form
3. **src/types/index.ts** - Add SendMessageRequest type

---

## Important Constraints

### Baileys Limitations
- Can only send from the connected WhatsApp account
- Message rate limits apply (WhatsApp anti-spam)
- No multimedia support in initial implementation (text-only recommended)
- Session must be active (bot needs to be "online")

### WhatsApp API Constraints
- ~80 messages per day per number (anti-spam)
- 16KB max message size
- Group messages subject to rate limiting
- Attachments require special handling

### Security Constraints
- Only authenticated users can send
- No public API without authentication
- Messages logged in database (audit trail)
- Add SENDING_ENABLED flag to disable feature if needed

---

## Potential Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Spam/abuse via message sending | Rate limiting per user, max messages per day |
| Unauthorized access to send feature | Require admin authentication, IP whitelist |
| WhatsApp account suspension | Rate limiting, no automated mass messaging |
| Message delivery failures | Retry logic, status tracking, error logging |
| Database bloat from logs | Archive old messages, cleanup policy |

---

## Testing Strategy

```bash
# 1. Unit tests for send endpoints
npm test -- src/web/routes/messages.test.ts

# 2. Integration test (requires WhatsApp session)
npm run test:integration

# 3. Manual testing
# - Send message to self
# - Send to group
# - Test error cases (invalid number, offline)
# - Verify messages appear in WhatsApp

# 4. Load testing
# - Send 50 messages rapidly (test rate limiting)
# - Monitor CPU/memory usage
```

---

## Next Steps for Claude Code

1. **Clone the repo locally:**
   ```bash
   git clone https://github.com/marinaglancy/whatsapp-group-monitor.git
   cd whatsapp-group-monitor
   ```

2. **Open in VS Code:**
   ```bash
   code .
   ```

3. **Copy this CONTEXT.md into the project root**

4. **Open Claude Code extension and ask:**
   ```
   "Based on CONTEXT.md, implement the message sending feature. 
    Start with Phase 1 (backend API endpoints and Baileys integration)"
   ```

5. **Claude Code will then:**
   - Explore the actual codebase
   - Understand current structure
   - Create/modify files for message sending
   - Provide working implementation

---

## Questions to Ask Claude Code

Once you open Claude Code with this context:

1. **"Add POST /api/messages/send endpoint with Baileys integration"**
2. **"Create the outgoing_messages database table schema"**
3. **"Add message sending UI to the dashboard"**
4. **"Implement rate limiting for message sending"**
5. **"Add error handling for invalid recipients"**

---

## Reference: Baileys SendMessage Syntax

```typescript
// Send text message to individual
await socket.sendMessage(
  "1234567890@s.whatsapp.net",  // Phone with @s.whatsapp.net
  { text: "Hello!" }
);

// Send to group
await socket.sendMessage(
  "120363123456789-1@g.us",  // Group ID with @g.us
  { text: "Group message!" }
);

// With media (optional advanced feature)
await socket.sendMessage(number, {
  image: { url: "https://..." },
  caption: "Image caption"
});
```

---

## Resources

- **Baileys GitHub:** https://github.com/WhiskeySockets/Baileys
- **Fastify Docs:** https://www.fastify.io/
- **Drizzle ORM:** https://orm.drizzle.team/
- **WhatsApp Rate Limits:** Consider anti-spam guidelines

---

## Summary

This document provides Claude Code with:
1. Complete project architecture understanding
2. Current security posture
3. Detailed implementation strategy (4 phases)
4. Database schema changes needed
5. API endpoint specifications
6. Frontend UI requirements
7. Testing and risk mitigation strategies

**You're now ready to use Claude Code to implement message sending!**