-- =====================================================================
-- 001 · SCHÉMA INITIAL
-- Département de Communication — Université de Bouaké
-- PostgreSQL (compatible PostgreSQL embarqué PGlite)
-- =====================================================================

-- ---------- Rôles & permissions ----------
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Structure académique ----------
CREATE TABLE IF NOT EXISTS levels (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  source      TEXT NOT NULL DEFAULT 'administration',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcours (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  parent_id   INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  source      TEXT NOT NULL DEFAULT 'administration',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcours_levels (
  parcours_id INTEGER NOT NULL REFERENCES parcours(id) ON DELETE CASCADE,
  level_id    INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  PRIMARY KEY (parcours_id, level_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  level_id      INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id   INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Comptes ----------
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  phone             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  email             TEXT NOT NULL DEFAULT '',
  matricule         TEXT NOT NULL DEFAULT '',
  role_id           INTEGER NOT NULL REFERENCES roles(id),
  level_id          INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id       INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  group_name        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','suspended','rejected')),
  note              TEXT NOT NULL DEFAULT '',
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  must_change_pw    BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at     TIMESTAMPTZ,
  approved_by       INTEGER,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_level ON users(level_id);

CREATE TABLE IF NOT EXISTS user_scopes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('level','parcours','group')),
  scope_id   INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          SERIAL PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         SERIAL PRIMARY KEY,
  phone      TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  success    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Publications ----------
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#1f4e79',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publications (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  priority     TEXT NOT NULL DEFAULT 'normale'
               CHECK (priority IN ('normale','haute','urgente')),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','scheduled','published','archived')),
  publish_at   TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  updated_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_publications_author ON publications(created_by);

CREATE TABLE IF NOT EXISTS publication_audiences (
  id             SERIAL PRIMARY KEY,
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('public','all','role','level','parcours','group')),
  target_text    TEXT NOT NULL DEFAULT '',
  target_id      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pubaud_pub ON publication_audiences(publication_id);

CREATE TABLE IF NOT EXISTS publication_views (
  id              SERIAL PRIMARY KEY,
  publication_id  INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  view_count      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (publication_id, user_id)
);

-- ---------- Fichiers & documents ----------
CREATE TABLE IF NOT EXISTS files (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage     TEXT NOT NULL DEFAULT 'local' CHECK (storage IN ('local','db','supabase')),
  storage_key TEXT NOT NULL DEFAULT '',
  data        BYTEA,
  sha256      TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'Document',
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  level_id    INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  visibility  TEXT NOT NULL DEFAULT 'all'
              CHECK (visibility IN ('public','all','etudiant','enseignant','personnel','level','parcours')),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publication_files (
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (publication_id, file_id)
);

-- ---------- Emplois du temps & événements ----------
CREATE TABLE IF NOT EXISTS timetables (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  level_id      INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id   INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  group_name    TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '',
  semester      TEXT NOT NULL DEFAULT '',
  date_start    DATE,
  date_end      DATE,
  note          TEXT NOT NULL DEFAULT '',
  file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'autre',
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  location    TEXT NOT NULL DEFAULT '',
  level_id    INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('public','all','etudiant','enseignant','personnel')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Résultats ----------
CREATE TABLE IF NOT EXISTS results (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  level_id    INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  parcours_id INTEGER REFERENCES parcours(id) ON DELETE SET NULL,
  session     TEXT NOT NULL DEFAULT '',
  period      TEXT NOT NULL DEFAULT '',
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  published_by INTEGER REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS result_views (
  id              SERIAL PRIMARY KEY,
  result_id       INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (result_id, user_id)
);

CREATE TABLE IF NOT EXISTS result_history (
  id         SERIAL PRIMARY KEY,
  result_id  INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  details    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Demandes administratives ----------
CREATE TABLE IF NOT EXISTS requests (
  id          SERIAL PRIMARY KEY,
  reference   TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Renseignement',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'recue'
              CHECK (status IN ('recue','en_cours','traitee','rejetee')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  response    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS request_events (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Messagerie interne ----------
CREATE TABLE IF NOT EXISTS threads (
  id         SERIAL PRIMARY KEY,
  subject    TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id    INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Vie scientifique ----------
CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'autre',
  date_start  DATE,
  date_end    DATE,
  location    TEXT NOT NULL DEFAULT '',
  organizer   TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  source      TEXT NOT NULL DEFAULT 'administration',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publication_id INTEGER REFERENCES publications(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'publication',
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  read_at        TIMESTAMPTZ,
  opened_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_pub_user
  ON notifications(user_id, publication_id)
  WHERE publication_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Paramètres, audit ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   INTEGER,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
