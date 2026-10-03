"""Manage login accounts from the command line.

  python users.py add NAME       create an account (asks for the password)
  python users.py passwd NAME    change a password (signs the user out everywhere)
  python users.py delete NAME    delete an account
  python users.py list           list accounts

Accounts can only be created here, never from the web page, so nobody on the Internet can sign up.
"""
import argparse
import getpass
import re
import sys

from werkzeug.security import generate_password_hash

import db

MIN_PASSWORD_LENGTH = 8


def ask_password():
    while True:
        password = getpass.getpass("Mot de passe / Password : ")
        if len(password) < MIN_PASSWORD_LENGTH:
            print(f"Au moins {MIN_PASSWORD_LENGTH} caractères / At least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if password != getpass.getpass("Confirmation : "):
            print("Les mots de passe ne correspondent pas / Passwords do not match.")
            continue
        return generate_password_hash(password)


def main():
    parser = argparse.ArgumentParser(description="Comptes de connexion / Login accounts")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("add", "passwd", "delete"):
        sub.add_parser(name).add_argument("username")
    sub.add_parser("list")
    args = parser.parse_args()

    db.init()
    conn = db.connect()
    try:
        if args.command == "list":
            for user in db.list_users(conn):
                print(f"{user['username']:<30} {user['created_at']}")
            return 0

        username = args.username.strip()
        if args.command == "add":
            if not re.fullmatch(r"[\w.@-]{2,50}", username):
                print("Identifiant invalide : 2 à 50 lettres, chiffres, . _ - @ / Invalid username.")
                return 1
            if db.get_user_by_name(conn, username):
                print(f"Le compte « {username} » existe déjà / Account already exists.")
                return 1
            db.create_user(conn, username, ask_password())
            print(f"Compte « {username} » créé / Account created.")
        elif args.command == "passwd":
            if not db.get_user_by_name(conn, username):
                print(f"Compte « {username} » introuvable / Account not found.")
                return 1
            db.set_password(conn, username, ask_password())
            print("Mot de passe modifié / Password changed.")
        elif args.command == "delete":
            if not db.delete_user(conn, username):
                print(f"Compte « {username} » introuvable / Account not found.")
                return 1
            print(f"Compte « {username} » supprimé / Account deleted.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
