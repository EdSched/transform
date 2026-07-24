// attendance.js - 出席・作业管理
// Depends on: shared/supabase.js, shared/constants.js

const ATT_STATUS = [
  {value:'offline', label:'线下出席', color:'var(--ok)', icon:'●'},
  {value:'online',  label:'线上出席', color:'#2a6aad', icon:'◉'},
  {value:'replay',  label:'录播回看', color:'var(--warn)', icon:'▶'},
  {value:'leave',   label:'请假',     color:'var(--text-3)', icon:'△'},
];
function attStatusLabel(v){
  if(!v) return '缺席';
  return ATT_STATUS.find(x=>x.value===v)?.label||'缺席';
}
function attStatusColor(v){
  if(!v) return 'var(--danger)';
  return ATT_STATUS.find(x=>x.value===v)?.color||'var(--danger)';
}
function attPresent(v){return v==='offline'||v==='online'||v==='replay';}

let attPeriodFilter='';
let attTypeFilter='';
let attMajorFilter='all';
let sessionEdits={};

let attRange='week';   // week | month | all
let attView='list';    // list 课次列表 | status 出席状况
let attHwCount={};     // session_id → 新作业系统的提交人数
let attHwSubs={};      // session_id → Set(已交作业的学生姓名)

function setAttRange(v){attRange=v;renderAttendancePage(document.getElementById('mainContent'))}
function setAttView(v){attView=v;renderAttendancePage(document.getElementById('mainContent'))}

// 载入新作业系统的提交统计（homework_submissions）
async function attLoadHwCounts(){
  try{
    const rows=await sb('/rest/v1/homework_submissions?select=session_id,student_name&limit=5000');
    attHwCount={}; attHwSubs={};
    (rows||[]).forEach(r=>{
      attHwCount[r.session_id]=(attHwCount[r.session_id]||0)+1;
      (attHwSubs[r.session_id]=attHwSubs[r.session_id]||new Set()).add(r.student_name);
    });
    const el=document.getElementById('mainContent');
    if(el&&curPage==='attendance') renderAttendancePage(el);
  }catch(e){}
}

