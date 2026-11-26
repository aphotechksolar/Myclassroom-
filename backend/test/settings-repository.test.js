const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createSettingsRepository } = require("../repositories/settings");

test("settings repository returns only the authenticated institution's settings", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE institution_settings (
        institution_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (institution_id, key)
      );
      INSERT INTO institution_settings(institution_id, key, value) VALUES
        ('school-a', 'school_name', 'School A'),
        ('school-a', 'theme', 'light'),
        ('school-b', 'school_name', 'School B');
    `);

    const repository = createSettingsRepository(database);
    assert.deepEqual(await repository.listForInstitution("school-a"), [
      { key: "school_name", value: "School A" },
      { key: "theme", value: "light" }
    ]);
    assert.deepEqual(await repository.listForInstitution("school-b"), [
      { key: "school_name", value: "School B" }
    ]);
    assert.deepEqual(await repository.listForInstitution("school-c"), []);
  } finally {
    await database.close();
  }
});

test("settings repository rejects missing institution scope", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    const repository = createSettingsRepository(database);
    await assert.rejects(repository.listForInstitution(""), /valid institution ID/);
    await assert.rejects(repository.listForInstitution(null), /valid institution ID/);
  } finally {
    await database.close();
  }
});
