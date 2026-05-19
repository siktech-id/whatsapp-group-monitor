# Phase 2: Conversations API Documentation

## Overview
Phase 2 adds a unified **Conversations API** that enables developers to:
- List all active conversations (groups + DMs)
- Retrieve paginated message history per conversation
- Build chat-style UIs with real-time message feeds

---

## New Endpoints

### 1. List All Conversations

**Endpoint:** `GET /api/conversations`

**Authentication:** API Key OR Session

**Response:**
```json
{
  "conversations": [
    {
      "id": "120363408247627931@g.us",
      "type": "group",
      "name": "My Group",
      "memberCount": 45,
      "lastActivity": 1779113241,
      "isArchived": false,
      "isCommunity": false
    },
    {
      "id": "628116191899@s.whatsapp.net",
      "type": "dm",
      "name": "Bobby Siagian",
      "lastMessageText": "Hello! This is a test message.",
      "lastMessageAt": "2026-05-18T14:07:13.729Z",
      "lastMessageStatus": "sent"
    }
  ]
}
```

**Response Fields:**

Group conversation:
- `id` - Group JID (format: `120363xxxxx@g.us`)
- `type` - Always `"group"`
- `name` - Group subject/display name
- `memberCount` - Current active members
- `lastActivity` - Unix timestamp of last message
- `isArchived` - Whether group is archived
- `isCommunity` - Whether this is a community

DM conversation:
- `id` - Recipient JID (format: `xxxxx@s.whatsapp.net`)
- `type` - Always `"dm"`
- `name` - Contact display name or phone number
- `lastMessageText` - Last message text (outgoing only)
- `lastMessageAt` - ISO 8601 timestamp
- `lastMessageStatus` - Delivery status: `"pending"`, `"sent"`, `"failed"`

**Sorting:** Conversations are sorted by most recent activity first.

**Example curl:**
```bash
curl -X GET http://localhost:3000/api/conversations \
  -H "X-API-Key: PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4"
```

---

### 2. Get Conversation Message History

**Endpoint:** `GET /api/conversations/:id/messages?limit=50&before=<cursor>`

**Authentication:** API Key OR Session

**URL Parameters:**
- `:id` - Conversation ID (group JID ending `@g.us` or contact JID ending `@s.whatsapp.net`)

**Query Parameters:**
- `limit` - Number of messages to return (default: 50, max: 100)
- `before` - Pagination cursor (optional)
  - For groups: Unix timestamp in seconds
  - For DMs: ISO 8601 datetime string

**Response (Group):**
```json
{
  "conversationId": "120363408247627931@g.us",
  "type": "group",
  "messages": [
    {
      "id": 4,
      "messageId": "3EB0xxx",
      "senderJid": "628xxxxx@s.whatsapp.net",
      "senderName": "Bobby Siagian",
      "text": "Hello everyone!",
      "timestamp": 1779113241,
      "eventType": "message"
    }
  ],
  "nextCursor": 1779113200
}
```

**Response (DM):**
```json
{
  "conversationId": "628116191899@s.whatsapp.net",
  "type": "dm",
  "messages": [
    {
      "id": 10,
      "text": "Hello! This is a test message.",
      "status": "sent",
      "whatsappMessageId": "3EB0xxx",
      "sentAt": "2026-05-18T14:07:13.729Z",
      "direction": "outgoing"
    }
  ],
  "nextCursor": "2026-05-18T14:07:00.000Z"
}
```

**Pagination:**
- `nextCursor` is the timestamp of the last message in the result set
- Pass `?before=<nextCursor>` to fetch the next page
- `nextCursor` is `null` when no more messages exist

**Example curl - Group:**
```bash
curl -X GET "http://localhost:3000/api/conversations/120363408247627931@g.us/messages?limit=20" \
  -H "X-API-Key: PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4"
```

**Example curl - DM:**
```bash
curl -X GET "http://localhost:3000/api/conversations/628116191899@s.whatsapp.net/messages?limit=20" \
  -H "X-API-Key: PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4"
```

**Example curl - With pagination cursor:**
```bash
CURSOR="1779113200"
curl -X GET "http://localhost:3000/api/conversations/120363408247627931@g.us/messages?limit=20&before=$CURSOR" \
  -H "X-API-Key: PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4"
```

---

## Data Model

### Group Message
```typescript
{
  id: number              // Local DB ID
  messageId: string       // WhatsApp message ID
  senderJid: string       // Sender's JID
  senderName: string      // Display name or phone
  text: string            // Message text content
  timestamp: number       // Unix seconds
  eventType: string       // "message" (only messages returned)
}
```

