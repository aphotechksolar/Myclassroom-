const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
require("dotenv").config();

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "myclassroom.db"));
db.pragma("foreign_keys = ON");

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function ensureColumn(table, column) {
  if (!tableExists(table)) return;
  const columns = db.prepare("PRAGMA table_info(" + table + ")").all();
  if (!columns.some(item => item.name === column)) {
    db.exec("ALTER TABLE " + table + " ADD COLUMN " + column + " TEXT");
  }
}

const migrate = db.transaction(() => {
  ensureColumn("notifications", "institution_id");
  ensureColumn("messages", "institution_id");

  if (tableExists("notifications")) {
    db.prepare("UPDATE notifications SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
    db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_institution_user ON notifications(institution_id,user_id,id)");
  }
  if (tableExists("messages")) {
    db.prepare("UPDATE messages SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_institution_participants ON messages(institution_id,sender_id,receiver_id,id)");
  }
  if (tableExists("schema_migrations")) {
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES('003_institution_communications')").run();
  }
});

try {
  migrate();
  console.log("Migration 003_institution_communications applied (or already current).");
} finally {
  db.close();
}
