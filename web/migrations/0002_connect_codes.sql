-- One-time codes handed to the extension after you allow it on /extension/connect.
-- The extension trades one for a device token; only a hash is kept, and codes expire in minutes.
CREATE TABLE connect_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
