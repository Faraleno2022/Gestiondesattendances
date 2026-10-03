"""SQLite storage for people and attendance records."""
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_FILE = Path(os.environ.get("DB_FILE") or BASE_DIR / "data" / "attendance.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY,
  matricule  TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  job_title  TEXT NOT NULL DEFAULT '',
  service    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  status    TEXT CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, date)
);

CREATE INDEX IF NOT EXISTS attendance_date ON attendance(date);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

PERSON_COLUMNS = 'p.id, p.matricule, p.name, p.job_title AS jobTitle, p.service'


class MatriculeTaken(Exception):
    """The matricule is already assigned to another person."""


def connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)

        # Upgrade databases created by the first version of the app (which had a "grp" column only).
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(people)")}
        if "grp" in columns:
            conn.execute("ALTER TABLE people RENAME COLUMN grp TO service")
        if "matricule" not in columns:
            conn.execute("ALTER TABLE people ADD COLUMN matricule TEXT NOT NULL DEFAULT ''")
        if "job_title" not in columns:
            conn.execute("ALTER TABLE people ADD COLUMN job_title TEXT NOT NULL DEFAULT ''")

        # The matricule is optional, but when given it must identify a single person.
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS people_matricule ON people(matricule) WHERE matricule <> ''")
    conn.close()


def _rows(cursor):
    return [dict(row) for row in cursor]


def _person(conn, person_id):
    row = conn.execute(f"SELECT {PERSON_COLUMNS} FROM people p WHERE p.id = ?", (person_id,)).fetchone()
    return dict(row) if row else None


def _unique_matricule(fn):
    try:
        return fn()
    except sqlite3.IntegrityError as err:
        if "people.matricule" in str(err):
            raise MatriculeTaken() from err
        raise


def list_people(conn):
    return _rows(conn.execute(f"SELECT {PERSON_COLUMNS} FROM people p"))


def get_person(conn, person_id):
    return _person(conn, person_id)


def create_person(conn, person):
    def insert():
        with conn:
            return conn.execute(
                "INSERT INTO people (matricule, name, job_title, service) VALUES (?, ?, ?, ?)",
                (person["matricule"], person["name"], person["jobTitle"], person["service"]),
            ).lastrowid

    return _person(conn, _unique_matricule(insert))


def update_person(conn, person_id, person):
    def update():
        with conn:
            return conn.execute(
                "UPDATE people SET matricule = ?, name = ?, job_title = ?, service = ? WHERE id = ?",
                (person["matricule"], person["name"], person["jobTitle"], person["service"], person_id),
            ).rowcount

    return _person(conn, person_id) if _unique_matricule(update) else None


def delete_person(conn, person_id):
    with conn:
        return conn.execute("DELETE FROM people WHERE id = ?", (person_id,)).rowcount > 0


def attendance_between(conn, date_from, date_to):
    return _rows(conn.execute(
        "SELECT person_id AS personId, date, status, note FROM attendance WHERE date BETWEEN ? AND ?",
        (date_from, date_to),
    ))


_UPSERT_STATUS = """
  INSERT INTO attendance (person_id, date, status)
  SELECT id, ?, ? FROM people WHERE id = ?
  ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status
"""


def set_attendance(conn, person_id, date, status, note=None):
    """When `note` is None only the status changes and any existing note is kept."""
    with conn:
        if note is None:
            conn.execute(_UPSERT_STATUS, (date, status, person_id))
        else:
            conn.execute(
                """INSERT INTO attendance (person_id, date, status, note) VALUES (?, ?, ?, ?)
                   ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status, note = excluded.note""",
                (person_id, date, status, note),
            )
        # A record with neither a status nor a note carries no information.
        conn.execute(
            "DELETE FROM attendance WHERE person_id = ? AND date = ? AND status IS NULL AND note = ''",
            (person_id, date),
        )


def set_attendance_bulk(conn, person_ids, date, status):
    with conn:
        conn.executemany(_UPSERT_STATUS, [(date, status, person_id) for person_id in person_ids])


def get_user(conn, user_id):
    row = conn.execute("SELECT id, username, password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_user_by_name(conn, username):
    row = conn.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    return dict(row) if row else None


def list_users(conn):
    return _rows(conn.execute("SELECT username, created_at FROM users ORDER BY username"))


def create_user(conn, username, password_hash):
    with conn:
        conn.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, password_hash))


def set_password(conn, username, password_hash):
    with conn:
        return conn.execute("UPDATE users SET password_hash = ? WHERE username = ?", (password_hash, username)).rowcount > 0


def delete_user(conn, username):
    with conn:
        return conn.execute("DELETE FROM users WHERE username = ?", (username,)).rowcount > 0


def stats(conn, date_from, date_to):
    return _rows(conn.execute(
        f"""SELECT {PERSON_COLUMNS},
              COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present,
              COUNT(CASE WHEN a.status = 'absent'  THEN 1 END) AS absent,
              COUNT(CASE WHEN a.status = 'late'    THEN 1 END) AS late,
              COUNT(CASE WHEN a.status = 'excused' THEN 1 END) AS excused
            FROM people p
            LEFT JOIN attendance a ON a.person_id = p.id AND a.date BETWEEN ? AND ?
            GROUP BY p.id""",
        (date_from, date_to),
    ))
