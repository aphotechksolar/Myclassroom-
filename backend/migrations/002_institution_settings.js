const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
require("dotenv").config();
const dataDir=path.join(__dirname,"..","data");
fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(path.join(dataDir,"myclassroom.db"));
db.pragma("foreign_keys = ON");
const migrate=db.transaction(()=>{
  db.exec(`
    CREATE TABLE IF NOT EXISTS institution_settings(
      institution_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(institution_id,key),
      FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO institution_settings(institution_id,key,value)
    SELECT COALESCE(institution_id,'legacy-school'),key,value FROM school_settings;
    CREATE INDEX IF NOT EXISTS idx_institution_settings_key ON institution_settings(key,institution_id);
    INSERT OR IGNORE INTO schema_migrations(version) VALUES('002_institution_settings');
  `);
});
try { migrate(); console.log("Migration 002_institution_settings applied (or already current)."); }
finally { db.close(); }
