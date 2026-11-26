const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createDatabase } = require("./db");
const { openAsyncSqliteDatabase } = require("./db/sqlite-async");
const { createSettingsRepository } = require("./repositories/settings");
const { createNotificationsRepository } = require("./repositories/notifications");
const { createAnnouncementsRepository } = require("./repositories/announcements");
const { createMessagesRepository } = require("./repositories/messages");
const { createClassesRepository } = require("./repositories/classes");
const { createLearningContentRepository } = require("./repositories/learning-content");
const { createStorage } = require("./storage");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "myclassroom-local-development-only");
if (!SECRET) throw new Error("JWT_SECRET must be set to a strong random value in production.");
if (process.env.NODE_ENV === "production" && SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production.");
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "..", "frontend");
const DATA = path.resolve(process.env.MYCLASSROOM_DATA_DIR || path.join(ROOT, "data"));
const UPLOADS = path.resolve(process.env.MYCLASSROOM_UPLOADS_DIR || path.join(ROOT, "uploads"));


const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
const corsOptions = { origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed by CORS"));
}};
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({limit:"2mb"}));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many authentication attempts. Please try again later." } });
app.use("/api/auth", authLimiter);
// Uploaded learning files are served only through authenticated, institution-scoped routes.

const db = createDatabase(path.join(DATA, "myclassroom.db"));
const asyncDb = openAsyncSqliteDatabase(db);
const settingsRepository = createSettingsRepository(asyncDb);
const notificationsRepository = createNotificationsRepository(asyncDb);
const announcementsRepository = createAnnouncementsRepository(asyncDb);
const messagesRepository = createMessagesRepository(asyncDb);
const classesRepository = createClassesRepository(asyncDb);
const learningContentRepository = createLearningContentRepository(asyncDb);
const storage = createStorage({ root: UPLOADS });

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')),
 phone TEXT DEFAULT '', bio TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS classes(
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 description TEXT DEFAULT '', teacher_id INTEGER, live_link TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(teacher_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS enrollments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(class_id,student_id),
 FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS subjects(
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, class_id INTEGER,
 teacher_id INTEGER, FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL,
 FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS timetable(
 id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER, subject_id INTEGER,
 day TEXT, start_time TEXT, end_time TEXT, room TEXT DEFAULT '',
 FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS materials(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '',
 url TEXT DEFAULT '', file_url TEXT DEFAULT '', class_id INTEGER, teacher_id INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS assignments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '',
 due_date TEXT, class_id INTEGER, teacher_id INTEGER, max_score REAL DEFAULT 100,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS submissions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER, student_id INTEGER,
 answer TEXT DEFAULT '', score REAL, feedback TEXT DEFAULT '', submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(assignment_id,student_id), FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS assessments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT DEFAULT 'quiz',
 duration_minutes INTEGER DEFAULT 20, class_id INTEGER, teacher_id INTEGER,
 pass_mark REAL DEFAULT 50, questions_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS attempts(
 id INTEGER PRIMARY KEY AUTOINCREMENT, assessment_id INTEGER, student_id INTEGER,
 started_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, submitted_at TEXT,
 score REAL DEFAULT 0, percentage REAL DEFAULT 0, status TEXT DEFAULT 'in_progress',
 answers_json TEXT DEFAULT '{}', UNIQUE(assessment_id,student_id),
 FOREIGN KEY(assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attendance(
 id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER, student_id INTEGER,
 date TEXT, status TEXT DEFAULT 'present',
 UNIQUE(class_id,student_id,date), FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS announcements(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
 class_id INTEGER, author_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT NOT NULL,
 body TEXT NOT NULL, read_at TEXT, institution_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER,
 subject TEXT DEFAULT '', body TEXT NOT NULL, read_at TEXT, institution_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reset_tokens(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, used INTEGER DEFAULT 0,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS school_settings(
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT, details TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Ensure the tenant foundation exists before authentication and seed logic run.
db.exec(`
  CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    institution_type TEXT NOT NULL DEFAULT 'school',
    country_code TEXT NOT NULL DEFAULT 'NG', timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
    currency_code TEXT NOT NULL DEFAULT 'NGN', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS institution_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, institution_id TEXT NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('school_admin','teacher','student','parent')),
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id,user_id),
    FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS institution_settings (
    institution_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(institution_id,key),
    FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE
  );
`);
function ensureTenantColumn(table,column,definition){
  const columns=db.prepare(`PRAGMA table_info(${table})`).all();
  if(!columns.some(c=>c.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureTenantColumn("classes","institution_id","TEXT REFERENCES institutions(id)");
ensureTenantColumn("announcements","institution_id","TEXT REFERENCES institutions(id)");
ensureTenantColumn("audit_log","institution_id","TEXT REFERENCES institutions(id)");
ensureTenantColumn("school_settings","institution_id","TEXT REFERENCES institutions(id)");
ensureTenantColumn("notifications","institution_id","TEXT");
ensureTenantColumn("messages","institution_id","TEXT");
db.prepare("INSERT OR IGNORE INTO institutions(id,name,slug,institution_type,country_code,timezone,currency_code) VALUES('legacy-school',?,'legacy-school','combined','NG','Africa/Lagos','NGN')")
  .run(process.env.SCHOOL_NAME || "MyClassroom Academy");
db.prepare("UPDATE classes SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE announcements SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE audit_log SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE school_settings SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE notifications SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE messages SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_institution_user ON notifications(institution_id,user_id,id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_messages_institution_participants ON messages(institution_id,sender_id,receiver_id,id)");
db.prepare("INSERT OR IGNORE INTO institution_settings(institution_id,key,value) SELECT 'legacy-school',key,value FROM school_settings").run();

const count = db.prepare("SELECT COUNT(*) c FROM users").get().c;
if (!count && process.env.NODE_ENV === "production") {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || "Platform Administrator").trim();
  if (!email || password.length < 10 || password.length > 128) {
    throw new Error("For a new production database, set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of 10-128 characters.");
  }
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(name,email,bcrypt.hashSync(password,10));
  db.prepare("INSERT INTO school_settings(key,value) VALUES('school_name',?)").run(process.env.SCHOOL_NAME || "MyClassroom Academy");
}
if (!count && process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_DATA !== "false") {
  const ins = db.prepare("INSERT INTO users(name,email,password_hash,role,phone,bio) VALUES(?,?,?,?,?,?)");
  const admin = ins.run("School Administrator","admin@example.com",bcrypt.hashSync("admin123",10),"admin","","");
  const teacher = ins.run("Demo Teacher","teacher@example.com",bcrypt.hashSync("teacher123",10),"teacher","","Science teacher");
  const student = ins.run("Demo Student","student@example.com",bcrypt.hashSync("student123",10),"student","","");
  const cls = db.prepare("INSERT INTO classes(name,code,description,teacher_id) VALUES(?,?,?,?)")
    .run("SS2 Science","SCI2026","Demo science class",teacher.lastInsertRowid);
  db.prepare("INSERT INTO enrollments(class_id,student_id) VALUES(?,?)").run(cls.lastInsertRowid,student.lastInsertRowid);
  db.prepare("INSERT INTO subjects(name,class_id,teacher_id) VALUES(?,?,?)").run("Biology",cls.lastInsertRowid,teacher.lastInsertRowid);
  db.prepare("INSERT INTO subjects(name,class_id,teacher_id) VALUES(?,?,?)").run("Mathematics",cls.lastInsertRowid,teacher.lastInsertRowid);
  db.prepare("INSERT INTO school_settings(key,value) VALUES('school_name',?)").run(process.env.SCHOOL_NAME || "MyClassroom Academy");
}

// Preserve access for the existing single-school installation and newly seeded local accounts.
db.prepare(`
  INSERT OR IGNORE INTO institution_memberships(institution_id,user_id,role)
  SELECT 'legacy-school',id,
    CASE role WHEN 'admin' THEN 'school_admin' WHEN 'teacher' THEN 'teacher' ELSE 'student' END
  FROM users
`).run();
db.prepare("INSERT OR IGNORE INTO institution_settings(institution_id,key,value) SELECT 'legacy-school',key,value FROM school_settings").run();
db.prepare("UPDATE classes SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE announcements SET institution_id='legacy-school' WHERE institution_id IS NULL").run();
db.prepare("UPDATE audit_log SET institution_id='legacy-school' WHERE institution_id IS NULL").run();

function activeMembership(userId, institutionId) {
  const sql = `SELECT m.institution_id,m.role,m.status,i.name institution_name,i.status institution_status
    FROM institution_memberships m JOIN institutions i ON i.id=m.institution_id
    WHERE m.user_id=? AND m.status='active' AND i.status='active'
      AND m.role IN ('school_admin','teacher','student')`;
  return institutionId
    ? db.prepare(sql + " AND m.institution_id=?").get(userId,institutionId)
    : db.prepare(sql + " ORDER BY m.created_at LIMIT 1").get(userId);
}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Authentication required"});
  try {
    req.user=jwt.verify(token,SECRET);
    const membership=activeMembership(req.user.id,req.user.institution_id);
    if(!membership) return res.status(403).json({error:"No active institution membership. Contact your school administrator."});
    req.user.institution_id=membership.institution_id;
    req.user.institution_role=membership.role;
    req.user.institution_name=membership.institution_name;
    next();
  } catch(e){ return res.status(401).json({error:"Invalid or expired token"}); }
}
function roles(...allowed){ return (req,res,next)=>{
  const role=req.user.institution_role==="school_admin"?"admin":req.user.institution_role;
  return allowed.includes(role)?next():res.status(403).json({error:"Not allowed"});
}; }
function sign(user,institutionId){
  const membership=activeMembership(user.id,institutionId);
  if(!membership) throw new Error("User has no active institution membership");
  const effectiveRole=membership.role==="school_admin"?"admin":membership.role;
  return jwt.sign({id:user.id,name:user.name,email:user.email,role:effectiveRole,institution_id:membership.institution_id,institution_role:membership.role},SECRET,{expiresIn:"7d"});
}
function log(actor,action,details="",institutionId=null){ const id=institutionId||activeMembership(actor)?.institution_id||null; db.prepare("INSERT INTO audit_log(actor_id,action,details,institution_id) VALUES(?,?,?,?)").run(actor,action,details,id); }
function notify(userId,title,body,institutionId){ if(userId && institutionId) db.prepare("INSERT INTO notifications(user_id,title,body,institution_id) VALUES(?,?,?,?)").run(userId,title,body,institutionId); }
function classForUser(user, classId){
  const c=db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=?").get(classId,user.institution_id);
  if(!c) return null;
  if(user.institution_role==="school_admin" || (c.teacher_id===user.id && user.institution_role==="teacher") ||
    (user.institution_role==="student" && db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(classId,user.id))) return c;
  return null;
}
function normalizeQuestions(raw){
  if(!Array.isArray(raw)) throw new Error("Questions must be an array");
  return raw.map((q,i)=>({
    question:String(q.question||"Question "+(i+1)),
    options:Array.isArray(q.options)?q.options.map(String):[],
    answer:Number(q.answer||0)
  })).filter(q=>q.options.length>=2 && q.answer>=0 && q.answer<q.options.length);
}


// Platform-owner operations use a separate high-entropy secret. This is an
// operational bootstrap API; never expose the secret in browser-side code.
db.exec(`
CREATE TABLE IF NOT EXISTS platform_audit_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 action TEXT NOT NULL,
 institution_id TEXT,
 details TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
function platformOwner(req,res,next){
 const expected=String(process.env.PLATFORM_OWNER_KEY||"");
 const supplied=String(req.get("x-platform-owner-key")||"");
 if(expected.length<32) return res.status(503).json({error:"Platform-owner API is not configured. Set a 32+ character PLATFORM_OWNER_KEY."});
 const a=Buffer.from(expected), b=Buffer.from(supplied);
 if(a.length!==b.length || !require("crypto").timingSafeEqual(a,b)) return res.status(401).json({error:"Not authorized"});
 next();
}
const platformLimiter=rateLimit({windowMs:15*60*1000,max:30,standardHeaders:true,legacyHeaders:false});
app.use("/api/platform",platformLimiter);
app.get("/api/platform/institutions",platformOwner,(req,res)=>{
 const rows=db.prepare(`SELECT i.id,i.name,i.slug,i.institution_type,i.country_code,i.timezone,i.currency_code,i.status,i.created_at,
 (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id AND m.status='active') active_members
 FROM institutions i ORDER BY i.created_at DESC`).all();
 res.json(rows);
});
app.post("/api/platform/institutions",platformOwner,(req,res)=>{
 const name=String(req.body.name||"").trim();
 const slug=String(req.body.slug||"").trim().toLowerCase();
 const type=String(req.body.institution_type||"combined");
 const country=String(req.body.country_code||"NG").trim().toUpperCase();
 const timezone=String(req.body.timezone||"Africa/Lagos").trim();
 const currency=String(req.body.currency_code||"NGN").trim().toUpperCase();
 const adminName=String(req.body.admin_name||"").trim();
 const email=String(req.body.admin_email||"").trim().toLowerCase();
 const password=String(req.body.admin_password||"");
 if(name.length<2||name.length>120) return res.status(400).json({error:"Institution name must be 2-120 characters"});
 if(!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) return res.status(400).json({error:"Use a unique slug with 3-60 lowercase letters, numbers or hyphens"});
 if(!["primary","secondary","tertiary","combined","other"].includes(type)) return res.status(400).json({error:"Invalid institution type"});
 if(!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency)||timezone.length<3||timezone.length>80) return res.status(400).json({error:"Invalid country, timezone or currency settings"});
 if(adminName.length<2||adminName.length>120||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"A valid school administrator name and email are required"});
 if(password.length<12||password.length>128) return res.status(400).json({error:"Initial administrator password must be 12-128 characters"});
 const id=require("crypto").randomUUID();
 try {
  const create=db.transaction(()=>{
   const user=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(adminName,email,bcrypt.hashSync(password,12));
   db.prepare("INSERT INTO institutions(id,name,slug,institution_type,country_code,timezone,currency_code,status) VALUES(?,?,?,?,?,?,?,'active')").run(id,name,slug,type,country,timezone,currency);
   db.prepare("INSERT INTO institution_memberships(institution_id,user_id,role,status) VALUES(?,?,'school_admin','active')").run(id,user.lastInsertRowid);
   db.prepare("INSERT INTO institution_settings(institution_id,key,value) VALUES(?,?,?)").run(id,"school_name",name);
   db.prepare("INSERT INTO platform_audit_log(action,institution_id,details) VALUES('institution_created',?,?)").run(id,JSON.stringify({slug,admin_email:email}));
   return user.lastInsertRowid;
  });
  const adminUserId=create();
  res.status(201).json({institution:{id,name,slug,institution_type:type,country_code:country,timezone,currency_code:currency,status:"active"},administrator:{id:adminUserId,name:adminName,email,role:"school_admin"}});
 } catch(e) {
  if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"The institution slug or administrator email is already in use"});
  console.error("Platform institution creation failed",e);
  return res.status(500).json({error:"Could not create institution"});
 }
});
app.patch("/api/platform/institutions/:id/status",platformOwner,(req,res)=>{
 const status=String(req.body.status||"");
 if(!["active","suspended","pending"].includes(status)) return res.status(400).json({error:"Status must be active, suspended or pending"});
 if(req.params.id==="legacy-school" && status!=="active") return res.status(400).json({error:"The legacy institution cannot be suspended through this endpoint"});
 const result=db.prepare("UPDATE institutions SET status=? WHERE id=?").run(status,req.params.id);
 if(!result.changes) return res.status(404).json({error:"Institution not found"});
 db.prepare("INSERT INTO platform_audit_log(action,institution_id,details) VALUES('institution_status_changed',?,?)").run(req.params.id,JSON.stringify({status}));
 res.json({ok:true,id:req.params.id,status});
});

app.post("/api/auth/register",(req,res)=>{
  const {name,email,password,role="student"}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
  if(String(password).length < 10 || String(password).length > 128) return res.status(400).json({error:"Password must be between 10 and 128 characters"});
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(email).trim())) return res.status(400).json({error:"Enter a valid email address"});
  const safeRole=role==="teacher"?"teacher":"student";
  try{
    const r=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
      .run(String(name).trim(),String(email).trim().toLowerCase(),bcrypt.hashSync(password,10),safeRole);
    const u=db.prepare("SELECT id,name,email,role,phone,bio,created_at FROM users WHERE id=?").get(r.lastInsertRowid);
    const institution=db.prepare("SELECT id FROM institutions WHERE id='legacy-school' AND status='active'").get();
    if(!institution) throw new Error("No institution is configured for self-registration");
    db.prepare("INSERT INTO institution_memberships(institution_id,user_id,role) VALUES(?,?,?)")
      .run(institution.id,u.id,safeRole);
    res.json({user:u,token:sign(u)});
  }catch(e){res.status(400).json({error:"Email already exists"});}
});
app.post("/api/auth/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").trim().toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password||"",u.password_hash)) return res.status(401).json({error:"Invalid email or password"});
  const membership=activeMembership(u.id,req.body.institution_id||null);
  if(!membership) return res.status(403).json({error:"This account has no active membership in the selected school."});
  res.json({user:{id:u.id,name:u.name,email:u.email,role:membership.role==="school_admin"?"admin":membership.role,phone:u.phone,bio:u.bio,institution_id:membership.institution_id,institution_name:membership.institution_name,institution_role:membership.role},token:sign(u,membership.institution_id)});
});
app.post("/api/auth/switch-institution",auth,(req,res)=>{
  const membership=activeMembership(req.user.id,String(req.body.institution_id||""));
  if(!membership) return res.status(403).json({error:"No active membership in that institution."});
  const user=db.prepare("SELECT id,name,email,role,phone,bio FROM users WHERE id=?").get(req.user.id);
  res.json({user:{...user,role:membership.role==="school_admin"?"admin":membership.role,institution_id:membership.institution_id,institution_name:membership.institution_name,institution_role:membership.role},token:sign(user,membership.institution_id)});
});
app.post("/api/auth/change-password",auth,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if(!u||!bcrypt.compareSync(req.body.currentPassword||"",u.password_hash)) return res.status(400).json({error:"Current password is incorrect"});
  const nextPassword=String(req.body.newPassword||"");
  if(nextPassword.length < 10 || nextPassword.length > 128) return res.status(400).json({error:"New password must be between 10 and 128 characters"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(nextPassword,10),u.id);
  log(u.id,"Changed password","",req.user.institution_id); res.json({ok:true});
});
app.post("/api/auth/request-reset",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").toLowerCase());
  if(!u) return res.json({ok:true,message:"If the account exists, a reset token has been prepared."});
  const crypto=require("crypto"), token=crypto.randomBytes(24).toString("hex");
  const hash=crypto.createHash("sha256").update(token).digest("hex");
  const expires=new Date(Date.now()+30*60*1000).toISOString();
  db.prepare("INSERT INTO reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)").run(u.id,hash,expires);
  // Email delivery is intentionally not simulated or exposed in the API response.
  // Connect a verified email provider before enabling customer-facing password recovery.
  res.json({ok:true,message:"Password recovery is not configured yet. Please contact your school administrator."});
});
app.post("/api/auth/reset",(req,res)=>{
  const crypto=require("crypto"), hash=crypto.createHash("sha256").update(req.body.token||"").digest("hex");
  const row=db.prepare("SELECT * FROM reset_tokens WHERE token_hash=? AND used=0 AND expires_at>?").get(hash,new Date().toISOString());
  if(!row) return res.status(400).json({error:"Invalid or expired reset token"});
  const nextPassword=String(req.body.newPassword||"");
  if(nextPassword.length < 10 || nextPassword.length > 128) return res.status(400).json({error:"New password must be between 10 and 128 characters"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(nextPassword,10),row.user_id);
  db.prepare("UPDATE reset_tokens SET used=1 WHERE id=?").run(row.id); res.json({ok:true});
});
app.get("/api/me",auth,(req,res)=>{const u=db.prepare("SELECT id,name,email,phone,bio,created_at FROM users WHERE id=?").get(req.user.id);res.json({...u,role:req.user.role,institution_id:req.user.institution_id,institution_name:req.user.institution_name,institution_role:req.user.institution_role});});
app.patch("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const name=req.body.name??u.name, phone=req.body.phone??u.phone, bio=req.body.bio??u.bio;
  db.prepare("UPDATE users SET name=?,phone=?,bio=? WHERE id=?").run(name,phone,bio,u.id);
  res.json({...db.prepare("SELECT id,name,email,phone,bio,created_at FROM users WHERE id=?").get(u.id),role:req.user.role,institution_id:req.user.institution_id,institution_name:req.user.institution_name,institution_role:req.user.institution_role});
});

app.get("/api/admin/stats",auth,roles("admin"),(req,res)=>{
  const id=req.user.institution_id;
  const users=db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND status='active'").get(id).c;
  const count=table=>db.prepare(`SELECT COUNT(*) c FROM ${table} x JOIN classes c ON c.id=x.class_id WHERE c.institution_id=?`).get(id).c;
  res.json({users,students:db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND role='student' AND status='active'").get(id).c,teachers:db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND role='teacher' AND status='active'").get(id).c,classes:db.prepare("SELECT COUNT(*) c FROM classes WHERE institution_id=?").get(id).c,materials:count("materials"),assignments:count("assignments"),assessments:count("assessments")});
});
app.get("/api/admin/users",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT u.id,u.name,u.email,u.role,m.role institution_role,u.phone,u.bio,u.created_at FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE m.institution_id=? AND m.status='active' ORDER BY m.role,u.name").all(req.user.institution_id)));
app.patch("/api/admin/users/:id",auth,roles("admin"),(req,res)=>{
  const role=["admin","teacher","student"].includes(req.body.role)?req.body.role:null;
  const u=db.prepare("SELECT u.* FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE u.id=? AND m.institution_id=? AND m.status='active'").get(req.params.id,req.user.institution_id);
  if(!u) return res.status(404).json({error:"User not found in this school"});
  db.prepare("UPDATE users SET name=?,phone=?,bio=? WHERE id=?").run(req.body.name??u.name,req.body.phone??u.phone,req.body.bio??u.bio,u.id);
  if(role) db.prepare("UPDATE institution_memberships SET role=? WHERE institution_id=? AND user_id=?").run(role==="admin"?"school_admin":role,req.user.institution_id,u.id);
  log(req.user.id,"Updated user",String(u.id),req.user.institution_id); res.json({ok:true});
});
app.delete("/api/admin/users/:id",auth,roles("admin"),(req,res)=>{
  if(Number(req.params.id)===req.user.id) return res.status(400).json({error:"You cannot delete yourself"});
  const target=db.prepare("SELECT user_id FROM institution_memberships WHERE institution_id=? AND user_id=?").get(req.user.institution_id,req.params.id);
  if(!target) return res.status(404).json({error:"User not found in this school"});
  db.prepare("DELETE FROM institution_memberships WHERE institution_id=? AND user_id=?").run(req.user.institution_id,req.params.id);
  log(req.user.id,"Removed school membership",String(req.params.id),req.user.institution_id); res.json({ok:true});
});
app.get("/api/audit",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.institution_id=? ORDER BY a.id DESC LIMIT 100").all(req.user.institution_id)));

app.get("/api/classes",auth,async(req,res,next)=>{
  try {
    const rows=await classesRepository.listForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) { next(error); }
});
app.post("/api/classes",auth,roles("admin","teacher"),(req,res)=>{
  const code=(req.body.code||("MC"+Math.random().toString(36).slice(2,8))).toUpperCase();
  try{
    const teacherId=req.user.institution_role==="teacher"?req.user.id:(req.body.teacher_id||null);
    if(teacherId && !db.prepare("SELECT 1 FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='teacher' AND status='active'").get(req.user.institution_id,teacherId)) return res.status(400).json({error:"Teacher must belong to this school"});
    const r=db.prepare("INSERT INTO classes(name,code,description,teacher_id,live_link,institution_id) VALUES(?,?,?,?,?,?)").run(req.body.name,code,req.body.description||"",teacherId,req.body.live_link||"",req.user.institution_id);
    log(req.user.id,"Created class",String(r.lastInsertRowid),req.user.institution_id); res.json(db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=?").get(r.lastInsertRowid,req.user.institution_id));
  }catch(e){res.status(400).json({error:"Class code must be unique"});}
});
app.patch("/api/classes/:id",auth,roles("admin","teacher"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=?").get(req.params.id,req.user.institution_id); if(!c) return res.status(404).json({error:"Not found"});
  if(req.user.role==="teacher"&&c.teacher_id!==req.user.id) return res.status(403).json({error:"Not your class"});
  const nextTeacher=req.user.institution_role==="school_admin"?(req.body.teacher_id??c.teacher_id):c.teacher_id;
  if(nextTeacher && !db.prepare("SELECT 1 FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='teacher' AND status='active'").get(req.user.institution_id,nextTeacher)) return res.status(400).json({error:"Teacher must belong to this school"});
  db.prepare("UPDATE classes SET name=?,description=?,live_link=?,teacher_id=? WHERE id=? AND institution_id=?").run(req.body.name??c.name,req.body.description??c.description,req.body.live_link??c.live_link,nextTeacher,c.id,req.user.institution_id);
  res.json(db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=?").get(c.id,req.user.institution_id));
});
app.delete("/api/classes/:id",auth,roles("admin","teacher"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=?").get(req.params.id,req.user.institution_id); if(!c) return res.status(404).json({error:"Not found"});
  if(req.user.role==="teacher"&&c.teacher_id!==req.user.id) return res.status(403).json({error:"Not your class"});
  db.prepare("DELETE FROM classes WHERE id=?").run(c.id); log(req.user.id,"Deleted class",String(c.id),req.user.institution_id); res.json({ok:true});
});
app.post("/api/classes/join",auth,roles("student"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE code=? AND institution_id=?").get(String(req.body.code||"").toUpperCase(),req.user.institution_id);
  if(!c) return res.status(404).json({error:"Class code not found"});
  db.prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id) VALUES(?,?)").run(c.id,req.user.id); notify(c.teacher_id,"New student joined",db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id).name+" joined "+c.name,req.user.institution_id); res.json(c);
});
app.get("/api/classes/:id/students",auth,(req,res)=>{
  if(!classForUser(req.user,req.params.id)) return res.status(403).json({error:"Not allowed"});
  const rows=req.user.institution_role==="student"
    ? db.prepare("SELECT u.id,u.name FROM users u JOIN enrollments e ON e.student_id=u.id JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.status='active' AND m.role='student' WHERE e.class_id=? ORDER BY u.name").all(req.user.institution_id,req.params.id)
    : db.prepare("SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN enrollments e ON e.student_id=u.id JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.status='active' AND m.role='student' WHERE e.class_id=? ORDER BY u.name").all(req.user.institution_id,req.params.id);
  res.json(rows);
});
app.get("/api/students",auth,roles("admin","teacher"),(req,res)=>{
  const rows=req.user.institution_role==="school_admin"?db.prepare("SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE m.institution_id=? AND m.role='student' AND m.status='active' ORDER BY u.name").all(req.user.institution_id):db.prepare("SELECT DISTINCT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN institution_memberships m ON m.user_id=u.id JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id WHERE m.institution_id=? AND m.status='active' AND c.institution_id=? AND c.teacher_id=? ORDER BY u.name").all(req.user.institution_id,req.user.institution_id,req.user.id);
  res.json(rows);
});
app.get("/api/teachers",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE m.institution_id=? AND m.role='teacher' AND m.status='active' ORDER BY u.name").all(req.user.institution_id)));

app.post("/api/subjects",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id); if(!c)return res.status(403).json({error:"Not allowed"}); const r=db.prepare("INSERT INTO subjects(name,class_id,teacher_id) VALUES(?,?,?)").run(req.body.name,c.id,req.user.id); res.json(db.prepare("SELECT * FROM subjects WHERE id=?").get(r.lastInsertRowid));});
app.get("/api/subjects",auth,async(req,res,next)=>{
  try {
    const rows=await classesRepository.listSubjectsForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) { next(error); }
});
app.post("/api/timetable",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});const subjectId=req.body.subject_id||null;if(subjectId&&!db.prepare("SELECT 1 FROM subjects WHERE id=? AND class_id=?").get(subjectId,c.id))return res.status(400).json({error:"Subject must belong to this class"});const r=db.prepare("INSERT INTO timetable(class_id,subject_id,day,start_time,end_time,room) VALUES(?,?,?,?,?,?)").run(c.id,subjectId,req.body.day,req.body.start_time,req.body.end_time,req.body.room||"");res.json({id:r.lastInsertRowid});});
app.get("/api/timetable",auth,(req,res)=>{let sql=`SELECT t.*,c.name class_name,s.name subject_name FROM timetable t LEFT JOIN classes c ON c.id=t.class_id LEFT JOIN subjects s ON s.id=t.subject_id`;let rows;if(req.user.institution_role==="student") rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=t.class_id WHERE c.institution_id=? AND e.student_id=? ORDER BY CASE t.day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 ELSE 6 END,t.start_time").all(req.user.institution_id,req.user.id);else if(req.user.institution_role==="teacher")rows=db.prepare(sql+" WHERE c.institution_id=? AND (c.teacher_id=? OR t.subject_id IN (SELECT id FROM subjects WHERE teacher_id=?)) ORDER BY t.day,t.start_time").all(req.user.institution_id,req.user.id,req.user.id);else rows=db.prepare(sql+" WHERE c.institution_id=? ORDER BY t.day,t.start_time").all(req.user.institution_id);res.json(rows);});

const upload=multer({storage:storage.multerStorage(),limits:{fileSize:10*1024*1024}});
app.post("/api/materials",auth,roles("admin","teacher"),upload.single("file"),(req,res)=>{
  const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});
  const file=req.file?"/uploads/"+req.file.filename:"";
  const r=db.prepare("INSERT INTO materials(title,description,url,file_url,class_id,teacher_id) VALUES(?,?,?,?,?,?)").run(req.body.title,req.body.description||"",req.body.url||"",file,c.id,req.user.id);
  const students=db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id);students.forEach(s=>notify(s.student_id,"New learning material",req.body.title,req.user.institution_id));
  res.json(db.prepare("SELECT * FROM materials WHERE id=?").get(r.lastInsertRowid));
});
app.get("/api/materials/:id/file",auth,(req,res)=>{
  const material=db.prepare("SELECT m.file_url,m.class_id FROM materials m WHERE m.id=?").get(req.params.id);
  if(!material||!material.file_url) return res.status(404).json({error:"File not found"});
  if(!classForUser(req.user,material.class_id)) return res.status(404).json({error:"File not found"});
  const filename=path.basename(material.file_url);
  const filePath=storage.resolveStoredFile(filename);
  if(!filePath || !storage.exists(filename)) return res.status(404).json({error:"File not found"});
  res.sendFile(filePath);
});
app.get("/api/materials",auth,async(req,res,next)=>{try{const rows=await learningContentRepository.listMaterialsForUser(req.user.id,req.user.institution_id,req.user.institution_role);res.json(rows);}catch(error){next(error);}});

app.post("/api/assignments",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});const r=db.prepare("INSERT INTO assignments(title,description,due_date,class_id,teacher_id,max_score) VALUES(?,?,?,?,?,?)").run(req.body.title,req.body.description||"",req.body.due_date||null,c.id,req.user.id,Number(req.body.max_score||100));db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id).forEach(s=>notify(s.student_id,"New assignment",req.body.title,req.user.institution_id));res.json(db.prepare("SELECT * FROM assignments WHERE id=?").get(r.lastInsertRowid));});
app.get("/api/assignments",auth,async(req,res,next)=>{try{const rows=await learningContentRepository.listAssignmentsForUser(req.user.id,req.user.institution_id,req.user.institution_role);res.json(rows);}catch(error){next(error);}});
app.post("/api/assignments/:id/submit",auth,roles("student"),(req,res)=>{const a=db.prepare("SELECT * FROM assignments WHERE id=?").get(req.params.id);if(!a||!classForUser(req.user,a.class_id)||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(a.class_id,req.user.id))return res.status(403).json({error:"Not allowed"});db.prepare("INSERT INTO submissions(assignment_id,student_id,answer) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET answer=excluded.answer,submitted_at=CURRENT_TIMESTAMP").run(a.id,req.user.id,req.body.answer||"");notify(a.teacher_id,"Assignment submitted",req.user.name+" submitted "+a.title,req.user.institution_id);res.json({ok:true});});
app.get("/api/submissions",auth,(req,res)=>{
  const sql=`SELECT s.*,a.title,a.max_score,a.class_id,u.name student_name,u.email
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id
    JOIN classes c ON c.id=a.class_id JOIN users u ON u.id=s.student_id
    JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.status='active'`;
  let rows;
  if(req.user.institution_role==="student") rows=db.prepare(sql+" WHERE c.institution_id=? AND s.student_id=? ORDER BY s.id DESC").all(req.user.institution_id,req.user.institution_id,req.user.id);
  else if(req.user.institution_role==="teacher") rows=db.prepare(sql+" WHERE c.institution_id=? AND (a.teacher_id=? OR c.teacher_id=?) ORDER BY s.id DESC").all(req.user.institution_id,req.user.institution_id,req.user.id,req.user.id);
  else rows=db.prepare(sql+" WHERE c.institution_id=? ORDER BY s.id DESC").all(req.user.institution_id,req.user.institution_id);
  res.json(rows);
});
app.patch("/api/submissions/:id/grade",auth,roles("admin","teacher"),(req,res)=>{
  const sub=db.prepare(`SELECT s.*,a.teacher_id,a.class_id,c.teacher_id class_teacher_id,c.institution_id
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN classes c ON c.id=a.class_id
    WHERE s.id=? AND c.institution_id=?`).get(req.params.id,req.user.institution_id);
  if(!sub)return res.status(404).json({error:"Submission not found in this school"});
  if(req.user.institution_role==="teacher"&&sub.teacher_id!==req.user.id&&sub.class_teacher_id!==req.user.id)return res.status(403).json({error:"Not allowed"});
  db.prepare("UPDATE submissions SET score=?,feedback=? WHERE id=?").run(Number(req.body.score),req.body.feedback||"",sub.id);
  notify(sub.student_id,"Assignment graded","Your "+db.prepare("SELECT title FROM assignments WHERE id=?").get(sub.assignment_id).title+" has been graded.",req.user.institution_id);
  res.json({ok:true});
});

app.post("/api/assessments",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});let questions;try{questions=normalizeQuestions(req.body.questions);}catch(e){return res.status(400).json({error:e.message});}if(!questions.length)return res.status(400).json({error:"Add at least one valid question"});const r=db.prepare("INSERT INTO assessments(title,type,duration_minutes,class_id,teacher_id,pass_mark,questions_json) VALUES(?,?,?,?,?,?,?)").run(req.body.title,req.body.type||"quiz",Number(req.body.duration_minutes||20),c.id,req.user.id,Number(req.body.pass_mark||50),JSON.stringify(questions));db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id).forEach(s=>notify(s.student_id,"New assessment",req.body.title,req.user.institution_id));res.json({id:r.lastInsertRowid});});
app.get("/api/assessments",auth,(req,res)=>{let sql="SELECT a.*,c.name class_name,u.name teacher_name FROM assessments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN users u ON u.id=a.teacher_id";let rows;if(req.user.institution_role==="student")rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=a.class_id WHERE c.institution_id=? AND e.student_id=? ORDER BY a.id DESC").all(req.user.institution_id,req.user.id);else if(req.user.institution_role==="teacher")rows=db.prepare(sql+" WHERE c.institution_id=? AND (a.teacher_id=? OR c.teacher_id=?) ORDER BY a.id DESC").all(req.user.institution_id,req.user.id,req.user.id);else rows=db.prepare(sql+" WHERE c.institution_id=? ORDER BY a.id DESC").all(req.user.institution_id);res.json(rows.map(x=>({...x,question_count:JSON.parse(x.questions_json).length})));});
app.post("/api/assessments/:id/start",auth,roles("student"),(req,res)=>{
  const a=db.prepare("SELECT * FROM assessments WHERE id=?").get(req.params.id);if(!a||!classForUser(req.user,a.class_id)||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(a.class_id,req.user.id))return res.status(403).json({error:"Not allowed"});
  const existing=db.prepare("SELECT * FROM attempts WHERE assessment_id=? AND student_id=?").get(a.id,req.user.id);
  if(existing&&existing.status==="submitted")return res.status(400).json({error:"Assessment already submitted",attempt:existing});
  if(existing)return res.json({attempt:existing,questions:JSON.parse(a.questions_json).map(q=>({question:q.question,options:q.options}))});
  const expires=new Date(Date.now()+Number(a.duration_minutes||20)*60000).toISOString();
  const r=db.prepare("INSERT INTO attempts(assessment_id,student_id,expires_at) VALUES(?,?,?)").run(a.id,req.user.id,expires);
  res.json({attempt:db.prepare("SELECT * FROM attempts WHERE id=?").get(r.lastInsertRowid),questions:JSON.parse(a.questions_json).map(q=>({question:q.question,options:q.options}))});
});
app.post("/api/assessments/:id/submit",auth,roles("student"),(req,res)=>{
  const a=db.prepare("SELECT * FROM assessments WHERE id=?").get(req.params.id), at=db.prepare("SELECT * FROM attempts WHERE assessment_id=? AND student_id=?").get(req.params.id,req.user.id);
  if(!a||!at||!classForUser(req.user,a.class_id))return res.status(400).json({error:"Attempt not found"}); if(at.status==="submitted")return res.json(at);
  const questions=JSON.parse(a.questions_json), answers=req.body.answers||{}, expired=new Date(at.expires_at).getTime()<Date.now();
  let score=0;questions.forEach((q,i)=>{if(Number(answers[i])===Number(q.answer))score++;});
  const pct=questions.length?Math.round(score/questions.length*100):0, status=pct>=a.pass_mark?"PASS":"FAIL";
  db.prepare("UPDATE attempts SET submitted_at=CURRENT_TIMESTAMP,score=?,percentage=?,status=?,answers_json=? WHERE id=?").run(score,pct,status,JSON.stringify(answers),at.id);
  res.json(db.prepare("SELECT * FROM attempts WHERE id=?").get(at.id));
});
app.get("/api/results",auth,(req,res)=>{let sql=`SELECT at.*,a.title,a.type,a.pass_mark,c.name class_name,u.name student_name FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id JOIN users u ON u.id=at.student_id`;let rows=req.user.institution_role==="student"?db.prepare(sql+" WHERE c.institution_id=? AND at.student_id=? ORDER BY at.id DESC").all(req.user.institution_id,req.user.id):req.user.institution_role==="teacher"?db.prepare(sql+" WHERE c.institution_id=? AND (a.teacher_id=? OR c.teacher_id=?) ORDER BY at.id DESC").all(req.user.institution_id,req.user.id,req.user.id):db.prepare(sql+" WHERE c.institution_id=? ORDER BY at.id DESC").all(req.user.institution_id);res.json(rows);});
app.get("/api/gradebook",auth,roles("admin","teacher"),(req,res)=>{let sql=`SELECT u.id student_id,u.name student_name,c.id class_id,c.name class_name,
(SELECT ROUND(AVG(at.percentage),1) FROM attempts at JOIN assessments aa ON aa.id=at.assessment_id WHERE at.student_id=u.id AND aa.class_id=c.id AND at.status='submitted') assessment_average,
(SELECT ROUND(AVG(s.score*100.0/a.max_score),1) FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.student_id=u.id AND a.class_id=c.id AND s.score IS NOT NULL) assignment_average
FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.status='active' WHERE u.role='student' AND c.institution_id=?`;
let rows=req.user.institution_role==="teacher"?db.prepare(sql+" AND c.teacher_id=? ORDER BY c.name,u.name").all(req.user.institution_id,req.user.institution_id,req.user.id):db.prepare(sql+" ORDER BY c.name,u.name").all(req.user.institution_id,req.user.institution_id);res.json(rows);});
app.get("/api/performance",auth,(req,res)=>{const studentId=req.user.institution_role==="student"?req.user.id:Number(req.query.student_id||0);if(!studentId)return res.status(400).json({error:"student_id required"});const user=db.prepare("SELECT u.id,u.name,u.email FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE u.id=? AND u.role='student' AND m.institution_id=? AND m.status='active'").get(studentId,req.user.institution_id);if(!user)return res.status(404).json({error:"Student not found in this school"});if(req.user.institution_role==="teacher"&&!db.prepare("SELECT 1 FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=? AND c.teacher_id=? AND c.institution_id=?").get(studentId,req.user.id,req.user.institution_id))return res.status(403).json({error:"Not allowed"});const results=db.prepare("SELECT a.title,a.type,at.percentage,at.status,at.submitted_at FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id WHERE at.student_id=? AND c.institution_id=? AND at.status='submitted' ORDER BY at.id").all(studentId,req.user.institution_id);const attendance=db.prepare("SELECT att.status,COUNT(*) c FROM attendance att JOIN classes c ON c.id=att.class_id WHERE att.student_id=? AND c.institution_id=? GROUP BY att.status").all(studentId,req.user.institution_id);res.json({student:user,results,attendance});});
app.get("/api/rankings/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});const rows=db.prepare(`SELECT u.id,u.name,ROUND(COALESCE(AVG(at.percentage),0),1) average FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attempts at ON at.student_id=u.id AND at.status='submitted' LEFT JOIN assessments a ON a.id=at.assessment_id AND a.class_id=e.class_id WHERE e.class_id=? GROUP BY u.id ORDER BY average DESC,u.name`).all(req.params.classId);res.json(rows.map((x,i)=>({...x,rank:i+1})));});
app.get("/api/export/gradebook.csv",auth,roles("admin","teacher"),(req,res)=>{
  const base=`SELECT u.name student,c.name class_name,COALESCE(ROUND(AVG(at.percentage),1),0) assessment_average
    FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id
    JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.status='active'
    LEFT JOIN assessments a ON a.class_id=c.id
    LEFT JOIN attempts at ON at.assessment_id=a.id AND at.student_id=u.id AND at.status='submitted'
    WHERE c.institution_id=?`;
  const rows=req.user.institution_role==="teacher"
    ?db.prepare(base+" AND c.teacher_id=? GROUP BY u.id,c.id").all(req.user.institution_id,req.user.institution_id,req.user.id)
    :db.prepare(base+" GROUP BY u.id,c.id").all(req.user.institution_id,req.user.institution_id);
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=["Student,Class,Assessment Average",...rows.map(r=>[r.student,r.class_name,r.assessment_average].map(esc).join(","))].join("\n");
  res.type("text/csv").send(csv);
});

app.post("/api/attendance",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});const student=db.prepare("SELECT 1 FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(req.user.institution_id,req.body.student_id);if(!student||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(c.id,req.body.student_id))return res.status(400).json({error:"Student is not enrolled in this class"});db.prepare("INSERT INTO attendance(class_id,student_id,date,status) VALUES(?,?,?,?) ON CONFLICT(class_id,student_id,date) DO UPDATE SET status=excluded.status").run(c.id,req.body.student_id,req.body.date,req.body.status||"present");res.json({ok:true});});
app.get("/api/attendance/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});const date=req.query.date||new Date().toISOString().slice(0,10);const rows=db.prepare(`SELECT u.id,u.name,u.email,COALESCE(att.status,'present') status FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id AND att.date=? WHERE e.class_id=? ORDER BY u.name`).all(date,req.params.classId);res.json({date,students:rows});});
app.get("/api/attendance-summary/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});res.json(db.prepare(`SELECT u.id,u.name,COUNT(att.id) total,SUM(CASE WHEN att.status='present' THEN 1 ELSE 0 END) present,SUM(CASE WHEN att.status='absent' THEN 1 ELSE 0 END) absent,SUM(CASE WHEN att.status='late' THEN 1 ELSE 0 END) late FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id WHERE e.class_id=? GROUP BY u.id ORDER BY u.name`).all(req.params.classId));});

app.post("/api/announcements",auth,roles("admin","teacher"),(req,res)=>{const c=req.body.class_id?classForUser(req.user,req.body.class_id):null;if(req.body.class_id&&!c)return res.status(403).json({error:"Not allowed"});const r=db.prepare("INSERT INTO announcements(title,body,class_id,author_id,institution_id) VALUES(?,?,?,?,?)").run(req.body.title,req.body.body,req.body.class_id||null,req.user.id,req.user.institution_id);const targets=req.body.class_id?db.prepare("SELECT e.student_id FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.class_id=? AND c.institution_id=?").all(req.body.class_id,req.user.institution_id).map(x=>x.student_id):db.prepare("SELECT m.user_id id FROM institution_memberships m WHERE m.institution_id=? AND m.role='student' AND m.status='active'").all(req.user.institution_id).map(x=>x.id);targets.forEach(id=>notify(id,req.body.title,req.body.body,req.user.institution_id));res.json({id:r.lastInsertRowid});});
app.get("/api/announcements",auth,async(req,res,next)=>{try{const rows=await announcementsRepository.listForUser(req.user.id,req.user.institution_id,req.user.institution_role==="student");res.json(rows);}catch(error){next(error);}});
app.get("/api/notifications",auth,async(req,res,next)=>{
  try {
    const rows = await notificationsRepository.listForUser(req.user.id, req.user.institution_id);
    res.json(rows);
  } catch (error) { next(error); }
});
app.patch("/api/notifications/:id/read",auth,async(req,res,next)=>{
  try {
    await notificationsRepository.markRead(req.params.id, req.user.id, req.user.institution_id);
    res.json({ok:true});
  } catch (error) { next(error); }
});

app.get("/api/messages",auth,async(req,res,next)=>{
  try {
    const rows = await messagesRepository.listForUser(req.user.id, req.user.institution_id);
    res.json(rows);
  } catch (error) { next(error); }
});
app.post("/api/messages",auth,(req,res)=>{const receiver=db.prepare("SELECT u.id FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE u.id=? AND m.institution_id=? AND m.status='active'").get(req.body.receiver_id,req.user.institution_id);if(!receiver)return res.status(404).json({error:"Recipient not found in this school"});const r=db.prepare("INSERT INTO messages(sender_id,receiver_id,subject,body,institution_id) VALUES(?,?,?,?,?)").run(req.user.id,receiver.id,req.body.subject||"",req.body.body||"",req.user.institution_id);notify(receiver.id,"New message","You have a new message from "+req.user.name,req.user.institution_id);res.json({id:r.lastInsertRowid});});
app.patch("/api/messages/:id/read",auth,async(req,res,next)=>{
  try {
    await messagesRepository.markRead(req.params.id, req.user.id, req.user.institution_id);
    res.json({ok:true});
  } catch (error) { next(error); }
});

app.get("/api/report-card/:studentId",auth,(req,res)=>{
  const sid=Number(req.params.studentId);
  if(req.user.role==="student"&&req.user.id!==sid)return res.status(403).json({error:"Not allowed"});
  if(req.user.institution_role==="teacher"){const ok=db.prepare("SELECT 1 FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=? AND c.teacher_id=? AND c.institution_id=?").get(sid,req.user.id,req.user.institution_id);if(!ok)return res.status(403).json({error:"Not allowed"});}
  const student=db.prepare("SELECT u.id,u.name,u.email FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE u.id=? AND m.institution_id=? AND m.status='active'").get(sid,req.user.institution_id);
  if(!student) return res.status(404).json({error:"Student not found in this school"});
  const subjects=db.prepare(`SELECT s.name subject,ROUND(COALESCE(AVG(at.percentage),0),1) average FROM subjects s JOIN classes c ON c.id=s.class_id LEFT JOIN assessments a ON a.class_id=s.class_id LEFT JOIN attempts at ON at.assessment_id=a.id AND at.student_id=? AND at.status='submitted' WHERE c.institution_id=? AND s.class_id IN (SELECT class_id FROM enrollments WHERE student_id=?) GROUP BY s.id`).all(sid,req.user.institution_id,sid);
  const att=db.prepare("SELECT COUNT(*) total,SUM(att.status='present') present,SUM(att.status='absent') absent,SUM(att.status='late') late FROM attendance att JOIN classes c ON c.id=att.class_id WHERE att.student_id=? AND c.institution_id=?").get(sid,req.user.institution_id);
  const school=db.prepare("SELECT value FROM institution_settings WHERE key='school_name' AND institution_id=?").get(req.user.institution_id)?.value||req.user.institution_name||"MyClassroom Academy";
  res.json({school,student,subjects,attendance:att});
});
app.get("/api/settings",auth,async(req,res,next)=>{
  try {
    const rows = await settingsRepository.listForInstitution(req.user.institution_id);
    res.json(Object.fromEntries(rows.map(({key,value})=>[key,value])));
  } catch (error) { next(error); }
});
app.patch("/api/settings",auth,roles("admin"),async(req,res,next)=>{
  try {
    await settingsRepository.updateForInstitution(req.user.institution_id, req.body);
    log(req.user.id,"Updated school settings","",req.user.institution_id);
    res.json({ok:true});
  } catch (error) { next(error); }
});

app.get("/api/dashboard",auth,(req,res)=>{
  const institutionId=req.user.institution_id;
  if(req.user.institution_role==="school_admin")return res.json({role:"admin",stats:{
    users:db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND status='active'").get(institutionId).c,
    students:db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND role='student' AND status='active'").get(institutionId).c,
    teachers:db.prepare("SELECT COUNT(*) c FROM institution_memberships WHERE institution_id=? AND role='teacher' AND status='active'").get(institutionId).c,
    classes:db.prepare("SELECT COUNT(*) c FROM classes WHERE institution_id=?").get(institutionId).c
  }});
  if(req.user.institution_role==="teacher")return res.json({role:"teacher",stats:{
    classes:db.prepare("SELECT COUNT(*) c FROM classes WHERE institution_id=? AND teacher_id=?").get(institutionId,req.user.id).c,
    students:db.prepare("SELECT COUNT(DISTINCT e.student_id) c FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.institution_id=? AND c.teacher_id=?").get(institutionId,req.user.id).c,
    pending:db.prepare("SELECT COUNT(*) c FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN classes c ON c.id=a.class_id WHERE c.institution_id=? AND (a.teacher_id=? OR c.teacher_id=?) AND s.score IS NULL").get(institutionId,req.user.id,req.user.id).c,
    assessments:db.prepare("SELECT COUNT(*) c FROM assessments a JOIN classes c ON c.id=a.class_id WHERE c.institution_id=? AND a.teacher_id=?").get(institutionId,req.user.id).c
  }});
  return res.json({role:"student",stats:{
    classes:db.prepare("SELECT COUNT(*) c FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.institution_id=? AND e.student_id=?").get(institutionId,req.user.id).c,
    assignments:db.prepare("SELECT COUNT(*) c FROM assignments a JOIN enrollments e ON e.class_id=a.class_id JOIN classes c ON c.id=a.class_id WHERE c.institution_id=? AND e.student_id=?").get(institutionId,req.user.id).c,
    assessments:db.prepare("SELECT COUNT(*) c FROM assessments a JOIN enrollments e ON e.class_id=a.class_id JOIN classes c ON c.id=a.class_id WHERE c.institution_id=? AND e.student_id=?").get(institutionId,req.user.id).c,
    average:db.prepare("SELECT ROUND(COALESCE(AVG(at.percentage),0),1) c FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id WHERE c.institution_id=? AND at.student_id=? AND at.status='submitted'").get(institutionId,req.user.id).c
  }});
});

app.get("/platform-owner",(req,res)=>res.sendFile(path.join(PUBLIC,"platform-owner.html")));
app.get("/api/health",(req,res)=>res.json({ok:true,version:"12.0.0"}));
app.use(express.static(PUBLIC));
app.get("*",(req,res)=>res.sendFile(path.join(PUBLIC,"index.html")));

app.listen(PORT,()=>console.log(`MyClassroom V12 running on http://localhost:${PORT}`));
