-- Arbre généalogique familial — schéma
-- Les dates ne sont jamais un champ DATE : voir date_min / date_max / date_qualifier / date_text.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branch (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#C9A961',
  root_person_id TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person (
  id                TEXT PRIMARY KEY,
  given_names       TEXT NOT NULL DEFAULT '',
  family_name       TEXT NOT NULL DEFAULT '',
  birth_name        TEXT,
  sex               TEXT NOT NULL DEFAULT '?' CHECK (sex IN ('M', 'F', 'X', '?')),
  living            INTEGER NOT NULL DEFAULT 1,
  summary           TEXT,
  portrait_media_id TEXT,
  branch_id         TEXT REFERENCES branch(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS name_variant (
  id        TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'surnom' CHECK (type IN ('alias', 'orthographe', 'surnom'))
);

CREATE INDEX IF NOT EXISTS idx_name_variant_person ON name_variant(person_id);

CREATE TABLE IF NOT EXISTS place (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  lat             REAL,
  lon             REAL,
  parent_place_id TEXT REFERENCES place(id) ON DELETE SET NULL
);

-- Table nommée « couple » et non « union » : UNION est un mot réservé SQL.
CREATE TABLE IF NOT EXISTS couple (
  id                  TEXT PRIMARY KEY,
  partner_a           TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  partner_b           TEXT REFERENCES person(id) ON DELETE CASCADE,
  type                TEXT NOT NULL DEFAULT 'inconnu',
  status              TEXT NOT NULL DEFAULT 'en_cours',
  start_date_min      TEXT,
  start_date_max      TEXT,
  start_date_qualifier TEXT,
  start_date_text     TEXT,
  end_date_min        TEXT,
  end_date_max        TEXT,
  end_date_qualifier  TEXT,
  end_date_text       TEXT,
  place_id            TEXT REFERENCES place(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_couple_a ON couple(partner_a);
CREATE INDEX IF NOT EXISTS idx_couple_b ON couple(partner_b);

CREATE TABLE IF NOT EXISTS parent_child (
  id        TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  couple_id TEXT REFERENCES couple(id) ON DELETE SET NULL,
  nature    TEXT NOT NULL DEFAULT 'biologique',
  certainty TEXT NOT NULL DEFAULT 'probable',
  UNIQUE (parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_parent ON parent_child(parent_id);
CREATE INDEX IF NOT EXISTS idx_pc_child ON parent_child(child_id);
CREATE INDEX IF NOT EXISTS idx_pc_couple ON parent_child(couple_id);

CREATE TABLE IF NOT EXISTS event (
  id           TEXT PRIMARY KEY,
  person_id    TEXT REFERENCES person(id) ON DELETE CASCADE,
  couple_id    TEXT REFERENCES couple(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  date_min     TEXT,
  date_max     TEXT,
  date_qualifier TEXT,
  date_text    TEXT,
  place_id     TEXT REFERENCES place(id) ON DELETE SET NULL,
  description  TEXT,
  source_id    TEXT,
  confidence   TEXT NOT NULL DEFAULT 'probable',
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_person ON event(person_id);
CREATE INDEX IF NOT EXISTS idx_event_couple ON event(couple_id);

CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'document')),
  original_path TEXT NOT NULL,
  thumb_path    TEXT,
  sha256        TEXT,
  mime          TEXT,
  width         INTEGER,
  height        INTEGER,
  date_min      TEXT,
  date_max      TEXT,
  date_qualifier TEXT,
  date_text     TEXT,
  caption       TEXT,
  place_id      TEXT REFERENCES place(id) ON DELETE SET NULL,
  source_id     TEXT,
  document_type TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_person (
  media_id  TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'sujet',
  crop_x    REAL,
  crop_y    REAL,
  crop_size REAL,
  PRIMARY KEY (media_id, person_id)
);

CREATE TABLE IF NOT EXISTS media_event (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, event_id)
);

CREATE TABLE IF NOT EXISTS note (
  id          TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_target ON note(target_type, target_id);

CREATE TABLE IF NOT EXISTS source (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  reference   TEXT,
  reliability TEXT NOT NULL DEFAULT 'probable'
);
