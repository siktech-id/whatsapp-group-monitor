# WhatsApp Group Monitor - Message Sending API

## Overview
Phase 1 implementation provides REST API endpoints to send WhatsApp messages to individuals and groups. Two authentication methods are supported:
1. **API Key** (recommended for developers)
2. **Session-based** (for web dashboard users)

---

## Authentication

### API Key Authentication (Recommended for Developers)
Pass the API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/messages/send
```

**Default API Key:** `dev-key-change-in-production`

**Setting Custom API Key:**
```bash
export API_KEY="your-secure-key"
npm run dev
```

### Session Authentication (For Web Dashboard)
1. Login via web dashboard at `http://localhost:3000/login`
2. Use session cookie + CSRF token for API calls
3. See Postman collection's "Message Sending (Session Auth)" folder

---

## Endpoints

### 1. Send Message to Individual

**Endpoint:** `POST /api/messages/send`

**Authentication:** API Key OR Session + CSRF

**Request:**
```json
{
  "recipient": "628116191899",
  "text": "Hello! This is a test message."
}
```

**Response (Success):**
```json
{
  "ok": true,
  "messageId": 2,
  "whatsappMessageId": "3EB0617C2D0C95018DCDFA"
}
```

**Response (Error):**
```json
{
  "error": "Failed to send message",
  "details": "Network error or invalid recipient"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipient` | string | Yes | Phone number or full JID. Phone only: `628116191899`, Full JID: `628116191899@s.whatsapp.net` |
| `text` | string | Yes | Message content (max 16KB) |

**Examples:**

With API Key:
```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-change-in-production" \
  -d '{
    "recipient": "628116191899",
    "text": "Hello from API!"
  }'
```

With Session Cookie:
```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -b cookies.txt \
  -d '{
    "recipient": "628116191899",
    "text": "Hello from web!"
  }'
```

---

### 2. Send Message to Group

**Endpoint:** `POST /api/groups/:jid/send`

**Authentication:** API Key OR Session + CSRF

**URL Parameter:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jid` | string | Yes | Group JID in format `120363xxxxx@g.us` |

**Request:**
```json
{
  "text": "Hello everyone! This is a group message."
}
```

**Response (Success):**
```json
{
  "ok": true,
  "messageId": 3,
  "whatsappMessageId": "3EB09FC1CC9A1BB50F17EE"
}
```

**Examples:**

```bash
# With API Key
curl -X POST http://localhost:3000/api/groups/120363408247627931@g.us/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-change-in-production" \
  -d '{"text": "Group message!"}'

# With Session
curl -X POST http://localhost:3000/api/groups/120363408247627931@g.us/send \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -b cookies.txt \
  -d '{"text": "Group message!"}'
```

---

### 3. Get Recent Sent Messages

**Endpoint:** `GET /api/messages/sent`

**Authentication:** API Key OR Session + CSRF

**Response:**
```json
{
  "messages": [
    {
      "id": 6,
      "recipient": "120363408247627931@g.us",
      "text": "Group message with API key",
      "status": "sent",
      "whatsappMessageId": "3EB047E5FEE5E5DFF13AB5",
      "error": null,
      "sentAt": "2026-05-18T13:58:25.199Z",
      "createdAt": "2026-05-18T13:58:24.676Z"
    }
  ]
}
```

**Query Parameters:** None (returns last 50 messages)

**Examples:**

```bash
# With API Key
curl -X GET http://localhost:3000/api/messages/sent \
  -H "X-API-Key: dev-key-change-in-production"

# With Session
curl -X GET http://localhost:3000/api/messages/sent \
  -H "X-CSRF-Token: <token>" \
  -b cookies.txt
