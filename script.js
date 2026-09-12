function demoLogin(e,role){e.preventDefault();location.href=role==='teacher'?'teacher-dashboard.html':'student-dashboard.html'}
function show(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById(id).classList.add('active');scrollTo(0,0)}
function addMaterial(){let n=materialName.value.trim();if(!n)return alert('Enter a material title.');materialsList.innerHTML+=`<div class="item">📚 <b>${safe(n)}</b><span>Uploaded</span></div>`;materialName.value=''}
function addAssignment(){let n=assignmentTitle.value.trim();if(!n)return alert('Enter an assignment title.');assignmentList.innerHTML+=`<div class="item">📝 <b>${safe(n)}</b><span>Created</span></div>`}
function addQuiz(){let n=quizTitle.value.trim();if(!n)return alert('Enter a quiz title.');quizList.innerHTML+=`<div class="item">❓ <b>${safe(n)}</b><span>${quizQuestions.value||0} questions</span></div>`}
function addExam(){let n=examTitle.value.trim();if(!n)return alert('Enter an examination title.');examList.innerHTML+=`<div class="item">🧪 <b>${safe(n)}</b><span>${examDuration.value}</span></div>`}
function startLive(){liveStatus.textContent='Live classroom started in demo mode. Video integration comes in the backend stage.'}
function joinLive(){joinStatus.textContent='You joined the live classroom in demo mode.'}
function submitDemo(b){b.textContent='Submitted ✓';b.disabled=true}
function takeDemo(){alert('Demo assessment opened. The real timed quiz/exam engine comes next.')}
function filterStudents(v){document.querySelectorAll('#studentsTable tr:not(:first-child)').forEach(r=>r.style.display=r.innerText.toLowerCase().includes(v.toLowerCase())?'':'none')}
function safe(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}