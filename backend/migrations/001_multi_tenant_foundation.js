const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
require("dotenv").config();

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "myclassroom.db"));
db.pragma("foreign_keys = ON");

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}
function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const migrate = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS institutions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      institution_type TEXT NOT NULL DEFAULT 'school'
        CHECK(institution_type IN ('primary','secondary','tertiary','combined','other')),
      country_code TEXT NOT NULL DEFAULT 'NG',
      timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
      currency_code TEXT NOT NULL DEFAULT 'NGN',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','suspended','pending')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS institution_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('school_admin','teacher','student','parent')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','invited','suspended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(institution_id, user_id),
      FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  addColumn("classes", "institution_id", "TEXT REFERENCES institutions(id)");
  addColumn("announcements", "institution_id", "TEXT REFERENCES institutions(id)");
  addColumn("audit_log", "institution_id", "TEXT REFERENCES institutions(id)");
  addColumn("school_settings", "institution_id", "TEXT REFERENCES institutions(id)");

  const schoolName = db.prepare("SELECT value FROM school_settings WHERE key='school_name'").get()?.value
    || process.env.SCHOOL_NAME || "MyClassroom Academy";
  db.prepare(`
    INSERT OR IGNORE INTO institutions(id,name,slug,institution_type,country_code,timezone,currency_code)
    VALUES('legacy-school', ?, 'legacy-school', 'combined', 'NG', 'Africa/Lagos', 'NGN')
  `).run(schoolName);

  db.prepare("UPDATE classes SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
  db.prepare("UPDATE announcements SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
  db.prepare("UPDATE audit_log SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
  db.prepare("UPDATE school_settings SET institution_id='legacy-school' WHERE institution_id IS NULL").run();

  db.prepare(`
    INSERT OR IGNORE INTO institution_memberships(institution_id,user_id,role)
    SELECT 'legacy-school', id,
      CASE role WHEN 'admin' THEN 'school_admin' WHEN 'teacher' THEN 'teacher' ELSE 'student' END
    FROM users
  `).run();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON institution_memberships(user_id,status);
    CREATE INDEX IF NOT EXISTS idx_memberships_institution ON institution_memberships(institution_id,status,role);
    CREATE INDEX IF NOT EXISTS idx_classes_institution ON classes(institution_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_institution ON announcements(institution_id);
    CREATE INDEX IF NOT EXISTS idx_audit_institution ON audit_log(institution_id);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)").run("001_multi_tenant_foundation");
});

try {
  migrate();
  console.log("Migration 001_multi_tenant_foundation applied (or already current).");
  console.log("Existing records were assigned to the legacy-school institution.");
  console.log("Tenant-aware API enforcement is a separate required release step.");
} finally {
  db.close();
}
