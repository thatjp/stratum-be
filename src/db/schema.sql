-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','support','admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens(user_id);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'book'
    CHECK (source_type IN ('book','article','course','video','other')),
  intent      TEXT NOT NULL DEFAULT 'study'
    CHECK (intent IN ('study','work','pleasure')),
  language    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collections_user_id_idx ON collections(user_id);

ALTER TABLE collections ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS ghost_synopsis TEXT;
-- Explicit learning goal for this collection (required on create; nullable for legacy rows)
ALTER TABLE collections ADD COLUMN IF NOT EXISTS goal             TEXT;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS goal_target_at   TIMESTAMPTZ;

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_mode   TEXT NOT NULL CHECK (input_mode IN ('photo','narration','mixed')),
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','processing','complete','failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_collection_id_idx ON sessions(collection_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

-- Captures
CREATE TABLE IF NOT EXISTS captures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('photo','narration')),
  sequence_index    INT NOT NULL DEFAULT 0,
  audio_url         TEXT,
  transcript        TEXT,
  image_url         TEXT,
  ocr_text          TEXT,
  duration_seconds  FLOAT,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','transcribing','extracting','done','failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS captures_session_id_idx ON captures(session_id);

-- Nuggets
CREATE TABLE IF NOT EXISTS nuggets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id    UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  source_text   TEXT,
  confidence    FLOAT NOT NULL DEFAULT 1.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nuggets_collection_id_idx ON nuggets(collection_id);
CREATE INDEX IF NOT EXISTS nuggets_user_id_idx ON nuggets(user_id);

-- Session artifact/nugget counts and getArtifactsForSession all walk
-- captures -> nuggets on this column.
CREATE INDEX IF NOT EXISTS nuggets_capture_id_idx ON nuggets(capture_id);

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nugget_id     UUID NOT NULL REFERENCES nuggets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
    CHECK (kind IN ('flashcard','quiz_question','summary_bullet','action_item','vocab_card')),
  front         TEXT NOT NULL,
  back          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','accepted','dismissed')),
  ease_factor   FLOAT NOT NULL DEFAULT 2.5,
  interval_days INT NOT NULL DEFAULT 1,
  due_at        TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_user_id_idx ON artifacts(user_id);
CREATE INDEX IF NOT EXISTS artifacts_due_at_idx ON artifacts(user_id, due_at)
  WHERE status = 'accepted';

-- Every nugget -> artifact join (retention graph, session artifacts, quiz
-- generation, duplicate-card checks) needs this; without it they seq scan.
CREATE INDEX IF NOT EXISTS artifacts_nugget_id_idx ON artifacts(nugget_id);

-- Admin moderation queue.
CREATE INDEX IF NOT EXISTS artifacts_pending_review_idx ON artifacts(created_at)
  WHERE status = 'pending_review';

-- Earlier versions grew ease_factor and interval_days without an upper bound,
-- which could push a card's schedule far enough out that it was effectively
-- unreviewable. Pull any such rows back into the range the SM-2 code now
-- enforces. Idempotent: a no-op once every row is in range.
UPDATE artifacts
SET ease_factor   = LEAST(ease_factor, 2.5),
    interval_days = LEAST(interval_days, 365),
    due_at        = LEAST(due_at, NOW() + INTERVAL '365 days')
WHERE ease_factor > 2.5
   OR interval_days > 365
   OR due_at > NOW() + INTERVAL '365 days';

-- Recall attempts
CREATE TABLE IF NOT EXISTS recall_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id      UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result           TEXT NOT NULL CHECK (result IN ('correct','incorrect','skipped')),
  response_time_ms INT,
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recall_attempts_artifact_id_idx ON recall_attempts(artifact_id);

-- Backs the review stats query and the streak window, both of which scan a
-- user's attempts by time.
CREATE INDEX IF NOT EXISTS recall_attempts_user_attempted_idx
  ON recall_attempts(user_id, attempted_at DESC);

-- Device tokens (push notifications)
CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT 'ios',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Artifacts: add quiz-related columns (idempotent)
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'session'
  CHECK (source IN ('session','quiz'));
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS quiz_session_id UUID;

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id       UUID REFERENCES collections(id) ON DELETE SET NULL,
  scope               TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global','collection','nugget')),
  socratic_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  title               TEXT,
  synopsis            TEXT,
  synopsis_updated_at TIMESTAMPTZ,
  message_count       INT NOT NULL DEFAULT 0,
  quiz_state          JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_collection_id_idx ON conversations(collection_id);

-- The conversation list filters on archived_at and paginates on updated_at, so
-- a partial index covering both serves the whole query.
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations(user_id, updated_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ghost_synopsis TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_titled    BOOLEAN NOT NULL DEFAULT FALSE;

-- Migrate existing conversations: drop mode column if it exists, add new columns
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS socratic_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS quiz_state JSONB;
DO $$ BEGIN
  ALTER TABLE conversations DROP COLUMN IF EXISTS mode;
EXCEPTION WHEN others THEN null;
END $$;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  token_count     INT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);

