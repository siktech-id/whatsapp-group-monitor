# WhatsApp Group Monitor - Message Sending API

## Overview
Phase 1 implementation provides REST API endpoints to send WhatsApp messages to individuals and groups. Two authentication methods are supported:
1. **API Key** (recommended for developers)
2. **Session-based** (for web dashboard users)

---

## Authentication

### API Key Authentication (Recommended for Developers)
Each client platform gets its **own** API key. Pass it in the `X-API-Key` header:

```bash
curl -H "X-API-Key: bwa_xxxxxxxx..." http://localhost:3000/api/groups
```

**Getting a key:** an admin logs in to the dashboard, opens **⋮ → API Keys** (`/api-keys`), enters a client name, picks scopes and clicks **Create**. The full key is shown **once**. Only a SHA-256 hash is stored, so a lost key can't be recovered. Revoke it and create a new one instead.

**Revoking a key:** click **Revoke** on the API Keys page. Requests using that key fail with `401` within seconds.

**Scopes:** each key grants a subset of these:

| Scope | Endpoints |
|-------|-----------|
| `read` | `GET /api/groups`, `GET /api/groups/:jid`, `GET /api/users/:jid`, `GET /api/conversations`, `GET /api/conversations/:id/messages`, `GET /api/messages/sent` |
| `send` | `POST /api/messages/send`, `POST /api/groups/:jid/send` |
| `settings` | `GET /api/settings`, `POST /api/settings` |

A request to an endpoint outside the key's scopes returns `403`. `/api/status` and the backup endpoints accept only an admin session, never an API key.

**Per-client data:** each outgoing message records which client sent it. When called with an API key, `GET /api/messages/sent` returns only that client's own messages. Groups, users and conversations are shared, because they come from the same WhatsApp account.

### Session Authentication (For Web Dashboard)
1. Login via web dashboard at `http://localhost:3000/login`
2. Use session cookie + CSRF token for API calls
3. See Postman collection's "Message Sending (Session Auth)" folder

---

## Endpoints

### 1. Send Message to Individual

**Endpoint:** `POST /api/messages/send`

**Authentication:** API Key (scope `send`) OR Session + CSRF

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
  -H "X-API-Key: bwa_your-client-key" \
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

**Authentication:** API Key (scope `send`) OR Session + CSRF

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
  -H "X-API-Key: bwa_your-client-key" \
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

**Authentication:** API Key (scope `read`) OR Session

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
  -H "X-API-Key: bwa_your-client-key"

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
| 403 | Forbidden | API key lacks the required scope, or invalid CSRF token (session auth) |
| 429 | Too Many Requests | Rate limit or send limit reached (see Rate Limiting) |
| 503 | Service Unavailable | WhatsApp not connected |

### Error Responses

**Invalid API Key:**
```json
{
  "error": "Unauthorized: Invalid or missing API key"
}
```

**Missing Scope:**
```json
{
  "error": "Forbidden: missing scope 'send'"
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
# API keys are managed in the dashboard (/api-keys), not via environment variables.

PORT=3000
HOST=0.0.0.0
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
DATA_DIR=./data
LOG_LEVEL=info

# Days to keep API request logs (default 30). Older rows are deleted daily.
API_LOG_RETENTION_DAYS=30

# Proxy hops in front of the app, so logs see the real client IP (default 1 = Railway's edge).
# Set to 0 when running without a proxy.
TRUST_PROXY_HOPS=1
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
1. Set `api_key` variable to a key created on the `/api-keys` page
2. Send "Send Message to Individual" request
3. Or use "Message Sending (API Key)" folder for all endpoints

---

## Rate Limiting

Each API key has two limits, both counted over a sliding 60-second window and editable per key on the `/api-keys` page:

| Limit | Default | Counts |
|-------|---------|--------|
| Requests / min | 60 | Every request made with the key |
| Sends / min | 10 | `POST /api/messages/send` and `POST /api/groups/:jid/send` |

The send limit protects the WhatsApp number: sending too fast can get it banned by WhatsApp. Changes to limits apply within seconds; the key itself doesn't change.

Every API-key response carries these headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 42          # seconds until the oldest request leaves the window
```

Send endpoints also return `X-SendLimit-Limit` and `X-SendLimit-Remaining`.

Over a limit, the API returns `429` with a `Retry-After` header (seconds):

```json
{ "error": "Rate limit exceeded: 10 sends per minute", "limit": 10, "retryAfterSec": 23 }
```

Clients should wait `Retry-After` seconds before retrying. Rejected requests don't count toward the limit.

Invalid keys are throttled too: after 20 failed key attempts in a minute from one IP, further invalid attempts get `429`. Valid keys from that IP keep working.

Admin dashboard (session) requests are not rate limited. Limits are kept in memory, so they reset when the service restarts.

---

## Request Logs

Every request that sends an `X-API-Key` header is logged, whether it succeeds, fails, is rate limited or uses an invalid key. Admins can see them at **⋮ → API Keys → View all request logs** (`/api-keys/logs`), or **Logs** on a single client's row.

The logs page shows, for any client, time range (1h, 24h, 7d, 30d), status, method, endpoint or path search:
- Totals: request count, success rate, 4xx, 429 and 5xx counts, average and p95 latency
- Requests over time (successful vs. errors)
- Top endpoints and per-client breakdown (click a row to filter)
- Each request: time, client, method, path, status, duration, IP; click for user agent, request body and error message

Each row stores: client, the key's first 8 characters (never the full key), method, endpoint, full path with query, status, duration, IP, user agent, request body (up to 4KB) and error message. Request bodies include message text and phone numbers, so treat the logs page as sensitive.

Logs are kept for 30 days (`API_LOG_RETENTION_DAYS`).

---

## Security Notes

- **API Keys:** Use one key per client platform, and give each the fewest scopes it needs. Revoke a key as soon as it's no longer used or may have leaked.
- **Storage:** Only SHA-256 hashes of keys are stored, in `shared.api_clients`.
- **HTTPS:** Use HTTPS in production (not http://)
- **Headers:** Validate `X-API-Key` header case-insensitively
- **Messages:** All messages are logged in the database for audit trails

---

## Troubleshooting

### "Unauthorized: Invalid API key"
- Verify `X-API-Key` header is included
- Confirm the key was copied in full and hasn't been revoked (check the `/api-keys` page)
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
  -H "X-API-Key: bwa_your-client-key" \
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
    -H "X-API-Key: bwa_your-client-key" \
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
      'X-API-Key': 'bwa_your-client-key',
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
