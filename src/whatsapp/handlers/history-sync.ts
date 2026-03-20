// History sync is not usable for per-member group activity tracking:
// - WhatsApp strips participant/sender info from group messages in history sync for linked devices
// - On-demand fetch (fetchMessageHistory) is not implemented in Baileys
// - This applies to both Baileys v6 and v7, Chrome and Desktop browser modes
//
// All group activity tracking relies on real-time events (messages.upsert, messages.reaction).
