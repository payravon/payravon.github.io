/* Payravon: Supabase-connected frontend. NO passwords or attendance in localStorage. */
'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){const n=$('toast');n.textContent=message;n.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.classList.remove('show'),3800)}
function view(name){if(name!=='dashboard'&&document.body.classList.contains('mobile-nav-open'))closeMobileMenu();['setup','welcome','register','login','hold','dashboard'].forEach(x=>$(x).classList.toggle('hidden',x!==name))}
function fail(err){
 console.error('Payravon API error', err);
 const code = String(err?.code || '').toLowerCase();
 const detail = String(err?.message || '');
 let msg = detail || 'Хатои сервер. Интернет ва танзимоти Supabase-ро санҷед.';
 if(code==='email_address_not_authorized'||/email address not authorized/i.test(detail))
   msg='Supabase ҳоло ба ин email иҷозати фиристодан намедиҳад. Барои сабти ном SMTP-ро танзим кунед (README).';
 else if(code==='over_email_send_rate_limit'||/email rate limit exceeded/i.test(detail))
   msg='Маҳдудияти фиристодани email дар Supabase пур шуд. SMTP-и алоҳида лозим аст.';
 else if(code==='invalid_credentials'||/invalid login credentials/i.test(detail))
   msg='Email ё парол нодуруст аст.';
 else if(code==='email_not_confirmed'||/email not confirmed/i.test(detail))
   msg='Почтаи электрониро тасдиқ кунед, баъд ворид шавед.';
 else if(/database error saving new user/i.test(detail))
   msg='Сабти корбар дар база қатъ шуд. Мигратсия/триггери profiles-ро дар Supabase санҷед.';
 toast(msg);
}
const config = window.PAYRAVON_CONFIG || {};
const configured = /^https:\/\/[^\s]+\.supabase\.co\/?$/.test(config.supabaseUrl || '')
  && typeof config.supabasePublishableKey === 'string'
  && config.supabasePublishableKey.length > 15
  && (config.supabasePublishableKey.startsWith('sb_publishable_') || config.supabasePublishableKey.startsWith('eyJ'));
const client = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true }
}) : null;
let current=null, activeTab='home', busy=false;
let data={universities:[],students:[],lessons:[],attendance:[],announcements:[],warnings:[],points:[],registrations:[]};
function role(){return current?.role||'student'}
function isStaff(){return role()==='admin'||role()==='super_admin'}
function roleText(r){return ({student:'Донишҷӯ',admin:'Admin',super_admin:'Super Admin'})[r] || r}
function universityName(id){return data.universities.find(u=>u.id===id)?.name||'—'}
function lessonName(id){return data.lessons.find(l=>l.id===id)?.title||'Дарс'}
function dateTime(x){return x?new Date(x).toLocaleString('tg-TJ'):'—'}
function updateBusy(form,state){
 const button=Array.from(form?.elements || []).find(control=>control.type==='submit');
 if(button)button.disabled=state;
}
async function q(table,options={}){
  // Supabase REST returns at most 1000 rows per request, so page for 500 students/30 lessons.
  const rows=[];const pageSize=800;
  for(let page=0;page<40;page++){
    let request=client.from(table).select(options.select||'*').range(page*pageSize,page*pageSize+pageSize-1);
    if(options.filter)request=request.eq(...options.filter);
    if(options.order)request=request.order(options.order,{ascending:options.ascending!==false});
    if(options.secondaryOrder)request=request.order(options.secondaryOrder);
    const {data:part,error}=await request;
    if(error)throw error;
    rows.push(...(part||[]));
    if(!part||part.length<pageSize)break;
  }
  return rows;
}
async function getUniversities(){const {data:unis,error}=await client.from('universities').select('id,name').order('name');if(error)throw error;data.universities=unis||[];fillUniversities()}
function fillUniversities(){const box=$('regUniversity');box.innerHTML='<option value="">Интихоб кунед</option>'+data.universities.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}
async function loadData(){
  if(!current)return;
  const jobs=[q('lessons',{order:'id'}),q('attendance',{order:'id',ascending:false}),q('announcements',{order:'id',ascending:false})];
  if(isStaff())jobs.push(q('profiles',{order:'created_at',ascending:false}));
  else jobs.push(Promise.resolve([current]));
  jobs.push(q('points_ledger',{order:'created_at',ascending:false}));
  jobs.push(q('event_points_awards',{select:'student_id,points,reason,created_at',order:'created_at',ascending:false}));
  jobs.push(isStaff()?Promise.resolve([]):q('announcement_registrations',{order:'announcement_id'}));
  const [lessons,attendance,announcements,students,points,eventPoints,registrations]=await Promise.all(jobs);
  data.lessons=lessons;data.attendance=attendance;data.announcements=announcements;
  data.students=students;
  data.points=[...points,...eventPoints].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  data.registrations=registrations;
  if(isStaff()){
    const {data:warnings,error}=await client.rpc('absence_warnings');
    if(error){
      data.warnings=[];
      console.warn('Payravon absence_warnings', error);
      toast('Рӯйхати донишҷӯён дастрас аст. Огоҳиҳои ғоибӣ бор нашуданд.');
    } else data.warnings=warnings||[];
  } else data.warnings=[];
}
async function loadCurrent(){
  const {data:auth,error:authError}=await client.auth.getUser();
  if(authError||!auth?.user){current=null;$('logoutBtn').hidden=true;view('welcome');return}
  const {data:profile,error}=await client.from('profiles').select('*').eq('id',auth.user.id).single();
  if(error){fail(error);view('welcome');return}
  current=profile;
  $('logoutBtn').hidden=false;
  $('roleLabel').textContent=roleText(profile.role);
  if(profile.role==='student'&&profile.status!=='approved'){
    const labels={pending:['Дархост дар интизорӣ','Баъди тасдиқи Admin кабинети донишҷӯ фаъол мешавад.'],rejected:['Дархост рад шуд','Барои маълумот ба маъмурияти курс муроҷиат кунед.'],excluded:['Аз курс хориҷ шудед','Ҳисоб аз курс хориҷ шудааст. Бо Admin тамос гиред.'],removed:['Ҳисоб ғайрифаъол аст','Барои маълумот бо Admin тамос гиред.']};
    const label=labels[profile.status]||['Дастрасӣ нест','Бо маъмурияти курс тамос гиред.'];
    $('holdTitle').textContent=label[0];$('holdText').textContent=label[1];view('hold');return;
  }
  await loadData();openDashboard();
}
async function refresh(tab=activeTab){await loadCurrent();if(current&&$('dashboard').classList.contains('hidden')===false)renderTabs(tab)}
function openDashboard(){
 view('dashboard');document.body.classList.toggle('staff-layout',isStaff());$('dashRole').textContent=role()==='student'?'КАБИНЕТИ ДОНИШҶӮ':role()==='admin'?'КАБИНЕТИ ADMIN':'ИДОРАКУНИИ УМУМӢ';
 $('dashTitle').textContent=role()==='student'?'Салом, '+current.full_name:'Панели идоракунӣ';
 $('dashSubtitle').textContent=role()==='student'?'Маълумоти курс ва иштироки шумо':'Идоракунии донишҷӯён ва 30 дарс';
 $('statCount').textContent=String(data.lessons.length);renderTabs(activeTab);
}
function studentPoints(id){return data.points.filter(p=>p.student_id===id).reduce((sum,p)=>sum+Number(p.points||0),0)}