```

---

## Error Handling

### Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Message sent successfully |
| 400 | Bad Request | Missing recipient or text, message too long |
| 401 | Unauthorized | Invalid API key or no session |
| 403 | Forbidden | Invalid CSRF token (session auth only) |
| 503 | Service Unavailable | WhatsApp not connected |

### Error Responses

**Invalid API Key:**
```json
{
  "error": "Unauthorized: Invalid or missing API key"
}
```

**Missing Recipient:**
```json
{
  "error": "Missing recipient or text"
}
```

**Message Too Long:**
```json
{
  "error": "Message too long (max 16KB)"
}
```

**WhatsApp Not Connected:**
```json
{
  "error": "Not connected"
}
```

**Send Failure:**
```json
{
  "error": "Failed to send message",
  "details": "Network timeout"
}
```

---

## Environment Variables

```bash
# API Key for authentication (default: "dev-key-change-in-production")
API_KEY=your-secure-key

# Other existing variables
PORT=3000
HOST=0.0.0.0
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
DATA_DIR=./data
LOG_LEVEL=info
```

---

## Database Schema

Messages are persisted in SQLite with the following schema:

```sql
CREATE TABLE outgoing_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
  whatsapp_message_id TEXT,
  error TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
```

**Fields:**
- `id` - Auto-increment message ID
- `recipient` - Target phone/group JID
- `text` - Message content
- `status` - Delivery status (pending, sent, failed)
- `whatsapp_message_id` - WhatsApp's message ID (if sent)
- `error` - Error message (if failed)
- `sent_at` - Timestamp when marked as sent
- `created_at` - Timestamp when message was created

---

## Message Format

### Phone Number Formats
Both formats are automatically normalized to `xxx@s.whatsapp.net`:
- Plain number: `628116191899`
- Full JID: `628116191899@s.whatsapp.net`

### Group JID Format
Must be in format: `120363xxxxx@g.us`

To find your group JID:
1. Open web dashboard
2. Look in group page URL or database
3. Format: `120363<groupId>-1@g.us`

---

## Postman Collection

Import `postman_collection.json` for pre-configured requests:
1. All three message endpoints
2. Variable management (api_key, csrf_token)
3. Session auth flow (optional)

**Quick start:**
1. Set `api_key` variable to your API key
2. Send "Send Message to Individual" request
3. Or use "Message Sending (API Key)" folder for all endpoints

---

## Rate Limiting

WhatsApp enforces rate limits (~80 messages per day per number). The API does not enforce additional limits but logs all attempts.

---

## Security Notes

- **API Key:** Keep `API_KEY` environment variable secret in production
- **Change Default Key:** Default key `dev-key-change-in-production` is for development only
- **HTTPS:** Use HTTPS in production (not http://)
- **Headers:** Validate `X-API-Key` header case-insensitively
- **Messages:** All messages are logged in the database for audit trails

---

## Troubleshooting

### "Unauthorized: Invalid API key"
- Verify `X-API-Key` header is included
- Confirm API key matches environment variable
- Check header is spelled correctly (case-sensitive)

### "Not connected"
- WhatsApp account must be connected (QR code scan required)
- Check dashboard status at `http://localhost:3000/`

### "Message too long"
- Maximum message size is 16KB
- Reduce message length and retry

### "Failed to send message"
- Check network connectivity
- Verify recipient phone number or group JID
- Check WhatsApp account is not rate-limited

---

## Examples

### Send Multi-line Message
```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key-change-in-production" \
  -d '{
    "recipient": "628116191899",
    "text": "Line 1\nLine 2\nLine 3"
  }'
```

### Send to Multiple Contacts
```bash
for number in 628116191899 628119876543 62811234567; do
  curl -X POST http://localhost:3000/api/messages/send \
    -H "Content-Type: application/json" \
    -H "X-API-Key: dev-key-change-in-production" \
    -d "{\"recipient\":\"$number\",\"text\":\"Broadcast message\"}"
done
```

### Integration with Node.js
```javascript
const fetch = require('node-fetch');

async function sendWhatsAppMessage(recipient, text) {
  const response = await fetch('http://localhost:3000/api/messages/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'dev-key-change-in-production',
    },
    body: JSON.stringify({ recipient, text }),
  });
  
  return await response.json();
}

sendWhatsAppMessage('628116191899', 'Hello from Node.js!').then(console.log);
```

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review server logs: `npm run dev 2>&1 | grep -i error`
3. Check database: `sqlite3 data/<phone>/account.db "SELECT * FROM outgoing_messages;"`
