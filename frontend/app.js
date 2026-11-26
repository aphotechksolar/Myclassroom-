async function openMaterialFile(id){try{const r=await fetch("/api/materials/"+encodeURIComponent(id)+"/file",{credentials:"same-origin"});if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error||"Unable to open file")}const blob=await r.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="learning-material-"+id;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}catch(e){toast(e.message)}}
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let csrfToken=null;
async function api(url,opts={}){
 opts={...opts,headers:{...(opts.headers||{})},credentials:"same-origin"};
 const method=String(opts.method||"GET").toUpperCase();
 if(!["GET","HEAD","OPTIONS"].includes(method) && !["/auth/login","/auth/register","/auth/guardian/redeem","/auth/request-reset","/auth/reset","/auth/csrf"].includes(url)){
  if(!csrfToken){const csrfResponse=await fetch("/api/auth/csrf",{method:"POST",credentials:"same-origin",cache:"no-store"});let csrfData={};try{csrfData=await csrfResponse.json()}catch{}if(!csrfResponse.ok)throw new Error(csrfData.error||"Your session has expired. Please sign in again.");csrfToken=csrfData.csrfToken;}
  opts.headers["X-CSRF-Token"]=csrfToken;
 }
 if(!(opts.body instanceof FormData))opts.headers["Content-Type"]="application/json";
 const r=await fetch("/api"+url,opts);let d={};try{d=await r.json()}catch{}
 if(d.csrfToken)csrfToken=d.csrfToken;
 if(!r.ok){const error=new Error(d.error||"Request failed");error.status=r.status;error.data=d;throw error}
 return d;
}
function toast(t){const x=document.createElement("div");x.className="toast";x.textContent=t;document.body.appendChild(x);setTimeout(()=>x.remove(),2600)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function logout(){try{await api("/auth/logout",{method:"POST"})}catch{}csrfToken=null;sessionStorage.removeItem("mc_user");location.href="/login.html"}
async function initAuth(){
 if($("#login"))$("#login").onsubmit=async e=>{
  e.preventDefault();
  const email=$("#email").value,password=$("#password").value;
  const finish=async institutionId=>{
   const payload={email,password};
   if(institutionId)payload.institution_id=institutionId;
   const d=await api("/auth/login",{method:"POST",body:JSON.stringify(payload)});
   if(d.must_change_password)d.user.must_change_password=true;
    csrfToken=d.csrfToken;sessionStorage.mc_user=JSON.stringify(d.user);location.href="/dashboard.html";
  };
  try{await finish("")}
  catch(err){
   if(err.data?.requiresInstitutionSelection && Array.isArray(err.data.institutions)){
    $("#msg").innerHTML=`<section class="card"><p>We found more than one school linked to this account. Choose where you want to sign in.</p><form id="chooseSchool"><label for="institutionChoice">School</label><select id="institutionChoice" required>${err.data.institutions.map(i=>`<option value="${esc(i.institution_id)}">${esc(i.name)} · ${esc(i.role.replace("_"," "))}</option>`).join("")}</select><button class="btn" type="submit">Continue to school</button></form><p id="loginError" class="error" role="alert"></p></section>`;
    $("#chooseSchool").onsubmit=async event=>{
     event.preventDefault();
     try{await finish($("#institutionChoice").value)}
     catch(choiceError){$("#loginError").textContent=choiceError.message}
    };
   }else $("#msg").innerHTML=`<p class="error">${esc(err.message)}</p>`;
  }
 };
 if($("#register"))$("#register").onsubmit=async e=>{e.preventDefault();try{const d=await api("/auth/register",{method:"POST",body:JSON.stringify({name:$("#name").value,email:$("#email").value,password:$("#password").value,role:$("#role").value})});csrfToken=d.csrfToken;sessionStorage.mc_user=JSON.stringify(d.user);location.href="/dashboard.html"}catch(err){$("#msg").innerHTML=`<p class="error">${esc(err.message)}</p>`}};
 if($("#guardianRedeem"))$("#guardianRedeem").onsubmit=async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget));try{const d=await api("/auth/guardian/redeem",{method:"POST",body:JSON.stringify(form)});csrfToken=d.csrfToken;sessionStorage.mc_user=JSON.stringify(d.user);location.href="/dashboard.html"}catch(err){$("#msg").innerHTML=`<p class="error">${esc(err.message)}</p>`}};
}
const state={page:"overview",data:{}};
async function boot(){
 if(!$("#app"))return;
 if(!sessionStorage.mc_user)return location.href="/login.html";
 state.user=JSON.parse(sessionStorage.mc_user||"{}");
 try{csrfToken=(await api("/auth/csrf",{method:"POST"})).csrfToken;}catch{sessionStorage.removeItem("mc_user");return location.href="/login.html";}
 if(state.user.must_change_password){
  $("#app").innerHTML='<main class="card" style="max-width:520px;margin:8vh auto;padding:28px"><h1>Change your temporary password</h1><p class="muted">Your school administrator created this account. Set a new password before continuing.</p><form id="firstPassword" class="formgrid"><label class="full">Current temporary password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label class="full">New password<input name="newPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label class="full">Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><div class="full"><button class="btn">Save new password</button></div></form><p id="passwordError" class="error" role="alert"></p><button class="btn secondary" type="button" onclick="logout()">Log out</button></main>';
  $("#firstPassword").onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));if(values.newPassword!==values.confirmPassword){$("#passwordError").textContent="The new passwords do not match.";return;}try{const result=await api("/auth/change-password",{method:"POST",body:JSON.stringify({currentPassword:values.currentPassword,newPassword:values.newPassword})});delete state.user.must_change_password;sessionStorage.mc_user=JSON.stringify(state.user);csrfToken=result.csrfToken;location.reload();}catch(error){$("#passwordError").textContent=error.message;}};
  return;
 }
 $("#app").innerHTML=`<div class="shell"><aside class="side" id="sidebar"><a class="brand" href="#">MyClassroom</a><div class="small" style="color:#aeb9ca">${esc(state.user.role.toUpperCase())} PORTAL</div><div class="nav">
 ${(state.user.role==="parent"?["overview"]:["overview","profile","people","classes","materials","assignments","assessments","attendance","timetable","performance","messages","notifications","reports","admin"].filter(p=>state.user.role==="admin"||p!=="admin")).map(p=>`<button data-page="${p}">${icons[p]||"•"} ${title(p)}</button>`).join("")}
 <button onclick="logout()">↪ Log out</button></div></aside><main class="main"><div class="bar"><div class="bar-heading"><button class="menu-toggle" id="menuToggle" aria-label="Toggle navigation" aria-expanded="false">☰</button><div><h1 id="title">Overview</h1><span class="muted" id="subtitle"></span></div></div><div class="userbox">${esc(state.user.name)} · ${esc(state.user.email)}</div></div><div id="view"></div></main></div><div id="modal" class="modal"></div>`;
 $(".nav button[data-page]").forEach(b=>b.onclick=()=>{show(b.dataset.page);$("#sidebar").classList.remove("side-open");$("#menuToggle").setAttribute("aria-expanded","false")});
 $("#menuToggle").onclick=()=>{const open=$("#sidebar").classList.toggle("side-open");$("#menuToggle").setAttribute("aria-expanded",String(open))};
 await show("overview");
}
const icons={overview:"⌂",profile:"◉",people:"♟",classes:"▦",materials:"▤",assignments:"✓",assessments:"✎",attendance:"◷",timetable:"▥",performance:"↗",messages:"✉",notifications:"●",reports:"▣",admin:"⚙"};
function title(x){return x[0].toUpperCase()+x.slice(1).replace("-", " ")}
async function show(page){
 state.page=page;$$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("#title").textContent=title(page);$("#subtitle").textContent="";
 try{
  if(page==="overview")return state.user.role==="parent"?parentOverview():state.user.role==="student"?studentOverview():overview(); if(page==="profile")return profile(); if(page==="people")return people(); if(page==="classes")return classes();
  if(page==="materials")return materials(); if(page==="assignments")return assignments(); if(page==="assessments")return assessments(); if(page==="attendance")return attendance();
  if(page==="timetable")return timetable(); if(page==="performance")return performance(); if(page==="messages")return messages(); if(page==="notifications")return notifications();
  if(page==="reports")return reports(); if(page==="admin")return admin();
 }catch(e){$("#view").innerHTML=`<div class="card"><p class="error">${esc(e.message)}</p></div>`}
}