### DM Message
```typescript
{
  id: number              // Local DB ID
  text: string            // Message text
  status: string          // "pending" | "sent" | "failed"
  whatsappMessageId: string | null  // WA ID if sent
  sentAt: string | null   // ISO 8601 timestamp
  direction: string       // "outgoing" (only outgoing DMs tracked)
}
```

---

## Implementation Details

### Files Created
- `src/db/queries/conversations.ts` - Database queries:
  - `getDistinctDmRecipients()` - Fetch all DM recipients
  - `getLastOutgoingPerRecipient()` - Latest message per DM
  - `getGroupMessages()` - Paginated group message history
  - `getOutgoingMessagesByRecipient()` - Paginated DM history

- `src/web/routes/conversations.ts` - Route handlers for both endpoints

### Files Modified
- `src/web/middleware/auth.ts` - Added `requireApiKeyOrSession` (shared middleware)
- `src/web/routes/index.ts` - Registered conversation routes
- `src/web/routes/messages.ts` - Updated to use shared `requireApiKeyOrSession`

### Database Queries
- **Groups:** Queries `group_activity_log` table filtered by `eventType='message'`
- **DMs:** Queries `outgoing_messages` table (inbound DMs not stored)
- **Indices:** Uses existing indices on `group_jid`, `timestamp` for optimal performance

---

## Known Limitations

1. **DM Inbound Messages Not Stored**
   - Only outgoing DM messages (sent by bot) are returned
   - Inbound DM messages from contacts are not persisted in database
   - To support inbound DMs, requires WhatsApp event listener for incoming messages

2. **DMs Only Show Sent Messages**
   - Cannot distinguish between read/unread status
   - No delivery confirmations from recipient side

3. **Group Messages Only**
   - Only `eventType='message'` events returned (no reactions, polls, edits)
   - Use `/api/groups/:jid` endpoint for full group metadata

---

## Error Handling

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | Invalid conversation ID format | ID doesn't end with `@g.us` or `@s.whatsapp.net` |
| 400 | Invalid before cursor format | Pagination cursor malformed |
| 401 | Unauthorized | Missing or invalid API key |
| 503 | Not connected | WhatsApp account not connected yet |

---

## Pagination Example (Node.js)

```javascript
const API_KEY = 'PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4'

async function getConversationHistory(conversationId) {
  const messages = []
  let cursor = null
  
  while (true) {
    const url = new URL(`http://localhost:3000/api/conversations/${conversationId}/messages`)
    url.searchParams.set('limit', '50')
    if (cursor) url.searchParams.set('before', cursor)
    
    const response = await fetch(url, {
      headers: { 'X-API-Key': API_KEY }
    })
    
    const data = await response.json()
    messages.push(...data.messages)
    
    if (!data.nextCursor) break
    cursor = data.nextCursor
  }
  
  return messages
}

// Usage
const history = await getConversationHistory('120363408247627931@g.us')
console.log(`Retrieved ${history.length} messages`)
```

---

## Integration with Phase 1 (Sending)

Use together with Phase 1 endpoints:
- Send message: `POST /api/messages/send` or `POST /api/groups/:jid/send`
- List message history: `GET /api/conversations/:id/messages`
- Full conversation flow: Send → List history → Paginate

---

## Testing

**Quick test all endpoints:**
```bash
API_KEY="PC0muZZ6myKIdIsx6ThHUdw0vSuALdm4"

# List conversations
curl -s http://localhost:3000/api/conversations \
  -H "X-API-Key: $API_KEY" | jq '.'

# Get group messages
curl -s 'http://localhost:3000/api/conversations/120363408247627931@g.us/messages?limit=5' \
  -H "X-API-Key: $API_KEY" | jq '.'

# Get DM messages
curl -s 'http://localhost:3000/api/conversations/628116191899@s.whatsapp.net/messages?limit=5' \
  -H "X-API-Key: $API_KEY" | jq '.'
```

---

## Performance Notes

- **Conversation List**: O(n) where n = number of groups + DM recipients
- **Group Messages**: Uses indexed query on `(group_jid, timestamp)` - O(log n)
- **DM Messages**: Uses indexed query on `recipient` - O(log n)
- **Limit**: Max 100 messages per request to prevent memory issues
- **Caching**: Implement client-side pagination cursor cache for efficient pagination

---

## Future Enhancements

1. **Inbound DM Storage** - Listen to WhatsApp events for incoming DMs
2. **Unread Counts** - Use `group_members.last_read_at` to compute unread message counts
3. **Message Search** - Full-text search across message history
4. **Reactions & Edits** - Return `eventType='reaction'` and `eventType='edit'` events
5. **Media Messages** - Return media URLs from message metadata