-- Messages are always read newest-first within a conversation and paginated on
-- created_at, so the composite serves both the filter and the ordering.
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages(conversation_id, created_at DESC);

-- conversations.message_count is maintained by trigger rather than recomputed
-- with COUNT(*) on every insert, which made each write O(messages in thread).
-- Statement-level with transition tables so bulk deletes (synopsis compression
-- drops hundreds of rows at once) cost one UPDATE instead of one per row.
CREATE OR REPLACE FUNCTION conversations_sync_message_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations c
    SET message_count = c.message_count + d.n,
        updated_at    = NOW()
    FROM (SELECT conversation_id, COUNT(*)::int AS n FROM new_rows GROUP BY conversation_id) d
    WHERE c.id = d.conversation_id;
  ELSE
    -- Deletions come from synopsis compression, which shouldn't reorder the
    -- conversation list, so updated_at is deliberately left alone here.
    UPDATE conversations c
    SET message_count = GREATEST(c.message_count - d.n, 0)
    FROM (SELECT conversation_id, COUNT(*)::int AS n FROM old_rows GROUP BY conversation_id) d
    WHERE c.id = d.conversation_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_count_insert ON messages;
CREATE TRIGGER messages_count_insert
  AFTER INSERT ON messages
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION conversations_sync_message_count();

DROP TRIGGER IF EXISTS messages_count_delete ON messages;
CREATE TRIGGER messages_count_delete
  AFTER DELETE ON messages
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION conversations_sync_message_count();

-- Reconcile any drift left by the previous COUNT(*) approach before the trigger
-- took over. Idempotent, and a no-op once counts agree.
UPDATE conversations c
SET message_count = m.n
FROM (
  SELECT c2.id, COUNT(msg.id)::int AS n
  FROM conversations c2
  LEFT JOIN messages msg ON msg.conversation_id = c2.id
  GROUP BY c2.id
) m
WHERE c.id = m.id AND c.message_count <> m.n;

-- Quiz sessions
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id        UUID REFERENCES collections(id) ON DELETE SET NULL,
  mode                 TEXT NOT NULL DEFAULT 'inline'
    CHECK (mode IN ('inline','final')),
  question_count       INT NOT NULL DEFAULT 0,
  score                INT NOT NULL DEFAULT 0,
  max_score            INT NOT NULL DEFAULT 0,
  performance_overview TEXT,
  weak_nugget_ids      UUID[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quiz_sessions_user_id_idx ON quiz_sessions(user_id);
CREATE INDEX IF NOT EXISTS quiz_sessions_user_created_idx ON quiz_sessions(user_id, created_at DESC);

-- Quiz questions
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  nugget_id       UUID REFERENCES nuggets(id) ON DELETE SET NULL,
  artifact_id     UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  user_answer     TEXT,
  is_correct      BOOLEAN,
  feedback        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quiz_questions_quiz_session_id_idx ON quiz_questions(quiz_session_id);

-- Token usage log — one row per Claude API call for cost tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  operation       TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT  NOT NULL DEFAULT 0,
  output_tokens   INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS token_usage_user_id_idx     ON token_usage(user_id);
CREATE INDEX IF NOT EXISTS token_usage_created_at_idx  ON token_usage(user_id, created_at);

-- The admin usage endpoints aggregate across all users filtered only by time,
-- which the user-leading index above cannot serve.
CREATE INDEX IF NOT EXISTS token_usage_created_at_only_idx ON token_usage(created_at);

-- Nugget links (Zettelkasten-style cross-references between atomic notes).
-- Undirected: nugget_a_id/nugget_b_id are ordered LEAST/GREATEST at write time
-- so a pair is only ever stored once, regardless of which side initiated it.
CREATE TABLE IF NOT EXISTS nugget_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nugget_a_id  UUID NOT NULL REFERENCES nuggets(id) ON DELETE CASCADE,
  nugget_b_id  UUID NOT NULL REFERENCES nuggets(id) ON DELETE CASCADE,
  note         TEXT,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_suggested')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nugget_links_no_self_link CHECK (nugget_a_id <> nugget_b_id),
  CONSTRAINT nugget_links_ordered CHECK (nugget_a_id < nugget_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS nugget_links_pair_idx ON nugget_links(nugget_a_id, nugget_b_id);
CREATE INDEX IF NOT EXISTS nugget_links_a_idx ON nugget_links(nugget_a_id);
CREATE INDEX IF NOT EXISTS nugget_links_b_idx ON nugget_links(nugget_b_id);
CREATE INDEX IF NOT EXISTS nugget_links_user_id_idx ON nugget_links(user_id);