async function parentOverview(){
 const children=await api("/guardian/children");
 $("#subtitle").textContent="Your verified children's school progress";
 if(!children.length){
  $("#view").innerHTML='<section class="card"><h3>No linked children yet</h3><p class="muted">Ask your school administrator to verify your relationship and issue a guardian invitation.</p></section>';
  return;
 }
 async function selectChild(id){
  const report=await api("/guardian/children/"+encodeURIComponent(id)+"/performance");
  const child=children.find(c=>String(c.id)===String(id));
  $("#view").querySelectorAll("[data-child]").forEach(b=>b.classList.toggle("selected",String(b.dataset.child)===String(id)));
  const results=report.results||[],attendance=report.attendance||[],assignments=report.assignments||[];
  const average=results.length?(results.reduce((n,r)=>n+Number(r.percentage||0),0)/results.length).toFixed(1):"—";
  const attendanceTotal=attendance.reduce((n,a)=>n+Number(a.count||0),0);
  const present=attendance.filter(a=>String(a.status).toLowerCase()==="present").reduce((n,a)=>n+Number(a.count||0),0);
  $("#childReport").innerHTML=`
   <div class="grid parent-stats">
    <div class="stat"><span>Assessments completed</span><strong>${results.length}</strong></div>
    <div class="stat"><span>Assessment average</span><strong>${average}${average==="—"?"":"%"}</strong></div>
    <div class="stat"><span>Attendance</span><strong>${attendanceTotal?Math.round(present/attendanceTotal*100)+"%":"—"}</strong></div>
   </div>
   <section class="card"><h3>Assessment results</h3>${results.length?results.map(r=>`<div class="parent-row"><div><b>${esc(r.title)}</b><span>${esc(r.type)} · ${esc(r.submitted_at||"")}</span></div><strong>${esc(r.percentage)}%</strong></div>`).join(""):'<p class="muted">No completed assessments yet.</p>'}</section>
   <section class="card"><h3>Attendance summary</h3>${attendance.length?attendance.map(a=>`<div class="parent-row"><span>${esc(a.status)}</span><strong>${esc(a.count)} days</strong></div>`).join(""):'<p class="muted">No attendance records yet.</p>'}</section>
   <section class="card"><h3>Assignments and feedback</h3>${assignments.length?assignments.map(a=>`<div class="parent-row"><div><b>${esc(a.title)}</b><span>Due ${esc(a.due_date||"Not set")} · ${a.score==null?"Not graded":esc(a.score)+" marks"}</span>${a.feedback?`<p>${esc(a.feedback)}</p>`:""}</div></div>`).join(""):'<p class="muted">No assignments found.</p>'}</section>`;
 }
 $("#view").innerHTML=`
  <section class="student-welcome parent-welcome"><div><span class="pill">PARENT & GUARDIAN SPACE</span><h2>Welcome, ${esc(state.user.name.split(" ")[0])}.</h2><p>View progress for children verified by your school.</p></div><div class="student-welcome-icon" aria-hidden="true">♡</div></section>
  <section class="card"><h3>Your linked children</h3><div class="parent-child-list">${children.map(c=>`<button class="parent-child" data-child="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.class_names||"Class details unavailable")}</span></button>`).join("")}</div></section>
  <div id="childReport" class="parent-report"></div>`;
 $("#view").querySelectorAll("[data-child]").forEach(b=>b.onclick=()=>selectChild(b.dataset.child).catch(e=>{$("#childReport").innerHTML=`<div class="card"><p class="error">${esc(e.message)}</p></div>`}));
 await selectChild(children[0].id);
}

async function studentOverview(){
 const [dash,assignments,assessments,announcements,timetable]=await Promise.all([
  api("/dashboard"),api("/assignments"),api("/assessments"),api("/announcements"),api("/timetable")
 ]);
 const stats=dash.stats||{};
 const due=assignments.filter(a=>a.due_date).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date))).slice(0,4);
 const upcoming=assessments.slice(0,4);
 const today=new Date().toLocaleDateString("en-US",{weekday:"long"});
 const todayClasses=timetable.filter(t=>String(t.day||"").toLowerCase()===today.toLowerCase());
 $("#subtitle").textContent=dash.school||"Your learning at a glance";
 $("#view").innerHTML=`
 <section class="student-welcome"><div><span class="pill">STUDENT LEARNING SPACE</span><h2>Welcome back, ${esc(state.user.name.split(" ")[0])}.</h2><p>Here is what is happening with your learning today.</p></div><div class="student-welcome-icon" aria-hidden="true">✦</div></section>
 <div class="grid student-stats">${Object.entries(stats).map(([k,v])=>`<div class="stat"><span>${title(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</div>
 <div class="student-columns">
  <section class="card"><div class="section-heading"><h3>Assignments to work on</h3><button class="text-action" data-go="assignments">View all</button></div>${due.length?due.map(a=>`<div class="student-list-item"><div><b>${esc(a.title)}</b><span>${esc(a.class_name||"Class")} · Due ${esc(a.due_date)}</span></div><span class="chip">${esc(a.max_score)} marks</span></div>`).join(""):`<p class="muted">No upcoming dated assignments.</p>`}</section>
  <section class="card"><div class="section-heading"><h3>Assessments</h3><button class="text-action" data-go="assessments">View all</button></div>${upcoming.length?upcoming.map(a=>`<div class="student-list-item"><div><b>${esc(a.title)}</b><span>${esc(a.class_name||"Class")} · ${esc(a.duration_minutes)} minutes</span></div><span class="chip">${esc(a.type)}</span></div>`).join(""):`<p class="muted">No assessments available right now.</p>`}</section>
  <section class="card"><div class="section-heading"><h3>Today's timetable</h3><button class="text-action" data-go="timetable">Full timetable</button></div>${todayClasses.length?todayClasses.map(t=>`<div class="student-list-item"><div><b>${esc(t.subject_name||"Lesson")}</b><span>${esc(t.class_name||"Class")} · ${esc(t.room||"Room not set")}</span></div><span class="chip">${esc(t.start_time||"")}–${esc(t.end_time||"")}</span></div>`).join(""):`<p class="muted">No lessons listed for today.</p>`}</section>
  <section class="card"><div class="section-heading"><h3>School updates</h3><button class="text-action" data-go="notifications">Notifications</button></div>${announcements.length?announcements.slice(0,3).map(a=>`<article class="student-announcement"><b>${esc(a.title)}</b><p>${esc(a.body)}</p><span>${esc(a.created_at||"")}</span></article>`).join(""):`<p class="muted">No new announcements.</p>`}</section>
 </div>
 <section class="student-shortcuts"><button class="btn" data-go="classes">My classes</button><button class="btn secondary" data-go="materials">Learning materials</button><button class="btn secondary" data-go="performance">My results</button></section>`;
 $("[data-go]").forEach(b=>b.onclick=()=>show(b.dataset.go));
}

async function overview(){const d=await api("/dashboard"), s=d.stats||{};$("#view").innerHTML=`<div class="grid">${Object.entries(s).map(([k,v])=>`<div class="stat"><span>${title(k)}</span><strong>${v}</strong></div>`).join("")}</div><div class="cards" style="margin-top:16px"><div class="card"><h3>Welcome to V12</h3><p>Use the navigation to manage classes, learning, assessments, attendance and school operations.</p></div><div class="card"><h3>Quick actions</h3><div class="toolbar"><button class="btn" onclick="show('${state.user.role==="student"?"classes":"classes"}')">Open classes</button><button class="btn secondary" onclick="show('assessments')">Assessments</button></div></div><div class="card"><h3>Security</h3><p>Change your password from Profile. Production deployments should add HTTPS, rate limiting and secure cookies.</p></div></div>`}
async function profile(){const u=await api("/me");$("#view").innerHTML=`<div class="card"><h3>My profile</h3><form id="pf" class="formgrid"><label>Name<input name="name" value="${esc(u.name)}"></label><label>Phone<input name="phone" value="${esc(u.phone)}"></label><label class="full">Bio<textarea name="bio">${esc(u.bio)}</textarea></label><div><button class="btn">Save profile</button></div></form></div><div class="card" style="margin-top:16px"><h3>Change password</h3><form id="pw" class="formgrid"><label>Current password<input name="currentPassword" type="password"></label><label>New password<input name="newPassword" type="password" minlength="6"></label><div><button class="btn">Change password</button></div></form></div>`;$("#pf").onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e));await api("/me",{method:"PATCH",body:JSON.stringify(o)});state.user={...state.user,...o};sessionStorage.mc_user=JSON.stringify(state.user);toast("Profile saved")};$("#pw").onsubmit=async e=>{e.preventDefault();const changed=await api("/auth/change-password",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e)))});csrfToken=changed.csrfToken;toast("Password changed")}}
async function people(){
 const list=state.user.role==="admin"?await api("/admin/users"):await api("/students");
 $("#view").innerHTML=`
  ${state.user.role==="admin"?`<section class="card guardian-admin-card"><div class="section-heading"><div><h3>Parent & guardian access</h3><p class="muted">Invite a verified guardian to view one student's academic progress.</p></div></div>
   <form id="guardianInviteForm" class="formgrid">
    <label>Student<select name="student_id" required><option value="">Select student</option>${list.filter(u=>u.institution_role==="student"||u.role==="student").map(u=>`<option value="${esc(u.id)}">${esc(u.name)} · ${esc(u.email)}</option>`).join("")}</select></label>
    <label>Guardian email<input name="email" type="email" required placeholder="guardian@example.com"></label>
    <div class="full"><button class="btn">Create guardian invitation</button></div>
   </form><div id="guardianTokenResult"></div><div id="guardianManagement"></div>
  </section>`:""}
  <div class="toolbar"><input id="psearch" placeholder="Search people...">${state.user.role==="admin"?'<button class="btn" onclick="openUserModal()">Add user</button>':""}</div>
  <div class="tablewrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th></th></tr></thead><tbody id="pt">${list.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="chip">${esc(u.institution_role||u.role||"student")}</span></td><td>${esc(u.phone)}</td><td>${state.user.role==="admin"?`<button class="btn secondary" onclick='editUser(${JSON.stringify(u)})'>Edit</button>`:""}</td></tr>`).join("")}</tbody></table></div>`;
 $("#psearch").oninput=e=>$$(`#pt tr`).forEach(r=>r.style.display=r.textContent.toLowerCase().includes(e.target.value.toLowerCase())?"":"none");
 if(state.user.role==="admin")setupGuardianManagement();
}
async function setupGuardianManagement(){
 const form=$("#guardianInviteForm");
 form.onsubmit=async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(form));
  try{
   const result=await api("/guardians/invitations",{method:"POST",body:JSON.stringify(data)});
   const link=location.origin+"/guardian-invite.html";
   $("#guardianTokenResult").innerHTML=`<div class="guardian-token"><h4>Invitation created</h4><p>Share this page and token privately with the verified guardian. This token is shown only once.</p><label>Invitation page<input readonly value="${esc(link)}"></label><label>One-time token<textarea readonly id="guardianInviteToken">${esc(result.invitation_token)}</textarea></label><p class="muted">Expires: ${esc(result.expires_at)}</p><button type="button" class="btn" id="copyGuardianInvite">Copy invitation details</button></div>`;
   $("#copyGuardianInvite").onclick=()=>{const message=`MyClassroom guardian invitation\nPage: ${link}\nEmail: ${data.email}\nToken: ${result.invitation_token}\nExpires: ${result.expires_at}`;if(navigator.clipboard?.writeText)navigator.clipboard.writeText(message).then(()=>toast("Invitation details copied")).catch(()=>toast("Copy the token and page manually"));else toast("Copy the token and page manually")};
   form.reset();await loadGuardianManagement();
  }catch(err){$("#guardianTokenResult").innerHTML=`<p class="error">${esc(err.message)}</p>`;}
 };
 await loadGuardianManagement();
}
async function loadGuardianManagement(){
 const data=await api("/guardians/manage");
 $("#guardianManagement").innerHTML=`
  <h4>Guardian invitations</h4><div class="tablewrap"><table class="table"><thead><tr><th>Student</th><th>Guardian email</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>
  ${data.invitations.map(i=>`<tr><td>${esc(i.student_name)}</td><td>${esc(i.email)}</td><td><span class="chip">${esc(i.status)}</span></td><td>${esc(i.expires_at)}</td><td>${i.status==="pending"?`<button class="btn secondary" data-cancel-invite="${esc(i.id)}">Cancel</button>`:""}</td></tr>`).join("")||'<tr><td colspan="5">No invitations yet.</td></tr>'}
  </tbody></table></div><h4>Verified guardian links</h4><div class="tablewrap"><table class="table"><thead><tr><th>Student</th><th>Guardian</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>
  ${data.links.map(l=>`<tr><td>${esc(l.student_name)}</td><td>${esc(l.guardian_name)}</td><td>${esc(l.guardian_email)}</td><td><span class="chip">${esc(l.status)}</span></td><td>${l.status==="verified"?`<button class="btn secondary" data-revoke-guardian="${esc(l.student_id)}" data-guardian-id="${esc(l.guardian_id)}">Revoke</button>`:""}</td></tr>`).join("")||'<tr><td colspan="5">No verified guardian links yet.</td></tr>'}
  </tbody></table></div>`;
 $("#guardianManagement").querySelectorAll("[data-cancel-invite]").forEach(b=>b.onclick=async()=>{if(!confirm("Cancel this pending guardian invitation?"))return;try{await api("/guardians/invitations/"+b.dataset.cancelInvite,{method:"DELETE"});await loadGuardianManagement()}catch(e){toast(e.message)}});
 $("#guardianManagement").querySelectorAll("[data-revoke-guardian]").forEach(b=>b.onclick=async()=>{if(!confirm("Revoke this guardian's access to the student?"))return;try{await api("/guardians/children/"+b.dataset.revokeGuardian,{method:"DELETE",body:JSON.stringify({guardian_id:Number(b.dataset.guardianId)})});await loadGuardianManagement()}catch(e){toast(e.message)}});
}
function openUserModal(){if(state.user.role!=="admin")return toast("Use registration for new accounts");$("#modal").innerHTML=`<div><h2>Create user</h2><form id="um" class="formgrid"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" value="changeme123" required></label><label>Role<select name="role"><option>student</option><option>teacher</option><option>admin</option></select></label><div><button class="btn">Create</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></div></form></div>`;$("#modal").classList.add("open");$("#um").onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e));await api("/admin/users",{method:"POST",body:JSON.stringify(o)});closeModal();show("people")}}
function editUser(u){$("#modal").innerHTML=`<div><h2>Edit user</h2><form id="ue"><label>Name<input name="name" value="${esc(u.name)}"></label><label>Role<select name="role">${["student","teacher","admin"].map(r=>`<option ${u.role===r?"selected":""}>${r}</option>`).join("")}</select></label><label>Phone<input name="phone" value="${esc(u.phone)}"></label><label>Bio<textarea name="bio">${esc(u.bio)}</textarea></label><button class="btn">Save</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");$("#ue").onsubmit=async e=>{e.preventDefault();await api("/admin/users/"+u.id,{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(e)))});closeModal();show("people")}}
function closeModal(){$("#modal").classList.remove("open")}
async function classes(){const cs=await api("/classes");$("#view").innerHTML=`<div class="toolbar">${state.user.role!=="student"?`<button class="btn" onclick="newClass()">+ New class</button>`:"<button class=\"btn\" onclick=\"joinClass()\">Join class</button>"}</div><div class="cards">${cs.map(c=>`<div class="card"><span class="tag">${esc(c.code)}</span><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><p class="muted">${c.student_count??"—"} students · ${esc(c.teacher_name||"No teacher")}</p>${c.live_link?`<a class="btn" target="_blank" href="${esc(c.live_link)}">Join live class</a>`:""} <button class="btn secondary" onclick="classDetail(${c.id})">Open</button></div>`).join("")||"<div class=card>No classes yet.</div>"}</div>`}
function newClass(){formModal("Create class",[{n:"name",l:"Class name"},{n:"code",l:"Enrolment code"},{n:"description",l:"Description",t:"textarea"},{n:"live_link",l:"Live class link"}],async o=>{await api("/classes",{method:"POST",body:JSON.stringify(o)});closeModal();show("classes")})}
function joinClass(){formModal("Join class",[{n:"code",l:"Enrolment code"}],async o=>{await api("/classes/join",{method:"POST",body:JSON.stringify(o)});closeModal();show("classes")})}
function formModal(titleTxt,fields,cb){$("#modal").innerHTML=`<div><h2>${titleTxt}</h2><form id="fm">${fields.map(f=>`<label>${f.l}${f.t==="textarea"?`<textarea name="${f.n}"></textarea>`:`<input name="${f.n}" ${f.n==="code"?"":""}>`}</label>`).join("")}<button class="btn">Save</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");$("#fm").onsubmit=async e=>{e.preventDefault();try{await cb(Object.fromEntries(new FormData(e)))}catch(err){toast(err.message)}}}
async function classDetail(id){const c=(await api("/classes")).find(x=>x.id===id), students=await api("/classes/"+id+"/students");$("#modal").innerHTML=`<div><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p><p><b>Code:</b> ${esc(c.code)}</p><h3>Roster (${students.length})</h3><div>${students.map(s=>`<div class="message">${esc(s.name)} · ${esc(s.email)}</div>`).join("")}</div><button class="btn secondary" onclick="closeModal()">Close</button></div>`;$("#modal").classList.add("open")}
async function materials(){const m=await api("/materials"),cs=await api("/classes");$("#view").innerHTML=`<div class="toolbar">${state.user.role!=="student"?`<button class="btn" onclick="newMaterial()">+ Publish material</button>`:""}</div><div class="cards">${m.map(x=>`<div class="card"><span class="tag">${esc(x.class_name)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p>${x.file_url?`<a class="btn secondary" href="#" onclick="openMaterialFile(${Number(x.id)});return false">Open file</a>`:""} ${x.url?`<a class="btn secondary" target="_blank" href="${esc(x.url)}">Open link</a>`:""}</div>`).join("")||"<div class=card>No materials.</div>"}</div>`}
async function newMaterial(){const cs=await api("/classes");$("#modal").innerHTML=`<div><h2>Publish learning material</h2><form id="mat"><label>Title<input name="title" required></label><label>Class<select name="class_id">${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><label>Description<textarea name="description"></textarea></label><label>External link<input name="url" placeholder="https://..."></label><label>Optional file (max 10 MB)<input name="file" type="file"></label><button class="btn">Publish</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");$("#mat").onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);await api("/materials",{method:"POST",body:fd});closeModal();show("materials")}}
async function assignments(){const a=await api("/assignments"),s=state.user.role==="student"?await api("/submissions"):[];$("#view").innerHTML=`<div class="toolbar">${state.user.role!=="student"?`<button class="btn" onclick="newAssignment()">+ New assignment</button>`:""}</div><div class="cards">${a.map(x=>{const sub=s.find(z=>z.assignment_id===x.id);return `<div class="card"><span class="tag">${esc(x.class_name)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><p class="muted">Due: ${esc(x.due_date||"No date")} · ${x.max_score} marks</p>${state.user.role==="student"?`<button class="btn" onclick='submitAssignment(${JSON.stringify(x)})'>${sub?"Update submission":"Submit work"}</button>`:`<button class="btn secondary" onclick="gradeAssignment(${x.id})">Grade submissions</button>`}</div>`}).join("")||"<div class=card>No assignments.</div>"}</div>`}
async function newAssignment(){const cs=await api("/classes");formModal("New assignment",[{n:"title",l:"Title"},{n:"class_id",l:"Class"},{n:"due_date",l:"Due date (YYYY-MM-DD)"},{n:"max_score",l:"Maximum score"},{n:"description",l:"Instructions",t:"textarea"}],async o=>{await api("/assignments",{method:"POST",body:JSON.stringify(o)});closeModal();show("assignments")})}
async function submitAssignment(a){const old=(await api("/submissions")).find(x=>x.assignment_id===a.id);$("#modal").innerHTML=`<div><h2>${esc(a.title)}</h2><form id="sub"><textarea name="answer" placeholder="Type your answer here...">${esc(old?.answer||"")}</textarea><button class="btn">Submit</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");$("#sub").onsubmit=async e=>{e.preventDefault();await api("/assignments/"+a.id+"/submit",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e)))});closeModal();toast("Submitted");show("assignments")}}
async function gradeAssignment(id){const subs=(await api("/submissions")).filter(x=>x.assignment_id===id);$("#modal").innerHTML=`<div><h2>Grade submissions</h2>${subs.map(s=>`<div class="qrow"><b>${esc(s.student_name)}</b><p>${esc(s.answer)}</p><form onsubmit="grade(event,${s.id})" class="formgrid"><label>Score<input name="score" type="number" max="${s.max_score}" value="${s.score??""}"></label><label>Feedback<input name="feedback" value="${esc(s.feedback)}"></label><button class="btn">Save grade</button></form></div>`).join("")||"<p>No submissions yet.</p>"}<button class="btn secondary" onclick="closeModal()">Close</button></div>`;$("#modal").classList.add("open")}
async function grade(e,id){e.preventDefault();await api("/submissions/"+id+"/grade",{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(e)))});toast("Grade saved");e.target.closest(".qrow").querySelector("b").insertAdjacentHTML("afterend"," <span class=chip>saved</span>")}
async function assessments(){const a=await api("/assessments");$("#view").innerHTML=`<div class="toolbar">${state.user.role!=="student"?`<button class="btn" onclick="newAssessment()">+ Build quiz/exam</button>`:""}</div><div class="cards">${a.map(x=>`<div class="card"><span class="tag">${esc(x.type)}</span><h3>${esc(x.title)}</h3><p>${esc(x.class_name)} · ${x.question_count} questions · ${x.duration_minutes} min</p><p>Pass mark: ${x.pass_mark}%</p>${state.user.role==="student"?`<button class="btn" onclick="takeAssessment(${x.id})">Start / continue</button>`:""}</div>`).join("")||"<div class=card>No assessments.</div>"}</div>`}
let qCount=0;
async function newAssessment(){const cs=await api("/classes");qCount=0;$("#modal").innerHTML=`<div><h2>Assessment builder</h2><form id="af"><div class="formgrid"><label>Title<input name="title" required></label><label>Type<select name="type"><option>quiz</option><option>exam</option></select></label><label>Class<select name="class_id">${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><label>Duration (minutes)<input name="duration_minutes" type="number" value="20"></label><label>Pass mark %<input name="pass_mark" type="number" value="50"></label></div><div id="qs"></div><button type="button" class="btn secondary" onclick="addQ()">+ Add question</button> <button class="btn">Publish</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");addQ();$("#af").onsubmit=async e=>{e.preventDefault();const qs=$$(".qrow").map((r,i)=>({question:r.querySelector("[name=q]").value,options:[...r.querySelectorAll("[name=o]")].map(x=>x.value),answer:Number(r.querySelector("[name=answer]").value)}));const o=Object.fromEntries(new FormData(e));o.questions=qs;await api("/assessments",{method:"POST",body:JSON.stringify(o)});closeModal();show("assessments")}}
function addQ(){qCount++;const d=document.createElement("div");d.className="qrow";d.innerHTML=`<div class="qtop"><b>Question ${qCount}</b><button type="button" class="btn secondary" onclick="this.closest('.qrow').remove()">Remove</button></div><label>Question<input name="q" required></label>${[0,1,2,3].map(i=>`<label>Option ${i+1}<input name="o" required></label>`).join("")}<label>Correct option<select name="answer"><option value="0">1</option><option value="1">2</option><option value="2">3</option><option value="3">4</option></select></label>`;$("#qs").appendChild(d)}
async function takeAssessment(id){
 let d;
 try{d=await api("/assessments/"+id+"/start",{method:"POST",body:"{}"})}
 catch(error){toast(error.message);return}
 const at=d.attempt,qs=d.questions,deadline=Date.parse(at.expires_at);
 if(!Number.isFinite(deadline)){toast("This assessment has an invalid deadline. Contact your school.");return}
 let answers={},finishing=false,saveQueue=Promise.resolve();
 const remaining=()=>Math.max(0,Math.ceil((deadline-Date.now())/1000));
 const fmt=n=>`${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;
 const render=()=>{
   if(remaining()<=0)return finish();
   $("#modal").innerHTML=`<div><div class="bar"><h2>Assessment</h2><b id="timer">${fmt(remaining())}</b></div>${qs.map((q,i)=>`<div class="qrow"><b>${i+1}. ${esc(q.question)}</b>${q.options.map((o,j)=>`<label style="font-weight:500"><input type="radio" name="q${i}" value="${j}" ${String(answers[i])===String(j)?"checked":""}> ${esc(o)}</label>`).join("")}</div>`).join("")}<button class="btn" id="finish">Submit assessment</button></div>`;
   $("#modal").classList.add("open");
   qs.forEach((q,i)=>$$(`input[name=q${i}]`).forEach(x=>x.onchange=()=>{answers[i]=Number(x.value);saveQueue=saveQueue.then(()=>api("/assessments/"+id+"/answers",{method:"PATCH",body:JSON.stringify({answers})})).catch(error=>{toast(error.message)});}));
   $("#finish").onclick=finish;
 };
 const finish=async()=>{
   if(finishing)return;
   finishing=true;clearInterval(window.mcTimer);
   try{
     await saveQueue;
     const r=await api("/assessments/"+id+"/submit",{method:"POST",body:JSON.stringify({answers})});
     const heading=r.timed_out?"Time expired — attempt closed":"Result";
     $("#modal").innerHTML=`<div><h2>${heading}</h2><p class="pill">${esc(r.status)}</p><h1>${Number(r.percentage)||0}%</h1><p>Score: ${Number(r.score)||0}</p><button class="btn" onclick="closeModal();show('performance')">Continue</button></div>`;
   }catch(error){
     finishing=false;toast(error.message);
     if(remaining()<=0)$("#modal").innerHTML=`<div><h2>Time expired</h2><p>Your answers could not be confirmed by the server. Please reconnect and submit to retrieve the final attempt status.</p><button class="btn" onclick="takeAssessment(${id})">Check attempt status</button></div>`;
   }
 };
 render();clearInterval(window.mcTimer);
 window.mcTimer=setInterval(()=>{const left=remaining();if($("#timer"))$("#timer").textContent=fmt(left);if(left<=0)finish()},500);
}
async function attendance(){const cs=await api("/classes");if(state.user.role==="student")return $("#view").innerHTML=`<div class="cards">${cs.map(c=>`<div class=card><h3>${esc(c.name)}</h3><button class="btn secondary" onclick="attendanceSummary(${c.id})">View attendance</button></div>`).join("")}</div>`;$("#view").innerHTML=`<div class="toolbar"><select id="aclass">${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><input id="adate" type="date" value="${new Date().toISOString().slice(0,10)}"><button class="btn" onclick="loadAttendance()">Load</button></div><div id="att"></div>`;await loadAttendance()}
async function loadAttendance(){const id=$("#aclass").value,d=await api("/attendance/"+id+"?date="+$("#adate").value);$("#att").innerHTML=`<div class=card><div class=tablewrap><table class=table><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${d.students.map(s=>`<tr><td>${esc(s.name)}</td><td><select onchange="saveAtt(${id},${s.id},this.value)"><option ${s.status==="present"?"selected":""}>present</option><option ${s.status==="absent"?"selected":""}>absent</option><option ${s.status==="late"?"selected":""}>late</option></select></td></tr>`).join("")}</tbody></table></div></div>`}
async function saveAtt(c,s,status){await api("/attendance",{method:"POST",body:JSON.stringify({class_id:c,student_id:s,date:$("#adate").value,status})});toast("Attendance saved")}
async function attendanceSummary(id){const d=await api("/attendance-summary/"+id);$("#modal").innerHTML=`<div><h2>Attendance summary</h2><table class=table><thead><tr><th>Student</th><th>Total</th><th>Present</th><th>Absent</th><th>Late</th><th>%</th></tr></thead><tbody>${d.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.total}</td><td>${x.present||0}</td><td>${x.absent||0}</td><td>${x.late||0}</td><td>${x.total?Math.round((x.present||0)/x.total*100):0}%</td></tr>`).join("")}</tbody></table><button class=btn onclick=closeModal()>Close</button></div>`;$("#modal").classList.add("open")}
async function timetable(){const t=await api("/timetable"),cs=await api("/classes");$("#view").innerHTML=`<div class="toolbar">${state.user.role!=="student"?`<button class="btn" onclick="newSlot()">+ Add timetable slot</button>`:""}</div><div class=tablewrap><table class=table><thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Class</th><th>Room</th></tr></thead><tbody>${t.map(x=>`<tr><td>${esc(x.day)}</td><td>${esc(x.start_time)}-${esc(x.end_time)}</td><td>${esc(x.subject_name||"")}</td><td>${esc(x.class_name||"")}</td><td>${esc(x.room)}</td></tr>`).join("")||"<tr><td colspan=5>No timetable entries.</td></tr>"}</tbody></table></div>`}
async function newSlot(){const cs=await api("/classes"),ss=await api("/subjects");formModal("Timetable slot",[{n:"class_id",l:"Class"},{n:"subject_id",l:"Subject"},{n:"day",l:"Day"},{n:"start_time",l:"Start time"},{n:"end_time",l:"End time"},{n:"room",l:"Room"}],async o=>{await api("/timetable",{method:"POST",body:JSON.stringify(o)});closeModal();show("timetable")})}
async function performance(){const d=await api("/performance");const vals=d.results||[];$("#view").innerHTML=`<div class=cards><div class=card><h3>Student</h3><h2>${esc(d.student.name)}</h2><p>${esc(d.student.email)}</p></div><div class=card><h3>Attendance</h3><p>${(d.attendance.find(x=>x.status==="present")?.c||0)} present · ${(d.attendance.find(x=>x.status==="absent")?.c||0)} absent</p></div></div><div class=card style="margin-top:16px"><h3>Assessment performance</h3>${vals.length?`<div class=chart>${vals.map(x=>`<div class=barcol title="${esc(x.title)}"><div>${x.percentage}%</div><div class=barfill style="height:${Math.max(3,x.percentage*1.3)}px"></div><small>${esc(x.title).slice(0,10)}</small></div>`).join("")}</div>`:"<p>No completed assessments yet.</p>"}</div>`}
async function messages(){const ms=await api("/messages");$("#view").innerHTML=`<div class=toolbar><button class=btn onclick="newMessage()">+ New message</button></div><div>${ms.map(m=>`<div class="message ${!m.read_at&&m.receiver_id===state.user.id?"unread":""}"><b>${esc(m.subject||"Message")}</b><p>${esc(m.body)}</p><small>${esc(m.sender_name)} → ${esc(m.receiver_name)} · ${esc(m.created_at)}</small>${m.receiver_id===state.user.id&&!m.read_at?`<button class="btn secondary" onclick="readMsg(${m.id})">Mark read</button>`:""}</div>`).join("")||"<div class=card>No messages.</div>"}</div>`}
async function newMessage(){const people=state.user.role==="student"?await api("/teachers"):await api("/students");$("#modal").innerHTML=`<div><h2>New message</h2><form id="fm"><label>Recipient<select name="receiver_id">${people.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.email)}</option>`).join("")}</select></label><label>Subject<input name="subject"></label><label>Message<textarea name="body" required></textarea></label><button class="btn">Send</button> <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button></form></div>`;$("#modal").classList.add("open");$("#fm").onsubmit=async e=>{e.preventDefault();await api("/messages",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e)))});closeModal();show("messages")};}async function readMsg(id){await api("/messages/"+id+"/read",{method:"PATCH"});show("messages")}
async function notifications(){const n=await api("/notifications");$("#view").innerHTML=`<div class=toolbar><button class=btn secondary onclick="nread()">Mark all read</button></div>${n.map(x=>`<div class="message ${!x.read_at?"unread":""}"><b>${esc(x.title)}</b><p>${esc(x.body)}</p><small>${esc(x.created_at)}</small>${!x.read_at?`<button class=btn onclick="readNote(${x.id})">Read</button>`:""}</div>`).join("")||"<div class=card>No notifications.</div>"}`}
async function readNote(id){await api("/notifications/"+id+"/read",{method:"PATCH"});show("notifications")}async function nread(){const n=await api("/notifications");await Promise.all(n.filter(x=>!x.read_at).map(x=>api("/notifications/"+x.id+"/read",{method:"PATCH"})));show("notifications")}
async function reports(){const d=state.user.role==="student"?await api("/report-card/"+state.user.id):null;if(state.user.role!=="student"){const gb=await api("/gradebook");$("#view").innerHTML=`<div class=toolbar><a class=btn href="/api/export/gradebook.csv" target="_blank">Export gradebook CSV</a></div><div class=tablewrap><table class=table><thead><tr><th>Student</th><th>Class</th><th>Assessment avg</th><th>Assignment avg</th></tr></thead><tbody>${gb.map(x=>`<tr><td>${esc(x.student_name)}</td><td>${esc(x.class_name)}</td><td>${x.assessment_average??0}%</td><td>${x.assignment_average??0}%</td></tr>`).join("")}</tbody></table></div>`}else renderReport(d)}
function renderReport(d){$("#view").innerHTML=`<div class="print-report"><div class=no-print><button class=btn onclick="window.print()">Print / Save as PDF</button></div><h1 style="font-size:2rem">${esc(d.school)}</h1><h2>Student Report Card</h2><p><b>Name:</b> ${esc(d.student.name)} &nbsp; <b>Email:</b> ${esc(d.student.email)}</p><table><thead><tr><th>Subject</th><th>Average</th><th>Grade</th></tr></thead><tbody>${d.subjects.map(s=>`<tr><td>${esc(s.subject)}</td><td>${s.average}%</td><td>${grade(s.average)}</td></tr>`).join("")}</tbody></table><h3>Attendance</h3><p>Total records: ${d.attendance.total||0} · Present: ${d.attendance.present||0} · Absent: ${d.attendance.absent||0} · Late: ${d.attendance.late||0}</p></div>`}
function grade(n){return n>=80?"A":n>=70?"B":n>=60?"C":n>=50?"D":"F"}
async function admin(){const [s,settings]=await Promise.all([api("/admin/stats"),api("/settings")]);$("#view").innerHTML=`<div class=grid>${Object.entries(s).map(([k,v])=>`<div class=stat><span>${title(k)}</span><strong>${v}</strong></div>`).join("")}</div><div class=card style="margin-top:16px"><h3>School settings</h3><form id=sf class=formgrid><label>School name<input name=school_name value="${esc(settings.school_name||"")}" /></label><label>Motto<input name=motto value="${esc(settings.motto||"")}" /></label><div><button class=btn>Save settings</button></div></form></div><div class=card style="margin-top:16px"><h3>Audit log</h3><div id=audit></div></div>`;$("#sf").onsubmit=async e=>{e.preventDefault();await api("/settings",{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(e)))});toast("Settings saved")};const a=await api("/audit");$("#audit").innerHTML=a.map(x=>`<div class=message>${esc(x.actor_name||"System")} · ${esc(x.action)} · ${esc(x.details||"")} <small>${esc(x.created_at)}</small></div>`).join("")}
initAuth();boot();
