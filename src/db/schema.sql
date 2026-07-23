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