function renderAttendancePage(mc){
  const periods=[...new Set(
    cachedCourses.filter(c=>c.first_session_date&&c.period).map(c=>{
      const y=c.first_session_date.slice(0,4);
      return y+'年'+c.period;
    })
  )].sort();
  const types=[...new Set(cachedCourses.map(c=>c.course_type).filter(Boolean))];

  // courses matching current type+period filter
  let filteredCourses=cachedCourses;
  if(attTypeFilter) filteredCourses=filteredCourses.filter(c=>c.course_type===attTypeFilter);
  if(attPeriodFilter){
    filteredCourses=filteredCourses.filter(c=>{
      const y=c.first_session_date?.slice(0,4)||'';
      return y+'年'+c.period===attPeriodFilter;
    });
  }
  const seen=new Set();
  filteredCourses=filteredCourses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  // majors available in filtered courses
  const availMajors=[...new Set(filteredCourses.flatMap(c=>c.major||[]))].filter(m=>MAJORS[m]);

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">出席・作业</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        ${[['week','本周'],['month','本月'],['all','全部']].map(([k,l])=>`<button onclick="setAttRange('${k}')" style="font-size:11px;padding:5px 14px;border:none;cursor:pointer;font-family:inherit;background:${attRange===k?'var(--accent)':'var(--surface)'};color:${attRange===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        ${[['list','课次列表'],['status','出席状况']].map(([k,l])=>`<button onclick="setAttView('${k}')" style="font-size:11px;padding:5px 14px;border:none;cursor:pointer;font-family:inherit;background:${attView===k?'var(--accent)':'var(--surface)'};color:${attView===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
      </div>
    </div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:16px">
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">课程属性</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${types.map(t=>`<div class="filter-chip${attTypeFilter===t?' active':''}" onclick="setAttType('${t}')">${t}</div>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">期数</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${periods.map(p=>`<div class="filter-chip${attPeriodFilter===p?' active':''}" onclick="setAttPeriod('${p}')">${p}</div>`).join('')}
        </div>
      </div>
      ${attTypeFilter&&availMajors.length?`<div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">专业</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <div class="filter-chip${attMajorFilter==='all'?' active':''}" onclick="setAttMajor('all')">全部</div>
          ${availMajors.map(m=>`<div class="filter-chip${attMajorFilter===m?' active':''}" onclick="setAttMajor('${m}')">${MAJORS[m]||m}</div>`).join('')}
        </div>
      </div>`:''}
    </div>
    ${!attTypeFilter&&!attPeriodFilter?'<div style="font-size:11px;color:var(--text-3);margin-top:10px">请选择课程属性或期数查看课次</div>':''}
  </div>
  ${attTypeFilter||attPeriodFilter ? renderSessionList(filteredCourses) : ''}`;
  if(!Object.keys(attHwCount).length) attLoadHwCounts();
}

function renderSessionList(filteredCourses){
  let courses=filteredCourses;
  if(attMajorFilter!=='all'){
    courses=courses.filter(c=>(c.major||[]).includes(attMajorFilter));
  }

  let sessions=cachedSessions
    .filter(s=>courses.find(c=>c.id===s.course_id)&&s.confirmed)
    .sort((a,b)=>a.session_date.localeCompare(b.session_date));

  // 时间范围：默认只看本周，避免一进来就是几百行
  if(attRange!=='all'){
    const now=new Date();
    let from,to;
    if(attRange==='week'){
      const day=(now.getDay()+6)%7;               // 周一为起点
      from=new Date(now); from.setDate(now.getDate()-day);
      to=new Date(from); to.setDate(from.getDate()+6);
    }else{
      from=new Date(now.getFullYear(),now.getMonth(),1);
      to=new Date(now.getFullYear(),now.getMonth()+1,0);
    }
    const f=d=>d.toISOString().slice(0,10);
    sessions=sessions.filter(s=>s.session_date>=f(from)&&s.session_date<=f(to));
  }

  if(!sessions.length) return `<div class="empty" style="padding:36px">${attRange==='all'?'所选条件下暂无已发布的课次':`本${attRange==='week'?'周':'月'}没有课次，可切换到「全部」查看`}</div>`;

  if(attView==='status') return renderAttStatusView(sessions,courses);

  const byCourse={};
  sessions.forEach(s=>{
    if(!byCourse[s.course_id]) byCourse[s.course_id]=[];
    byCourse[s.course_id].push(s);
  });

  return Object.entries(byCourse).map(([cid,sess])=>{
    const course=courses.find(c=>c.id===cid)||{name:sess[0]?.course_name||''};
    const color=courseColor(course.name);
    const majors=sess[0]?.major||course.major||[];
    const totalStudents=cachedStudents.filter(s=>
      s.status==='active'&&(
        majors.includes(s.major)||
        (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
      )
    ).length;

    return `<div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div style="background:${color.bg};color:${color.text};padding:8px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>${course.name} <span style="font-size:10px;font-weight:400;opacity:.7">${course.time_range||''}</span></span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;opacity:.7">${sess.length}回 · ${totalStudents}人</span>
          ${sess.some(s=>s.homework_enabled)?`<button onclick="adminBatchDownloadCourse('${cid}')" style="font-size:10px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:3px;padding:3px 8px;cursor:pointer;color:inherit;font-family:inherit">📦 下载作业</button>`:''}
        </div>
      </div>
      <div class="table-scroll"><table class="student-table" style="margin:0;min-width:560px">
        <thead><tr>
          <th style="width:52px">回</th>
          <th style="width:86px">日期</th>
          <th>单回名称</th>
          <th style="width:88px">出席</th>
          <th style="width:70px">出席率</th>
          <th style="width:88px">交作业</th>
          <th style="width:120px"></th>
        </tr></thead>
        <tbody>
          ${sess.map(s=>{
            const recs=cachedSessionRecords.filter(r=>r.session_id===s.id);
            const present=recs.filter(r=>attPresent(r.attendance_status)).length;
            // 交作业人数：新作业系统的实际提交（学生提交即自动计入，无需手动记录）
            const hwSubmit=(attHwCount[s.id]||0)||recs.filter(r=>r.homework_submitted||r.homework_file_url).length;
            const rate=totalStudents?Math.round(present/totalStudents*100):0;
            const f=fmtSessionDate(s.session_date);
            const hasHw=!!s.homework_enabled;
            return `<tr>
              <td style="font-size:11px;color:var(--text-3)">${s.session_number}</td>
              <td style="font-size:12px;font-weight:600">${f.short} <span style="font-size:10px;color:${f.dowColor}">${f.dow}</span></td>
              <td style="font-size:11px;color:var(--text-2)">${s.session_title||'—'}${hasHw?'<span style="font-size:9px;color:var(--accent);margin-left:5px">📝</span>':''}</td>
              <td style="font-size:11px">${recs.length?`${present}/${totalStudents}`:'<span style="color:var(--text-3)">—</span>'}</td>
              <td style="font-size:11px;color:${!recs.length?'var(--text-3)':rate>=80?'var(--ok)':rate>=60?'var(--warn)':'var(--danger)'}">${recs.length?rate+'%':'—'}</td>
              <td style="font-size:11px">${hasHw?(hwSubmit?`<span style="color:var(--ok);font-weight:600">${hwSubmit}</span>/${totalStudents}`:`<span style="color:var(--text-3)">0/${totalStudents}</span>`):'<span style="color:var(--text-3)">—</span>'}</td>
              <td style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm" onclick="openSessionModal('${s.id}')">记出席</button>
                ${hasHw&&hwSubmit?`<button class="btn btn-outline btn-sm" onclick="toggleAdminHwPanel('${s.id}')">作业(${hwSubmit})</button>`:''}
                <button class="btn btn-danger btn-sm" onclick="deleteSession('${s.id}')">删</button>
              </td>
            </tr>
            <tr id="admin_hw_panel_${s.id}" style="display:none">
              <td colspan="7" style="padding:0;background:var(--bg)">
                <div id="admin_hw_content_${s.id}" style="padding:10px 14px">加载中…</div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }).join('');
}

async function toggleAdminHwPanel(sessionId) {
  const row = document.getElementById(`admin_hw_panel_${sessionId}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (!isOpen) await loadAdminHwPanel(sessionId);
}

async function loadAdminHwPanel(sessionId) {
  const wrap = document.getElementById(`admin_hw_content_${sessionId}`);
  if (!wrap) return;
  wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">加载中…</div>';
  const s = cachedSessions.find(x => x.id === sessionId) || {};
  let subs = [];
  try {
    subs = await sb(`/rest/v1/homework_submissions?session_id=eq.${sessionId}&select=*&order=submitted_at.asc`);
  } catch (e) { wrap.innerHTML = `<div style="font-size:11px;color:var(--danger)">加载失败：${e.message}</div>`; return; }
  admHwSubs[sessionId] = subs || [];
  if (!subs.length) { wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">暂无提交作业</div>'; return; }

  const majors = s.major || [];
  const students = cachedStudents.filter(x => x.status === 'active' && (
    majors.includes(x.major) || (majors.includes('shakai_group') && ['shakai','shinpan','fukushi'].includes(x.major))
  ));
  const done = new Set(subs.map(x => x.student_name));
  const missing = students.filter(x => !done.has(x.name));

  wrap.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <span style="font-size:11px;font-weight:600">📝 作业提交（${subs.length}/${students.length}）</span>
    <button onclick="admHwPrint('${sessionId}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">🖨 全部打印 / 存 PDF</button>
    <button onclick="admHwWord('${sessionId}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">⬇ 全部导出 Word</button>
    ${missing.length ? `<span style="font-size:10px;color:var(--warn,#b8860b);margin-left:auto">未交 ${missing.length} 人：${missing.slice(0,6).map(x=>x.name).join('、')}${missing.length>6?'…':''}</span>` : '<span style="font-size:10px;color:var(--ok);margin-left:auto">✓ 全员已交</span>'}
  </div>
  <div style="display:flex;flex-direction:column;gap:4px">
    ${subs.map(x => `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--border-light);border-radius:3px;background:var(--surface)">
      <span style="font-size:11px;font-weight:600">${x.student_name}</span>
      <span style="font-size:9px;color:var(--text-3)">${fmtJst(x.submitted_at)}</span>
      ${x.level?`<span style="font-size:9px;color:var(--text-3)">【${x.level}】</span>`:''}
      <span style="font-size:9px;color:var(--text-3)">${(x.answers||[]).filter(a=>a.text||(a.images||[]).length).length} 处作答${x.whole_file_url?' · 📎附件':''}</span>
      ${x.teacher_feedback||x.feedback_knowledge?`<span style="font-size:9px;color:var(--ok)">✓ 已批改${x.graded_by?`（${x.graded_by}）`:''}</span>`:'<span style="font-size:9px;color:var(--warn,#b8860b)">待批改</span>'}
      <span style="margin-left:auto;display:flex;gap:4px">
        <button onclick="admHwPrint('${sessionId}','${x.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 9px;cursor:pointer;font-family:inherit">打印</button>
        <button onclick="admHwWord('${sessionId}','${x.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 9px;cursor:pointer;font-family:inherit">Word</button>
      </span>
    </div>`).join('')}
  </div>`;
}

// ══ admin 侧作业整合与导出（与老师端同一套排版） ══
let admHwSubs = {};

// 时间统一按日本时间（JST）显示
function fmtJst(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 16).replace('T', ' ');
    return d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
  } catch (e) { return String(ts).slice(0, 16).replace('T', ' '); }
}


function admEsc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

function admHwPaper(s, sub, forPrint) {
  // Word 认 width 属性；打印用 max-height 防止一张图占满整页
  const imgStyle = 'max-width:100%;max-height:16cm;width:auto;height:auto;display:block;margin:6px 0;border:1px solid #ddd';
  const imgAttr = 'width="440"';
  const groups = [];
  (sub.answers || []).forEach(a => {
    const label = a.label || a.k || '';
    const sp = label.indexOf(' ');
    const head = sp > 0 ? label.slice(0, sp) : '';
    let sub2 = sp > 0 ? label.slice(sp + 1) : label;
    if (sub2 === '作答') sub2 = '';
    if (sub2 === '整题') sub2 = '手写作答';
    let g = groups.find(x => x.head === head);
    if (!g) { g = { head, items: [] }; groups.push(g); }
    g.items.push({ ...a, sub: sub2 });
  });
  return `
  <div style="border-bottom:2px solid #5a3e28;padding-bottom:8px;margin-bottom:14px">
    <div style="font-size:16px;font-weight:700">${admEsc(sub.student_name)} — ${admEsc(s.course_name||'')} 第${s.session_number||''}回 作业${sub.level?`（${admEsc(sub.level)}级）`:''}</div>
    <div style="font-size:11px;color:#666;margin-top:3px">${s.session_date||''}${s.session_title?' · '+admEsc(s.session_title):''}　提交：${fmtJst(sub.submitted_at)}（JST）</div>
  </div>
  ${sub.whole_file_url?`<div style="font-size:11px;margin-bottom:10px">📎 整份作业：<a href="${admEsc(sub.whole_file_url)}">${admEsc(sub.whole_file_url)}</a></div>`:''}
  ${groups.map(g => `<div style="margin-bottom:16px">
    ${g.head?`<div style="font-size:13px;font-weight:700;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #ccc">${admEsc(g.head)}</div>`:''}
    ${g.items.every(it => !(it.images||[]).length && !(it.q||'') && (it.text||'').length <= 8)
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:4px">
          ${g.items.map(it => `<div style="font-size:11px"><span style="color:#999">${admEsc(it.sub)}</span> <b>${admEsc(it.text||'—')}</b></div>`).join('')}
        </div>`
      : g.items.map(it => `<div style="margin-bottom:12px;page-break-inside:avoid">
          ${(it.sub||it.q)?`<div style="font-size:12px;font-weight:600;margin-bottom:3px">${admEsc(it.sub)}${it.q?` <span style="font-weight:400">${admEsc(it.q)}</span>`:''}</div>`:''}
          ${it.text?`<div style="font-size:12px;line-height:1.9;white-space:pre-wrap;padding:6px 8px;background:#fafafa;border-radius:2px">${admEsc(it.text)}</div>`:''}
          ${(it.images||[]).map((im,i)=> im.kind==='doc'
            ? `<div style="font-size:11px;margin-top:4px">📎 <a href="${admEsc(im.url)}">${admEsc(im.name||'附件')}</a></div>`
            : `<div><div style="font-size:9px;color:#999;margin-top:4px">${admEsc(it.sub)} · 图${i+1}</div><img src="${admEsc(im.url)}" ${imgAttr} style="${imgStyle}"></div>`).join('')}
          ${!it.text && !(it.images||[]).length?'<div style="font-size:11px;color:#aaa">（未作答）</div>':''}
        </div>`).join('')}
  </div>`).join('')}
  ${(sub.feedback_knowledge||sub.feedback_attitude||sub.feedback_suggestions||sub.teacher_feedback)?`
  <div style="margin-top:16px;border-top:1px solid #ccc;padding-top:8px">
    <div style="font-size:11px;font-weight:700;margin-bottom:4px">老师批改${sub.score?` · ${admEsc(sub.score)}`:''}${sub.graded_by?`（${admEsc(sub.graded_by)}）`:''}</div>
    ${sub.feedback_knowledge?`<div style="font-size:11px">知识掌握：${admEsc(sub.feedback_knowledge)}</div>`:''}
    ${sub.feedback_attitude?`<div style="font-size:11px">学习态度：${admEsc(sub.feedback_attitude)}</div>`:''}
    ${sub.feedback_suggestions?`<div style="font-size:11px">改进建议：${admEsc(sub.feedback_suggestions)}</div>`:''}
    ${(!sub.feedback_knowledge&&sub.teacher_feedback)?`<div style="font-size:11px;white-space:pre-wrap">${admEsc(sub.teacher_feedback)}</div>`:''}
  </div>`:''}`;
}

function admHwTargets(sessionId, subId) {
  const s = cachedSessions.find(x => x.id === sessionId) || {};
  let subs = admHwSubs[sessionId] || [];
  if (subId) subs = subs.filter(x => x.id === subId);
  return { s, subs };
}

function admHwPrint(sessionId, subId) {
  const { s, subs } = admHwTargets(sessionId, subId);
  if (!subs.length) return;
  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${s.course_name||''}_第${s.session_number||''}回作业</title>
<style>body{font-family:'Noto Serif SC','Hiragino Sans GB',serif;background:#fff;margin:0;padding:24px;color:#1a1814}
@media print{.noprint{display:none!important}body{padding:0}}.paper{max-width:820px;margin:0 auto 40px}</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button></div>
${subs.map(sub => `<div class="paper" style="page-break-after:always">${admHwPaper(s, sub, true)}</div>`).join('')}
</body></html>`);
  w.document.close();
}

function admHwWord(sessionId, subId) {
  const { s, subs } = admHwTargets(sessionId, subId);
  if (!subs.length) return;
  const body = subs.map(sub => admHwPaper(s, sub, false) + '<br clear=all style="page-break-before:always">').join('');
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>body{font-family:'Noto Serif SC',serif;font-size:12pt;line-height:1.8}img{max-width:520px}</style></head><body>${body}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.course_name||''}_第${s.session_number||''}回作业${subId?'_'+subs[0].student_name:''}.doc`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function setAttPeriod(p){
  attPeriodFilter=attPeriodFilter===p?'':p;
  attMajorFilter='all';
  renderAttendancePage(document.getElementById('mainContent'));
}
function setAttType(t){
  attTypeFilter=attTypeFilter===t?'':t;
  attMajorFilter='all';
  renderAttendancePage(document.getElementById('mainContent'));
}
function setAttMajor(m){
  attMajorFilter=m;
  renderAttendancePage(document.getElementById('mainContent'));
}

// ── Session modal ──
async function openSessionModal(sessionId){
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const course=cachedCourses.find(c=>c.id===session.course_id)||{};
  document.getElementById('sessionModalId').value=sessionId;
  document.getElementById('sessionModalTitle').textContent=`${session.course_name} 第${session.session_number}回`;
  document.getElementById('sessionModalSub').textContent=`${session.session_date} · ${session.time_range||''} · ${session.session_title||''}`;

  const majors=session.major||course.major||[];
  const students=cachedStudents.filter(s=>
    s.status==='active'&&(
      majors.includes(s.major)||
      (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )
  ).sort((a,b)=>a.name.localeCompare(b.name,'zh'));

  let existing=cachedSessionRecords.filter(r=>r.session_id===sessionId);
  if(!existing.length){
    try{existing=await sb(`/rest/v1/session_records?session_id=eq.${sessionId}&select=*`)}catch(e){}
    existing.forEach(r=>{if(!cachedSessionRecords.find(x=>x.id===r.id))cachedSessionRecords.push(r)});
  }

  sessionEdits={};
  _currentSessionStudents = students;
  _currentSessionRecords = existing;
  const searchInput = document.getElementById('sessionStudentSearch');
  if (searchInput) searchInput.value = '';
  renderStudentRows('');
  document.getElementById('sessionModal').classList.add('open');
}

let _currentSessionStudents = [];
let _currentSessionRecords = [];

function renderStudentRows(filter='') {
  const students = _currentSessionStudents;
  const existing = _currentSessionRecords;
  const filtered = filter
    ? students.filter(s => matchesStudentSearch(s, filter))
    : students;
  const tbody=document.getElementById('sessionRecordBody');
  tbody.innerHTML=filtered.map(s=>{
    const rec=existing.find(r=>r.student_id===s.id||r.student_name===s.name)||{};
    const defaultMode=rec.student_mode||s.default_mode||'offline';
    sessionEdits[s.id]={
      student_mode:defaultMode,
      attendance_status:rec.attendance_status||'',
      homework_submitted:rec.homework_submitted||!!rec.homework_file_url,
    };
    const att=rec.attendance_status||'';
    // 有上传文件的也算已交作业
    const hw=rec.homework_submitted||!!rec.homework_file_url;
    // 如果有文件但 homework_submitted 还是 false，自动更新
    if(!rec.homework_submitted && rec.homework_file_url && rec.id){
      sb(`/rest/v1/session_records?id=eq.${rec.id}`,'PATCH',{homework_submitted:true}).catch(()=>{});
      rec.homework_submitted=true;
    }
    return `<tr id="srow-${s.id}">
      <td style="font-size:12px;font-family:'Noto Serif SC',serif;font-weight:600">${s.name}</td>
      <td>
        <button onclick="toggleMode('${s.id}')" id="mode-${s.id}"
          style="font-size:10px;padding:3px 10px;border-radius:2px;border:1px solid;cursor:pointer;font-family:inherit;
          background:${defaultMode==='online'?'#e8eef8':'var(--bg)'};
          color:${defaultMode==='online'?'#1a3a6a':'var(--text-2)'};
          border-color:${defaultMode==='online'?'#2a6aad':'var(--border)'}">
          ${defaultMode==='online'?'线上':'线下'}
        </button>
      </td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${ATT_STATUS.map(a=>`<button onclick="setAtt('${s.id}','${a.value}')" id="att-${s.id}-${a.value}"
            style="font-size:10px;padding:3px 9px;border-radius:2px;border:1px solid;cursor:pointer;font-family:inherit;
            background:${att===a.value?a.color:'var(--bg)'};
            color:${att===a.value?'#fff':'var(--text-2)'};
            border-color:${att===a.value?a.color:'var(--border)'}">${a.label}
          </button>`).join('')}
        </div>
        ${att===''?'<div style="font-size:10px;color:var(--danger);margin-top:3px">缺席</div>':''}
      </td>
      <td>
        <button onclick="toggleHw('${s.id}')" id="hw-${s.id}"
          style="font-size:12px;width:28px;height:28px;border-radius:3px;border:1px solid;cursor:pointer;
          background:${hw?'var(--ok)':'var(--bg)'};
          color:${hw?'#fff':'var(--text-3)'};
          border-color:${hw?'var(--ok)':'var(--border)'}">
          ${hw?'✓':'—'}
        </button>
      </td>
    </tr>`;
    }).join('');
}

function getPinyinInitials(str) {
  // 常用姓氏拼音首字母映射
  const map = {
    '阿':'A','艾':'A','安':'A','昂':'A','敖':'A',
    '巴':'B','白':'B','柏':'B','班':'B','包':'B','鲍':'B','贝':'B','本':'B','毕':'B','卞':'B','别':'B','薄':'B','卜':'B',
    '蔡':'C','曹':'C','岑':'C','柴':'C','常':'C','车':'C','陈':'C','程':'C','池':'C','仇':'C','储':'C','楚':'C','褚':'C','崔':'C',
    '戴':'D','邓':'D','刁':'D','丁':'D','董':'D','窦':'D','杜':'D','段':'D','樊':'F','范':'F','方':'F','房':'F','费':'F','冯':'F','凤':'F','伏':'F','符':'F','傅':'F',
    '盖':'G','甘':'G','高':'G','葛':'G','耿':'G','弓':'G','宫':'G','巩':'G','贡':'G','苟':'G','古':'G','谷':'G','顾':'G','管':'G','郭':'G','过':'G',
    '郝':'H','何':'H','和':'H','赫':'H','贺':'H','洪':'H','侯':'H','胡':'H','花':'H','滑':'H','怀':'H','桓':'H','黄':'H','惠':'H','霍':'H',
    '纪':'J','计':'J','季':'J','贾':'J','简':'J','江':'J','姜':'J','蒋':'J','焦':'J','解':'J','金':'J','靳':'J','经':'J','景':'J','鞠':'J',
    '康':'K','柯':'K','孔':'K','寇':'K','匡':'K',
    '郎':'L','劳':'L','乐':'L','雷':'L','冷':'L','黎':'L','李':'L','厉':'L','连':'L','廉':'L','练':'L','梁':'L','林':'L','刘':'L','龙':'L','楼':'L','卢':'L','鲁':'L','陆':'L','路':'L','吕':'L','罗':'L','骆':'L',
    '马':'M','麦':'M','毛':'M','梅':'M','孟':'M','苗':'M','闵':'M','莫':'M','牟':'M','穆':'M',
    '倪':'N','聂':'N','宁':'N','牛':'N','钮':'N',
    '欧':'O',
    '潘':'P','庞':'P','裴':'P','彭':'P','皮':'P','平':'P','蒲':'P','濮':'P',
    '戚':'Q','祁':'Q','齐':'Q','钱':'Q','强':'Q','乔':'Q','秦':'Q','邱':'Q','丘':'Q','仇':'Q',
    '冉':'R','任':'R','荣':'R','阮':'R',
    '桑':'S','沙':'S','邵':'S','申':'S','沈':'S','盛':'S','施':'S','石':'S','史':'S','舒':'S','宋':'S','苏':'S','孙':'S',
    '谭':'T','汤':'T','唐':'T','陶':'T','田':'T','仝':'T','涂':'T','屠':'T',
    '万':'W','汪':'W','王':'W','韦':'W','魏':'W','文':'W','翁':'W','吴':'W','伍':'W',
    '奚':'X','夏':'X','项':'X','萧':'X','谢':'X','邢':'X','熊':'X','徐':'X','许':'X','宣':'X','薛':'X',
    '闫':'Y','严':'Y','颜':'Y','杨':'Y','姚':'Y','叶':'Y','尹':'Y','应':'Y','于':'Y','俞':'Y','虞':'Y','余':'Y','禹':'Y','袁':'Y','岳':'Y','云':'Y',
    '曾':'Z','占':'Z','章':'Z','赵':'Z','甄':'Z','郑':'Z','钟':'Z','周':'Z','朱':'Z','庄':'Z','卓':'Z','宗':'Z','邹':'Z'
  };
  return str.split('').map(c => map[c] || '').join('');
}

function toggleMode(studentId){
  const st=sessionEdits[studentId];
  st.student_mode=st.student_mode==='online'?'offline':'online';
  const btn=document.getElementById(`mode-${studentId}`);
  if(btn){
    const isOnline=st.student_mode==='online';
    btn.textContent=isOnline?'线上':'线下';
    btn.style.background=isOnline?'#e8eef8':'var(--bg)';
    btn.style.color=isOnline?'#1a3a6a':'var(--text-2)';
    btn.style.borderColor=isOnline?'#2a6aad':'var(--border)';
  }
  // save default_mode to students table
  sb(`/rest/v1/students?id=eq.${studentId}`,'PATCH',{default_mode:st.student_mode}).catch(()=>{});
  const stu=cachedStudents.find(s=>s.id===studentId);
  if(stu) stu.default_mode=st.student_mode;
}

function setAtt(studentId,value){
  const st=sessionEdits[studentId];
  st.attendance_status=st.attendance_status===value?'':value;
  ATT_STATUS.forEach(a=>{
    const btn=document.getElementById(`att-${studentId}-${a.value}`);
    const active=st.attendance_status===a.value;
    if(btn){
      btn.style.background=active?a.color:'var(--bg)';
      btn.style.color=active?'#fff':'var(--text-2)';
      btn.style.borderColor=active?a.color:'var(--border)';
    }
  });
  // update absent hint
  const row=document.getElementById(`srow-${studentId}`);
  if(row){
    const hint=row.querySelector('.absent-hint');
    if(hint) hint.style.display=st.attendance_status===''?'block':'none';
  }
}

function toggleHw(studentId){
  const st=sessionEdits[studentId];
  st.homework_submitted=!st.homework_submitted;
  const btn=document.getElementById(`hw-${studentId}`);
  if(btn){
    btn.textContent=st.homework_submitted?'✓':'—';
    btn.style.background=st.homework_submitted?'var(--ok)':'var(--bg)';
    btn.style.color=st.homework_submitted?'#fff':'var(--text-3)';
    btn.style.borderColor=st.homework_submitted?'var(--ok)':'var(--border)';
  }
}

async function adminBatchDownloadCourse(courseId) {
  const sessions = cachedSessions.filter(s => s.course_id === courseId && s.homework_enabled)
    .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  if (!sessions.length) { alert('该课程暂无布置作业的课次'); return; }
  try {
    const ids = sessions.map(s => `"${s.id}"`).join(',');
    const subs = await sb(`/rest/v1/homework_submissions?session_id=in.(${ids})&select=*&order=session_date.asc,student_name.asc`);
    if (!subs || !subs.length) { alert('该课程暂无学生提交的作业'); return; }
    const course = cachedCourses.find(c => c.id === courseId) || {};
    const w = window.open('', '_blank');
    if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
    const body = subs.map(sub => {
      const s = sessions.find(x => x.id === sub.session_id) || {};
      return `<div class="paper" style="page-break-after:always">${admHwPaper(s, sub, true)}</div>`;
    }).join('');
    w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${course.name || ''}_全部作业</title>
<style>body{font-family:'Noto Serif SC','Hiragino Sans GB',serif;background:#fff;margin:0;padding:24px;color:#1a1814}
@media print{.noprint{display:none!important}body{padding:0}}.paper{max-width:820px;margin:0 auto 40px}</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:12px">
  <span style="font-size:12px;color:#666;margin-right:10px">${course.name || ''}　共 ${subs.length} 份</span>
  <button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button>
</div>${body}</body></html>`);
    w.document.close();
  } catch (e) { alert('导出失败：' + e.message); }
}


async function deleteSession(sessionId) {
  if (!confirm('确定删除这个课次？')) return;
  try {
    await sb(`/rest/v1/course_sessions?id=eq.${sessionId}`, 'DELETE');
    cachedSessions = cachedSessions.filter(s => s.id !== sessionId);
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('删除失败：' + e.message); }
}


async function toggleCourseHomework(courseId, enable) {
  try {
    // 해당 코스의 모든 세션 일괄 업데이트
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`, 'PATCH', { homework_enabled: enable });
    // 课程表也同步
    await sb(`/rest/v1/courses?id=eq.${courseId}`, 'PATCH', { homework_enabled: enable }).catch(() => {});
    // 로컬 캐시 업데이트
    cachedSessions.forEach(s => { if (s.course_id === courseId) s.homework_enabled = enable; });
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}


async function toggleHomeworkEnabled(sessionId, current) {
  const newVal = !current;
  try {
    await sb(`/rest/v1/course_sessions?id=eq.${sessionId}`, 'PATCH', { homework_enabled: newVal });
    const s = cachedSessions.find(x => x.id === sessionId);
    if (s) s.homework_enabled = newVal;
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}


async function saveSessionRecords(){
  const sessionId=document.getElementById('sessionModalId').value;
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const majors=session.major||[];
  const students=cachedStudents.filter(s=>
    s.status==='active'&&(
      majors.includes(s.major)||
      (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )
  );
  const btn=document.querySelector('#sessionModal .btn-primary');
  btn.textContent='保存中…';btn.disabled=true;
  try{
    for(const s of students){
      const edit=sessionEdits[s.id];
      if(!edit) continue;
      const existing=cachedSessionRecords.find(r=>r.session_id===sessionId&&r.student_id===s.id);
      const data={
        session_id:sessionId,
        course_name:session.course_name,
        session_date:session.session_date,
        student_id:s.id,
        student_name:s.name,
        major:s.major,
        student_mode:edit.student_mode||'offline',
        attendance_status:edit.attendance_status||'', // empty = absent
        homework_submitted:edit.homework_submitted||false,
      };
      if(existing){
        await sb(`/rest/v1/session_records?id=eq.${existing.id}`,'PATCH',data);
        Object.assign(existing,data);
      } else {
        data.id=`r-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
        const res=await sb('/rest/v1/session_records','POST',[data]);
        cachedSessionRecords.push(Array.isArray(res)?res[0]:data);
      }
    }
    btn.textContent='✓ 已保存';
    setTimeout(()=>{btn.textContent='保存全部';btn.disabled=false},1500);
    renderAttendancePage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message);btn.textContent='保存全部';btn.disabled=false}
}

// ── Student detail ──
function openStudentAttModal(studentId){
  const s=cachedStudents.find(x=>x.id===studentId);
  if(!s) return;
  document.getElementById('studentAttTitle').textContent=s.name+' · 出席记录';
  document.getElementById('studentAttSub').textContent=`${MAJORS[s.major]||s.major||''}`;
  const recs=cachedSessionRecords.filter(r=>r.student_id===studentId).sort((a,b)=>a.session_date?.localeCompare(b.session_date));
  const present=recs.filter(r=>attPresent(r.attendance_status)).length;
  const hwSubmit=recs.filter(r=>r.homework_submitted).length;
  document.getElementById('studentAttBody').innerHTML=`
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">出席 <strong style="color:var(--ok)">${present}/${recs.length}</strong></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">出席率 <strong style="color:${recs.length&&present/recs.length>=0.8?'var(--ok)':'var(--warn)'}">${recs.length?Math.round(present/recs.length*100)+'%':'—'}</strong></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">作业提交 <strong>${hwSubmit}/${recs.length}</strong></div>
    </div>
    ${recs.length?`<div class="table-scroll"><table class="student-table" style="min-width:600px">
      <thead><tr><th>课程</th><th>日期</th><th>单回</th><th>方式</th><th>出席状态</th><th>作业</th></tr></thead>
      <tbody>
        ${recs.map(r=>`<tr>
          <td style="font-size:11px;max-width:160px">${r.course_name||''}</td>
          <td style="font-size:11px">${r.session_date||''}</td>
          <td style="font-size:11px;color:var(--text-3)">${cachedSessions.find(s=>s.id===r.session_id)?.session_title||'—'}</td>
          <td style="font-size:11px">${r.student_mode==='online'?'线上':'线下'}</td>
          <td style="font-size:11px;color:${attStatusColor(r.attendance_status)}">${attStatusLabel(r.attendance_status)}</td>
          <td style="font-size:11px;color:${r.homework_submitted?'var(--ok)':'var(--text-3)'}">${r.homework_submitted?'✓ 已提交':'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`:'<div class="empty">暂无记录</div>'}`;
  document.getElementById('studentAttModal').classList.add('open');
}

// ══ 出席状况视图：学生 × 课次 矩阵，一眼看谁缺席、谁没交作业 ══
function renderAttStatusView(sessions, courses){
  const byCourse={};
  sessions.forEach(s=>{ (byCourse[s.course_id]=byCourse[s.course_id]||[]).push(s) });
  return Object.entries(byCourse).map(([cid,sess])=>{
    const course=courses.find(c=>c.id===cid)||{name:sess[0]?.course_name||''};
    const color=courseColor(course.name);
    const majors=sess[0]?.major||course.major||[];
    const students=cachedStudents.filter(s=>s.status==='active'&&(
      majors.includes(s.major)||(majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    if(!students.length) return '';
    const hwSess=sess.filter(s=>s.homework_enabled);
    return `<div style="margin-bottom:18px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div style="background:${color.bg};color:${color.text};padding:8px 14px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>${course.name}</span>
        <span style="font-size:10px;opacity:.75">${sess.length}回 · ${students.length}人　✓出席 ✗缺席 ─未记录 · 📝已交作业</span>
      </div>
      <div class="table-scroll"><table class="student-table" style="margin:0">
        <thead><tr>
          <th style="width:110px;position:sticky;left:0;background:var(--bg);z-index:1">学生</th>
          ${sess.map(s=>{const f=fmtSessionDate(s.session_date);return `<th style="width:56px;text-align:center;font-size:10px" title="第${s.session_number}回 ${s.session_title||''}">${f.short}${s.homework_enabled?'<div style="font-size:8px;color:var(--accent)">📝</div>':''}</th>`}).join('')}
          <th style="width:64px;text-align:center;font-size:10px">出席率</th>
          ${hwSess.length?'<th style="width:64px;text-align:center;font-size:10px">交作业</th>':''}
        </tr></thead>
        <tbody>
          ${students.map(stu=>{
            let att=0, rec=0, hw=0;
            const cells=sess.map(s=>{
              const r=cachedSessionRecords.find(x=>x.session_id===s.id&&x.student_name===stu.name);
              const submitted=!!(attHwSubs[s.id]&&attHwSubs[s.id].has(stu.name));
              if(r){rec++; if(attPresent(r.attendance_status)) att++;}
              if(submitted) hw++;
              const mark=!r?'<span style="color:var(--text-3)">─</span>'
                : attPresent(r.attendance_status)?'<span style="color:var(--ok)">✓</span>'
                : '<span style="color:var(--danger)">✗</span>';
              return `<td style="text-align:center;font-size:12px" title="${r?attStatusLabel(r.attendance_status):'未记录'}${submitted?' · 已交作业':''}">${mark}${submitted?'<span style="font-size:8px;color:var(--accent)">📝</span>':''}</td>`;
            }).join('');
            const rate=rec?Math.round(att/rec*100):0;
            return `<tr>
              <td style="font-size:11px;font-weight:600;position:sticky;left:0;background:var(--surface)">${stu.name}</td>
              ${cells}
              <td style="text-align:center;font-size:11px;color:${!rec?'var(--text-3)':rate>=80?'var(--ok)':rate>=60?'var(--warn)':'var(--danger)'}">${rec?rate+'%':'—'}</td>
              ${hwSess.length?`<td style="text-align:center;font-size:11px;color:${hw>=hwSess.length?'var(--ok)':hw?'var(--warn)':'var(--text-3)'}">${hw}/${hwSess.length}</td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }).join('')||'<div class="empty" style="padding:36px">该范围内没有可显示的学生</div>';
}
