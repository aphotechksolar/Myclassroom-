"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { createSessionStore, DEFAULT_TTL_MS } = require("../auth/sessions");

function fixture() {
  const db = new Database(":memory:");
  let clock = Date.parse("2026-11-26T12:00:00.000Z");
  const store = createSessionStore(db, { now: () => clock });
  return { db, store, advance: ms => { clock += ms; } };
}

test("creates opaque session and CSRF secrets without storing either raw value", () => {
  const { db, store } = fixture();
  const created = store.create({ userId: 7, institutionId: "school-a" });
  assert.match(created.sessionId, /^[a-f0-9]{64}$/);
  assert.match(created.csrfToken, /^[a-f0-9]{64}$/);
  assert.notEqual(created.sessionId, created.csrfToken);
  const row = db.prepare("SELECT * FROM auth_sessions").get();
  assert.equal(row.session_hash, require("crypto").createHash("sha256").update(created.sessionId).digest("hex"));
  assert.equal(row.csrf_hash, require("crypto").createHash("sha256").update(created.csrfToken).digest("hex"));
  assert.equal(row.user_id, 7);
  assert.equal(row.institution_id, "school-a");
  assert.equal(row.expires_at, new Date(Date.parse(created.createdAt) + DEFAULT_TTL_MS).toISOString());
  assert.equal(JSON.stringify(row).includes(created.sessionId), false);
  assert.equal(JSON.stringify(row).includes(created.csrfToken), false);
  db.close();
});

test("retrieves only an active, unexpired session and records activity", () => {
  const { db, store, advance } = fixture();
  const created = store.create({ userId: 3, institutionId: "school-b" });
  assert.equal(store.get(created.sessionId).institution_id, "school-b");
  advance(1000);
  assert.equal(store.get(created.sessionId).last_seen_at, new Date(Date.parse(created.createdAt) + 1000).toISOString());
  advance(DEFAULT_TTL_MS);
  assert.equal(store.get(created.sessionId), null);
  db.close();
});

test("validates the per-session CSRF token and rejects wrong or malformed values", () => {
  const { db, store } = fixture();
  const created = store.create({ userId: 4, institutionId: "school-c" });
  const session = store.get(created.sessionId);
  assert.equal(store.verifyCsrf(session, created.csrfToken), true);
  assert.equal(store.verifyCsrf(session, "f".repeat(64)), false);
  assert.equal(store.verifyCsrf(session, "bad"), false);
  assert.equal(store.verifyCsrf(null, created.csrfToken), false);
  db.close();
});

test("revokes one session without affecting another session for the same user", () => {
  const { db, store } = fixture();
  const first = store.create({ userId: 5, institutionId: "school-a" });
  const second = store.create({ userId: 5, institutionId: "school-b" });
  assert.equal(store.revoke(first.sessionId), true);
  assert.equal(store.revoke(first.sessionId), false);
  assert.equal(store.get(first.sessionId), null);
  assert.equal(store.get(second.sessionId).institution_id, "school-b");
  db.close();
});

test("revokes every active session for a user and leaves other users signed in", () => {
  const { db, store } = fixture();
  const first = store.create({ userId: 6, institutionId: "school-a" });
  const second = store.create({ userId: 6, institutionId: "school-b" });
  const other = store.create({ userId: 8, institutionId: "school-a" });
  assert.equal(store.revokeAllForUser(6), 2);
  assert.equal(store.get(first.sessionId), null);
  assert.equal(store.get(second.sessionId), null);
  assert.ok(store.get(other.sessionId));
  db.close();
});

test("rejects invalid session creation and safely prunes expired or revoked rows", () => {
  const { db, store, advance } = fixture();
  assert.throws(() => store.create({ userId: 0, institutionId: "school-a" }), /valid userId/);
  assert.throws(() => store.create({ userId: 2, institutionId: "" }), /valid userId/);
  const expired = store.create({ userId: 9, institutionId: "school-a" });
  advance(DEFAULT_TTL_MS);
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.get(expired.sessionId), null);
  db.close();
});
