-- Accounts are MyAnimeList users. MAL shares no email, so the MAL user id is the identity.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  mal_user_id INTEGER NOT NULL UNIQUE,
  mal_name TEXT NOT NULL,
  mal_picture TEXT,
  created_at INTEGER NOT NULL
);

-- Third-party tokens, encrypted with TOKEN_KEY before they are stored.
CREATE TABLE oauth_tokens (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- Browser sessions. Only a hash of the cookie value is kept.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One library per user: the same Db JSON the extension keeps. Merges are per episode (newest wins).
CREATE TABLE libraries (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  db TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Long-lived tokens for the extension. Only a hash is kept.
CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX device_tokens_user ON device_tokens(user_id);
