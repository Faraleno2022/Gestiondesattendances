"""Copies everything from the SQLite file (data/attendance.db) into the MySQL database set in .env.

  python sqlite_to_mysql.py

People, attendance records and login accounts are copied with their ids.
The MySQL database must be empty: the script refuses to run otherwise, so nothing is ever duplicated.
"""
import sqlite3
import sys

import db


def main():
    if not db.USE_MYSQL:
        print("MySQL n'est pas configuré : renseignez MYSQL_DB, MYSQL_USER, MYSQL_PASSWORD et MYSQL_HOST dans .env.")
        return 1
    if not db.DB_FILE.exists():
        print(f"Fichier SQLite introuvable : {db.DB_FILE}")
        return 1

    source = sqlite3.connect(db.DB_FILE)
    source.row_factory = sqlite3.Row
    tables = {
        "people": "SELECT id, matricule, name, job_title, service, created_at FROM people",
        "attendance": "SELECT person_id, date, status, note FROM attendance",
        "users": "SELECT id, username, password_hash, created_at FROM users",
    }
    existing = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    data = {name: [tuple(row) for row in source.execute(sql)] if name in existing else [] for name, sql in tables.items()}
    source.close()

    db.init()
    target = db.connect()
    try:
        for name in tables:
            if target.one(f"SELECT COUNT(*) AS n FROM {name}")["n"]:
                print(f"La table MySQL « {name} » contient déjà des données : transfert annulé, rien n'a été modifié.")
                return 1
        with target.transaction():
            target.executemany(
                "INSERT INTO people (id, matricule, name, job_title, service, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                data["people"],
            )
            target.executemany("INSERT INTO attendance (person_id, date, status, note) VALUES (?, ?, ?, ?)", data["attendance"])
            target.executemany(
                "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
                data["users"],
            )
    finally:
        target.close()

    print(
        f"Transfert terminé : {len(data['people'])} personnes, {len(data['attendance'])} pointages, "
        f"{len(data['users'])} comptes."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