function rankedStudents(){
 return data.students.filter(s=>s.role==='student'&&s.status==='approved')
  .sort((a,b)=>studentPoints(b.id)-studentPoints(a.id)||String(a.full_name||'').localeCompare(String(b.full_name||''),'tg')||String(a.id).localeCompare(String(b.id)));
}
function studentRank(id){if(!isStaff())return null;const index=rankedStudents().findIndex(s=>s.id===id);return index<0?null:index+1}
function rankTheme(rank){return !rank?'rank-unranked':rank<=120?'rank-green':rank<=150?'rank-yellow':'rank-red'}
function rankBadge(rank){if(!rank)return '<span class="rank-badge rank-unranked">—</span>';
 const medal=rank===1?'🏆':rank===2?'🥇':rank===3?'🥈':rank===4?'🥉':'';
 return `<span class="rank-badge ${rankTheme(rank)}">${medal?medal+' ':''}№${rank}${rank===1?' · Шоҳҷоиза':''}</span>`;
}
function studentNameHtml(id,fallback='—'){
 const person=data.students.find(s=>s.id===id);
 const rank=studentRank(id);
 return `<span class="student-name ${rankTheme(rank)}">${esc(person?.full_name||fallback)}</span>`;
}
function secondsLeft(value){return Math.max(0,Math.floor((new Date(value).getTime()-Date.now())/1000))}
function renderCountdown(seconds){
 const days=Math.floor(seconds/86400),hours=Math.floor((seconds%86400)/3600),mins=Math.floor((seconds%3600)/60),secs=seconds%60;
 return seconds===0?'Вақт фаро расид':`${days} рӯз · ${String(hours).padStart(2,'0')} соат · ${String(mins).padStart(2,'0')} дақ · ${String(secs).padStart(2,'0')} сония`;
}
function registrationClosed(a){
 return a.is_active===false || (a.countdown_to && new Date(a.countdown_to).getTime()<=Date.now());
}
function registrationEnabled(a){return a.registration_mode==='all'||a.registration_mode==='limited'}
function registrationFull(a){return a.registration_mode==='limited'&&a.registered_count>=a.participant_limit}
function registrationCount(a){
 return a.registration_mode==='limited'
  ? `${Number(a.registered_count)} аз ${Number(a.participant_limit)} ҷой`
  : `Барои ҳама · ${Number(a.registered_count)} сабт`;
}
function registrationStatus(a){
 if(registrationFull(a))return '<span class="status no">Ҷойҳо пур шуданд</span>';
 if(registrationClosed(a))return '<span class="status no">Сабти ном баста аст</span>';
 return '';
}
function registrationInfo(a){
 if(!registrationEnabled(a))return '';
 const joined=data.registrations.some(r=>String(r.announcement_id)===String(a.id));
 const status=registrationStatus(a);
 let action=joined?'<span class="status ok">Сабт шудед</span>':status;
 if(isStaff())action=`<span data-registration-status>${status}</span>
  <button type="button" class="btn secondary" data-event-roster="${esc(a.id)}" aria-expanded="false">Рӯйхати иштирокчиён</button>
  <div class="event-roster" hidden>
   <button type="button" class="btn primary" data-export-event="${esc(a.id)}">Боргирии CSV</button>
   <div data-roster-content></div>
  </div>`;
 else if(!action)action=`<button type="button" class="btn primary" data-join-event="${esc(a.id)}">Ман иштирок мекунам</button>`;
 return `<div class="announcement-actions"><strong data-event-count="${esc(a.id)}">${registrationCount(a)}</strong> ${action}</div>`;
}
function renderUrgentBanner(){
 const container=$('urgentBanner');if(!container||!current)return;
 const now=Date.now();
 const featured=data.announcements.filter(a=>a.is_active!==false&&a.is_urgent&&a.is_pinned&&(!a.countdown_to||new Date(a.countdown_to).getTime()>now))
  .sort((a,b)=>Number(b.id)-Number(a.id))[0];
 if(!featured){
  const latest=!isStaff()&&data.announcements.find(a=>registrationEnabled(a)&&!registrationClosed(a));
  container.hidden=!latest;
  container.innerHTML=latest?`<div class="panel-card"><strong>📢 ${esc(latest.title)}</strong> <button type="button" class="btn secondary" id="openEventAnnouncements">Дидани эълонҳо</button></div>`:'';
  if(latest)$('openEventAnnouncements').onclick=()=>renderTabs('announcements');
  return;
 }
 container.hidden=false;
 container.innerHTML=`<div class="urgent-banner"><div class="urgent-head">🔥 ХАБАРИ ФАВРӢ · РӮЗҲОИ НАЗДИК</div><strong class="urgent-title">${esc(featured.title)}</strong><p>${esc(featured.body)}</p>${featured.bonus_points?`<span class="urgent-bonus">⭐ ${Number(featured.bonus_points)} хол барои иштирок</span>`:''}${featured.countdown_to?`<div class="urgent-clock" data-end="${esc(featured.countdown_to)}" aria-live="off">⏳ ${renderCountdown(secondsLeft(featured.countdown_to))}</div>`:''}<span class="urgent-date">${featured.countdown_to?'Санаи чорабинӣ: '+dateTime(featured.countdown_to):'Эълони муҳим'}</span>${registrationEnabled(featured)&&!isStaff()?' <button type="button" class="btn secondary" id="openEventAnnouncements">Дидани эълонҳо</button>':''}</div>`;
 if($('openEventAnnouncements'))$('openEventAnnouncements').onclick=()=>renderTabs('announcements');
}

