"""Optional credits for public Zephyrus Music test builds."""
from contextlib import closing
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

DB = Path(os.environ.get('ZEPHYRUS_TEST_CREDITS_DB', '/var/lib/zephyrus-test-credits/credits.sqlite3'))
RELEASE = os.environ.get('ZEPHYRUS_CREDITS_RELEASE', '1.4.3')
ALLOWED_ORIGINS = {'https://mucang.xyz', 'https://localhost'}
HEX = re.compile(r'[0-9a-f]{64}')


def connect():
    db = sqlite3.connect(DB)
    db.execute('PRAGMA foreign_keys = ON')
    return db


def init():
    with closing(connect()) as db, db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS credits (
                id INTEGER PRIMARY KEY,
                release TEXT NOT NULL,
                owner TEXT NOT NULL,
                name TEXT,
                avatar TEXT NOT NULL,
                UNIQUE(release, owner)
            );
            CREATE TABLE IF NOT EXISTS account_aliases (
                release TEXT NOT NULL,
                account TEXT NOT NULL,
                credit INTEGER NOT NULL REFERENCES credits(id),
                PRIMARY KEY (release, account)
            );
        ''')


def find_account(db, accounts):
    if not accounts:
        return False
    placeholders = ','.join('?' for _ in accounts)
    return db.execute(f'''SELECT 1 FROM account_aliases
        WHERE release=? AND account IN ({placeholders}) LIMIT 1''', (RELEASE, *accounts)).fetchone() is not None


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data=None):
        payload = json.dumps(data, ensure_ascii=False).encode() if data is not None else b''
        self.send_response(status)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def do_OPTIONS(self):
        self.reply(204 if self.headers.get('Origin') in ALLOWED_ORIGINS else 403)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path != '/list':
            return self.reply(404)
        release = parse_qs(url.query).get('version', [''])[0]
        if not re.fullmatch(r'\d+\.\d+\.\d+', release):
            return self.reply(400)
        with closing(connect()) as db:
            rows = db.execute('SELECT id, name, avatar FROM credits WHERE release=? AND name IS NOT NULL ORDER BY id',
                              (release,)).fetchall()
        self.reply(200, [{'id': row[0], 'name': row[1], 'avatar': row[2]} for row in rows])

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return self.reply(403)
        if self.path not in ('/status', '/profile'):
            return self.reply(404)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                return self.reply(400)
            data = json.loads(self.rfile.read(size))
            owner = data['owner']
            accounts = data['aliases']
            if not isinstance(owner, str) or not HEX.fullmatch(owner) or not isinstance(accounts, list) or len(accounts) > 20:
                return self.reply(400)
            if any(not isinstance(account, str) or not HEX.fullmatch(account) for account in accounts):
                return self.reply(400)
        except (KeyError, TypeError, ValueError, UnicodeError):
            return self.reply(400)
        owner = sha256(owner.encode()).hexdigest()
        if self.path == '/status':
            with closing(connect()) as db:
                row = db.execute('SELECT name, avatar FROM credits WHERE release=? AND owner=?',
                                 (RELEASE, owner)).fetchone()
                decided = row is not None or find_account(db, accounts)
            result = {'decided': decided, 'owned': row is not None}
            if row and row[0]:
                result.update(name=row[0], avatar=row[1])
            return self.reply(200, result)

        if 'profile' not in data:
            return self.reply(400)
        profile = data['profile']
        name, avatar = None, ''
        if profile is not None:
            if not isinstance(profile, dict):
                return self.reply(400)
            name, avatar = profile.get('name'), profile.get('avatar', '')
            if not isinstance(name, str) or not 0 < len(name.strip()) <= 48:
                return self.reply(400)
            if not isinstance(avatar, str) or len(avatar) > 1500:
                return self.reply(400)
            if avatar and not re.fullmatch(r'https://[^/?#\s]+[^\s]*', avatar):
                return self.reply(400)
            name = name.strip()
        with closing(connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT id FROM credits WHERE release=? AND owner=?', (RELEASE, owner)).fetchone()
            if row is None and find_account(db, accounts):
                return self.reply(409)
            if row:
                credit_id = row[0]
                db.execute('UPDATE credits SET name=?, avatar=? WHERE id=?', (name, avatar, credit_id))
            else:
                credit_id = db.execute('INSERT INTO credits(release, owner, name, avatar) VALUES (?, ?, ?, ?)',
                                       (RELEASE, owner, name, avatar)).lastrowid
            db.executemany('INSERT OR IGNORE INTO account_aliases VALUES (?, ?, ?)',
                           [(RELEASE, account, credit_id) for account in accounts])
        self.reply(204)


if __name__ == '__main__':
    init()
    ThreadingHTTPServer(('127.0.0.1', 8768), Handler).serve_forever()
