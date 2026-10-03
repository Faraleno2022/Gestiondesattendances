'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(dataDir, 'attendance.db'));

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

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
`);

// Upgrade databases created by the first version of the app (which had a "grp" column only).
const peopleColumns = db.prepare('PRAGMA table_info(people)').all().map((c) => c.name);
if (peopleColumns.includes('grp')) db.exec('ALTER TABLE people RENAME COLUMN grp TO service');
if (!peopleColumns.includes('matricule')) db.exec(`ALTER TABLE people ADD COLUMN matricule TEXT NOT NULL DEFAULT ''`);
if (!peopleColumns.includes('job_title')) db.exec(`ALTER TABLE people ADD COLUMN job_title TEXT NOT NULL DEFAULT ''`);

// The matricule is optional, but when given it must identify a single person.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS people_matricule ON people(matricule) WHERE matricule <> ''`);

const PERSON_COLUMNS = `p.id, p.matricule, p.name, p.job_title AS jobTitle, p.service`;

const stmts = {
  listPeople: db.prepare(`SELECT ${PERSON_COLUMNS} FROM people p`),
  getPerson: db.prepare(`SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id = ?`),
  insertPerson: db.prepare(`INSERT INTO people (matricule, name, job_title, service) VALUES (?, ?, ?, ?)`),
  updatePerson: db.prepare(`UPDATE people SET matricule = ?, name = ?, job_title = ?, service = ? WHERE id = ?`),
  deletePerson: db.prepare(`DELETE FROM people WHERE id = ?`),

  attendanceBetween: db.prepare(`
    SELECT person_id AS personId, date, status, note
    FROM attendance
    WHERE date BETWEEN ? AND ?
  `),
  upsertAttendance: db.prepare(`
    INSERT INTO attendance (person_id, date, status, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status, note = excluded.note
  `),
  upsertStatus: db.prepare(`
    INSERT INTO attendance (person_id, date, status)
    SELECT id, ?, ? FROM people WHERE id = ?
    ON CONFLICT (person_id, date) DO UPDATE SET status = excluded.status
  `),
  // A record with neither a status nor a note carries no information.
  deleteIfEmpty: db.prepare(`
    DELETE FROM attendance WHERE person_id = ? AND date = ? AND status IS NULL AND note = ''
  `),

  stats: db.prepare(`
    SELECT ${PERSON_COLUMNS},
      COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present,
      COUNT(CASE WHEN a.status = 'absent'  THEN 1 END) AS absent,
      COUNT(CASE WHEN a.status = 'late'    THEN 1 END) AS late,
      COUNT(CASE WHEN a.status = 'excused' THEN 1 END) AS excused
    FROM people p
    LEFT JOIN attendance a ON a.person_id = p.id AND a.date BETWEEN ? AND ?
    GROUP BY p.id
  `),
};

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  listPeople: () => stmts.listPeople.all(),
  getPerson: (id) => stmts.getPerson.get(id),

  createPerson({ matricule, name, jobTitle, service }) {
    const { lastInsertRowid } = stmts.insertPerson.run(matricule, name, jobTitle, service);
    return stmts.getPerson.get(lastInsertRowid);
  },

  updatePerson(id, { matricule, name, jobTitle, service }) {
    const { changes } = stmts.updatePerson.run(matricule, name, jobTitle, service, id);
    return changes ? stmts.getPerson.get(id) : undefined;
  },

  deletePerson: (id) => stmts.deletePerson.run(id).changes > 0,

  attendanceBetween: (from, to) => stmts.attendanceBetween.all(from, to),

  // When `note` is undefined only the status changes and any existing note is kept.
  setAttendance(personId, date, status, note) {
    if (note === undefined) stmts.upsertStatus.run(date, status, personId);
    else stmts.upsertAttendance.run(personId, date, status, note);
    stmts.deleteIfEmpty.run(personId, date);
  },

  setAttendanceBulk(personIds, date, status) {
    transaction(() => {
      for (const id of personIds) stmts.upsertStatus.run(date, status, id);
    });
  },

  stats: (from, to) => stmts.stats.all(from, to),
};
