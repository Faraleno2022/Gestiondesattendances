"""Storage for people, attendance records and login accounts.

Uses MySQL when MYSQL_DB is set (in the environment or in the project's .env file), SQLite otherwise.

  python db.py check    tests every database operation on the configured database, then cleans up
"""
import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_env_file():
    """Reads KEY=VALUE lines from .env, so the web app and console commands share one configuration."""
    path = BASE_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file()

USE_MYSQL = bool(os.environ.get("MYSQL_DB"))
DB_FILE = Path(os.environ.get("DB_FILE") or BASE_DIR / "data" / "attendance.db")
DATA_DIR = DB_FILE.parent  # also holds the session signing key

if USE_MYSQL:
    import pymysql
    from pymysql.constants import CLIENT

    IntegrityError = pymysql.err.IntegrityError
else:
    IntegrityError = sqlite3.IntegrityError

SQLITE_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS people (
         id         INTEGER PRIMARY KEY,
         matricule  TEXT NOT NULL DEFAULT '',
         name       TEXT NOT NULL,
         job_title  TEXT NOT NULL DEFAULT '',
         service    TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )""",
    """CREATE TABLE IF NOT EXISTS attendance (
         person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
         date      TEXT NOT NULL,
         status    TEXT CHECK (status IN ('present', 'absent', 'late', 'excused')),
         note      TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (person_id, date)
       )""",
    "CREATE INDEX IF NOT EXISTS attendance_date ON attendance(date)",
    """CREATE TABLE IF NOT EXISTS users (
         id            INTEGER PRIMARY KEY,
         username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
         password_hash TEXT NOT NULL,
         created_at    TEXT NOT NULL DEFAULT (datetime('now'))
       )""",
]

_MYSQL_TABLE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
MYSQL_SCHEMA = [
    # matricule_key is NULL for an empty matricule, so the unique index only applies to real matricules.
    f"""CREATE TABLE IF NOT EXISTS people (
          id            INT AUTO_INCREMENT PRIMARY KEY,
          matricule     VARCHAR(30)  NOT NULL DEFAULT '',
          name          VARCHAR(100) NOT NULL,
          job_title     VARCHAR(80)  NOT NULL DEFAULT '',
          service       VARCHAR(80)  NOT NULL DEFAULT '',
          created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          matricule_key VARCHAR(30) AS (NULLIF(matricule, '')) STORED,
          UNIQUE KEY people_matricule (matricule_key)
        ) {_MYSQL_TABLE}""",
    f"""CREATE TABLE IF NOT EXISTS attendance (
          person_id INT          NOT NULL,
          date      CHAR(10)     NOT NULL,
          status    VARCHAR(10)  NULL,
          note      VARCHAR(200) NOT NULL DEFAULT '',
          PRIMARY KEY (person_id, date),
          KEY attendance_date (date),
          CONSTRAINT attendance_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
          CONSTRAINT attendance_status CHECK (status IN ('present', 'absent', 'late', 'excused'))
        ) {_MYSQL_TABLE}""",
    f"""CREATE TABLE IF NOT EXISTS users (
          id            INT AUTO_INCREMENT PRIMARY KEY,
          username      VARCHAR(50)  NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY users_username (username)
        ) {_MYSQL_TABLE}""",
]

# The only statements whose syntax differs between the two databases.
if USE_MYSQL:
    UPSERT_RECORD = """INSERT INTO attendance (person_id, date, status, note) VALUES (?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note)"""
    UPSERT_STATUS = """INSERT INTO attendance (person_id, date, status)
                       SELECT id, ?, ? FROM people WHERE id = ?
                       ON DUPLICATE KEY UPDATE status = VALUES(status)"""
else:
    UPSERT_RECORD = """INSERT INTO attendance (person_id, date, status, note) VALUES (?, ?, ?, ?)
                       ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status, note = excluded.note"""
    UPSERT_STATUS = """INSERT INTO attendance (person_id, date, status)
                       SELECT id, ?, ? FROM people WHERE id = ?
                       ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status"""

PERSON_COLUMNS = "p.id, p.matricule, p.name, p.job_title AS jobTitle, p.service"


class MatriculeTaken(Exception):
    """The matricule is already assigned to another person."""


class Connection:
    """Same small API for SQLite and MySQL; SQL is written with "?" placeholders."""

    def __init__(self):
        if USE_MYSQL:
            self.raw = pymysql.connect(
                host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
                port=int(os.environ.get("MYSQL_PORT", "3306")),
                user=os.environ.get("MYSQL_USER", ""),
                password=os.environ.get("MYSQL_PASSWORD", ""),
                database=os.environ["MYSQL_DB"],
                charset="utf8mb4",  # accents and Chinese characters
                cursorclass=pymysql.cursors.DictCursor,
                client_flag=CLIENT.FOUND_ROWS,  # UPDATE counts matched rows, even when nothing changed
            )
        else:
            self.raw = sqlite3.connect(DB_FILE)
            self.raw.row_factory = sqlite3.Row
            self.raw.execute("PRAGMA foreign_keys = ON")

    def execute(self, sql, params=()):
        cursor = self.raw.cursor()
        cursor.execute(sql.replace("?", "%s") if USE_MYSQL else sql, params)
        return cursor

    def executemany(self, sql, rows):
        cursor = self.raw.cursor()
        cursor.executemany(sql.replace("?", "%s") if USE_MYSQL else sql, rows)
        return cursor

    def one(self, sql, params=()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row else None

    def all(self, sql, params=()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]

    @contextmanager
    def transaction(self):
        try:
            yield self
            self.raw.commit()
        except BaseException:
            self.raw.rollback()
            raise

    def close(self):
        self.raw.close()


def connect():
    return Connection()


def init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        with conn.transaction():
            if USE_MYSQL:
                for statement in MYSQL_SCHEMA:
                    conn.execute(statement)
            else:
                conn.execute("PRAGMA journal_mode = WAL")
                for statement in SQLITE_SCHEMA:
                    conn.execute(statement)
                _upgrade_sqlite(conn)
    finally:
        conn.close()


def _upgrade_sqlite(conn):
    # Databases created by the first version of the app had a "grp" column only.
    columns = {row["name"] for row in conn.all("PRAGMA table_info(people)")}
    if "grp" in columns:
        conn.execute("ALTER TABLE people RENAME COLUMN grp TO service")
    if "matricule" not in columns:
        conn.execute("ALTER TABLE people ADD COLUMN matricule TEXT NOT NULL DEFAULT ''")
    if "job_title" not in columns:
        conn.execute("ALTER TABLE people ADD COLUMN job_title TEXT NOT NULL DEFAULT ''")
    # The matricule is optional, but when given it must identify a single person.
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS people_matricule ON people(matricule) WHERE matricule <> ''")


def _unique_matricule(fn):
    try:
        return fn()
    except IntegrityError as err:
        if "matricule" in str(err):
            raise MatriculeTaken() from err
        raise


# --- People -----------------------------------------------------------------

def list_people(conn):
    return conn.all(f"SELECT {PERSON_COLUMNS} FROM people p")


def get_person(conn, person_id):
    return conn.one(f"SELECT {PERSON_COLUMNS} FROM people p WHERE p.id = ?", (person_id,))


def create_person(conn, person):
    def insert():
        with conn.transaction():
            return conn.execute(
                "INSERT INTO people (matricule, name, job_title, service) VALUES (?, ?, ?, ?)",
                (person["matricule"], person["name"], person["jobTitle"], person["service"]),
            ).lastrowid

    return get_person(conn, _unique_matricule(insert))


def update_person(conn, person_id, person):
    def update():
        with conn.transaction():
            return conn.execute(
                "UPDATE people SET matricule = ?, name = ?, job_title = ?, service = ? WHERE id = ?",
                (person["matricule"], person["name"], person["jobTitle"], person["service"], person_id),
            ).rowcount

    return get_person(conn, person_id) if _unique_matricule(update) else None


def delete_person(conn, person_id):
    with conn.transaction():
        return conn.execute("DELETE FROM people WHERE id = ?", (person_id,)).rowcount > 0


# --- Attendance -------------------------------------------------------------

def attendance_between(conn, date_from, date_to):
    return conn.all(
        "SELECT person_id AS personId, date, status, note FROM attendance WHERE date BETWEEN ? AND ?",
        (date_from, date_to),
    )


def set_attendance(conn, person_id, date, status, note=None):
    """When `note` is None only the status changes and any existing note is kept."""
    with conn.transaction():
        if note is None:
            conn.execute(UPSERT_STATUS, (date, status, person_id))
        else:
            conn.execute(UPSERT_RECORD, (person_id, date, status, note))
        # A record with neither a status nor a note carries no information.
        conn.execute(
            "DELETE FROM attendance WHERE person_id = ? AND date = ? AND status IS NULL AND note = ''",
            (person_id, date),
        )


def set_attendance_bulk(conn, person_ids, date, status):
    if not person_ids:
        return
    with conn.transaction():
        conn.executemany(UPSERT_STATUS, [(date, status, person_id) for person_id in person_ids])


def stats(conn, date_from, date_to):
    return conn.all(
        f"""SELECT {PERSON_COLUMNS},
              COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present,
              COUNT(CASE WHEN a.status = 'absent'  THEN 1 END) AS absent,
              COUNT(CASE WHEN a.status = 'late'    THEN 1 END) AS late,
              COUNT(CASE WHEN a.status = 'excused' THEN 1 END) AS excused
            FROM people p
            LEFT JOIN attendance a ON a.person_id = p.id AND a.date BETWEEN ? AND ?
            GROUP BY p.id, p.matricule, p.name, p.job_title, p.service""",
        (date_from, date_to),
    )


# --- Login accounts ---------------------------------------------------------

def get_user(conn, user_id):
    return conn.one("SELECT id, username, password_hash FROM users WHERE id = ?", (user_id,))


def get_user_by_name(conn, username):
    return conn.one("SELECT id, username, password_hash FROM users WHERE username = ?", (username,))


def list_users(conn):
    return conn.all("SELECT username, created_at FROM users ORDER BY username")


def create_user(conn, username, password_hash):
    with conn.transaction():
        conn.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, password_hash))


def set_password(conn, username, password_hash):
    with conn.transaction():
        return conn.execute("UPDATE users SET password_hash = ? WHERE username = ?", (password_hash, username)).rowcount > 0


def delete_user(conn, username):
    with conn.transaction():
        return conn.execute("DELETE FROM users WHERE username = ?", (username,)).rowcount > 0


# --- Self-test --------------------------------------------------------------

def check():
    """Runs every operation on the configured database with throw-away records, then removes them."""
    where = f"MySQL « {os.environ['MYSQL_DB']} » @ {os.environ.get('MYSQL_HOST', '127.0.0.1')}" if USE_MYSQL else f"SQLite {DB_FILE}"
    print(f"Base de données / Database : {where}")
    init()
    conn = connect()
    created = []
    try:
        def step(label, ok):
            print(f"  {'OK ' if ok else 'ÉCHEC'}  {label}")
            if not ok:
                raise SystemExit(1)

        a = create_person(conn, {"matricule": "__TEST_1__", "name": "Test 测试 é", "jobTitle": "", "service": "__TEST__"})
        created.append(a["id"])
        b = create_person(conn, {"matricule": "", "name": "Test 2", "jobTitle": "", "service": "__TEST__"})
        created.append(b["id"])
        c = create_person(conn, {"matricule": "", "name": "Test 3", "jobTitle": "", "service": "__TEST__"})
        created.append(c["id"])
        step("création de personnes, caractères chinois et accents", get_person(conn, a["id"])["name"] == "Test 测试 é")
        try:
            create_person(conn, {"matricule": "__TEST_1__", "name": "Doublon", "jobTitle": "", "service": "__TEST__"})
            step("matricule en double refusé", False)
        except MatriculeTaken:
            step("matricule en double refusé, matricules vides autorisés", True)
        step("modification sans changement", update_person(conn, b["id"], {"matricule": "", "name": "Test 2", "jobTitle": "", "service": "__TEST__"}) is not None)

        set_attendance(conn, a["id"], "1999-01-01", "late")
        set_attendance(conn, a["id"], "1999-01-01", "present")
        set_attendance_bulk(conn, [a["id"], b["id"], 999999999], "1999-01-02", "absent")
        records = attendance_between(conn, "1999-01-01", "1999-01-31")
        step("pointages et mise à jour", sorted((r["date"], r["status"]) for r in records if r["personId"] == a["id"])
             == [("1999-01-01", "present"), ("1999-01-02", "absent")])
        set_attendance(conn, a["id"], "1999-01-01", None)
        step("effacement d'un pointage", len(attendance_between(conn, "1999-01-01", "1999-01-01")) == 0)
        row = next(r for r in stats(conn, "1999-01-01", "1999-01-31") if r["id"] == a["id"])
        step("statistiques", (row["present"], row["absent"]) == (0, 1))

        create_user(conn, "__test_user__", "x")
        step("comptes de connexion (nom insensible à la casse)", get_user_by_name(conn, "__TEST_USER__") is not None)
        delete_user(conn, "__test_user__")

        delete_person(conn, a["id"])
        step("suppression en cascade des pointages", len(attendance_between(conn, "1999-01-01", "1999-01-31")) == 1)
        print("Tout fonctionne / All checks passed.")
    finally:
        for person_id in created:
            delete_person(conn, person_id)
        conn.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["check"]:
        check()
    else:
        print(__doc__)
