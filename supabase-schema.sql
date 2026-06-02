-- Reading Log — Supabase schema (no-auth version)
-- This is the minimal schema we use while skipping parent login.
-- Paste this whole file into the Supabase SQL editor and hit Run.
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and INSERT ... ON CONFLICT.
--
-- When we add real parent auth later we'll layer RLS policies on top
-- (the auth-aware version lives in git history).

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS households (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  weekly_goal_minutes int  NOT NULL DEFAULT 200,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  slug          text NOT NULL,                     -- stable id used by the app: 'olivia', 'abigail'
  name          text NOT NULL,
  age           int,
  mascot        text NOT NULL DEFAULT 'penguin',   -- penguin | axolotl | fox | dragon | otter
  level         int  NOT NULL DEFAULT 1,
  xp            int  NOT NULL DEFAULT 0,
  xp_max        int  NOT NULL DEFAULT 200,
  streak        int  NOT NULL DEFAULT 0,
  shields       int  NOT NULL DEFAULT 0,
  last_log_date date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id, slug)
);

CREATE TABLE IF NOT EXISTS books (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title            text NOT NULL,
  author           text,
  series           text,
  series_number    int,
  pages            int,
  google_books_id  text,
  cover_url        text,
  genres           text[],
  ar_level         numeric(3,1),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kid_books (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id       uuid NOT NULL REFERENCES kids(id)  ON DELETE CASCADE,
  book_id      uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('reading', 'finished', 'want')),
  current_page int,
  started_at   timestamptz,
  finished_at  timestamptz,
  rating       int CHECK (rating BETWEEN 1 AND 5),
  notes        text,
  feeling      text,
  UNIQUE(kid_id, book_id)
);

CREATE TABLE IF NOT EXISTS log_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id      uuid NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  book_id     uuid REFERENCES books(id) ON DELETE SET NULL,
  minutes     int  NOT NULL DEFAULT 0,
  pages       int  NOT NULL DEFAULT 0,
  xp_earned   int  NOT NULL DEFAULT 0,
  shield_used boolean NOT NULL DEFAULT false,
  log_date    date NOT NULL DEFAULT current_date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS earned_badges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id     uuid NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  badge_key  text NOT NULL,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kid_id, badge_key)
);

CREATE TABLE IF NOT EXISTS weekly_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start     date NOT NULL,
  target_minutes int  NOT NULL,
  hit            boolean NOT NULL DEFAULT false,
  UNIQUE(household_id, week_start)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kids_household       ON kids(household_id);
CREATE INDEX IF NOT EXISTS idx_books_household      ON books(household_id);
CREATE INDEX IF NOT EXISTS idx_kid_books_kid        ON kid_books(kid_id);
CREATE INDEX IF NOT EXISTS idx_kid_books_status     ON kid_books(kid_id, status);
CREATE INDEX IF NOT EXISTS idx_log_entries_kid_date ON log_entries(kid_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_earned_badges_kid    ON earned_badges(kid_id);

-- ============================================================
-- Seed the default household and the two kids
-- The app expects this exact household UUID.
-- ============================================================
INSERT INTO households (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Chris''s family')
ON CONFLICT (id) DO NOTHING;

INSERT INTO kids (household_id, slug, name, age, mascot, level, xp, xp_max, streak, shields) VALUES
  ('00000000-0000-0000-0000-000000000001', 'olivia',  'Olivia',  9, 'penguin', 7, 340, 500, 12, 2),
  ('00000000-0000-0000-0000-000000000001', 'abigail', 'Abigail', 7, 'axolotl', 4, 180, 350, 5,  1)
ON CONFLICT (household_id, slug) DO NOTHING;
