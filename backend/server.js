const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const multer = require("multer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "..", "frontend");
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(DATA, {recursive:true});
fs.mkdirSync(UPLOADS, {recursive:true});

app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use("/uploads", express.static(UPLOADS));

const db = new Database(path.join(DATA, "myclassroom.db"));
db.pragma("foreign_keys = ON");

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
 body TEXT NOT NULL, read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER,
 subject TEXT DEFAULT '', body TEXT NOT NULL, read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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

const count = db.prepare("SELECT COUNT(*) c FROM users").get().c;
if (!count) {
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

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Authentication required"});
  try { req.user=jwt.verify(token,SECRET); next(); } catch(e){ return res.status(401).json({error:"Invalid or expired token"}); }
}
function roles(...allowed){ return (req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:"Not allowed"}); }
function sign(user){ return jwt.sign({id:user.id,name:user.name,email:user.email,role:user.role},SECRET,{expiresIn:"7d"}); }
function log(actor,action,details=""){ db.prepare("INSERT INTO audit_log(actor_id,action,details) VALUES(?,?,?)").run(actor,action,details); }
function notify(userId,title,body){ if(userId) db.prepare("INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)").run(userId,title,body); }
function classForUser(user, classId){
  const c=db.prepare("SELECT * FROM classes WHERE id=?").get(classId);
  if(!c) return null;
  if(user.role==="admin" || c.teacher_id===user.id || db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(classId,user.id)) return c;
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

app.post("/api/auth/register",(req,res)=>{
  const {name,email,password,role="student"}=req.body;
  if(!name||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
  const safeRole=role==="teacher"?"teacher":"student";
  try{
    const r=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
      .run(name,email.toLowerCase(),bcrypt.hashSync(password,10),safeRole);
    const u=db.prepare("SELECT id,name,email,role,phone,bio,created_at FROM users WHERE id=?").get(r.lastInsertRowid);
    res.json({user:u,token:sign(u)});
  }catch(e){res.status(400).json({error:"Email already exists"});}
});
app.post("/api/auth/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password||"",u.password_hash)) return res.status(401).json({error:"Invalid email or password"});
  res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone,bio:u.bio},token:sign(u)});
});
app.post("/api/auth/change-password",auth,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if(!u||!bcrypt.compareSync(req.body.currentPassword||"",u.password_hash)) return res.status(400).json({error:"Current password is incorrect"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(req.body.newPassword||"",10),u.id);
  log(u.id,"Changed password"); res.json({ok:true});
});
app.post("/api/auth/request-reset",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").toLowerCase());
  if(!u) return res.json({ok:true,message:"If the account exists, a reset token has been prepared."});
  const crypto=require("crypto"), token=crypto.randomBytes(24).toString("hex");
  const hash=crypto.createHash("sha256").update(token).digest("hex");
  const expires=new Date(Date.now()+30*60*1000).toISOString();
  db.prepare("INSERT INTO reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)").run(u.id,hash,expires);
  res.json({ok:true,message:"Reset token created. Connect this endpoint to your email provider in production.",dev_token:token});
});
app.post("/api/auth/reset",(req,res)=>{
  const crypto=require("crypto"), hash=crypto.createHash("sha256").update(req.body.token||"").digest("hex");
  const row=db.prepare("SELECT * FROM reset_tokens WHERE token_hash=? AND used=0 AND expires_at>?").get(hash,new Date().toISOString());
  if(!row) return res.status(400).json({error:"Invalid or expired reset token"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(req.body.newPassword||"",10),row.user_id);
  db.prepare("UPDATE reset_tokens SET used=1 WHERE id=?").run(row.id); res.json({ok:true});
});
app.get("/api/me",auth,(req,res)=>res.json(db.prepare("SELECT id,name,email,role,phone,bio,created_at FROM users WHERE id=?").get(req.user.id)));
app.patch("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const name=req.body.name??u.name, phone=req.body.phone??u.phone, bio=req.body.bio??u.bio;
  db.prepare("UPDATE users SET name=?,phone=?,bio=? WHERE id=?").run(name,phone,bio,u.id);
  res.json(db.prepare("SELECT id,name,email,role,phone,bio,created_at FROM users WHERE id=?").get(u.id));
});

