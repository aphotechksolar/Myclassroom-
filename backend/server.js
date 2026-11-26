const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { createDatabase } = require("./db");
const { createSessionStore } = require("./auth/sessions");
const { openAsyncSqliteDatabase } = require("./db/sqlite-async");
const { createSettingsRepository } = require("./repositories/settings");
const { createNotificationsRepository } = require("./repositories/notifications");
const { createAnnouncementsRepository } = require("./repositories/announcements");
const { createMessagesRepository } = require("./repositories/messages");
const { createClassesRepository } = require("./repositories/classes");
const { createLearningContentRepository } = require("./repositories/learning-content");
const { createSubmissionRepository } = require("./repositories/submissions");
const { createAssessmentsRepository } = require("./repositories/assessments");
const { createTimetableRepository } = require("./repositories/timetable");
const { createPeopleRepository } = require("./repositories/people");
const { createAttendanceRepository } = require("./repositories/attendance");
const { createGradebookRepository } = require("./repositories/gradebook");
const { createPerformanceRepository } = require("./repositories/performance");
const { createStorage } = require("./storage");
const multer = require("multer");
const { validateMaterialUpload } = require("./uploads/validation");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "..", "frontend");
const DATA = path.resolve(process.env.MYCLASSROOM_DATA_DIR || path.join(ROOT, "data"));
const UPLOADS = path.resolve(process.env.MYCLASSROOM_UPLOADS_DIR || path.join(ROOT, "uploads"));


const appOrigin = String(process.env.APP_ORIGIN || "").trim();
const allowedOrigins = [...new Set([...(process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean), ...(appOrigin ? [appOrigin] : [])])];
const corsOptions = { origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed by CORS"));
}};
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({limit:"2mb"}));
app.use((req,res,next)=>{
  if (["GET","HEAD","OPTIONS"].includes(req.method)) return next();
  const origin=req.get("origin");
  if (!origin) return process.env.NODE_ENV === "production"
    ? res.status(403).json({error:"A valid request origin is required."}) : next();
  const localOrigin=process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowedOrigins.includes(origin) && !localOrigin) return res.status(403).json({error:"Request origin is not allowed."});
  next();
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 100 : 10, standardHeaders: true, legacyHeaders: false, skip: req => req.path === "/csrf", message: { error: "Too many authentication attempts. Please try again later." } });
app.use("/api/auth", authLimiter);
// Uploaded learning files are served only through authenticated, institution-scoped routes.

