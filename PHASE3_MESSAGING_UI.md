# Phase 3: Frontend Messaging UI Documentation

## Overview
Phase 3 adds a full-featured **Messaging page** to the web dashboard at `/messaging`. The page provides a two-panel chat interface:
- **Left panel:** List of all conversations (groups + DMs), sortable by recency
- **Right panel:** Message history with compose box

Users can:
- View all groups and direct messages in one place
- Send messages to groups or individuals
- View message history with pagination ("Load older")
- Create new DM conversations

---

## UI Features

### Conversation List (Left Panel)
- Shows all active groups + DM recipients
- Each conversation displays:
  - Icon: 🟢 for groups, 👤 for DMs
  - Name (truncated to 20 chars)
  - Relative time of last activity (e.g., "2m ago", "Yesterday")
- Hover state and active selection highlight
- **"+ New Message" button** at bottom to start a new DM

### Message History (Right Panel)
- Shows message thread for selected conversation
- Messages displayed as bubbles:
  - **Incoming (group):** Left-aligned, gray background, includes sender name + timestamp
  - **Outgoing (DM/sent):** Right-aligned, green background
- **"Load older messages"** button appears when more messages available (pagination)
- Auto-scrolls to newest message on load
- Chat header shows conversation name and metadata (member count for groups, "Direct message" for DMs)

### Compose Box
- Single-line text area with send button
- **Enter** to send, **Shift+Enter** for newline
- Automatically clears after sending
- Shows sent message immediately in chat

### New Message Modal
- Opens when clicking "+ New Message" button
- Prompts for:
  - Phone number (e.g., 628116191899)
  - Message text
- **Cancel** or **Send** buttons
- Sends directly via POST `/api/messages/send`

---

## File Changes

### Created
- **`src/web/static/messaging.html`** (580 lines)
  - Full HTML page with embedded CSS and JavaScript
  - Two-panel layout with Flexbox
  - Integration with Phase 1/2 APIs

### Modified
- **`src/web/routes/index.ts`** — Added GET `/messaging` route
- **`src/web/static/partials/status-bar.html`** — Added "Messaging" link in kebab dropdown menu

---

## API Integration

The page uses these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/conversations` | GET | Fetch list of all groups + DMs |
| `/api/conversations/:id/messages` | GET | Fetch paginated message history |
| `/api/messages/send` | POST | Send direct message to a contact |
| `/api/groups/:jid/send` | POST | Send message to a group |

All requests include CSRF token in `X-CSRF-Token` header.

---

## JavaScript Functions

**State Management:**
- `currentConvId` — Currently selected conversation JID
- `nextCursor` — Pagination cursor for loading older messages
- `loadingMore` — Flag to prevent double-loading

**Core Functions:**

| Function | Purpose |
|----------|---------|
| `loadConversations()` | Fetch and render conversation list |
| `selectConversation(id, name, type)` | Switch to a conversation |
| `loadMessages(id, before)` | Fetch and render message history |
| `sendMessage()` | Send message from compose box |
| `openNewMessageModal()` | Show new DM modal |
| `sendNewMessage()` | Send message from modal |
| `relativeTime(timestamp)` | Convert timestamp to human text ("2m ago") |
| `escHtml(s)` | XSS-safe HTML escaping |

---

## Design System

**Colors:**
- Primary: `#25d366` (WhatsApp green) — buttons, active states
- Secondary: `#667781` (muted gray) — secondary text
- Text: `#1a1a1a` (dark) — primary text, `#999` — timestamps
- Background: `#f0f2f5` (light gray) — surface backgrounds
- Message out: `#d9fdd3` (light green) — outgoing messages
- Message in: `#f0f2f5` (light gray) — incoming messages

**Typography:**
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`
- Responsive text sizes: 0.75rem – 1rem
- All styling via page-scoped `<style>` block (no external CSS framework)

**Layout:**
- Max-width: 1100px
- Two-column flex layout: 280px left + flexible right
- Full viewport height minus header/statusbar
- Message bubbles with 70% max-width for text wrapping

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Enter** | Send message |
| **Shift + Enter** | Insert newline in compose box |

---

## Security

- All user input escaped via `escHtml()` to prevent XSS
- CSRF token included in all POST requests
- 401 redirects to login on auth failures
- No sensitive data stored in localStorage

---

## Mobile Responsiveness

The page uses viewport-relative units (`calc(100vh - Xpx)`), so it adapts to screen size. For best experience:
- Desktop: Full two-panel layout
- Mobile: Left panel may need scroll (or could be hidden with a menu toggle in future)

---

## Limitations

1. **DM Inbound Messages Not Shown**
   - Only outgoing DM messages appear (Phase 2 limitation)
   - Feature requires WhatsApp event listeners for inbound DMs

2. **No Message Search**
   - Would require backend full-text search implementation

3. **No Media Messages**
   - Text-only for now; media message support requires backend enhancement

4. **No Message Reactions/Edits**
   - Only base messages shown (`eventType='message'`)

5. **No Read Receipts**
   - No delivery confirmation from recipient side

---

## Future Enhancements

1. **Unread Badges** — Show unread count next to conversation names
2. **Typing Indicators** — "Bobby is typing..." status
3. **Message Search** — Search across all messages
4. **Media Support** — Send/receive images, videos
5. **Reactions** — Emoji reactions to messages
6. **Mobile UI Toggle** — Collapse conversation list on small screens
7. **Pinned Conversations** — Pin frequently-used conversations to top
8. **Message Drafts** — Save unsent messages

---

## Testing Checklist

- ✅ Page loads and requires authentication
- ✅ Conversation list fetches and renders
- ✅ Clicking a group shows message history
- ✅ Clicking a DM shows outgoing message history
- ✅ "Load older" button appears and loads previous messages
- ✅ Composing and sending a message works
- ✅ Sent message appears immediately in chat
- ✅ New Message modal opens and sends DM
- ✅ Enter key sends message, Shift+Enter adds newline
- ✅ "Messaging" link visible in kebab dropdown on all pages

---

## Summary

Phase 3 completes the messaging feature with a modern, user-friendly chat UI. All three phases are now complete:

1. ✅ **Phase 1** — Backend API for sending messages
2. ✅ **Phase 2** — Conversations API for listing & history
3. ✅ **Phase 3** — Frontend Messaging page for users

The system is now ready for full deployment and usage!