app.get("/api/admin/stats",auth,roles("admin"),(req,res)=>{
  const q=t=>db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  res.json({users:q("users"),students:db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c,teachers:db.prepare("SELECT COUNT(*) c FROM users WHERE role='teacher'").get().c,classes:q("classes"),materials:q("materials"),assignments:q("assignments"),assessments:q("assessments")});
});
app.get("/api/admin/users",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT id,name,email,role,phone,bio,created_at FROM users ORDER BY role,name").all()));
app.patch("/api/admin/users/:id",auth,roles("admin"),(req,res)=>{
  const role=["admin","teacher","student"].includes(req.body.role)?req.body.role:null;
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!u) return res.status(404).json({error:"User not found"});
  db.prepare("UPDATE users SET name=?,role=?,phone=?,bio=? WHERE id=?").run(req.body.name??u.name,role||u.role,req.body.phone??u.phone,req.body.bio??u.bio,u.id);
  log(req.user.id,"Updated user",String(u.id)); res.json({ok:true});
});
app.delete("/api/admin/users/:id",auth,roles("admin"),(req,res)=>{
  if(Number(req.params.id)===req.user.id) return res.status(400).json({error:"You cannot delete yourself"});
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id); log(req.user.id,"Deleted user",String(req.params.id)); res.json({ok:true});
});
app.get("/api/audit",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100").all()));

app.get("/api/classes",auth,(req,res)=>{
  let rows;
  if(req.user.role==="admin") rows=db.prepare("SELECT c.*,u.name teacher_name,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id) student_count FROM classes c LEFT JOIN users u ON u.id=c.teacher_id ORDER BY c.name").all();
  else if(req.user.role==="teacher") rows=db.prepare("SELECT c.*,u.name teacher_name,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id) student_count FROM classes c LEFT JOIN users u ON u.id=c.teacher_id WHERE c.teacher_id=? ORDER BY c.name").all(req.user.id);
  else rows=db.prepare("SELECT c.*,u.name teacher_name FROM classes c JOIN enrollments e ON e.class_id=c.id LEFT JOIN users u ON u.id=c.teacher_id WHERE e.student_id=? ORDER BY c.name").all(req.user.id);
  res.json(rows);
});
app.post("/api/classes",auth,roles("admin","teacher"),(req,res)=>{
  const code=(req.body.code||("MC"+Math.random().toString(36).slice(2,8))).toUpperCase();
  try{const r=db.prepare("INSERT INTO classes(name,code,description,teacher_id,live_link) VALUES(?,?,?,?,?)").run(req.body.name,code,req.body.description||"",req.user.role==="teacher"?req.user.id:(req.body.teacher_id||null),req.body.live_link||""); log(req.user.id,"Created class",String(r.lastInsertRowid)); res.json(db.prepare("SELECT * FROM classes WHERE id=?").get(r.lastInsertRowid));}catch(e){res.status(400).json({error:"Class code must be unique"});}
});
app.patch("/api/classes/:id",auth,roles("admin","teacher"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id); if(!c) return res.status(404).json({error:"Not found"});
  if(req.user.role==="teacher"&&c.teacher_id!==req.user.id) return res.status(403).json({error:"Not your class"});
  db.prepare("UPDATE classes SET name=?,description=?,live_link=?,teacher_id=? WHERE id=?").run(req.body.name??c.name,req.body.description??c.description,req.body.live_link??c.live_link,req.user.role==="admin"?(req.body.teacher_id??c.teacher_id):c.teacher_id,c.id);
  res.json(db.prepare("SELECT * FROM classes WHERE id=?").get(c.id));
});
app.delete("/api/classes/:id",auth,roles("admin","teacher"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE id=?").get(req.params.id); if(!c) return res.status(404).json({error:"Not found"});
  if(req.user.role==="teacher"&&c.teacher_id!==req.user.id) return res.status(403).json({error:"Not your class"});
  db.prepare("DELETE FROM classes WHERE id=?").run(c.id); log(req.user.id,"Deleted class",String(c.id)); res.json({ok:true});
});
app.post("/api/classes/join",auth,roles("student"),(req,res)=>{
  const c=db.prepare("SELECT * FROM classes WHERE code=?").get(String(req.body.code||"").toUpperCase());
  if(!c) return res.status(404).json({error:"Class code not found"});
  db.prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id) VALUES(?,?)").run(c.id,req.user.id); notify(c.teacher_id,"New student joined",db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id).name+" joined "+c.name); res.json(c);
});
app.get("/api/classes/:id/students",auth,(req,res)=>{
  if(!classForUser(req.user,req.params.id)) return res.status(403).json({error:"Not allowed"});
  res.json(db.prepare("SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN enrollments e ON e.student_id=u.id WHERE e.class_id=? ORDER BY u.name").all(req.params.id));
});
app.get("/api/students",auth,roles("admin","teacher"),(req,res)=>{
  const rows=req.user.role==="admin"?db.prepare("SELECT id,name,email,phone,bio FROM users WHERE role='student' ORDER BY name").all():db.prepare("SELECT DISTINCT u.id,u.name,u.email,u.phone,u.bio FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id WHERE c.teacher_id=? ORDER BY u.name").all(req.user.id);
  res.json(rows);
});
app.get("/api/teachers",auth,roles("admin"),(req,res)=>res.json(db.prepare("SELECT id,name,email,phone,bio FROM users WHERE role='teacher' ORDER BY name").all()));