function renderTabs(tab='home'){
 if(!current)return;activeTab=tab;
 const studentTabs=[['home','Асосӣ'],['my','Саҳифаи ман'],['lessons','Дарсҳо'],['scan','Скан кардани QR'],['attendance','Иштироки ман'],['announcements','Эълонҳо'],['account','Логин ва парол']];
 const staffTabs=[['home','Асосӣ'],['students',`Шунавандагони курс${data.warnings.length?' ('+data.warnings.length+')':''}`],['lessons','30 дарс'],['qr','QR-коди дарс'],['attendance','Иштирок'],['announcements','Эълонҳо'],['reports','Ҳисобот'],['points','Холҳо'],['account','Логин ва парол']];
 if(role()==='super_admin')staffTabs.splice(staffTabs.findIndex(t=>t[0]==='account'),0,['settings','Танзимот']);
 const tabs=role()==='student'?studentTabs:staffTabs;
 if(!tabs.some(t=>t[0]===tab)){tab='home';activeTab='home'}
 $('nav').innerHTML=tabs.map(([k,n])=>`<button class="tab ${k===tab?'active':''}" data-tab="${k}">${esc(n)}</button>`).join('');
 $('nav').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{closeMobileMenu();renderTabs(b.dataset.tab)}));
 const pages={home,my:myPage,students,lessons,qr:qrPanel,scan:scanPanel,attendance,announcements,reports,points:pointsPage,settings,account:accountSettings};
 renderUrgentBanner();
 pages[tab]?.();if(tab==='my')loadPersonalRank();
}
function panel(html){$('panel').innerHTML=html}
function home(){
 const present=data.attendance.length;
 const approved=data.students.filter(s=>s.role==='student'&&s.status==='approved').length;
 panel(`<div class="grid-cards"><div class="mini-card"><small>${isStaff()?'Донишҷӯёни тасдиқшуда':'Иштироки ман'}</small><b>${isStaff()?approved:present}</b></div><div class="mini-card"><small>Дарсҳои умумӣ</small><b>30</b></div><div class="mini-card"><small>${isStaff()?'Сабтҳои иштирок':'Дарсҳои анҷомёфта'}</small><b>${isStaff()?present:data.lessons.filter(l=>l.status==='completed').length}</b></div></div><div class="panel-card"><h3>Маълумоти курс</h3><p class="muted">Курси «Пайравони Пешвои миллат» аз 30 дарс иборат аст. Иштирок танҳо баъди скан кардани QR-коди эътибордор дар база сабт мешавад.</p></div>${role()==='student'?`<div class="panel-card"><h3>Маълумоти шахсӣ</h3><p>${esc(universityName(current.university_id))} · Курси ${esc(current.course)}</p></div>`:`<div class="panel-card"><h3>Огоҳиҳои иштироки пайдарпай</h3><p>${data.warnings.length?`<strong>${data.warnings.length}</strong> донишҷӯ ду дарси пайдарпай ғоиб аст. Аз бахши «Донишҷӯён» дида бароед.`:'Огоҳии нав нест.'}</p></div>`}`);
}
function attachStudentButtons(){
 $('panel').querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>changeStudent(b.dataset.id,b.dataset.act)));
}
function students(){
 if(!isStaff())return;
 const pending=data.students.filter(s=>s.role==='student'&&s.status==='pending');
 const approved=rankedStudents();
 const studentRows=(list,kind)=>list.length?`<div class="table-wrap"><table><thead><tr><th>Ҷой</th><th>Ному насаб</th><th>Телефон</th><th>Донишгоҳ</th><th>Курс</th><th>Хол</th><th>Амалиёт</th></tr></thead><tbody>${list.map(s=>`<tr class="student-row ${rankTheme(studentRank(s.id))}"><td>${rankBadge(studentRank(s.id))}</td><td>${studentNameHtml(s.id,s.full_name)}</td><td>${esc(s.phone)}</td><td>${esc(universityName(s.university_id))}</td><td>${esc(s.course)}</td><td>${studentPoints(s.id)}</td><td>${kind==='pending'?`<button class="btn primary" data-act="approve" data-id="${esc(s.id)}">Тасдиқ</button> <button class="btn danger" data-act="reject" data-id="${esc(s.id)}">Рад</button>`:`<button class="btn danger" data-act="remove" data-id="${esc(s.id)}">Нест кардан</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Маълумот нест.</div>';
 panel(`<div class="panel-card"><h3>Огоҳӣ: ду дарси пайдарпай ғоиб</h3>${data.warnings.length?data.warnings.map(w=>`<div class="mini-card"><b style="font-size:17px">${esc(w.full_name)}</b><p>Дарсҳои ${w.lesson_a} ва ${w.lesson_b}: иштирок сабт нашудааст.</p><button class="btn danger" data-act="exclude" data-id="${esc(w.student_id)}">Бо тасдиқ хориҷ кардан</button></div>`).join(''):'<p class="muted">Огоҳӣ нест.</p>'}</div><div class="panel-card"><div class="panel-title"><h3>Дархостҳои бақайдгирӣ</h3><span class="status">${pending.length} интизор</span></div>${studentRows(pending,'pending')}</div><div class="panel-card"><h3>Шунавандагони курс (тасдиқшуда)</h3>${approved.length?`<div class="table-wrap"><table class="listeners-table"><thead><tr><th>Ному насаб</th><th>Донишгоҳ</th></tr></thead><tbody>${approved.map(s=>`<tr><td>${studentNameHtml(s.id,s.full_name)}</td><td>${esc(universityName(s.university_id))}</td></tr>`).join('')}</tbody></table></div>`:'<p>Маълумот нест.</p>'}</div><div class="notice">«Нест кардан» ҳисоби донишҷӯро ғайрифаъол ва аз рӯйхати фаъол хориҷ мекунад. Таърихи иштирок барои ҳисобот нигоҳ дошта мешавад.</div>`);
 attachStudentButtons();
}
async function changeStudent(id,action){
 if(!isStaff())return;
 const student=data.students.find(s=>s.id===id);
 if(!student)return;
 const messages={approve:`Дархости «${student.full_name}» тасдиқ шавад?`,reject:`Дархости «${student.full_name}» рад шавад?`,remove:`«${student.full_name}» ғайрифаъол карда шавад? Сабтҳои иштирок нигоҳ дошта мешаванд.`,exclude:`«${student.full_name}» ду дарси пайдарпай ғоиб буд. Аз курс хориҷ карда шавад?`};
 if(!confirm(messages[action]))return;
 try{const {error}=await client.rpc('manage_student',{p_student:id,p_action:action});if(error)throw error;await refresh('students');toast('Амалиёт иҷро шуд.')}catch(e){fail(e)}
}
function lessons(){
 const staff=isStaff();
 panel(`<div class="panel-card"><div class="panel-title"><h3>Рӯйхати 30 дарси курс</h3><span class="status ok">${data.lessons.length} дарс</span></div><div class="table-wrap"><table><thead><tr><th>№</th><th>Номи дарс</th><th>Сана</th><th>Вақт</th><th>Баргузоркунанда</th><th>Ҳолат</th>${staff?'<th>Амалиёт</th>':''}</tr></thead><tbody>${data.lessons.map(l=>`<tr><td>${l.id}</td><td>${esc(l.title)}</td><td>${esc(l.lesson_date||'—')}</td><td>${esc(l.starts_at?.slice(0,5)||'—')} ${l.ends_at?'– '+esc(l.ends_at.slice(0,5)):''}</td><td>${esc(l.speaker||'—')}</td><td>${({scheduled:'Банақшагирифташуда',active:'Фаъол',completed:'Анҷомёфта'})[l.status]}</td>${staff?`<td><button class="btn secondary" data-edit="${l.id}">Таҳрир</button></td>`:''}</tr>`).join('')}</tbody></table></div></div>${staff?`<div id="lessonEditor" class="panel-card"><h3>Таҳрири маълумоти дарс</h3><form id="lessonForm" class="inline-form"><label>Рақами дарс<select name="id">${data.lessons.map(l=>`<option value="${l.id}">${l.id}</option>`).join('')}</select></label><label class="wide">Номи дарс<input name="title" required maxlength="300"></label><label>Сана<input name="date" type="date"></label><label>Оғоз<input name="start" type="time"></label><label>Анҷом<input name="end" type="time"></label><label>Ҷойи баргузорӣ<input name="place"></label><label>Меҳмони дарс<input name="speaker"></label><button class="btn primary">Нигоҳ доштан</button></form></div>`:''}`);
 if(!staff)return;
 const fillLesson=id=>{const l=data.lessons.find(z=>z.id===+id),f=$('lessonForm');if(!l)return;f.elements.id.value=l.id;f.elements.title.value=l.title||'';f.elements.date.value=l.lesson_date||'';f.elements.start.value=l.starts_at?.slice(0,5)||'';f.elements.end.value=l.ends_at?.slice(0,5)||'';f.elements.place.value=l.place||'';f.elements.speaker.value=l.speaker||''};
 fillLesson(1);
 $('panel').querySelectorAll('button[data-edit]').forEach(b=>b.onclick=()=>{fillLesson(b.dataset.edit);$('lessonEditor').scrollIntoView({behavior:'smooth'})});
 $('lessonForm').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target);
  const patch={title:String(f.get('title')).trim(),lesson_date:f.get('date')||null,starts_at:f.get('start')||null,ends_at:f.get('end')||null,place:f.get('place')||null,speaker:f.get('speaker')||null};
  try{updateBusy(e.target,true);const {error}=await client.from('lessons').update(patch).eq('id',Number(f.get('id')));if(error)throw error;await refresh('lessons');toast('Дарс нигоҳ дошта шуд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
}
function qrPanel(){
 if(!isStaff())return;
 panel(`<div class="panel-card"><h3>QR-коди дарс</h3><div class="qr-layout"><div class="qr-info"><label>Интихоби дарс<select id="qrLesson">${data.lessons.map(l=>`<option value="${l.id}">${l.id} — ${esc(l.title)} ${l.status==='completed'?'(Анҷом ёфтааст)':''}</option>`).join('')}</select></label><p class="notice">QR-код дар сервер сохта шуда, 10 дақиқа эътибор дорад. Дар сурати гузаштани вақт QR-и нав созед.</p><button class="btn primary" id="makeQR">Сохтани QR-код</button><button class="btn danger" id="stopQR">Анҷом додани дарс</button><div id="qrMeta" class="muted">Ҳоло QR сохта нашудааст.</div></div><div class="qr-box"><div id="qrcode"></div><div id="qrPlaceholder" class="qr-placeholder">QR-код дар ин ҷо намоиш дода мешавад.</div></div></div></div>`);
 $('makeQR').onclick=async()=>{
  try{const id=Number($('qrLesson').value);const {data:qr,error}=await client.rpc('start_lesson_qr',{p_lesson:id});if(error)throw error;
   if(typeof QRCode==='undefined')throw Error('Китобхонаи QR бор нашуд. Интернетро санҷед.');
   $('qrcode').innerHTML='';$('qrPlaceholder').hidden=true;
   new QRCode($('qrcode'),{text:JSON.stringify({lesson:qr.lesson,token:qr.token}),width:240,height:240,correctLevel:QRCode.CorrectLevel.M});
   $('qrMeta').textContent=`Дарси ${id} · Эътибор то: ${dateTime(qr.expires_at)}`;toast('QR-и 10-дақиқаина сохта шуд.');
  }catch(e){fail(e)}
 };
 $('stopQR').onclick=async()=>{
  const id=Number($('qrLesson').value);
  if(!confirm(`Дарси ${id} анҷомёфта ҳисоб шавад? Баъд аз ин ҳузур сабт намешавад ва ғоибӣ ҳисоб мешавад.`))return;
  try{const {error}=await client.rpc('complete_lesson',{p_lesson:id});if(error)throw error;await refresh('qr');toast('Дарс анҷом ёфт.');}catch(e){fail(e)}
 };
}
function scanPanel(){
 if(role()!=='student')return;
 panel(`<div class="panel-card scan-area"><h3>Скан кардани QR-коди дарс ё чорабинӣ</h3><p class="muted">Барои камера HTTPS ё localhost лозим аст. QR танҳо 10 дақиқа кор мекунад.</p><div id="reader"></div><div id="scanResult" class="notice">QR ҳоло скан нашудааст.</div><button class="btn secondary" id="startScan">Оғози скан</button> <button class="btn ghost" id="stopScan">Қатъи камера</button></div>`);
 let scanner=null,handling=false;
 $('startScan').onclick=async()=>{
  if(scanner)return;
  if(typeof Html5Qrcode==='undefined'){toast('Китобхонаи сканер бор нашуд.');return}
  try{
   scanner=new Html5Qrcode('reader');
   await scanner.start({facingMode:'environment'},{fps:8,qrbox:220},async decoded=>{
    if(handling)return;handling=true;
    try{
     const qr=JSON.parse(decoded);
     const eventCode=qr?.type==='event-points';
     if(typeof qr?.token!=='string'||(!eventCode&&!Number.isInteger(qr.lesson)))throw Error('QR-и нодуруст.');
     if(scanner){await scanner.stop();scanner=null}
     const result=eventCode
      ? await client.rpc('claim_event_points_qr',{p_token:qr.token})
      : await client.rpc('mark_attendance',{p_lesson:qr.lesson,p_token:qr.token});
     if(result.error)throw result.error;
     const message=eventCode
      ? (result.data.already_awarded?'Холи ин чорабинӣ қаблан сабт шудааст.':`+${result.data.points} хол барои чорабинӣ!`)
      : `Иштироки шумо барои дарси ${qr.lesson} сабт шуд. +3 хол!`;
     if($('scanResult'))$('scanResult').textContent=message;
     toast(message);
     await loadData();
    }catch(e){if($('scanResult'))$('scanResult').textContent=e.message||'Скан хато шуд.';fail(e)}finally{handling=false}
   },()=>{});
  }catch(e){scanner=null;fail(e)}
 };
 $('stopScan').onclick=async()=>{if(scanner){await scanner.stop().catch(()=>{});scanner=null}};
}
function attendance(){
 const rows=data.attendance;
 panel(`<div class="panel-card"><div class="panel-title"><h3>${isStaff()?'Иштироки донишҷӯён':'Таърихи иштироки ман'}</h3><span class="status ok">${rows.length} сабт</span></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Ҷой</th><th>Донишҷӯ</th><th>Дарс</th><th>Сана ва вақт</th></tr></thead><tbody>${rows.map(a=>`<tr class="student-row ${rankTheme(studentRank(a.student_id))}"><td>${rankBadge(studentRank(a.student_id))}</td><td>${studentNameHtml(a.student_id,current?.full_name||'—')}</td><td>${a.lesson_id} — ${esc(lessonName(a.lesson_id))}</td><td>${dateTime(a.attended_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ҳоло сабти иштирок нест.</div>'}</div>`);
}
function announcementCards(list,staff){
 return list.map(a=>`<div class="mini-card announcement-card ${a.is_urgent?'announcement-important':''}"><div class="announcement-title"><strong>${a.is_urgent?'🔥 ':''}${esc(a.title)}</strong>${a.is_pinned&&a.is_active!==false?'<span class="status ok">📌 Мустаҳкам</span>':''}${a.is_active===false?'<span class="status no">Хомӯш</span>':''}</div><p>${esc(a.body)}</p>${a.bonus_points?`<p>⭐ ${Number(a.bonus_points)} хол барои иштирок</p>`:''}${a.countdown_to?`<p class="muted">⏳ ${dateTime(a.countdown_to)}</p>`:''}<small>${esc(a.audience_university_id?universityName(a.audience_university_id):'Ҳама')} · ${dateTime(a.created_at)}</small>${registrationInfo(a)}${staff&&(a.is_urgent||registrationEnabled(a))?`<div class="announcement-actions">${a.is_urgent?`<button class="btn secondary" data-ann-action="pin" data-ann-id="${Number(a.id)}">${a.is_pinned?'Кушодани закреп':'Закрепить'}</button>`:''}<button class="btn danger" data-ann-action="toggle" data-ann-id="${Number(a.id)}">${a.is_active===false?'Фаъол кардан':'Хомӯш кардан'}</button></div>`:''}</div>`).join('');
}
function announcementList(){
 const list=isStaff()?data.announcements:data.announcements.filter(a=>a.is_active!==false);
 return list.length?announcementCards(list,isStaff()):'<div class="empty">Эълон нест.</div>';
}
const rosterLoads=new WeakMap();
const rosterDateTime=new Intl.DateTimeFormat('ru-RU',{
 timeZone:'Asia/Dushanbe',dateStyle:'short',timeStyle:'medium'
});
function refreshEventRoster(target,id){
 if(rosterLoads.has(target))return rosterLoads.get(target);
 const content=target.querySelector('[data-roster-content]');
 const button=target.querySelector('[data-export-event]');
 button.disabled=true;
 if(!content.textContent)content.textContent='Рӯйхат бор мешавад…';
 const load=q('announcement_registrations',{
  select:'student_id,created_at,profiles(full_name)',
  order:'created_at',secondaryOrder:'student_id',filter:['announcement_id',id]
 }).then(registrations=>{
  const rows=registrations.map((row,index)=>[
   index+1,row.profiles?.full_name||'Донишҷӯ',rosterDateTime.format(new Date(row.created_at))
  ]);
  content.innerHTML=`<p><strong>Сабтшудагон: ${rows.length} нафар</strong></p>`+(rows.length
   ? `<ol>${rows.map(([,name,time])=>`<li>${esc(name)} · ${esc(time)}</li>`).join('')}</ol>`
   : '<p>Ҳоло касе сабт нашудааст.</p>');
  return rows;
 }).catch(error=>{
  content.textContent='Рӯйхат бор нашуд. Аз нав кӯшиш кунед.';
  throw error;
 }).finally(()=>{
  rosterLoads.delete(target);
  button.disabled=false;
 });
 rosterLoads.set(target,load);
 return load;
}
function announcements(){
 const staff=isStaff();
 panel(`${staff?`<div class="panel-card"><h3>📢 Нашри эълон / хабари фаврӣ</h3><form id="announceForm" class="form-grid"><label class="full">Сарлавҳа<input name="title" minlength="2" maxlength="200" required placeholder="Масалан: РӮЗҲОИ НАЗДИК — ШАНБЕГӢ"></label><label class="full">Матни эълон<textarea name="body" rows="3" minlength="2" maxlength="5000" required></textarea></label><label>Сабти иштирок<select name="registration_mode"><option value="none">Танҳо эълон</option><option value="limited">Шумораи муайян</option><option value="all">Ҳамаи донишҷӯён</option></select></label><label id="participantLimitLabel" hidden>Шумораи ҷойҳо<input name="participant_limit" type="number" min="1" max="2147483647" step="1" placeholder="100" disabled></label><label>Аудитория<select name="audience"><option value="">Ҳама</option>${data.universities.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label><label>Сана ва вақти чорабинӣ<input type="datetime-local" name="countdown_to"></label><label>Хол барои чорабинӣ (ихтиёрӣ)<input type="number" name="bonus_points" min="0" max="100" value="0"></label><label class="check-label"><input type="checkbox" name="is_urgent" id="urgentCheck"> 🔥 Хабари фаврӣ</label><label class="check-label"><input type="checkbox" name="is_pinned" id="pinCheck"> 📌 Дар болои ҳама панелҳо нишон додан</label><button class="btn primary full">Нашр кардан</button></form><p class="hint">Барои ҳисобкунаки вақт, сана ва соатро муайян кунед. Сабти иштирок ба ҳамаи донишҷӯёни тасдиқшуда дастрас аст. Барои додани хол аз бахши «Холҳо» QR созед.</p></div>`:''}<div class="panel-card"><h3>Эълонҳо</h3><div id="announcementList">${announcementList()}</div></div>`);
 $('announcementList').onclick=async e=>{
  const join=e.target.closest('[data-join-event]');
  const roster=e.target.closest('[data-event-roster]');
  if(join){
   const list=$('announcementList');
   list.dataset.joining='true';
   join.disabled=true;
   try{
    const {data:result,error}=await client.rpc('join_payravon_event',{p_announcement:Number(join.dataset.joinEvent)});
    if(error)throw error;
    const [rows,registrations]=await Promise.all([q('announcements',{order:'id',ascending:false}),q('announcement_registrations',{order:'announcement_id'})]);
    data.announcements=rows;
    data.registrations=registrations;
    if(list.isConnected)list.innerHTML=announcementList();
    toast(({joined:'Иштироки шумо сабт шуд.',already:'Шумо аллакай сабт шудаед.',full:'Ҷойҳо пур шуданд.',closed:'Сабти ном баста аст.'})[result]);
   }catch(error){fail(error)}finally{delete list.dataset.joining;join.disabled=false}
  }
  if(roster&&staff){
   const target=roster.nextElementSibling;
   target.hidden=!target.hidden;
   roster.setAttribute('aria-expanded',String(!target.hidden));
   if(!target.hidden){
    try{await refreshEventRoster(target,roster.dataset.eventRoster)}catch(error){fail(error)}
   }
  }
  const download=e.target.closest('[data-export-event]');
  if(download&&staff){
   const id=download.dataset.exportEvent;
   try{
    const rows=await refreshEventRoster(download.closest('.event-roster'),id);
    if(!current||!isStaff()||!download.isConnected||$('dashboard').classList.contains('hidden'))return;
    if(!rows.length){toast('Ҳоло касе сабт нашудааст.');return}
    const title=data.announcements.find(a=>String(a.id)===id)?.title||'чорабинӣ';
    const safeTitle=title.replace(/[^\p{L}\p{M}\p{N}]+/gu,'-').slice(0,70);
    downloadCsv(`ishtirok-${id}-${safeTitle}.csv`,[
     ['№','Ному насаб','Сана ва вақти сабт (Душанбе)'],...rows
    ]);
   }catch(error){fail(error)}
  }
 };
 if(staff){
  const fields=$('announceForm').elements;
  fields.registration_mode.onchange=()=>{
   const limited=fields.registration_mode.value==='limited';
   $('participantLimitLabel').hidden=!limited;
   fields.participant_limit.disabled=!limited;
   fields.participant_limit.required=limited;
   fields.audience.disabled=fields.registration_mode.value!=='none';
   if(fields.audience.disabled)fields.audience.value='';
  };
  $('pinCheck').onchange=e=>{if(e.target.checked)$('urgentCheck').checked=true};
  $('announceForm').onsubmit=async e=>{
   e.preventDefault();const f=new FormData(e.target),when=String(f.get('countdown_to')||'');
   const urgent=f.has('is_urgent')||f.has('is_pinned');
   if(urgent&&(!when||!Number.isFinite(new Date(when).getTime())||new Date(when).getTime()<=Date.now())){toast('Барои хабари фаврӣ сана ва вақти ояндаро интихоб кунед.');return}
   const points=Number(f.get('bonus_points')||0);
   if(!Number.isInteger(points)||points<0||points>100){toast('Хол аз 0 то 100 бошад.');return}
   const mode=f.get('registration_mode');
   const limit=mode==='limited'?Number(f.get('participant_limit')):null;
   if(mode==='limited'&&(!Number.isInteger(limit)||limit<1||limit>2147483647)){toast('Шумораи дурусти ҷойҳоро ворид кунед.');return}
   if(mode!=='none'&&when&&new Date(when).getTime()<=Date.now()){toast('Санаи чорабинӣ бояд дар оянда бошад.');return}
   const payload={registration_mode:mode,participant_limit:limit,title:String(f.get('title')).trim(),body:String(f.get('body')).trim(),audience_university_id:f.get('audience')?Number(f.get('audience')):null,created_by:current.id,is_urgent:urgent,is_pinned:f.has('is_pinned'),countdown_to:when?new Date(when).toISOString():null,bonus_points:points,is_active:true};
   try{updateBusy(e.target,true);const {error}=await client.from('announcements').insert(payload);if(error)throw error;await refresh('announcements');toast('Эълон нашр шуд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
  };
  $('panel').querySelectorAll('[data-ann-action]').forEach(btn=>btn.onclick=async()=>{
   const id=Number(btn.dataset.annId),item=data.announcements.find(a=>Number(a.id)===id);if(!item)return;
   const patch=btn.dataset.annAction==='pin'?{is_pinned:!item.is_pinned,is_urgent:true}:{is_active:item.is_active===false};
   if(patch.is_pinned&&item.countdown_to&&secondsLeft(item.countdown_to)===0){toast('Муҳлати ин эълон гузашт. Эълони нав созед.');return}
   try{btn.disabled=true;const {error}=await client.from('announcements').update(patch).eq('id',id);if(error)throw error;await refresh('announcements');toast('Эълон нав шуд.')}catch(ex){fail(ex);btn.disabled=false}
  });
 }
}
function getReport(){
 const completed=data.lessons.filter(l=>l.status==='completed'&&l.completed_at);
 return data.students.filter(s=>s.role==='student'&&s.status==='approved').map(s=>{
  const eligible=completed.filter(l=>s.approved_at&&new Date(l.completed_at)>=new Date(s.approved_at));
  const attended=eligible.filter(l=>data.attendance.some(a=>a.student_id===s.id&&a.lesson_id===l.id)).length;
  const scans=data.attendance.filter(a=>a.student_id===s.id).length;
  const absent=eligible.length-attended;
  return {id:s.id,name:s.full_name,university:universityName(s.university_id),course:s.course,present:scans,absent,total:eligible.length,percent:eligible.length?(attended/eligible.length*100).toFixed(1):'—',points:studentPoints(s.id)};
 });
}
function downloadCsv(filename,cells){
 const csv='\uFEFF'+cells.map(row=>row.map(value=>{
  let cell=String(value??'');
  if(/^\s*[=+@-]|^[\t\r\n]/.test(cell))cell="'"+cell;
  return '"'+cell.replaceAll('"','""')+'"';
 }).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;
 link.download=filename;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function reports(){
 if(!isStaff())return;
 const rows=getReport().sort((a,b)=>studentPoints(b.id)-studentPoints(a.id)||String(a.name).localeCompare(String(b.name),'tg'));
 panel(`<div class="panel-card"><div class="panel-title"><h3>Ҳисоботи курс</h3><button class="btn primary" id="csv">Содироти CSV</button></div><p class="muted">Ҳозир — ҳар QR-и бомуваффақият сабтшуда (ҳатто дарси фаъол). Ғоибӣ ва фоиз танҳо аз дарсҳои анҷомёфтаи баъди тасдиқ ҳисоб мешаванд. Ҳангоми кушода будани ҳисобот, маълумот ҳар 10 сония нав мешавад.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Ҷой</th><th>Донишҷӯ</th><th>Донишгоҳ</th><th>Курс</th><th>Дарсҳои ҳисобшаванда</th><th>Ҳозир (QR)</th><th>Ғоиб</th><th>Иштирок</th><th>Хол</th></tr></thead><tbody>${rows.map(r=>`<tr class="student-row report-select ${rankTheme(studentRank(r.id))}" data-profile="${esc(r.id)}" tabindex="0" role="button"><td>${rankBadge(studentRank(r.id))}</td><td>${studentNameHtml(r.id,r.name)}</td><td>${esc(r.university)}</td><td>${esc(r.course)}</td><td>${r.total}</td><td>${r.present}</td><td>${r.absent}</td><td>${r.percent==='—'?'—':r.percent+'%'}</td><td>${r.points}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Маълумоти кофӣ нест.</div>'}</div>`);
 $('panel').querySelectorAll('[data-profile]').forEach(el=>{const open=()=>showListenerProfile(el.dataset.profile);el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}})});
 $('csv').onclick=()=>{
  const cells=[['Ҷой','Ному насаб','Донишгоҳ','Курс','Дарсҳои ҳисобшаванда','Ҳозир','Ғоиб','Фоизи иштирок','Хол'],...rows.map(r=>[studentRank(r.id),r.name,r.university,r.course,r.total,r.present,r.absent,r.percent,r.points])];
  downloadCsv('hisoboti-payravon.csv',cells);
 };
}
function showListenerProfile(id){
 if(!isStaff())return;
 const s=data.students.find(x=>x.id===id&&x.role==='student');if(!s)return;
 const row=getReport().find(x=>x.id===id);
 const history=data.points.filter(x=>x.student_id===id);
 const box=document.createElement('div');box.className='profile-overlay';
 box.innerHTML=`<div class="profile-sheet" role="dialog" aria-modal="true" aria-label="Маълумоти шунаванда"><button class="btn ghost profile-close" type="button">✕ Пӯшидан</button><h2>Маълумоти шунаванда</h2><div class="profile-facts"><div><h2>${esc(s.full_name)}</h2><span class="status">${esc(s.status)}</span></div><div><p><b>Донишгоҳ:</b> ${esc(universityName(s.university_id))}</p><p><b>Курс:</b> ${esc(s.course)}</p><p><b>Телефон:</b> ${esc(s.phone)}</p><p><b>Санаи тасдиқ:</b> ${dateTime(s.approved_at)}</p></div></div><div class="profile-metrics"><div><small>Холҳо</small><b>${row?.points??0}</b></div><div><small>Иштирок (QR)</small><b>${row?.present??0}</b></div><div><small>Ғоиб</small><b>${row?.absent??0}</b></div></div><h3>Таърихи холҳо</h3><div class="table-wrap"><table><thead><tr><th>Хол</th><th>Сабаб</th><th>Сана</th></tr></thead><tbody>${history.map(h=>`<tr><td>+${Number(h.points)}</td><td>${esc(h.reason)}</td><td>${dateTime(h.created_at)}</td></tr>`).join('')||'<tr><td colspan="3">Ҳоло хол нест</td></tr>'}</tbody></table></div><p class="hint">Паролҳо дар Supabase Auth махфӣ нигоҳ дошта мешаванд ва ба админ нишон дода намешаванд. Барои иваз кардани парол аз барқарорсозии бехатар истифода баред.</p></div>`;
 document.body.appendChild(box);const close=()=>box.remove();box.querySelector('.profile-close').onclick=close;box.addEventListener('click',e=>{if(e.target===box)close()});box.querySelector('.profile-close').focus();
}
function settings(){
 if(role()!=='super_admin')return;
 const possible=data.students.filter(s=>s.role==='student'&&s.status==='approved');
 const admins=data.students.filter(s=>s.role==='admin');
 const adminRows=admins.length?`<div class="table-wrap"><table><thead><tr><th>Ному насаб</th><th>Телефон</th><th>Донишгоҳ</th><th>Амалиёт</th></tr></thead><tbody>${admins.map(a=>`<tr><td>${esc(a.full_name)}</td><td>${esc(a.phone)}</td><td>${esc(universityName(a.university_id))}</td><td><button class="btn danger" data-demote="${esc(a.id)}">Аз Admin баровардан</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Ҳоло Admin нест.</p>';
 panel(`<div class="panel-card"><h3>Донишгоҳҳо</h3><form id="universityForm" class="form-grid"><label>Иловаи донишгоҳ<input name="name" required maxlength="200"></label><button class="btn primary">Илова кардан</button></form><p class="muted">${data.universities.map(u=>esc(u.name)).join(' · ')}</p></div><div class="panel-card"><h3>Admin-ҳои фаъол (${admins.length})</h3>${adminRows}<p class="hint">Баровардан танҳо ҳуқуқи Admin-ро бекор мекунад, ҳисоб ва таърихи иштироки ӯро нест намекунад.</p></div><div class="panel-card"><h3>Таъин кардани Admin</h3>${possible.length?`<form id="staffForm" class="form-grid"><label>Интихоби ҳисоб<select name="user">${possible.map(u=>`<option value="${esc(u.id)}">${esc(u.full_name)} — ${esc(u.phone)}</option>`).join('')}</select></label><button class="btn primary">Admin таъин кардан</button></form>`:'<p>Ҳисоби мувофиқ нест.</p>'}</div>`);
 $('universityForm').onsubmit=async e=>{
  e.preventDefault();const name=String(new FormData(e.target).get('name')||'').trim();
  try{updateBusy(e.target,true);const {error}=await client.from('universities').insert({name});if(error)throw error;await getUniversities();renderTabs('settings');toast('Донишгоҳ илова шуд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
 if(possible.length)$('staffForm').onsubmit=async e=>{
  e.preventDefault();const user=new FormData(e.target).get('user');
  if(!confirm('Ба ин ҳисоб ҳуқуқи Admin дода шавад?'))return;
  try{updateBusy(e.target,true);const {error}=await client.rpc('set_staff_role',{p_user:user,p_role:'admin'});if(error)throw error;await refresh('settings');toast('Ҳуқуқи Admin дода шуд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
 $('panel').querySelectorAll('[data-demote]').forEach(b=>b.onclick=async()=>{
  const person=admins.find(a=>a.id===b.dataset.demote);
  if(!person||!confirm(`Ҳуқуқи Admin-и «${person.full_name}» бекор шавад?`))return;
  try{b.disabled=true;const {error}=await client.rpc('set_staff_role',{p_user:person.id,p_role:'student'});if(error)throw error;await refresh('settings');toast('Ҳуқуқи Admin бекор шуд.')}catch(e){fail(e);b.disabled=false}
 });
}
function eventPointsPanel(){
 const options=data.announcements.map(a=>`<option value="${esc(a.id)}">${esc(a.title)} · ${esc(dateTime(a.created_at))}</option>`).join('');
 return `<div class="panel-card"><h3>QR-код барои холҳои чорабинӣ</h3>
  <form id="eventPointsForm" class="form-grid">
   <label>Эълон<select name="announcement"><option value="">Чорабинии бе эълон</option>${options}</select></label>
   <label>Хол (1–100)<input type="number" name="points" min="1" max="100" value="7" required></label>
   <label class="full" id="eventReasonLabel">Номи чорабинӣ<input name="reason" minlength="2" maxlength="300" required></label>
   <button class="btn primary full">Сохтани QR-код</button>
  </form>
  <p class="hint">QR-код 10 дақиқа эътибор дорад. Донишҷӯ онро аз бахши «Скан кардани QR» мехонад. Барои чорабинии бе эълон ба ҳама донишҷӯёни тасдиқшудае, ки QR-ро скан мекунанд, хол дода мешавад.</p>
  <div id="eventPointsOutput" hidden><p id="eventPointsMeta" role="status"></p><div id="eventPointsCode"></div></div>
 </div>`;
}
function bindEventPointsForm(){
 const form=$('eventPointsForm');
 form.elements.announcement.onchange=()=>{
  const event=data.announcements.find(a=>String(a.id)===form.elements.announcement.value);
  form.elements.reason.disabled=Boolean(event);
  form.elements.reason.required=!event;
  $('eventReasonLabel').hidden=Boolean(event);
  if(event)form.elements.points.value=event.bonus_points||7;
 };
 form.onsubmit=async e=>{
  e.preventDefault();
  if(typeof QRCode==='undefined'){toast('Китобхонаи QR бор нашуд. Интернетро санҷед.');return}
  const fields=new FormData(form);
  try{
   updateBusy(form,true);
   const {data:qr,error}=await client.rpc('make_event_points_qr',{
    p_announcement:fields.get('announcement')?Number(fields.get('announcement')):null,
    p_points:Number(fields.get('points')),
    p_reason:fields.get('reason')?.trim()||null
   });
   if(error)throw error;
   if(!form.isConnected)return;
   $('eventPointsCode').replaceChildren();
   new QRCode($('eventPointsCode'),{
    text:JSON.stringify({type:'event-points',token:qr.token}),
    width:240,height:240,correctLevel:QRCode.CorrectLevel.M
   });
   $('eventPointsMeta').textContent=`+${qr.points} хол · Эътибор то ${dateTime(qr.expires_at)}`;
   $('eventPointsOutput').hidden=false;
  }catch(error){fail(error)}finally{updateBusy(form,false)}
 };
}
function renderPointsSummary(){
 const students=rankedStudents();
 const summary=$('pointsSummary');
 summary.innerHTML=`<div class="panel-card"><div class="panel-title"><h3>Ҷамъи холҳои донишҷӯён</h3><button class="btn secondary" type="button" id="refreshPoints">Нав кардани холҳо</button></div><div class="table-wrap"><table><thead><tr><th>Ҷой</th><th>Донишҷӯ</th><th>Хол</th></tr></thead><tbody>${students.map(s=>`<tr class="student-row ${rankTheme(studentRank(s.id))}"><td>${rankBadge(studentRank(s.id))}</td><td>${studentNameHtml(s.id,s.full_name)}</td><td>${studentPoints(s.id)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel-card"><h3>Таърихи холҳо</h3><div class="table-wrap"><table><thead><tr><th>Донишҷӯ</th><th>Хол</th><th>Сабаб</th><th>Сана</th></tr></thead><tbody>${data.points.map(p=>`<tr><td>${studentNameHtml(p.student_id)}</td><td>+${Number(p.points)}</td><td>${esc(p.reason)}</td><td>${dateTime(p.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
 $('refreshPoints').onclick=async e=>{
  const button=e.currentTarget;
  button.disabled=true;
  try{
   await loadData();
   if(summary.isConnected)renderPointsSummary();
  }catch(error){fail(error)}finally{button.disabled=false}
 };
}
function pointsPage(){
 if(!isStaff())return;
 const students=rankedStudents();
 panel(`${eventPointsPanel()}<div class="panel-card"><h3>Додани хол барои чорабинӣ ё ҷамъомад</h3><p class="muted">Ҳар QR-и нав барои як дарс худкор 3 хол медиҳад. Барои кори иловагӣ метавонед хол илова кунед; сабаб ва номи диҳанда сабт мешаванд.</p>${students.length?`<form id="pointsForm" class="form-grid"><label>Донишҷӯ<select name="student" required>${students.map(s=>`<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('')}</select></label><label>Хол (1–100)<input type="number" name="points" min="1" max="100" value="3" required></label><label class="full">Сабаби додани хол<input name="reason" minlength="5" maxlength="300" required placeholder="Масалан: иштирок дар чорабинӣ"></label><button class="btn primary full">Хол илова кардан</button></form>`:'<p>Донишҷӯи тасдиқшуда нест.</p>'}</div><div id="pointsSummary"></div>`);
 bindEventPointsForm();
 renderPointsSummary();
 if(students.length)$('pointsForm').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target),v=Number(f.get('points'));
  if(!Number.isInteger(v)||v<1||v>100){toast('Хол аз 1 то 100 бошад.');return}
  try{updateBusy(e.target,true);const {error}=await client.rpc('award_manual_points',{p_student:f.get('student'),p_points:v,p_reason:String(f.get('reason')).trim()});if(error)throw error;await refresh('points');toast('Холҳо сабт шуданд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
}
function myPage(){
 if(role()!=='student')return;
 const attended=new Set(data.attendance.filter(a=>a.student_id===current.id).map(a=>a.lesson_id));
 const eligible=data.lessons.filter(l=>l.status==='completed'&&l.completed_at&&current.approved_at&&new Date(l.completed_at)>=new Date(current.approved_at));
 const present=eligible.filter(l=>attended.has(l.id)).length,absent=eligible.length-present;
 const allPresent=attended.size;
 const pct=eligible.length?Math.round(present*100/eligible.length):0;
 panel(`<div class="grid-cards student-summary-grid"><div class="mini-card"><small>Холҳои ман</small><b>${studentPoints(current.id)}</b></div><div class="mini-card"><small>Ғоиб</small><b>${absent}</b></div><div class="mini-card"><small>Рейтинг</small><b id="personalRank">—</b></div><div class="mini-card"><small>Дарси иштирок карда</small><b>${allPresent}</b></div></div><div class="panel-card"><h3>Маълумоти шахсии ман</h3><p><b>Ному насаб:</b> ${esc(current.full_name)}</p><p><b>Телефон:</b> ${esc(current.phone)}</p><p><b>Донишгоҳ:</b> ${esc(universityName(current.university_id))}</p><p><b>Курс:</b> ${esc(current.course)}</p><p><b>Ҳолат:</b> ${current.status==='approved'?'Тасдиқшуда':esc(current.status)}</p></div><div class="panel-card"><h3>Графики иштирок</h3><p class="muted">Фоизи иштирок дар дарсҳои анҷомёфтаи баъди тасдиқи ҳисоб: ${eligible.length?pct+'%':'Ҳоло дарси ҳисобшаванда нест'}</p><div class="bar-chart"><div class="bar-row"><span>Ҳозир (${allPresent})</span><div class="bar-track"><div class="bar-fill present" style="width:${pct}%"></div></div></div><div class="bar-row"><span>Ғоиб (${absent})</span><div class="bar-track"><div class="bar-fill absent" style="width:${eligible.length?100-pct:0}%"></div></div></div></div><h3>Натиҷа аз рӯйи дарс</h3><div class="lesson-chart">${data.lessons.map(l=>{const eligibleLesson=eligible.some(x=>x.id===l.id);const state=attended.has(l.id)?'present':eligibleLesson?'absent':'pending';return `<div class="lesson-dot ${state}" title="${esc(l.title)}: ${state==='present'?'Иштирок':state==='absent'?'Ғоиб':'Ҳоло ҳисоб намешавад'}">${l.id}</div>`}).join('')}</div><p class="hint">Сабз — QR сабт шудааст; сурх — дарси анҷомёфта бе сабти иштирок; хокистарӣ — ҳоло ҳисоб намешавад. Агар скан хатогӣ дода бошад, ба админ муроҷиат кунед.</p></div><div class="panel-card"><h3>Таърихи холҳои ман</h3>${data.points.length?`<div class="table-wrap"><table><thead><tr><th>Хол</th><th>Сабаб</th><th>Сана</th></tr></thead><tbody>${data.points.map(p=>`<tr><td>+${Number(p.points)}</td><td>${esc(p.reason)}</td><td>${dateTime(p.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Ҳоло хол нест.</p>'}</div>`);
}
async function loadPersonalRank(){
 if(role()!=='student')return;
 const el=document.getElementById('personalRank');if(!el)return;
 try{const {data:rank,error}=await client.rpc('my_course_rank');if(error)throw error;const value=Array.isArray(rank)?rank[0]?.rank:rank?.rank??rank;if(Number.isInteger(Number(value))&&Number(value)>0)el.textContent='№'+Number(value);else el.textContent='—';}catch(e){console.info('Рейтинг RPC ҳоло насб нашудааст',e?.message);el.title='Барои рейтинг функсияи бехатари my_course_rank лозим аст';}
}
function accountSettings(){
 panel(`<div class="panel-card"><h3>Иваз кардани логин (email)</h3><p class="muted">Email-и ҳозира: <span id="currentEmail">...</span></p><form id="emailForm" class="form-grid one"><label>Email-и нав<input type="email" name="email" required></label><button class="btn primary">Иваз кардани email</button></form><p class="hint">Supabase метавонад тасдиқи почтаи кӯҳна ва навро талаб кунад.</p></div><div class="panel-card"><h3>Иваз кардани парол</h3><form id="passwordForm" class="form-grid one"><label>Пароли ҳозира<input name="current_password" type="password" autocomplete="current-password" required></label><label>Пароли нав (камаш 8 аломат)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Такрори пароли нав<input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn primary">Иваз кардани парол</button></form></div>`);
 client.auth.getUser().then(({data})=>{$('currentEmail').textContent=data?.user?.email||'—';$('emailForm').elements.email.value=data?.user?.email||''}).catch(fail);
 $('emailForm').onsubmit=async e=>{
  e.preventDefault();const email=String(new FormData(e.target).get('email')||'').trim();
  try{updateBusy(e.target,true);const {error}=await client.auth.updateUser({email});if(error)throw error;toast('Дархости ивазкунии email фиристода шуд. Почтаро санҷед.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
 $('passwordForm').onsubmit=async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
  if(f.password!==f.confirm){toast('Паролҳои нав мувофиқат намекунанд.');return}
  try{updateBusy(e.target,true);const {error}=await client.auth.updateUser({password:f.password,current_password:f.current_password});if(error)throw error;toast('Парол нав карда шуд.');e.target.reset()}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
}
function closeMobileMenu(){document.body.classList.remove('mobile-nav-open');$('menuToggle')?.setAttribute('aria-expanded','false');$('menuToggle')?.setAttribute('aria-label','Кушодани меню')}
$('menuToggle').onclick=()=>{const isOpen=document.body.classList.toggle('mobile-nav-open');$('menuToggle').setAttribute('aria-expanded',String(isOpen));$('menuToggle').setAttribute('aria-label',isOpen?'Пӯшидани меню':'Кушодани меню')};
$('navBackdrop').onclick=closeMobileMenu;
async function logout(){closeMobileMenu();try{if(client)await client.auth.signOut()}catch(e){console.error(e)}current=null;$('logoutBtn').hidden=true;$('roleLabel').textContent='Кушодани система';activeTab='home';view('welcome')}
$('logoutBtn').onclick=logout;$('holdLogout').onclick=logout;
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
$('registerForm').onsubmit=async e=>{
 e.preventDefault();if(!client){view('setup');return}
 const f=Object.fromEntries(new FormData(e.target));
 try{
  updateBusy(e.target,true);
  const {data:registration,error}=await client.auth.signUp({email:f.email.trim(),password:f.password,options:{data:{full_name:f.name.trim(),phone:f.phone.trim(),university_id:Number(f.university),course:Number(f.course)},emailRedirectTo:location.origin+location.pathname}});
  if(error)throw error;
  e.target.reset();
  if(registration.session){
   await loadCurrent();
   return;
  }
  view('login');
  toast('Почтаатонро санҷед ва пас аз тасдиқи email ворид шавед.');
 }catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
};
$('loginForm').onsubmit=async e=>{
 e.preventDefault();if(!client){view('setup');return}
 const f=Object.fromEntries(new FormData(e.target));
 try{updateBusy(e.target,true);const {error}=await client.auth.signInWithPassword({email:f.identity.trim(),password:f.password});if(error)throw error;await loadCurrent()}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
};
async function init(){
 if(!client){view('setup');return}
 try{await getUniversities();await loadCurrent()}catch(e){fail(e);view('welcome')}
}
init();
// Refresh visible staff reports while other students scan on different devices.
setInterval(async()=>{
 if(!client||!current||!isStaff()||activeTab!=='reports'||document.hidden||$('dashboard').classList.contains('hidden'))return;
 try{await loadData();if(activeTab==='reports')reports()}catch(error){console.warn('Report refresh failed',error)}
},10000);

// A lightweight countdown redraws text, without disrupting a user editing a form.
setInterval(()=>{
 const clock=$('urgentBanner')?.querySelector('[data-end]');
 if(clock){const remaining=secondsLeft(clock.dataset.end);clock.textContent='⏳ '+renderCountdown(remaining);if(!remaining)renderUrgentBanner()}
},1000);
// Receive new pinned announcements from other logged-in accounts.
setInterval(async()=>{
 if(!client||!current||document.hidden||$('dashboard').classList.contains('hidden'))return;
 try{
  const profile=current.id;
  const rows=await q('announcements',{order:'id',ascending:false});
  if(current?.id!==profile)return;
  const list=$('announcementList');
  if(list?.dataset.joining)return;
  const changed=JSON.stringify(rows)!==JSON.stringify(data.announcements);
  data.announcements=rows;
  renderUrgentBanner();
  if(!list)return;
  if(!isStaff()){
   if(changed||rows.some(a=>a.countdown_to&&registrationEnabled(a)))list.innerHTML=announcementList();
   return;
  }
  const events=new Map(rows.map(event=>[String(event.id),event]));
  list.querySelectorAll('[data-event-count]').forEach(count=>{
   const event=events.get(count.dataset.eventCount);
   if(!event)return;
   count.textContent=registrationCount(event);
   count.nextElementSibling.innerHTML=registrationStatus(event);
  });
  const rosters=list.querySelectorAll('.event-roster:not([hidden])');
  await Promise.allSettled(Array.from(rosters,target=>refreshEventRoster(
   target,target.querySelector('[data-export-event]').dataset.exportEvent
  )));
 }catch(error){console.warn('Announcement polling failed',error)}
},30000);

// Staff-only desktop sidebar toggle. No changes to authentication or Supabase requests.
const desktopMenuToggle = document.getElementById('desktopMenuToggle');
if (desktopMenuToggle) {
 desktopMenuToggle.addEventListener('click', () => {
   const collapsed = document.body.classList.toggle('sidebar-collapsed');
   desktopMenuToggle.setAttribute('aria-expanded', String(!collapsed));
   desktopMenuToggle.setAttribute('aria-label', collapsed ? 'Кушодани меню' : 'Пӯшидани меню');
   desktopMenuToggle.title = collapsed ? 'Кушодани меню' : 'Пӯшидани меню';
 });
}
