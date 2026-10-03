"""Attendance manager — Flask server (REST API + static front-end in public/)."""
import os
import re
import secrets
import threading
import time
from datetime import date as Date
from datetime import timedelta
from urllib.parse import quote

from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

import db
import exports

STATUSES = {"present", "absent", "late", "excused"}
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")


def load_secret_key():
    """SECRET_KEY from the environment or .env, otherwise a random key kept in the data folder."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    key_file = db.DATA_DIR / "secret_key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32), encoding="utf-8")
    return key_file.read_text(encoding="utf-8").strip()


db.init()
app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")
app.secret_key = load_secret_key()
app.config.update(
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,  # exports carry a whole month of data
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    # Set HTTPS_ONLY=1 once the site is served over HTTPS so the session cookie is never sent in clear.
    SESSION_COOKIE_SECURE=os.environ.get("HTTPS_ONLY") == "1",
)
app.json.ensure_ascii = False  # keep accents and Chinese characters readable


# The API answers with error *codes* only; the browser translates them into the user's language.
class ApiError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def get_conn():
    if "conn" not in g:
        g.conn = db.connect()
    return g.conn


@app.teardown_appcontext
def close_conn(exc):
    conn = g.pop("conn", None)
    if conn is not None:
        conn.close()


def body():
    data = request.get_json(silent=True)
    if data is None and request.data:
        raise ApiError(400, "INVALID_JSON")
    return data if isinstance(data, dict) else {}


def parse_text(value, max_length):
    return "" if value is None else str(value).strip()[:max_length]


def parse_person(data):
    person = {
        "matricule": parse_text(data.get("matricule"), 30),
        "name": parse_text(data.get("name"), 100),
        "jobTitle": parse_text(data.get("jobTitle"), 80),
        "service": parse_text(data.get("service"), 80),
    }
    if not person["name"]:
        raise ApiError(400, "NAME_REQUIRED")
    return person


def parse_date(value):
    s = str(value or "")
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            raise ValueError
        Date.fromisoformat(s)
    except ValueError:
        raise ApiError(400, "INVALID_DATE") from None
    return s


def parse_month(value):
    s = str(value or "")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", s):
        raise ApiError(400, "INVALID_MONTH")
    return s


def parse_id(value):
    if isinstance(value, bool):
        raise ApiError(404, "NOT_FOUND")
    try:
        number = int(str(value))
    except ValueError:
        raise ApiError(404, "NOT_FOUND") from None
    if number <= 0 or str(number) != str(value).strip():
        raise ApiError(404, "NOT_FOUND")
    return number


def parse_status(value, allow_null=False):
    if value is None and allow_null:
        return None
    if value not in STATUSES:
        raise ApiError(400, "INVALID_STATUS")
    return value


def with_unique_matricule(fn):
    try:
        return fn()
    except db.MatriculeTaken:
        raise ApiError(409, "MATRICULE_TAKEN") from None


# --- Authentication ---------------------------------------------------------

LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 15 * 60
# Compared against when the username does not exist, so both cases take the same time.
DUMMY_HASH = generate_password_hash(secrets.token_hex(16))

_failures = {}  # username → timestamps of recent failed logins (per worker process)
_failures_lock = threading.Lock()


def _recent_failures(username):
    cutoff = time.time() - LOGIN_LOCK_SECONDS
    with _failures_lock:
        attempts = [t for t in _failures.get(username, []) if t > cutoff]
        _failures[username] = attempts
        return attempts


def _record_failure(username):
    with _failures_lock:
        _failures.setdefault(username, []).append(time.time())


def _session_marker(user):
    # Changing the password changes the hash, which invalidates every existing session.
    return user["password_hash"][-16:]


@app.before_request
def require_login():
    if not request.path.startswith("/api/"):
        return None  # the page itself holds no data; it shows the login form when needed
    if request.method in ("POST", "PUT") and not request.is_json:
        raise ApiError(400, "INVALID_JSON")  # blocks cross-site form submissions
    if request.path == "/api/login":
        return None
    user = db.get_user(get_conn(), session.get("user_id") or 0)
    if not user or session.get("marker") != _session_marker(user):
        session.clear()
        raise ApiError(401, "UNAUTHORIZED")
    g.user = user
    return None


@app.post("/api/login")
def login():
    data = body()
    username = parse_text(data.get("username"), 50).lower()
    password = str(data.get("password") or "")
    if len(_recent_failures(username)) >= LOGIN_MAX_FAILURES:
        raise ApiError(429, "TOO_MANY_ATTEMPTS")

    user = db.get_user_by_name(get_conn(), username)
    valid = check_password_hash(user["password_hash"] if user else DUMMY_HASH, password)
    if not (user and valid):
        _record_failure(username)
        raise ApiError(401, "INVALID_CREDENTIALS")

    with _failures_lock:
        _failures.pop(username, None)
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["marker"] = _session_marker(user)
    return jsonify({"username": user["username"]})


@app.get("/api/session")
def current_session():
    return jsonify({"username": g.user["username"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return "", 204


# --- Front-end --------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")


# --- People -----------------------------------------------------------------

@app.get("/api/people")
def list_people():
    return jsonify(db.list_people(get_conn()))


@app.post("/api/people")
def create_person():
    person = parse_person(body())
    return jsonify(with_unique_matricule(lambda: db.create_person(get_conn(), person))), 201


@app.put("/api/people/<person_id>")
def update_person(person_id):
    pid = parse_id(person_id)
    changes = parse_person(body())
    person = with_unique_matricule(lambda: db.update_person(get_conn(), pid, changes))
    if not person:
        raise ApiError(404, "NOT_FOUND")
    return jsonify(person)


@app.delete("/api/people/<person_id>")
def delete_person(person_id):
    if not db.delete_person(get_conn(), parse_id(person_id)):
        raise ApiError(404, "NOT_FOUND")
    return "", 204


# --- Attendance -------------------------------------------------------------

@app.get("/api/attendance")
def month_sheet():
    """Monthly sheet: everyone, plus every record of the month (YYYY-MM)."""
    month = parse_month(request.args.get("month"))
    conn = get_conn()
    return jsonify({
        "people": db.list_people(conn),
        "records": db.attendance_between(conn, f"{month}-01", f"{month}-31"),
    })


@app.put("/api/attendance")
def set_attendance():
    data = body()
    day = parse_date(data.get("date"))
    person_id = parse_id(data.get("personId"))
    status = parse_status(data.get("status"), allow_null=True)
    conn = get_conn()
    if not db.get_person(conn, person_id):
        raise ApiError(404, "NOT_FOUND")
    note = parse_text(data["note"], 200) if "note" in data else None
    db.set_attendance(conn, person_id, day, status, note)
    return jsonify({"ok": True})


@app.put("/api/attendance/bulk")
def set_attendance_bulk():
    data = body()
    day = parse_date(data.get("date"))
    status = parse_status(data.get("status"))
    ids = data.get("personIds")
    person_ids = [parse_id(i) for i in ids] if isinstance(ids, list) else []
    db.set_attendance_bulk(get_conn(), person_ids, day, status)
    return jsonify({"ok": True})


# --- Statistics -------------------------------------------------------------

@app.get("/api/stats")
def stats():
    date_from = parse_date(request.args.get("from"))
    date_to = parse_date(request.args.get("to"))
    if date_from > date_to:
        raise ApiError(400, "INVALID_RANGE")
    return jsonify(db.stats(get_conn(), date_from, date_to))


# --- Exports (PDF / Excel) --------------------------------------------------

EXPORTERS = {
    "xlsx": (exports.build_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pdf": (exports.build_pdf, "application/pdf"),
}


@app.post("/api/export/<fmt>")
def export(fmt):
    """The browser sends the table already translated and filtered; the server only lays it out."""
    if fmt not in EXPORTERS:
        raise ApiError(404, "NOT_FOUND")
    build, mimetype = EXPORTERS[fmt]
    try:
        content, file_name = build(body())
    except exports.SpecError:
        raise ApiError(400, "INVALID_EXPORT") from None
    # HTTP headers are Latin-1 only: Chinese or accented names go in the UTF-8 "filename*" form.
    fallback = file_name.encode("ascii", "replace").decode().replace("?", "_").replace('"', "_")
    response = Response(content, mimetype=mimetype)
    response.headers["Content-Disposition"] = f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(file_name)}"
    return response


# --- Errors -----------------------------------------------------------------

@app.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify({"error": err.code}), err.status


@app.errorhandler(HTTPException)
def handle_http_error(err):
    if request.path.startswith("/api/"):
        code = "NOT_FOUND" if err.code in (404, 405) else "INVALID_JSON" if err.code in (400, 413) else "SERVER_ERROR"
        return jsonify({"error": code}), err.code
    return err


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    app.logger.exception(err)
    return jsonify({"error": "SERVER_ERROR"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print(f"Gestion des présences : http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