app.post("/api/subjects",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id); if(!c)return res.status(403).json({error:"Not allowed"}); const r=db.prepare("INSERT INTO subjects(name,class_id,teacher_id) VALUES(?,?,?)").run(req.body.name,c.id,req.user.id); res.json(db.prepare("SELECT * FROM subjects WHERE id=?").get(r.lastInsertRowid));});
app.get("/api/subjects",auth,(req,res)=>{const rows=req.user.role==="student"?db.prepare("SELECT s.*,c.name class_name FROM subjects s LEFT JOIN classes c ON c.id=s.class_id JOIN enrollments e ON e.class_id=s.class_id WHERE e.student_id=?").all(req.user.id):req.user.role==="teacher"?db.prepare("SELECT s.*,c.name class_name FROM subjects s LEFT JOIN classes c ON c.id=s.class_id WHERE s.teacher_id=? OR c.teacher_id=?").all(req.user.id,req.user.id):db.prepare("SELECT s.*,c.name class_name FROM subjects s LEFT JOIN classes c ON c.id=s.class_id").all(); res.json(rows);});
app.post("/api/timetable",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});const r=db.prepare("INSERT INTO timetable(class_id,subject_id,day,start_time,end_time,room) VALUES(?,?,?,?,?,?)").run(c.id,req.body.subject_id||null,req.body.day,req.body.start_time,req.body.end_time,req.body.room||"");res.json({id:r.lastInsertRowid});});
app.get("/api/timetable",auth,(req,res)=>{let sql=`SELECT t.*,c.name class_name,s.name subject_name FROM timetable t LEFT JOIN classes c ON c.id=t.class_id LEFT JOIN subjects s ON s.id=t.subject_id`;let rows;if(req.user.role==="student") rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=t.class_id WHERE e.student_id=? ORDER BY CASE t.day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 ELSE 6 END,t.start_time").all(req.user.id);else if(req.user.role==="teacher")rows=db.prepare(sql+" WHERE c.teacher_id=? OR t.subject_id IN (SELECT id FROM subjects WHERE teacher_id=?) ORDER BY t.day,t.start_time").all(req.user.id,req.user.id);else rows=db.prepare(sql+" ORDER BY t.day,t.start_time").all();res.json(rows);});

const upload=multer({storage:multer.diskStorage({destination:UPLOADS,filename:(req,file,cb)=>cb(null,Date.now()+"-"+file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_"))}),limits:{fileSize:10*1024*1024}});
app.post("/api/materials",auth,roles("admin","teacher"),upload.single("file"),(req,res)=>{
  const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});
  const file=req.file?"/uploads/"+req.file.filename:"";
  const r=db.prepare("INSERT INTO materials(title,description,url,file_url,class_id,teacher_id) VALUES(?,?,?,?,?,?)").run(req.body.title,req.body.description||"",req.body.url||"",file,c.id,req.user.id);
  const students=db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id);students.forEach(s=>notify(s.student_id,"New learning material",req.body.title));
  res.json(db.prepare("SELECT * FROM materials WHERE id=?").get(r.lastInsertRowid));
});
app.get("/api/materials",auth,(req,res)=>{let sql="SELECT m.*,c.name class_name,u.name teacher_name FROM materials m LEFT JOIN classes c ON c.id=m.class_id LEFT JOIN users u ON u.id=m.teacher_id";let rows;if(req.user.role==="student")rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=m.class_id WHERE e.student_id=? ORDER BY m.id DESC").all(req.user.id);else if(req.user.role==="teacher")rows=db.prepare(sql+" WHERE m.teacher_id=? OR c.teacher_id=? ORDER BY m.id DESC").all(req.user.id,req.user.id);else rows=db.prepare(sql+" ORDER BY m.id DESC").all();res.json(rows);});

app.post("/api/assignments",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});const r=db.prepare("INSERT INTO assignments(title,description,due_date,class_id,teacher_id,max_score) VALUES(?,?,?,?,?,?)").run(req.body.title,req.body.description||"",req.body.due_date||null,c.id,req.user.id,Number(req.body.max_score||100));db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id).forEach(s=>notify(s.student_id,"New assignment",req.body.title));res.json(db.prepare("SELECT * FROM assignments WHERE id=?").get(r.lastInsertRowid));});
app.get("/api/assignments",auth,(req,res)=>{let sql="SELECT a.*,c.name class_name,u.name teacher_name FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN users u ON u.id=a.teacher_id";let rows;if(req.user.role==="student")rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=a.class_id WHERE e.student_id=? ORDER BY a.due_date").all(req.user.id);else if(req.user.role==="teacher")rows=db.prepare(sql+" WHERE a.teacher_id=? OR c.teacher_id=? ORDER BY a.due_date").all(req.user.id,req.user.id);else rows=db.prepare(sql+" ORDER BY a.due_date").all();res.json(rows);});
app.post("/api/assignments/:id/submit",auth,roles("student"),(req,res)=>{const a=db.prepare("SELECT * FROM assignments WHERE id=?").get(req.params.id);if(!a||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(a.class_id,req.user.id))return res.status(403).json({error:"Not allowed"});db.prepare("INSERT INTO submissions(assignment_id,student_id,answer) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET answer=excluded.answer,submitted_at=CURRENT_TIMESTAMP").run(a.id,req.user.id,req.body.answer||"");notify(a.teacher_id,"Assignment submitted",req.user.name+" submitted "+a.title);res.json({ok:true});});
app.get("/api/submissions",auth,(req,res)=>{let sql=`SELECT s.*,a.title,a.max_score,a.class_id,u.name student_name,u.email FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN users u ON u.id=s.student_id`;let rows=req.user.role==="student"?db.prepare(sql+" WHERE s.student_id=? ORDER BY s.id DESC").all(req.user.id):req.user.role==="teacher"?db.prepare(sql+" WHERE a.teacher_id=? OR a.class_id IN (SELECT id FROM classes WHERE teacher_id=?) ORDER BY s.id DESC").all(req.user.id,req.user.id):db.prepare(sql+" ORDER BY s.id DESC").all();res.json(rows);});
app.patch("/api/submissions/:id/grade",auth,roles("admin","teacher"),(req,res)=>{const s=db.prepare("SELECT s.*,a.teacher_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?").get(req.params.id);if(!s)return res.status(404).json({error:"Not found"});if(req.user.role==="teacher"&&s.teacher_id!==req.user.id)return res.status(403).json({error:"Not allowed"});db.prepare("UPDATE submissions SET score=?,feedback=? WHERE id=?").run(Number(req.body.score),req.body.feedback||"",s.id);notify(s.student_id,"Assignment graded","Your "+db.prepare("SELECT title FROM assignments WHERE id=?").get(s.assignment_id).title+" has been graded.");res.json({ok:true});});

app.post("/api/assessments",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});let questions;try{questions=normalizeQuestions(req.body.questions);}catch(e){return res.status(400).json({error:e.message});}if(!questions.length)return res.status(400).json({error:"Add at least one valid question"});const r=db.prepare("INSERT INTO assessments(title,type,duration_minutes,class_id,teacher_id,pass_mark,questions_json) VALUES(?,?,?,?,?,?,?)").run(req.body.title,req.body.type||"quiz",Number(req.body.duration_minutes||20),c.id,req.user.id,Number(req.body.pass_mark||50),JSON.stringify(questions));db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(c.id).forEach(s=>notify(s.student_id,"New assessment",req.body.title));res.json({id:r.lastInsertRowid});});
app.get("/api/assessments",auth,(req,res)=>{let sql="SELECT a.*,c.name class_name,u.name teacher_name FROM assessments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN users u ON u.id=a.teacher_id";let rows;if(req.user.role==="student")rows=db.prepare(sql+" JOIN enrollments e ON e.class_id=a.class_id WHERE e.student_id=? ORDER BY a.id DESC").all(req.user.id);else if(req.user.role==="teacher")rows=db.prepare(sql+" WHERE a.teacher_id=? OR c.teacher_id=? ORDER BY a.id DESC").all(req.user.id,req.user.id);else rows=db.prepare(sql+" ORDER BY a.id DESC").all();res.json(rows.map(x=>({...x,question_count:JSON.parse(x.questions_json).length})));});
app.post("/api/assessments/:id/start",auth,roles("student"),(req,res)=>{
  const a=db.prepare("SELECT * FROM assessments WHERE id=?").get(req.params.id);if(!a||!db.prepare("SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?").get(a.class_id,req.user.id))return res.status(403).json({error:"Not allowed"});
  const existing=db.prepare("SELECT * FROM attempts WHERE assessment_id=? AND student_id=?").get(a.id,req.user.id);
  if(existing&&existing.status==="submitted")return res.status(400).json({error:"Assessment already submitted",attempt:existing});
  if(existing)return res.json({attempt:existing,questions:JSON.parse(a.questions_json).map(q=>({question:q.question,options:q.options}))});
  const expires=new Date(Date.now()+Number(a.duration_minutes||20)*60000).toISOString();
  const r=db.prepare("INSERT INTO attempts(assessment_id,student_id,expires_at) VALUES(?,?,?)").run(a.id,req.user.id,expires);
  res.json({attempt:db.prepare("SELECT * FROM attempts WHERE id=?").get(r.lastInsertRowid),questions:JSON.parse(a.questions_json).map(q=>({question:q.question,options:q.options}))});
});
app.post("/api/assessments/:id/submit",auth,roles("student"),(req,res)=>{
  const a=db.prepare("SELECT * FROM assessments WHERE id=?").get(req.params.id), at=db.prepare("SELECT * FROM attempts WHERE assessment_id=? AND student_id=?").get(req.params.id,req.user.id);
  if(!a||!at)return res.status(400).json({error:"Attempt not found"}); if(at.status==="submitted")return res.json(at);
  const questions=JSON.parse(a.questions_json), answers=req.body.answers||{}, expired=new Date(at.expires_at).getTime()<Date.now();
  let score=0;questions.forEach((q,i)=>{if(Number(answers[i])===Number(q.answer))score++;});
  const pct=questions.length?Math.round(score/questions.length*100):0, status=pct>=a.pass_mark?"PASS":"FAIL";
  db.prepare("UPDATE attempts SET submitted_at=CURRENT_TIMESTAMP,score=?,percentage=?,status=?,answers_json=? WHERE id=?").run(score,pct,status,JSON.stringify(answers),at.id);
  res.json(db.prepare("SELECT * FROM attempts WHERE id=?").get(at.id));
});
app.get("/api/results",auth,(req,res)=>{let sql=`SELECT at.*,a.title,a.type,a.pass_mark,c.name class_name,u.name student_name FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id JOIN users u ON u.id=at.student_id`;let rows=req.user.role==="student"?db.prepare(sql+" WHERE at.student_id=? ORDER BY at.id DESC").all(req.user.id):req.user.role==="teacher"?db.prepare(sql+" WHERE a.teacher_id=? OR c.teacher_id=? ORDER BY at.id DESC").all(req.user.id,req.user.id):db.prepare(sql+" ORDER BY at.id DESC").all();res.json(rows);});
app.get("/api/gradebook",auth,roles("admin","teacher"),(req,res)=>{let sql=`SELECT u.id student_id,u.name student_name,c.id class_id,c.name class_name,
(SELECT ROUND(AVG(at.percentage),1) FROM attempts at JOIN assessments aa ON aa.id=at.assessment_id WHERE at.student_id=u.id AND aa.class_id=c.id AND at.status='submitted') assessment_average,
(SELECT ROUND(AVG(s.score*100.0/a.max_score),1) FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.student_id=u.id AND a.class_id=c.id AND s.score IS NOT NULL) assignment_average
FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id WHERE u.role='student'`;
let rows=req.user.role==="teacher"?db.prepare(sql+" AND c.teacher_id=? ORDER BY c.name,u.name").all(req.user.id):db.prepare(sql+" ORDER BY c.name,u.name").all();res.json(rows);});
app.get("/api/performance",auth,(req,res)=>{const studentId=req.user.role==="student"?req.user.id:Number(req.query.student_id||0);if(!studentId)return res.status(400).json({error:"student_id required"});const user=db.prepare("SELECT id,name,email FROM users WHERE id=? AND role='student'").get(studentId);if(!user)return res.status(404).json({error:"Student not found"});const results=db.prepare("SELECT a.title,a.type,at.percentage,at.status,at.submitted_at FROM attempts at JOIN assessments a ON a.id=at.assessment_id WHERE at.student_id=? AND at.status='submitted' ORDER BY at.id").all(studentId);const attendance=db.prepare("SELECT status,COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status").all(studentId);res.json({student:user,results,attendance});});
app.get("/api/rankings/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});const rows=db.prepare(`SELECT u.id,u.name,ROUND(COALESCE(AVG(at.percentage),0),1) average FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attempts at ON at.student_id=u.id AND at.status='submitted' LEFT JOIN assessments a ON a.id=at.assessment_id AND a.class_id=e.class_id WHERE e.class_id=? GROUP BY u.id ORDER BY average DESC,u.name`).all(req.params.classId);res.json(rows.map((x,i)=>({...x,rank:i+1})));});
app.get("/api/export/gradebook.csv",auth,roles("admin","teacher"),(req,res)=>{let rows=req.user.role==="teacher"?db.prepare(`SELECT u.name student,c.name class_name,COALESCE(ROUND(AVG(at.percentage),1),0) assessment_average FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id LEFT JOIN attempts at ON at.student_id=u.id AND at.status='submitted' LEFT JOIN assessments a ON a.id=at.assessment_id AND a.class_id=c.id WHERE c.teacher_id=? GROUP BY u.id,c.id`).all(req.user.id):db.prepare(`SELECT u.name student,c.name class_name,COALESCE(ROUND(AVG(at.percentage),1),0) assessment_average FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id LEFT JOIN attempts at ON at.student_id=u.id AND at.status='submitted' LEFT JOIN assessments a ON a.id=at.assessment_id AND a.class_id=c.id GROUP BY u.id,c.id`).all();const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv=["Student,Class,Assessment Average",...rows.map(r=>[r.student,r.class_name,r.assessment_average].map(esc).join(","))].join("\n");res.type("text/csv").send(csv);});

app.post("/api/attendance",auth,roles("admin","teacher"),(req,res)=>{const c=classForUser(req.user,req.body.class_id);if(!c)return res.status(403).json({error:"Not allowed"});db.prepare("INSERT INTO attendance(class_id,student_id,date,status) VALUES(?,?,?,?) ON CONFLICT(class_id,student_id,date) DO UPDATE SET status=excluded.status").run(c.id,req.body.student_id,req.body.date,req.body.status||"present");res.json({ok:true});});
app.get("/api/attendance/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});const date=req.query.date||new Date().toISOString().slice(0,10);const rows=db.prepare(`SELECT u.id,u.name,u.email,COALESCE(att.status,'present') status FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id AND att.date=? WHERE e.class_id=? ORDER BY u.name`).all(date,req.params.classId);res.json({date,students:rows});});
app.get("/api/attendance-summary/:classId",auth,(req,res)=>{if(!classForUser(req.user,req.params.classId))return res.status(403).json({error:"Not allowed"});res.json(db.prepare(`SELECT u.id,u.name,COUNT(att.id) total,SUM(CASE WHEN att.status='present' THEN 1 ELSE 0 END) present,SUM(CASE WHEN att.status='absent' THEN 1 ELSE 0 END) absent,SUM(CASE WHEN att.status='late' THEN 1 ELSE 0 END) late FROM users u JOIN enrollments e ON e.student_id=u.id LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id WHERE e.class_id=? GROUP BY u.id ORDER BY u.name`).all(req.params.classId));});

app.post("/api/announcements",auth,roles("admin","teacher"),(req,res)=>{const c=req.body.class_id?classForUser(req.user,req.body.class_id):null;if(req.body.class_id&&!c)return res.status(403).json({error:"Not allowed"});const r=db.prepare("INSERT INTO announcements(title,body,class_id,author_id) VALUES(?,?,?,?)").run(req.body.title,req.body.body,req.body.class_id||null,req.user.id);const targets=req.body.class_id?db.prepare("SELECT student_id FROM enrollments WHERE class_id=?").all(req.body.class_id).map(x=>x.student_id):db.prepare("SELECT id FROM users WHERE role='student'").all().map(x=>x.id);targets.forEach(id=>notify(id,req.body.title,req.body.body));res.json({id:r.lastInsertRowid});});
app.get("/api/announcements",auth,(req,res)=>{const rows=req.user.role==="student"?db.prepare(`SELECT a.*,c.name class_name,u.name author_name FROM announcements a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN users u ON u.id=a.author_id LEFT JOIN enrollments e ON e.class_id=a.class_id WHERE a.class_id IS NULL OR e.student_id=? ORDER BY a.id DESC`).all(req.user.id):db.prepare(`SELECT a.*,c.name class_name,u.name author_name FROM announcements a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN users u ON u.id=a.author_id ORDER BY a.id DESC`).all();res.json(rows);});
app.get("/api/notifications",auth,(req,res)=>res.json(db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.id)));
app.patch("/api/notifications/:id/read",auth,(req,res)=>{db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id,req.user.id);res.json({ok:true});});

app.get("/api/messages",auth,(req,res)=>res.json(db.prepare(`SELECT m.*,s.name sender_name,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE m.sender_id=? OR m.receiver_id=? ORDER BY m.id DESC`).all(req.user.id,req.user.id)));
app.post("/api/messages",auth,(req,res)=>{const receiver=db.prepare("SELECT id FROM users WHERE id=?").get(req.body.receiver_id);if(!receiver)return res.status(404).json({error:"Recipient not found"});const r=db.prepare("INSERT INTO messages(sender_id,receiver_id,subject,body) VALUES(?,?,?,?)").run(req.user.id,receiver.id,req.body.subject||"",req.body.body||"");notify(receiver.id,"New message","You have a new message from "+req.user.name);res.json({id:r.lastInsertRowid});});
app.patch("/api/messages/:id/read",auth,(req,res)=>{db.prepare("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE id=? AND receiver_id=?").run(req.params.id,req.user.id);res.json({ok:true});});

app.get("/api/report-card/:studentId",auth,(req,res)=>{
  const sid=Number(req.params.studentId);
  if(req.user.role==="student"&&req.user.id!==sid)return res.status(403).json({error:"Not allowed"});
  if(req.user.role==="teacher"){const ok=db.prepare("SELECT 1 FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=? AND c.teacher_id=?").get(sid,req.user.id);if(!ok)return res.status(403).json({error:"Not allowed"});}
  const student=db.prepare("SELECT id,name,email FROM users WHERE id=?").get(sid);
  const subjects=db.prepare(`SELECT s.name subject,ROUND(COALESCE(AVG(at.percentage),0),1) average FROM subjects s LEFT JOIN assessments a ON a.class_id=s.class_id LEFT JOIN attempts at ON at.assessment_id=a.id AND at.student_id=? AND at.status='submitted' WHERE s.class_id IN (SELECT class_id FROM enrollments WHERE student_id=?) GROUP BY s.id`).all(sid,sid);
  const att=db.prepare("SELECT COUNT(*) total,SUM(status='present') present,SUM(status='absent') absent,SUM(status='late') late FROM attendance WHERE student_id=?").get(sid);
  const school=db.prepare("SELECT value FROM school_settings WHERE key='school_name'").get()?.value||"MyClassroom Academy";
  res.json({school,student,subjects,attendance:att});
});
app.get("/api/settings",auth,(req,res)=>res.json(Object.fromEntries(db.prepare("SELECT key,value FROM school_settings").all().map(x=>[x.key,x.value]))));
app.patch("/api/settings",auth,roles("admin"),(req,res)=>{for(const [k,v] of Object.entries(req.body)){db.prepare("INSERT INTO school_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));}log(req.user.id,"Updated school settings");res.json({ok:true});});

app.get("/api/dashboard",auth,(req,res)=>{
  if(req.user.role==="admin")return res.json({role:"admin",stats:{users:db.prepare("SELECT COUNT(*) c FROM users").get().c,students:db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c,teachers:db.prepare("SELECT COUNT(*) c FROM users WHERE role='teacher'").get().c,classes:db.prepare("SELECT COUNT(*) c FROM classes").get().c}});
  if(req.user.role==="teacher")return res.json({role:"teacher",stats:{classes:db.prepare("SELECT COUNT(*) c FROM classes WHERE teacher_id=?").get(req.user.id).c,students:db.prepare("SELECT COUNT(DISTINCT e.student_id) c FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.teacher_id=?").get(req.user.id).c,pending:db.prepare("SELECT COUNT(*) c FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE (a.teacher_id=? OR a.class_id IN (SELECT id FROM classes WHERE teacher_id=?)) AND s.score IS NULL").get(req.user.id,req.user.id).c,assessments:db.prepare("SELECT COUNT(*) c FROM assessments WHERE teacher_id=?").get(req.user.id).c}});
  return res.json({role:"student",stats:{classes:db.prepare("SELECT COUNT(*) c FROM enrollments WHERE student_id=?").get(req.user.id).c,assignments:db.prepare("SELECT COUNT(*) c FROM assignments a JOIN enrollments e ON e.class_id=a.class_id WHERE e.student_id=?").get(req.user.id).c,assessments:db.prepare("SELECT COUNT(*) c FROM assessments a JOIN enrollments e ON e.class_id=a.class_id WHERE e.student_id=?").get(req.user.id).c,average:db.prepare("SELECT ROUND(COALESCE(AVG(percentage),0),1) c FROM attempts WHERE student_id=? AND status='submitted'").get(req.user.id).c}});
});

app.get("/api/health",(req,res)=>res.json({ok:true,version:"12.0.0"}));
app.use(express.static(PUBLIC));
app.get("*",(req,res)=>res.sendFile(path.join(PUBLIC,"index.html")));

app.listen(PORT,()=>console.log(`MyClassroom V12 running on http://localhost:${PORT}`));
