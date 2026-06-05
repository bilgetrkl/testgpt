from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


DB_PATH = Path(__file__).with_name("testgpt.db")
TOKEN_TTL_DAYS = 7
_auth_scheme = HTTPBearer(auto_error=False)


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS test_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                external_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, external_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000).hex()


def _public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


def create_user(name: str, email: str, password: str) -> dict[str, Any]:
    salt = secrets.token_bytes(16)
    try:
        with _connect() as connection:
            cursor = connection.execute(
                "INSERT INTO users (name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
                (name.strip(), email.strip().lower(), _hash_password(password, salt), salt.hex(), _utc_now().isoformat()),
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise ValueError("An account with this email already exists") from exc
    return _public_user(row)


def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email.strip(),)).fetchone()
    if not row:
        return None
    actual = _hash_password(password, bytes.fromhex(row["password_salt"]))
    return _public_user(row) if hmac.compare_digest(row["password_hash"], actual) else None


def create_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    with _connect() as connection:
        connection.execute("DELETE FROM auth_tokens WHERE expires_at <= ?", (now.isoformat(),))
        connection.execute(
            "INSERT INTO auth_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, hashlib.sha256(token.encode()).hexdigest(), (now + timedelta(days=TOKEN_TTL_DAYS)).isoformat(), now.isoformat()),
        )
    return token


def revoke_token(token: str) -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM auth_tokens WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_auth_scheme)) -> dict[str, Any]:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required")
    token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    with _connect() as connection:
        row = connection.execute(
            "SELECT users.* FROM auth_tokens JOIN users ON users.id = auth_tokens.user_id WHERE auth_tokens.token_hash = ? AND auth_tokens.expires_at > ?",
            (token_hash, _utc_now().isoformat()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return _public_user(row)


def load_sessions(user_id: int) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute("SELECT payload_json FROM test_sessions WHERE user_id = ? ORDER BY id ASC", (user_id,)).fetchall()
    return [json.loads(row["payload_json"]) for row in rows]


def replace_sessions(user_id: int, sessions: list[dict[str, Any]]) -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM test_sessions WHERE user_id = ?", (user_id,))
        for session in sessions:
            connection.execute(
                "INSERT INTO test_sessions (user_id, external_id, payload_json, updated_at) VALUES (?, ?, ?, ?)",
                (user_id, str(session.get("id") or secrets.token_hex(8)), json.dumps(session, ensure_ascii=False), _utc_now().isoformat()),
            )
