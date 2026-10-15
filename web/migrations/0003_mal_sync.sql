-- AniList id -> MyAnimeList id, looked up once (mal_id NULL: AniList knows no MAL entry).
CREATE TABLE mal_ids (
  anilist_id INTEGER PRIMARY KEY,
  mal_id INTEGER
);

-- What Kumostamp last sent to each user's MAL list, so the same episode isn't sent twice.
CREATE TABLE mal_pushes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mal_id INTEGER NOT NULL,
  progress INTEGER NOT NULL,
  title TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mal_id)
);
