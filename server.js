'use strict';
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { buildXlsx, buildPdf, SpecError } = require('./export');

const PORT = Number(process.env.PORT) || 3000;
const STATUSES = new Set(['present', 'absent', 'late', 'excused']);

// The API answers with error *codes* only; the browser translates them into the user's language.
class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function parseText(value, maxLength) {
  return value == null ? '' : String(value).trim().slice(0, maxLength);
}

function parsePerson(body = {}) {
  const person = {
    matricule: parseText(body.matricule, 30),
    name: parseText(body.name, 100),
    jobTitle: parseText(body.jobTitle, 80),
    service: parseText(body.service, 80),
  };
  if (!person.name) throw new ApiError(400, 'NAME_REQUIRED');
  return person;
}

// Turns the database's duplicate-matricule error into a code the user can understand.
function withUniqueMatricule(fn) {
  try {
    return fn();
  } catch (err) {
    if (/UNIQUE constraint failed: people\.matricule/.test(err.message)) throw new ApiError(409, 'MATRICULE_TAKEN');
    throw err;
  }
}

function parseMonth(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ApiError(400, 'INVALID_MONTH');
  return s;
}

function parseDate(value) {
  const s = String(value ?? '');
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ApiError(400, 'INVALID_DATE');
  }
  return s;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, 'NOT_FOUND');
  return id;
}

function parseStatus(value, { allowNull = false } = {}) {
  if (value == null && allowNull) return null;
  if (!STATUSES.has(value)) throw new ApiError(400, 'INVALID_STATUS');
  return value;
}

const app = express();
app.use(express.json({ limit: '5mb' })); // exports carry a whole month of data
app.use(express.static(path.join(__dirname, 'public')));

// --- People ---------------------------------------------------------------

app.get('/api/people', (req, res) => {
  res.json(db.listPeople());
});

app.post('/api/people', (req, res) => {
  const person = parsePerson(req.body ?? {});
  res.status(201).json(withUniqueMatricule(() => db.createPerson(person)));
});

app.put('/api/people/:id', (req, res) => {
  const id = parseId(req.params.id);
  const changes = parsePerson(req.body ?? {});
  const person = withUniqueMatricule(() => db.updatePerson(id, changes));
  if (!person) throw new ApiError(404, 'NOT_FOUND');
  res.json(person);
});

app.delete('/api/people/:id', (req, res) => {
  if (!db.deletePerson(parseId(req.params.id))) throw new ApiError(404, 'NOT_FOUND');
  res.status(204).end();
});

// --- Attendance -----------------------------------------------------------

// Monthly sheet: everyone, plus every record of the month (YYYY-MM).
app.get('/api/attendance', (req, res) => {
  const month = parseMonth(req.query.month);
  res.json({
    people: db.listPeople(),
    records: db.attendanceBetween(`${month}-01`, `${month}-31`),
  });
});

app.put('/api/attendance', (req, res) => {
  const body = req.body ?? {};
  const date = parseDate(body.date);
  const personId = parseId(body.personId);
  const status = parseStatus(body.status, { allowNull: true });
  if (!db.getPerson(personId)) throw new ApiError(404, 'NOT_FOUND');
  const note = body.note === undefined ? undefined : parseText(body.note, 200);
  db.setAttendance(personId, date, status, note);
  res.json({ ok: true });
});

app.put('/api/attendance/bulk', (req, res) => {
  const body = req.body ?? {};
  const date = parseDate(body.date);
  const status = parseStatus(body.status);
  const personIds = Array.isArray(body.personIds) ? body.personIds.map(parseId) : [];
  db.setAttendanceBulk(personIds, date, status);
  res.json({ ok: true });
});

// --- Statistics -----------------------------------------------------------

app.get('/api/stats', (req, res) => {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (from > to) throw new ApiError(400, 'INVALID_RANGE');
  res.json(db.stats(from, to));
});

// --- Exports (PDF / Excel) -----------------------------------------------

const EXPORTERS = {
  xlsx: { build: buildXlsx, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { build: buildPdf, type: 'application/pdf' },
};

// The browser sends the table already translated and filtered; the server only lays it out.
app.post('/api/export/:format', async (req, res) => {
  const exporter = EXPORTERS[req.params.format];
  if (!exporter) throw new ApiError(404, 'NOT_FOUND');
  let file;
  try {
    file = await exporter.build(req.body);
  } catch (err) {
    if (err instanceof SpecError) throw new ApiError(400, 'INVALID_EXPORT');
    throw err;
  }
  res.type(exporter.type);
  res.attachment(file.fileName);
  res.send(file.buffer);
});

// --- Errors ---------------------------------------------------------------

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON' });
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

app.listen(PORT, () => {
  console.log(`Gestion des présences : http://localhost:${PORT}`);
});
