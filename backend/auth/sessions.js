"use strict";

const crypto = require("crypto");

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqualHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function createSessionStore(db, options = {}) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    throw new TypeError("A synchronous SQLite-compatible database is required");
  }
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs > 0
    ? options.ttlMs : DEFAULT_TTL_MS;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === "function"
    ? options.randomBytes : crypto.randomBytes;

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      institution_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
  `);

  const insert = db.prepare(`INSERT INTO auth_sessions
    (session_hash,csrf_hash,user_id,institution_id,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?)`);
  const find = db.prepare(`SELECT user_id,institution_id,created_at,expires_at,last_seen_at
    FROM auth_sessions WHERE session_hash=? AND revoked_at IS NULL AND expires_at>?`);
  const touch = db.prepare("UPDATE auth_sessions SET last_seen_at=? WHERE session_hash=? AND revoked_at IS NULL");
  const revokeOne = db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE session_hash=? AND revoked_at IS NULL");
  const revokeUser = db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL");

  function create(input) {
    const userId = Number(input && input.userId);
    const institutionId = String(input && input.institutionId || "").trim();
    if (!Number.isSafeInteger(userId) || userId <= 0 || !institutionId || institutionId.length > 128) {
      throw new TypeError("A valid userId and institutionId are required");
    }
    const rawSessionId = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const createdAt = new Date(now()).toISOString();
    const expiresAt = new Date(now() + ttlMs).toISOString();
    insert.run(digest(rawSessionId), digest(csrfToken), userId, institutionId, createdAt, expiresAt, createdAt);
    return { sessionId: rawSessionId, csrfToken, userId, institutionId, createdAt, expiresAt };
  }

  function get(rawSessionId) {
    if (typeof rawSessionId !== "string" || !/^[a-f0-9]{64}$/i.test(rawSessionId)) return null;
    const currentTime = new Date(now()).toISOString();
    const sessionHash = digest(rawSessionId);
    const row = find.get(sessionHash, currentTime);
    if (!row) return null;
    touch.run(currentTime, sessionHash);
    return { ...row, last_seen_at: currentTime, sessionHash };
  }

  function refreshCsrf(rawSessionId) {
    if (typeof rawSessionId !== "string" || !/^[a-f0-9]{64}$/i.test(rawSessionId)) return null;
    const sessionHash = digest(rawSessionId);
    const currentTime = new Date(now()).toISOString();
    const active = find.get(sessionHash, currentTime);
    if (!active) return null;
    const csrfToken = randomBytes(32).toString("hex");
    const updated = db.prepare("UPDATE auth_sessions SET csrf_hash=? WHERE session_hash=? AND revoked_at IS NULL AND expires_at>?")
      .run(digest(csrfToken), sessionHash, currentTime);
    return updated.changes === 1 ? csrfToken : null;
  }

  function verifyCsrf(session, suppliedToken) {
    if (!session || typeof suppliedToken !== "string" || !/^[a-f0-9]{64}$/i.test(suppliedToken)) return false;
    const row = db.prepare("SELECT csrf_hash FROM auth_sessions WHERE session_hash=? AND revoked_at IS NULL AND expires_at>?")
      .get(session.sessionHash, new Date(now()).toISOString());
    return !!row && safeEqualHex(row.csrf_hash, digest(suppliedToken));
  }

  function revoke(rawSessionId) {
    if (typeof rawSessionId !== "string" || !/^[a-f0-9]{64}$/i.test(rawSessionId)) return false;
    return revokeOne.run(new Date(now()).toISOString(), digest(rawSessionId)).changes === 1;
  }

  function revokeAllForUser(userId) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("A valid userId is required");
    return revokeUser.run(new Date(now()).toISOString(), id).changes;
  }

  function pruneExpired() {
    return db.prepare("DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL")
      .run(new Date(now()).toISOString()).changes;
  }

  return Object.freeze({ create, get, refreshCsrf, verifyCsrf, revoke, revokeAllForUser, pruneExpired });
}

module.exports = { createSessionStore, DEFAULT_TTL_MS };