const db = createDatabase(path.join(DATA, "myclassroom.db"));
const sessionStore = createSessionStore(db);
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mc_session" : "mc_session";
const SESSION_COOKIE_SECURE = process.env.NODE_ENV === "production";
function readCookie(req,name) {
  const header=String(req.headers.cookie||"");
  for (const part of header.split(";")) {
    const index=part.indexOf("=");
    if(index<0) continue;
    if(part.slice(0,index).trim()===name) {
      try { return decodeURIComponent(part.slice(index+1).trim()); } catch { return null; }
    }
  }
  return null;
}
function setSessionCookie(res,sessionId) {
  const secure=SESSION_COOKIE_SECURE?"; Secure":"";
  res.setHeader("Set-Cookie",SESSION_COOKIE+"="+encodeURIComponent(sessionId)+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800"+secure);
}
function clearSessionCookie(res) {
  const secure=SESSION_COOKIE_SECURE?"; Secure":"";
  res.setHeader("Set-Cookie",SESSION_COOKIE+"=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"+secure);
}
function issueSession(user,institutionId,res) {
  res.setHeader("Cache-Control","no-store");
  const membership=activeMembership(user.id,institutionId);
  if(!membership) throw new Error("User has no active institution membership");
  const session=sessionStore.create({userId:user.id,institutionId:membership.institution_id});
  setSessionCookie(res,session.sessionId);
  const safeUser={id:user.id,name:user.name,email:user.email,role:membership.role==="school_admin"?"admin":membership.role,phone:user.phone||"",bio:user.bio||"",institution_id:membership.institution_id,institution_name:membership.institution_name,institution_role:membership.role};
  return {user:safeUser,csrfToken:session.csrfToken,...(process.env.NODE_ENV==="test"?{token:session.sessionId}:{})};
}
const asyncDb = openAsyncSqliteDatabase(db);
const settingsRepository = createSettingsRepository(asyncDb);
const notificationsRepository = createNotificationsRepository(asyncDb);
const announcementsRepository = createAnnouncementsRepository(asyncDb);
const messagesRepository = createMessagesRepository(asyncDb);
const classesRepository = createClassesRepository(asyncDb);
const learningContentRepository = createLearningContentRepository(asyncDb);
const submissionRepository = createSubmissionRepository(asyncDb);
const assessmentsRepository = createAssessmentsRepository(asyncDb);
const timetableRepository = createTimetableRepository(asyncDb);
const peopleRepository = createPeopleRepository(asyncDb);
const attendanceRepository = createAttendanceRepository(asyncDb);
const gradebookRepository = createGradebookRepository(asyncDb);
const performanceRepository = createPerformanceRepository(asyncDb);
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

db.exec("CREATE TABLE IF NOT EXISTS password_change_required (user_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);");

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
  CREATE TABLE IF NOT EXISTS guardian_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS guardian_student_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id TEXT NOT NULL,
    guardian_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('verified','revoked')),
    verified_by INTEGER NOT NULL,
    verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(institution_id,guardian_id,student_id),
    FOREIGN KEY(institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    FOREIGN KEY(guardian_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(verified_by) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_guardian_links_guardian ON guardian_student_links(institution_id,guardian_id,status);
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
      AND m.role IN ('school_admin','teacher','student','parent')`;
  return institutionId
    ? db.prepare(sql + " AND m.institution_id=?").get(userId,institutionId)
    : db.prepare(sql + " ORDER BY m.created_at LIMIT 1").get(userId);
}
function auth(req,res,next){
  const cookieSessionId=readCookie(req,SESSION_COOKIE);
  let rawSessionId=cookieSessionId;
  let session=rawSessionId?sessionStore.get(rawSessionId):null;
  if(!session && process.env.NODE_ENV==="test") {
    const h=req.headers.authorization||"";
    const testToken=h.startsWith("Bearer ")?h.slice(7):null;
    if(testToken){rawSessionId=testToken;session=sessionStore.get(testToken);}
  }
  if(!session) return res.status(401).json({error:"Authentication required or session expired"});
  if(!["GET","HEAD","OPTIONS"].includes(req.method)) {
    if(!sessionStore.verifyCsrf(session,req.get("x-csrf-token"))) return res.status(403).json({error:"Your security token is missing or expired. Refresh the page and try again."});
  }
  const membership=activeMembership(session.user_id,session.institution_id);
  if(!membership) return res.status(403).json({error:"No active institution membership. Contact your school administrator."});
  const account=db.prepare("SELECT id,name,email,role,phone,bio FROM users WHERE id=?").get(session.user_id);
  if(!account) return res.status(401).json({error:"Account no longer exists"});
  req.sessionId=rawSessionId;
  req.session=session;
  req.user={...account,institution_id:membership.institution_id,institution_role:membership.role,institution_name:membership.institution_name,role:membership.role==="school_admin"?"admin":membership.role};
  const mustChangePassword=!!db.prepare("SELECT 1 FROM password_change_required WHERE user_id=?").get(req.user.id);
  if(mustChangePassword && !(req.method==="POST" && req.path==="/api/auth/change-password")) return res.status(403).json({error:"You must change your temporary password before accessing your portal.",mustChangePassword:true});
  if(membership.role==="parent" && !/^\/api\/guardian\/(children(?:\/\d+\/performance)?)?$/.test(req.path)) {
    return res.status(403).json({error:"Parent accounts can only access their verified children's information."});
  }
  next();
}
function roles(...allowed){ return (req,res,next)=>{
  const role=req.user.institution_role==="school_admin"?"admin":req.user.institution_role;
  return allowed.includes(role)?next():res.status(403).json({error:"Not allowed"});
}; }
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
 (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id AND m.status='active') active_members,
 (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id AND m.status='active' AND m.role='school_admin') admin_count,
 (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id AND m.status='active' AND m.role='teacher') teacher_count,
 (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id AND m.status='active' AND m.role='student') student_count,
 (SELECT COUNT(*) FROM institution_memberships m JOIN password_change_required p ON p.user_id=m.user_id WHERE m.institution_id=i.id AND m.status='active' AND m.role='school_admin') pending_admin_password_changes,
 (SELECT GROUP_CONCAT(u.name, ', ') FROM institution_memberships m JOIN users u ON u.id=m.user_id WHERE m.institution_id=i.id AND m.status='active' AND m.role='school_admin') admin_names,
 (SELECT GROUP_CONCAT(u.email, ', ') FROM institution_memberships m JOIN users u ON u.id=m.user_id WHERE m.institution_id=i.id AND m.status='active' AND m.role='school_admin') admin_emails,
 (SELECT MAX(activity_at) FROM (
   SELECT created_at AS activity_at FROM audit_log WHERE institution_id=i.id
   UNION ALL
   SELECT created_at AS activity_at FROM platform_audit_log WHERE institution_id=i.id
 )) last_activity_at
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
   db.prepare("INSERT INTO password_change_required(user_id) VALUES(?)").run(user.lastInsertRowid);
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

app.post("/api/auth/csrf",(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const rawSessionId=readCookie(req,SESSION_COOKIE);
  const session=rawSessionId?sessionStore.get(rawSessionId):null;
  if(!session) return res.status(401).json({error:"Session expired. Please sign in again."});
  const csrfToken=sessionStore.refreshCsrf(rawSessionId);
  if(!csrfToken) return res.status(401).json({error:"Session expired. Please sign in again."});
  res.json({csrfToken});
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
    res.status(201).json(issueSession(u,institution.id,res));
  }catch(e){res.status(400).json({error:"Email already exists"});}
});
app.post("/api/auth/guardian/redeem",(req,res)=>{
  const token=String(req.body.token||"").trim();
  const email=String(req.body.email||"").trim().toLowerCase();
  const name=String(req.body.name||"").trim();
  const password=String(req.body.password||"");
  if(token.length<32||token.length>256||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<2||name.length>120||password.length<10||password.length>128) {
    return res.status(400).json({error:"Provide a valid invitation, name, email and password (10-128 characters)."});
  }
  const tokenHash=require("crypto").createHash("sha256").update(token).digest("hex");
  const invitation=db.prepare("SELECT * FROM guardian_invitations WHERE token_hash=? AND email=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").get(tokenHash,email);
  if(!invitation) return res.status(400).json({error:"Invitation is invalid, expired, already used or does not match this email."});
  try {
    const redeem=db.transaction(()=>{
      const claimed=db.prepare("UPDATE guardian_invitations SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").run(invitation.id);
      if(claimed.changes!==1) throw new Error("This invitation has expired or has already been used.");
      let user=db.prepare("SELECT * FROM users WHERE email=?").get(email);
      if(!user) {
        const created=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'student')").run(name,email,bcrypt.hashSync(password,12));
        user=db.prepare("SELECT * FROM users WHERE id=?").get(created.lastInsertRowid);
      } else {
        if(!bcrypt.compareSync(password,user.password_hash)) throw new Error("This email already has an account. Use its existing password to accept the invitation.");
      }
      const membership=db.prepare("SELECT role,status FROM institution_memberships WHERE institution_id=? AND user_id=?").get(invitation.institution_id,user.id);
      if(membership && (membership.role!=="parent" || membership.status!=="active")) throw new Error("This account already has a different or inactive role in this school.");
      db.prepare("INSERT OR IGNORE INTO institution_memberships(institution_id,user_id,role,status) VALUES(?,?,'parent','active')").run(invitation.institution_id,user.id);
      db.prepare("INSERT OR IGNORE INTO guardian_student_links(institution_id,guardian_id,student_id,status,verified_by) VALUES(?,?,?,'verified',?)").run(invitation.institution_id,user.id,invitation.student_id,invitation.created_by);
      return user;
    });
    const user=redeem();
    const issued=issueSession(user,invitation.institution_id,res);
    issued.user.role="parent";
    res.status(201).json(issued);
  } catch(e) {
    res.status(400).json({error:e.message||"Could not redeem invitation"});
  }
});
app.post("/api/auth/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").trim().toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password||"",u.password_hash)) return res.status(401).json({error:"Invalid email or password"});
  const memberships=db.prepare(`SELECT m.institution_id,m.role,i.name institution_name
    FROM institution_memberships m JOIN institutions i ON i.id=m.institution_id
    WHERE m.user_id=? AND m.status='active' AND i.status='active'
      AND m.role IN ('school_admin','teacher','student','parent')
    ORDER BY i.name,m.institution_id`).all(u.id);
  const selectedInstitutionId=String(req.body.institution_id||"").trim();
  if(!selectedInstitutionId && memberships.length>1) {
    return res.status(409).json({
      error:"Choose a school to continue.",
      requiresInstitutionSelection:true,
      institutions:memberships.map(({institution_id,name,institution_name,role})=>({
        institution_id,
        name:institution_name,
        role
      }))
    });
  }
  const membership=selectedInstitutionId
    ? memberships.find(item=>item.institution_id===selectedInstitutionId)
    : memberships[0];
  if(!membership) return res.status(403).json({error:"This account has no active membership in the selected school."});
  const mustChangePassword=!!db.prepare("SELECT 1 FROM password_change_required WHERE user_id=?").get(u.id);
  res.json({...issueSession(u,membership.institution_id,res),must_change_password:mustChangePassword});
});
app.post("/api/auth/switch-institution",auth,(req,res)=>{
  const membership=activeMembership(req.user.id,String(req.body.institution_id||""));
  if(!membership) return res.status(403).json({error:"No active membership in that institution."});
  const user=db.prepare("SELECT id,name,email,role,phone,bio FROM users WHERE id=?").get(req.user.id);
  sessionStore.revoke(req.sessionId);
  res.json(issueSession(user,membership.institution_id,res));
});
app.post("/api/auth/change-password",auth,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if(!u||!bcrypt.compareSync(req.body.currentPassword||"",u.password_hash)) return res.status(400).json({error:"Current password is incorrect"});
  const nextPassword=String(req.body.newPassword||"");
  const mustChange=!!db.prepare("SELECT 1 FROM password_change_required WHERE user_id=?").get(u.id);
  const minimum=mustChange?12:10;
  if(nextPassword.length < minimum || nextPassword.length > 128) return res.status(400).json({error:`New password must be between ${minimum} and 128 characters`});
  if(nextPassword===String(req.body.currentPassword||"")) return res.status(400).json({error:"Choose a password different from your current password"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(nextPassword,12),u.id);
  if(mustChange) db.prepare("DELETE FROM password_change_required WHERE user_id=?").run(u.id);
  log(u.id,mustChange?"Completed temporary password change":"Changed password","",req.user.institution_id);
  const updated=db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  sessionStore.revokeAllForUser(u.id);
  res.json({ok:true,...issueSession(updated,req.user.institution_id,res)});
});
app.post("/api/auth/logout",auth,(req,res)=>{
  sessionStore.revoke(req.sessionId);
  clearSessionCookie(res);
  res.json({ok:true});
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
  db.prepare("UPDATE reset_tokens SET used=1 WHERE id=?").run(row.id);
  sessionStore.revokeAllForUser(row.user_id);
  res.json({ok:true});
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
app.post("/api/admin/users",auth,roles("admin"),(req,res)=>{
  const name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||""),requestedRole=String(req.body.role||"student");
  const role=requestedRole==="admin"?"school_admin":requestedRole;
  if(name.length<2||name.length>120||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>128||!["student","teacher","school_admin"].includes(role))
    return res.status(400).json({error:"Provide a valid name, email, password (10-128 characters) and role."});
  try{
    const create=db.transaction(()=>{
      const userId=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name,email,bcrypt.hashSync(password,12),role==="school_admin"?"admin":role).lastInsertRowid;
      db.prepare("INSERT INTO institution_memberships(institution_id,user_id,role,status) VALUES(?,?,?,'active')").run(req.user.institution_id,userId,role);
      db.prepare("INSERT INTO password_change_required(user_id) VALUES(?)").run(userId);
      return db.prepare("SELECT u.id,u.name,u.email,u.role,m.role institution_role,u.phone,u.bio,u.created_at FROM users u JOIN institution_memberships m ON m.user_id=u.id WHERE u.id=? AND m.institution_id=?").get(userId,req.user.institution_id);
    });
    const user=create();log(req.user.id,"Created school user",JSON.stringify({user_id:user.id,role}),req.user.institution_id);res.status(201).json(user);
  }catch(e){if(String(e.message).includes("UNIQUE"))return res.status(409).json({error:"An account with this email already exists."});throw e;}
});
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
app.get("/api/students",auth,roles("admin","teacher"),async(req,res,next)=>{
  try {
    const rows=await peopleRepository.listStudentsForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) { next(error); }
});
app.get("/api/teachers",auth,roles("admin"),async(req,res,next)=>{
  try {
    const rows=await peopleRepository.listTeachersForInstitution(req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) { next(error); }
});

app.post("/api/subjects",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id); if(!c)return res.status(403).json({error:"Not allowed"}); const r=db.prepare("INSERT INTO subjects(name,class_id,teacher_id) VALUES(?,?,?)").run(req.body.name,c.id,req.user.id); res.json(db.prepare("SELECT * FROM subjects WHERE id=?").get(r.lastInsertRowid));});
app.get("/api/subjects",auth,async(req,res,next)=>{
  try {
    const rows=await classesRepository.listSubjectsForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) { next(error); }
});
app.post("/api/timetable",auth,roles("admin","teacher"),async(req,res,next)=>{try{const result=await timetableRepository.create({userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,classId:req.body.class_id,subjectId:req.body.subject_id,day:req.body.day,startTime:req.body.start_time,endTime:req.body.end_time,room:req.body.room});res.json(result);}catch(error){if(/not found in this school|assigned classes|belong to this class/.test(error.message))return res.status(403).json({error:error.message});if(error instanceof TypeError)return res.status(400).json({error:error.message});next(error);}});
app.get("/api/timetable",auth,async(req,res,next)=>{try{const rows=await timetableRepository.listForUser(req.user.id,req.user.institution_id,req.user.institution_role);res.json(rows);}catch(error){next(error);}});

const upload=multer({storage:storage.multerStorage(),limits:{fileSize:10*1024*1024}});
app.post("/api/materials",auth,roles("admin","teacher"),upload.single("file"),validateMaterialUpload,async(req,res,next)=>{
  try{
    const file=req.file?"/uploads/"+req.file.filename:"";
    const result=await learningContentRepository.createMaterial({
      userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,
      classId:req.body.class_id,title:req.body.title,description:req.body.description||"",
      url:req.body.url||"",fileUrl:file
    });
    result.studentIds.forEach(studentId=>notify(studentId,"New learning material",req.body.title,req.user.institution_id));
    res.json(result.material);
  }catch(error){next(error);}
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

app.post("/api/assignments",auth,roles("admin","teacher"),async(req,res,next)=>{
  try{
    const result=await learningContentRepository.createAssignment({
      userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,
      classId:req.body.class_id,title:req.body.title,description:req.body.description||"",
      dueDate:req.body.due_date||null,maxScore:Number(req.body.max_score||100)
    });
    result.studentIds.forEach(studentId=>notify(studentId,"New assignment",req.body.title,req.user.institution_id));
    res.json(result.assignment);
  }catch(error){next(error);}
});
app.get("/api/assignments",auth,async(req,res,next)=>{try{const rows=await learningContentRepository.listAssignmentsForUser(req.user.id,req.user.institution_id,req.user.institution_role);res.json(rows);}catch(error){next(error);}});
app.post("/api/assignments/:id/submit",auth,roles("student"),(req,res)=>{const a=db.prepare("SELECT * FROM assignments WHERE id=?").get(req.params.id);if(!a||!classForUser(req.user,a.class_id)||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(a.class_id,req.user.id))return res.status(403).json({error:"Not allowed"});db.prepare("INSERT INTO submissions(assignment_id,student_id,answer) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET answer=excluded.answer,submitted_at=CURRENT_TIMESTAMP").run(a.id,req.user.id,req.body.answer||"");notify(a.teacher_id,"Assignment submitted",req.user.name+" submitted "+a.title,req.user.institution_id);res.json({ok:true});});
app.get("/api/submissions",auth,async(req,res,next)=>{
  try{
    const rows=await learningContentRepository.listSubmissionsForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  }catch(error){next(error);}
});
app.patch("/api/submissions/:id/grade",auth,roles("admin","teacher"),async(req,res,next)=>{
  try{
    const result=await submissionRepository.gradeSubmission({
      userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,
      submissionId:req.params.id,score:req.body.score,feedback:req.body.feedback||""
    });
    notify(result.studentId,"Assignment graded","Your "+result.assignmentTitle+" has been graded.",req.user.institution_id);
    res.json({ok:true});
  }catch(error){next(error);}
});

app.post("/api/assessments",auth,roles("admin","teacher"),async(req,res,next)=>{try{const created=await assessmentsRepository.createForClass({userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,classId:req.body.class_id,title:req.body.title,type:req.body.type,durationMinutes:req.body.duration_minutes,passMark:req.body.pass_mark,questions:req.body.questions});created.studentIds.forEach(studentId=>notify(studentId,"New assessment",req.body.title,req.user.institution_id));res.json({id:created.id});}catch(error){if(error.status===403)return res.status(403).json({error:error.message});if(error instanceof TypeError)return res.status(400).json({error:error.message});next(error);}});
app.get("/api/assessments",auth,async(req,res,next)=>{try{const rows=await assessmentsRepository.listForUser(req.user.id,req.user.institution_id,req.user.institution_role);res.json(rows);}catch(error){next(error);}});
app.post("/api/assessments/:id/start",auth,roles("student"),async(req,res,next)=>{
  try{
    const result=await assessmentsRepository.startAttempt({userId:req.user.id,institutionId:req.user.institution_id,assessmentId:req.params.id});
    res.json(result);
  }catch(error){
    if(error.status===400)return res.status(400).json({error:error.message,attempt:error.attempt});
    if(error.status===403)return res.status(403).json({error:error.message});
    if(error instanceof TypeError)return res.status(400).json({error:error.message});
    next(error);
  }
});
app.patch("/api/assessments/:id/answers",auth,roles("student"),async(req,res,next)=>{
   try{
     const result=await assessmentsRepository.saveAttemptAnswers({
       userId:req.user.id,institutionId:req.user.institution_id,
       assessmentId:req.params.id,answers:req.body.answers||{}
     });
     res.json(result);
   }catch(error){
     if(error.status===400)return res.status(400).json({error:error.message});
     if(error.status===403)return res.status(403).json({error:error.message});
     if(error instanceof TypeError)return res.status(400).json({error:error.message});
     next(error);
   }
 });
app.post("/api/assessments/:id/submit",auth,roles("student"),async(req,res,next)=>{
  try{
    const result=await assessmentsRepository.submitAttempt({userId:req.user.id,institutionId:req.user.institution_id,assessmentId:req.params.id,answers:req.body.answers||{}});
    res.json(result);
  }catch(error){
    if(error.status===400)return res.status(400).json({error:error.message});
    if(error instanceof TypeError)return res.status(400).json({error:error.message});
    next(error);
  }
});
app.get("/api/results",auth,async(req,res,next)=>{
  try {
    const rows=await assessmentsRepository.listResultsForUser(
      req.user.id,req.user.institution_id,req.user.institution_role
    );
    res.json(rows);
  } catch(error) {
    if(error.status===403) return res.status(403).json({error:error.message});
    if(error instanceof TypeError) return res.status(400).json({error:error.message});
    next(error);
  }
});
app.get("/api/gradebook",auth,roles("admin","teacher"),async(req,res,next)=>{
  try {
    const rows=await gradebookRepository.listForUser(req.user.id,req.user.institution_id,req.user.institution_role);
    res.json(rows);
  } catch(error) {
    if(error.status===403) return res.status(403).json({error:error.message});
    if(error instanceof TypeError) return res.status(400).json({error:error.message});
    next(error);
  }
});
app.get("/api/performance",auth,async(req,res,next)=>{
  const role=req.user.institution_role;
  const studentId=role==="student"?req.user.id:Number(req.query.student_id||0);
  try {
    const result=await performanceRepository.getForUser(req.user.id,req.user.institution_id,role,studentId);
    if(!result) return res.status(404).json({error:"Student not found in this school"});
    res.json(result);
  } catch(error) {
    if(error.status===403) return res.status(403).json({error:error.message});
    if(error instanceof TypeError) return res.status(400).json({error:error.message});
    next(error);
  }
});
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

app.post("/api/attendance",auth,roles("admin","teacher"),async(req,res,next)=>{
  try {
    const result=await attendanceRepository.recordForClass({
      userId:req.user.id,institutionId:req.user.institution_id,role:req.user.institution_role,
      classId:req.body.class_id,studentId:req.body.student_id,date:req.body.date,status:req.body.status
    });
    if(result===null) return res.status(403).json({error:"Not allowed"});
    res.json({ok:true});
  } catch(error) {
    if(error.status) return res.status(error.status).json({error:error.message});
    next(error);
  }
});
app.get("/api/attendance/:classId",auth,async(req,res,next)=>{
  try {
    const date=req.query.date||new Date().toISOString().slice(0,10);
    const rows=await attendanceRepository.listForClass(req.user.id,req.user.institution_id,req.user.institution_role,req.params.classId,date);
    if(rows===null) return res.status(403).json({error:"Not allowed"});
    res.json({date,students:rows});
  } catch(error) { next(error); }
});
app.get("/api/attendance-summary/:classId",auth,async(req,res,next)=>{
  try {
    const rows=await attendanceRepository.summarizeClass(req.user.id,req.user.institution_id,req.user.institution_role,req.params.classId);
    if(rows===null) return res.status(403).json({error:"Not allowed"});
    res.json(rows);
  } catch(error) { next(error); }
});

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

// Guardian access is provisioned only by a school administrator after offline identity/relationship checks.
app.post("/api/guardians/invitations",auth,roles("admin"),(req,res)=>{
  const studentId=Number(req.body.student_id);
  const email=String(req.body.email||"").trim().toLowerCase();
  if(!Number.isSafeInteger(studentId)||studentId<=0||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"A valid student_id and guardian email are required."});
  const student=db.prepare("SELECT u.id FROM users u JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=? AND m.role='student' AND m.status='active' WHERE u.id=? AND u.role='student'").get(req.user.institution_id,studentId);
  if(!student) return res.status(404).json({error:"Student not found in this school."});
  const crypto=require("crypto");
  const rawToken=crypto.randomBytes(32).toString("hex");
  const tokenHash=crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
  db.prepare("INSERT INTO guardian_invitations(institution_id,student_id,email,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?)")
    .run(req.user.institution_id,studentId,email,tokenHash,expiresAt,req.user.id);
  log(req.user.id,"Created guardian invitation",JSON.stringify({student_id:studentId,email}),req.user.institution_id);
  res.status(201).json({ok:true,invitation_token:rawToken,expires_at:expiresAt,delivery:"Share this one-time token privately with the verified guardian. It is not emailed automatically."});
});
app.get("/api/guardians/manage",auth,roles("admin"),(req,res)=>{
  const invitations=db.prepare(`SELECT i.id,i.email,i.student_id,u.name student_name,i.expires_at,i.used_at,i.created_at,
    CASE WHEN i.used_at IS NOT NULL THEN 'accepted' WHEN julianday(i.expires_at)<=julianday('now') THEN 'expired' ELSE 'pending' END status
    FROM guardian_invitations i JOIN users u ON u.id=i.student_id
    WHERE i.institution_id=? ORDER BY i.id DESC LIMIT 100`).all(req.user.institution_id);
  const links=db.prepare(`SELECT l.guardian_id,l.student_id,g.name guardian_name,g.email guardian_email,s.name student_name,l.status,l.verified_at
    FROM guardian_student_links l JOIN users g ON g.id=l.guardian_id JOIN users s ON s.id=l.student_id
    WHERE l.institution_id=? ORDER BY l.verified_at DESC LIMIT 100`).all(req.user.institution_id);
  res.json({invitations,links});
});
app.delete("/api/guardians/invitations/:id",auth,roles("admin"),(req,res)=>{
  const changed=db.prepare("DELETE FROM guardian_invitations WHERE id=? AND institution_id=? AND used_at IS NULL").run(Number(req.params.id),req.user.institution_id);
  if(!changed.changes) return res.status(404).json({error:"Pending invitation not found."});
  log(req.user.id,"Cancelled guardian invitation",String(req.params.id),req.user.institution_id);
  res.json({ok:true});
});
app.get("/api/guardian/children",auth,(req,res)=>{
  if(req.user.institution_role!=="parent") return res.status(403).json({error:"Parent access required."});
  const children=db.prepare(`SELECT u.id,u.name,
    (SELECT GROUP_CONCAT(c.name, ', ') FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=u.id AND c.institution_id=?) class_names
    FROM guardian_student_links l JOIN users u ON u.id=l.student_id
    JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=l.institution_id AND m.role='student' AND m.status='active'
    WHERE l.institution_id=? AND l.guardian_id=? AND l.status='verified' ORDER BY u.name`)
    .all(req.user.institution_id,req.user.institution_id,req.user.id);
  res.json(children);
});
app.get("/api/guardian/children/:id/performance",auth,(req,res)=>{
  if(req.user.institution_role!=="parent") return res.status(403).json({error:"Parent access required."});
  const studentId=Number(req.params.id);
  const link=db.prepare("SELECT 1 FROM guardian_student_links WHERE institution_id=? AND guardian_id=? AND student_id=? AND status='verified'").get(req.user.institution_id,req.user.id,studentId);
  if(!link) return res.status(404).json({error:"Verified child not found."});
  const student=db.prepare("SELECT id,name FROM users WHERE id=?").get(studentId);
  const results=db.prepare(`SELECT a.title,a.type,at.percentage,at.status,at.submitted_at
    FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id
    WHERE at.student_id=? AND c.institution_id=? AND at.status IN ('submitted','expired') ORDER BY at.id DESC LIMIT 100`).all(studentId,req.user.institution_id);
  const attendance=db.prepare(`SELECT att.status,COUNT(*) count FROM attendance att JOIN classes c ON c.id=att.class_id
    WHERE att.student_id=? AND c.institution_id=? GROUP BY att.status`).all(studentId,req.user.institution_id);
  const assignments=db.prepare(`SELECT a.title,a.due_date,s.score,s.feedback,s.submitted_at
    FROM assignments a JOIN classes c ON c.id=a.class_id
    LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=?
    JOIN enrollments e ON e.class_id=c.id AND e.student_id=?
    WHERE c.institution_id=? ORDER BY a.due_date DESC LIMIT 100`).all(studentId,studentId,req.user.institution_id);
  res.json({student,results,attendance,assignments});
});
app.delete("/api/guardians/children/:id",auth,roles("admin"),(req,res)=>{
  const studentId=Number(req.params.id);
  const guardianId=Number(req.body.guardian_id);
  const changed=db.prepare("UPDATE guardian_student_links SET status='revoked' WHERE institution_id=? AND guardian_id=? AND student_id=? AND status='verified'").run(req.user.institution_id,guardianId,studentId);
  if(!changed.changes) return res.status(404).json({error:"Verified guardian relationship not found."});
  log(req.user.id,"Revoked guardian relationship",JSON.stringify({student_id:studentId,guardian_id:guardianId}),req.user.institution_id);
  res.json({ok:true});
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

// Expire overdue exam attempts using the server clock, even if a student closes the browser.
const attemptExpirySweep = setInterval(() => {
  assessmentsRepository.expireOverdueAttempts().catch(error => {
    console.error("Assessment expiry sweep failed:", error);
  });
}, 15000);
if (typeof attemptExpirySweep.unref === "function") attemptExpirySweep.unref();
assessmentsRepository.expireOverdueAttempts().catch(error => {
  console.error("Initial assessment expiry sweep failed:", error);
});

app.listen(PORT,()=>console.log(`MyClassroom V12 running on http://localhost:${PORT}`));
