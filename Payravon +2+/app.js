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
let data={universities:[],students:[],lessons:[],attendance:[],announcements:[],warnings:[],points:[]};
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
    if(options.order)request=request.order(options.order,{ascending:options.ascending!==false});
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
  const [lessons,attendance,announcements,students,points]=await Promise.all(jobs);
  data.lessons=lessons;data.attendance=attendance;data.announcements=announcements;
  data.students=students;data.points=points;
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
 view('dashboard');$('dashRole').textContent=role()==='student'?'КАБИНЕТИ ДОНИШҶӮ':role()==='admin'?'КАБИНЕТИ ADMIN':'ИДОРАКУНИИ УМУМӢ';
 $('dashTitle').textContent=role()==='student'?'Салом, '+current.full_name:'Панели идоракунӣ';
 $('dashSubtitle').textContent=role()==='student'?'Маълумоти курс ва иштироки шумо':'Идоракунии донишҷӯён ва 30 дарс';
 $('statCount').textContent=String(data.lessons.length);renderTabs(activeTab);
}
function studentPoints(id){return data.points.filter(p=>p.student_id===id).reduce((sum,p)=>sum+Number(p.points||0),0)}
function renderTabs(tab='home'){
 if(!current)return;activeTab=tab;
 const studentTabs=[['home','Асосӣ'],['my','Саҳифаи ман'],['lessons','Дарсҳо'],['scan','Скан кардани QR'],['attendance','Иштироки ман'],['announcements','Эълонҳо'],['account','Логин ва парол']];
 const staffTabs=[['home','Асосӣ'],['students',`Донишҷӯён${data.warnings.length?' ('+data.warnings.length+')':''}`],['lessons','30 дарс'],['qr','QR-коди дарс'],['attendance','Иштирок'],['announcements','Эълонҳо'],['reports','Ҳисобот'],['points','Холҳо'],['account','Логин ва парол']];
 if(role()==='super_admin')staffTabs.splice(staffTabs.findIndex(t=>t[0]==='account'),0,['settings','Танзимот']);
 const tabs=role()==='student'?studentTabs:staffTabs;
 if(!tabs.some(t=>t[0]===tab)){tab='home';activeTab='home'}
 $('nav').innerHTML=tabs.map(([k,n])=>`<button class="tab ${k===tab?'active':''}" data-tab="${k}">${esc(n)}</button>`).join('');
 $('nav').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>renderTabs(b.dataset.tab)));
 const pages={home,my:myPage,students,lessons,qr:qrPanel,scan:scanPanel,attendance,announcements,reports,points:pointsPage,settings,account:accountSettings};
 pages[tab]?.();
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
 const approved=data.students.filter(s=>s.role==='student'&&s.status==='approved');
 const studentRows=(list,kind)=>list.length?`<div class="table-wrap"><table><thead><tr><th>Ному насаб</th><th>Телефон</th><th>Донишгоҳ</th><th>Курс</th><th>Хол</th><th>Амалиёт</th></tr></thead><tbody>${list.map(s=>`<tr><td>${esc(s.full_name)}</td><td>${esc(s.phone)}</td><td>${esc(universityName(s.university_id))}</td><td>${esc(s.course)}</td><td>${studentPoints(s.id)}</td><td>${kind==='pending'?`<button class="btn primary" data-act="approve" data-id="${esc(s.id)}">Тасдиқ</button> <button class="btn danger" data-act="reject" data-id="${esc(s.id)}">Рад</button>`:`<button class="btn danger" data-act="remove" data-id="${esc(s.id)}">Нест кардан</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Маълумот нест.</div>';
 panel(`<div class="panel-card"><h3>Огоҳӣ: ду дарси пайдарпай ғоиб</h3>${data.warnings.length?data.warnings.map(w=>`<div class="mini-card"><b style="font-size:17px">${esc(w.full_name)}</b><p>Дарсҳои ${w.lesson_a} ва ${w.lesson_b}: иштирок сабт нашудааст.</p><button class="btn danger" data-act="exclude" data-id="${esc(w.student_id)}">Бо тасдиқ хориҷ кардан</button></div>`).join(''):'<p class="muted">Огоҳӣ нест.</p>'}</div><div class="panel-card"><div class="panel-title"><h3>Дархостҳои бақайдгирӣ</h3><span class="status">${pending.length} интизор</span></div>${studentRows(pending,'pending')}</div><div class="panel-card"><h3>Донишҷӯёни тасдиқшуда</h3>${studentRows(approved,'approved')}</div><div class="notice">«Нест кардан» ҳисоби донишҷӯро ғайрифаъол ва аз рӯйхати фаъол хориҷ мекунад. Таърихи иштирок барои ҳисобот нигоҳ дошта мешавад.</div>`);
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
 panel(`<div class="panel-card scan-area"><h3>Скан кардани QR-коди дарс</h3><p class="muted">Барои камера HTTPS ё localhost лозим аст. QR танҳо 10 дақиқа кор мекунад.</p><div id="reader"></div><div id="scanResult" class="notice">QR ҳоло скан нашудааст.</div><button class="btn secondary" id="startScan">Оғози скан</button> <button class="btn ghost" id="stopScan">Қатъи камера</button></div>`);
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
     if(!Number.isInteger(qr.lesson)||typeof qr.token!=='string')throw Error('QR-и нодуруст.');
     if(scanner){await scanner.stop();scanner=null}
     const {error}=await client.rpc('mark_attendance',{p_lesson:qr.lesson,p_token:qr.token});
     if(error)throw error;
     $('scanResult').textContent=`Иштироки шумо барои дарси ${qr.lesson} сабт шуд. +3 хол!`;
     await loadData();toast('Иштирок дар базаи маълумот сабт шуд.');
    }catch(e){$('scanResult').textContent=e.message||'Скан хато шуд.';fail(e)}finally{handling=false}
   },()=>{});
  }catch(e){scanner=null;fail(e)}
 };
 $('stopScan').onclick=async()=>{if(scanner){await scanner.stop().catch(()=>{});scanner=null}};
}
function attendance(){
 const rows=data.attendance;
 panel(`<div class="panel-card"><div class="panel-title"><h3>${isStaff()?'Иштироки донишҷӯён':'Таърихи иштироки ман'}</h3><span class="status ok">${rows.length} сабт</span></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Донишҷӯ</th><th>Дарс</th><th>Сана ва вақт</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(data.students.find(s=>s.id===a.student_id)?.full_name||current?.full_name||'—')}</td><td>${a.lesson_id} — ${esc(lessonName(a.lesson_id))}</td><td>${dateTime(a.attended_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ҳоло сабти иштирок нест.</div>'}</div>`);
}
function announcements(){
 const staff=isStaff();
 panel(`${staff?`<div class="panel-card"><h3>Нашри эълон</h3><form id="announceForm" class="form-grid"><label class="full">Сарлавҳа<input name="title" minlength="2" maxlength="200" required></label><label class="full">Матни эълон<textarea name="body" rows="3" minlength="2" maxlength="5000" required></textarea></label><label>Аудитория<select name="audience"><option value="">Ҳама</option>${data.universities.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label><button class="btn primary">Нашр кардан</button></form></div>`:''}<div class="panel-card"><h3>Эълонҳо</h3>${data.announcements.length?data.announcements.map(a=>`<div class="mini-card"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><small>${esc(a.audience_university_id?universityName(a.audience_university_id):'Ҳама')} · ${dateTime(a.created_at)}</small></div>`).join(''):'<div class="empty">Эълон нест.</div>'}</div>`);
 if(staff)$('announceForm').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{updateBusy(e.target,true);const {error}=await client.from('announcements').insert({title:f.get('title'),body:f.get('body'),audience_university_id:f.get('audience')?Number(f.get('audience')):null,created_by:current.id});if(error)throw error;await refresh('announcements');toast('Эълон нашр шуд.')}catch(ex){fail(ex)}finally{updateBusy(e.target,false)}
 };
}
function getReport(){
 const completed=data.lessons.filter(l=>l.status==='completed'&&l.completed_at);
 return data.students.filter(s=>s.role==='student'&&s.status==='approved').map(s=>{
  const eligible=completed.filter(l=>s.approved_at&&new Date(l.completed_at)>=new Date(s.approved_at));
  const attended=eligible.filter(l=>data.attendance.some(a=>a.student_id===s.id&&a.lesson_id===l.id)).length;
  const scans=data.attendance.filter(a=>a.student_id===s.id).length;
  const absent=eligible.length-attended;
  return {name:s.full_name,university:universityName(s.university_id),course:s.course,present:scans,absent,total:eligible.length,percent:eligible.length?(attended/eligible.length*100).toFixed(1):'—',points:studentPoints(s.id)};
 });
}
function reports(){
 if(!isStaff())return;
 const rows=getReport();
 panel(`<div class="panel-card"><div class="panel-title"><h3>Ҳисоботи курс</h3><button class="btn primary" id="csv">Содироти CSV</button></div><p class="muted">Ҳозир — ҳар QR-и бомуваффақият сабтшуда (ҳатто дарси фаъол). Ғоибӣ ва фоиз танҳо аз дарсҳои анҷомёфтаи баъди тасдиқ ҳисоб мешаванд. Ҳангоми кушода будани ҳисобот, маълумот ҳар 10 сония нав мешавад.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Донишҷӯ</th><th>Донишгоҳ</th><th>Курс</th><th>Дарсҳои ҳисобшаванда</th><th>Ҳозир (QR)</th><th>Ғоиб</th><th>Иштирок</th><th>Хол</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.university)}</td><td>${esc(r.course)}</td><td>${r.total}</td><td>${r.present}</td><td>${r.absent}</td><td>${r.percent==='—'?'—':r.percent+'%'}</td><td>${r.points}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Маълумоти кофӣ нест.</div>'}</div>`);
 $('csv').onclick=()=>{
  const cells=[['Ному насаб','Донишгоҳ','Курс','Дарсҳои ҳисобшаванда','Ҳозир','Ғоиб','Фоизи иштирок','Хол'],...rows.map(r=>[r.name,r.university,r.course,r.total,r.present,r.absent,r.percent,r.points])];
  const csv='\uFEFF'+cells.map(r=>r.map(v=>{let x=String(v??'');if(/^[=+@-]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';}).join(';')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='hisoboti-payravon.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1500);
 };
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
function pointsPage(){
 if(!isStaff())return;
 const students=data.students.filter(s=>s.role==='student'&&s.status==='approved');
 panel(`<div class="panel-card"><h3>Додани хол барои чорабинӣ ё ҷамъомад</h3><p class="muted">Ҳар QR-и нав барои як дарс худкор 3 хол медиҳад. Барои кори иловагӣ метавонед хол илова кунед; сабаб ва номи диҳанда сабт мешаванд.</p>${students.length?`<form id="pointsForm" class="form-grid"><label>Донишҷӯ<select name="student" required>${students.map(s=>`<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('')}</select></label><label>Хол (1–100)<input type="number" name="points" min="1" max="100" value="3" required></label><label class="full">Сабаби додани хол<input name="reason" minlength="5" maxlength="300" required placeholder="Масалан: иштирок дар чорабинӣ"></label><button class="btn primary full">Хол илова кардан</button></form>`:'<p>Донишҷӯи тасдиқшуда нест.</p>'}</div><div class="panel-card"><h3>Ҷамъи холҳои донишҷӯён</h3><div class="table-wrap"><table><thead><tr><th>Донишҷӯ</th><th>Хол</th></tr></thead><tbody>${students.map(s=>`<tr><td>${esc(s.full_name)}</td><td>${studentPoints(s.id)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel-card"><h3>Таърихи холҳо</h3><div class="table-wrap"><table><thead><tr><th>Донишҷӯ</th><th>Хол</th><th>Сабаб</th><th>Сана</th></tr></thead><tbody>${data.points.map(p=>`<tr><td>${esc(data.students.find(s=>s.id===p.student_id)?.full_name||'—')}</td><td>+${Number(p.points)}</td><td>${esc(p.reason)}</td><td>${dateTime(p.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`);
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
 panel(`<div class="grid-cards"><div class="mini-card"><small>Холҳои ман</small><b>${studentPoints(current.id)}</b></div><div class="mini-card"><small>Дарсҳои иштироккарда (QR)</small><b>${allPresent}</b></div><div class="mini-card"><small>Ғоиб (дарсҳои анҷомёфта)</small><b>${absent}</b></div></div><div class="panel-card"><h3>Маълумоти шахсии ман</h3><p><b>Ному насаб:</b> ${esc(current.full_name)}</p><p><b>Телефон:</b> ${esc(current.phone)}</p><p><b>Донишгоҳ:</b> ${esc(universityName(current.university_id))}</p><p><b>Курс:</b> ${esc(current.course)}</p><p><b>Ҳолат:</b> ${current.status==='approved'?'Тасдиқшуда':esc(current.status)}</p></div><div class="panel-card"><h3>Графики иштирок</h3><p class="muted">Фоизи иштирок дар дарсҳои анҷомёфтаи баъди тасдиқи ҳисоб: ${eligible.length?pct+'%':'Ҳоло дарси ҳисобшаванда нест'}</p><div class="bar-chart"><div class="bar-row"><span>Ҳозир (${present})</span><div class="bar-track"><div class="bar-fill present" style="width:${pct}%"></div></div></div><div class="bar-row"><span>Ғоиб (${absent})</span><div class="bar-track"><div class="bar-fill absent" style="width:${eligible.length?100-pct:0}%"></div></div></div></div><h3>Натиҷа аз рӯйи дарс</h3><div class="lesson-chart">${data.lessons.map(l=>{const eligibleLesson=eligible.some(x=>x.id===l.id);const state=attended.has(l.id)?'present':eligibleLesson?'absent':'pending';return `<div class="lesson-dot ${state}" title="${esc(l.title)}: ${state==='present'?'Иштирок':state==='absent'?'Ғоиб':'Ҳоло ҳисоб намешавад'}">${l.id}</div>`}).join('')}</div><p class="hint">Сабз — ҳозир; сурх — ғоиб; хокистарӣ — ҳоло ҳисоб намешавад.</p></div><div class="panel-card"><h3>Таърихи холҳои ман</h3>${data.points.length?`<div class="table-wrap"><table><thead><tr><th>Хол</th><th>Сабаб</th><th>Сана</th></tr></thead><tbody>${data.points.map(p=>`<tr><td>+${Number(p.points)}</td><td>${esc(p.reason)}</td><td>${dateTime(p.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Ҳоло хол нест.</p>'}</div>`);
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
function closeMobileMenu(){document.body.classList.remove('mobile-nav-open');$('menuToggle')?.setAttribute('aria-expanded','false')}
$('menuToggle').onclick=()=>{const isOpen=document.body.classList.toggle('mobile-nav-open');$('menuToggle').setAttribute('aria-expanded',String(isOpen))};
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
