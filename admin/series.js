// ══════════════════════════════════════════════════════════
// 系列课：几门同专业的课「接续」或「同日分段」排，一次算日期、一次占教室；课程表照样每门课分开显示
//   接续 chain：A 的回次全部上完，接着 B，再接着 C（同一个星期、同一个时间，日期一路往下排）
//   同日分段 split：同一天按时间段切开，每门课回数、日期都一样，时间不同
// 数据：course_series（系列）+ courses.series_id / series_order；SQL 见 seed/course_series.sql
// 依赖：admin/courses.js（cachedCourses / cachedSessions / acToday / openReschedule 等）、shared/constants.js（courseScan）、shared/course-confirm.js
// ══════════════════════════════════════════════════════════
let cachedSeries=[];
let SER=null;   // 弹窗里正在编辑的系列（state）

async function serLoad(){
  try{ cachedSeries=await sbAll('/rest/v1/course_series?select=*&order=created_at.desc'); cachedSeries=cachedSeries.filter(s=>!s.deleted_at); }
  catch(e){ cachedSeries=[]; }
  return cachedSeries;
}
function serById(id){ return id?(cachedSeries.find(s=>s.id===id)||null):null; }
function serOf(c){ return c&&c.series_id?serById(c.series_id):null; }
function serMembersOf(sid){ return cachedCourses.filter(c=>c.series_id===sid).sort((a,b)=>(a.series_order||0)-(b.series_order||0)); }
function serRerender(){ const mc=document.getElementById('mainContent'); if(typeof curPage!=='undefined'&&curPage==='coursecleanup'&&typeof renderCourseCleanupPage==='function') renderCourseCleanupPage(mc); else renderCoursesPage(mc); }
function serModeLabel(m){ return m==='split'?'同日分段':m==='mixed'?'接续＋同日分段':'接续'; }
// 接续＋同日分段：时段（上课时间）相同的成员接续排成一条线，时段不同的线同一天并行
function serLaneKey(tr){ return normalizeTimeRanges(tr||'').replace(/\s+/g,''); }
function serChained(s){ return !!s&&(s.mode==='chain'||s.mode==='mixed'); }
// 休讲顺延时，课 c 后面要跟着挪的成员：接续＝后面全部；混合＝后面同一时段的；同日分段＝没有
function serLaneLater(s,c){
  const ms=serMembersOf(s.id), later=ms.slice(ms.findIndex(x=>x.id===c.id)+1);
  if(s.mode==='mixed') return later.filter(m=>serLaneKey(m.time_range)===serLaneKey(c.time_range));
  return s.mode==='chain'?later:[];
}
function serNewId(p){ return `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }
function serMD(d){ return d?`${+d.slice(5,7)}/${+d.slice(8,10)}`:''; }
function serActive(cid){ return cachedSessions.filter(s=>s.course_id===cid&&!s.is_cancelled&&s.session_date).sort((a,b)=>a.session_date.localeCompare(b.session_date)||((a.session_number||0)-(b.session_number||0))); }
// 已经开课（阶段二）：和课程编辑弹窗同一个判断——有单回已经过了日期 / 休讲过 / 单独调整过
function serStarted(c){
  const today=acToday(), ss=cachedSessions.filter(s=>s.course_id===c.id);
  if(!ss.length) return false;
  return !ss.every(s=>s.session_date>=today&&!s.is_cancelled&&!s.orig_date&&!s.orig_time_range);
}
// 课程卡片标题后面的小标签
function serTagHtml(c){
  const s=serOf(c); if(!s) return '';
  const ms=serMembersOf(s.id), idx=ms.findIndex(x=>x.id===c.id)+1;
  return `<span onclick="serOpen('${s.id}')" title="点击编辑系列（${serModeLabel(s.mode)}）" style="font-size:10px;cursor:pointer;background:rgba(0,0,0,.12);border-radius:2px;padding:1px 7px">⛓ ${escTM(s.name)} · 第 ${idx||'?'} 门 / 共 ${ms.length} 门</span>`;
}

// ── 日期怎么算 ──
function serFrameOf(d){ return { first_session_date:d.first||'', weekdays:d.weekdays||'', skip_dates:'', holiday_except:[...(d.except||[])].sort().join(',') }; }
// 返回 { members:[{dates,time_range}], hits, err }
function serPlan(d){
  const out={ members:[], hits:[], err:'' }, f=serFrameOf(d), ms=d.members;
  if(!ms.length){ out.err='还没有成员'; return out; }
  if(!f.first_session_date||!f.weekdays){ out.err='请先填第一回日期和星期'; return out; }
  if(!courseWdList(f.weekdays).length){ out.err='星期不对'; return out; }
  if(d.mode==='chain'){
    if(ms.some(m=>!(m.total>0))){ out.err='每门课的回数都要填（至少 1 回）'; return out; }
    const total=ms.reduce((a,m)=>a+m.total,0), sc=courseScan(f,{total});
    out.hits=sc.hits;
    if(sc.dates.length<total){ out.err=`按这个星期只排出 ${sc.dates.length} 回（需要 ${total} 回），请检查星期或假期`; return out; }
    let i=0; ms.forEach(m=>{ out.members.push({ dates:sc.dates.slice(i,i+m.total), time_range:d.time_range||'' }); i+=m.total; });
  } else if(d.mode==='mixed'){
    if(ms.some(m=>!(m.total>0))){ out.err='每门课的回数都要填（至少 1 回）'; return out; }
    if(ms.some(m=>!serLaneKey(m.tr))){ out.err='每门课都要填时段（时段相同的接续排，不同的同一天并行）'; return out; }
    const lanes=new Map(), hitMap={};
    ms.forEach((m,i)=>{ const k=serLaneKey(m.tr); if(!lanes.has(k)) lanes.set(k,[]); lanes.get(k).push(i); });
    out.members=ms.map(()=>null);
    for(const [k,idx] of lanes.entries()){
      const total=idx.reduce((a,i)=>a+ms[i].total,0), sc=courseScan(f,{total});
      sc.hits.forEach(h=>{ hitMap[h.date]=h; });
      if(sc.dates.length<total){ out.err=`时段 ${k} 按这个星期只排出 ${sc.dates.length} 回（需要 ${total} 回），请检查星期或假期`; return out; }
      let n=0; idx.forEach(i=>{ out.members[i]={ dates:sc.dates.slice(n,n+ms[i].total), time_range:ms[i].tr }; n+=ms[i].total; });
    }
    out.hits=Object.keys(hitMap).sort().map(k=>hitMap[k]);
  } else {
    if(!(d.total>0)){ out.err='请填回数（每门课一样）'; return out; }
    const sc=courseScan(f,{total:d.total});
    out.hits=sc.hits;
    if(sc.dates.length<d.total){ out.err=`按这个星期只排出 ${sc.dates.length} 回（需要 ${d.total} 回），请检查星期或假期`; return out; }
    ms.forEach(m=>out.members.push({ dates:sc.dates.slice(), time_range:m.tr||'' }));
  }
  return out;
}
// 同日分段：时段有没有重叠 / 格式不对。返回提示文字（空 = 没问题）
function serTrProblems(d){
  if(d.mode!=='split'&&d.mode!=='mixed') return '';
  let spans=d.members.map(m=>{ const p=timeRangesSpan(m.tr||''); return { m, a:_trMin(p.start), b:_trMin(p.end), k:serLaneKey(m.tr) }; });
  const bad=spans.filter(x=>x.a==null||x.b==null||x.b<=x.a);
  if(bad.length) return '有成员的时段没填或格式不对（要「开始-结束」，如 10:00-12:00）';
  if(d.mode==='mixed'){ const seen=new Set(); spans=spans.filter(x=>{ if(seen.has(x.k)) return false; seen.add(x.k); return true; }); }   // 同一时段 = 同一条线，不算重叠
  const sorted=spans.slice().sort((x,y)=>x.a-y.a);
  for(let i=1;i<sorted.length;i++) if(sorted[i].a<sorted[i-1].b) return `时段有重叠：${sorted[i-1].m.name||'?'}（${sorted[i-1].m.tr}）和 ${sorted[i].m.name||'?'}（${sorted[i].m.tr}）`;
  return '';
}
function serFmtMin(n){ return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
// 同日分段：默认从上一门结束的时间开始，时长和上一门一样
function serNextTr(prevTr){
  const p=timeRangesSpan(prevTr||''), a=_trMin(p.start), b=_trMin(p.end);
  if(a==null||b==null||b<=a) return '';
  return serFmtMin(b)+'-'+serFmtMin(b+(b-a));
}

// ── 弹窗 ──
function serOpen(id,pre){
  const s=id?serById(id):null;
  if(id&&!s){ alert('找不到这个系列'); return; }
  if(!HOLIDAYS.length&&typeof loadHolidaysFromDB==='function') loadHolidaysFromDB().then(()=>{ if(SER) serDrawPreview(); }).catch(()=>{});
  if(s){
    const ms=serMembersOf(s.id), first=ms[0]||{};
    const act0=ms.map(m=>serActive(m.id));
    SER={ id:s.id, name:s.name||'', mode:s.mode||'chain', major:(s.major&&s.major[0])||(ms[0]&&ms[0].major&&ms[0].major[0])||'',
      first:s.first_session_date||first.first_session_date||'', weekdays:s.weekdays||first.weekdays||'',
      campus:s.campus||first.campus||'', delivery:first.delivery||'', time_range:s.time_range||first.time_range||'',
      except:new Set((s.holiday_except||'').split(',').map(x=>x.trim()).filter(Boolean)),
      total:s.mode==='split'?(act0[0]?act0[0].length:(first.total_sessions||0)):0,
      members:ms.map((m,i)=>({ key:'m'+i, cid:m.id, name:m.name||'', teacher:m.teacher||'', total:act0[i].length||m.total_sessions||0, cur:act0[i].length, tr:m.time_range||'' })),
      phase2:ms.some(serStarted), picking:false, pickQ:'' };
  } else {
    SER={ id:'', name:'', mode:'chain', major:'', first:'', weekdays:'', campus:'', delivery:'', time_range:'', except:new Set(), total:5, members:[], phase2:false, picking:false, pickQ:'' };
    if(typeof viewLockDomain==='function'&&CURRENT_MAJOR) SER.major=CURRENT_MAJOR;
  }
  if(pre) Object.assign(SER,pre);
  SER.seq=SER.members.length;
  serDraw();
}
function serClose(){ const o=document.getElementById('serOv'); if(o) o.remove(); SER=null; }

const SER_INP='font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit';
function serChip(on,label,fn,dis){ return `<span class="filter-chip${on?' active':''}" ${dis?'':`onclick="${fn}"`} style="font-size:12px;padding:4px 12px;${dis?'opacity:.5;cursor:not-allowed':'cursor:pointer'}">${escTM(label)}</span>`; }
function serLbl(t){ return `<div style="font-size:10px;color:var(--text-3);margin:10px 0 4px">${t}</div>`; }

function serDraw(){
  if(!SER) return;
  const d=SER, lock=d.phase2, lockMem=!!d.members.some(m=>m.cid);
  const old=document.getElementById('serOv'), prevScroll=old&&old.querySelector('#serBody')?old.querySelector('#serBody').scrollTop:0;
  const ov=ccOverlay('serOv');
  const majors=majorFilterKeys().filter(k=>!(typeof isMajorGroup==='function'&&isMajorGroup(k)));
  const wds=['周一','周二','周三','周四','周五','周六','周日'], curWd=new Set(parseWeekdays(d.weekdays));
  const campusChips=CAMPUS_OPTS.map(o=>serChip(d.campus===o.value,o.label,`serSet('campus','${o.value}')`,lock)).join('');
  ov.innerHTML=`<div style="${CC_BOX};max-width:760px">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">${d.id?'编辑系列':'新建系列课'}${d.id?`<span style="font-size:11px;font-weight:400;color:var(--text-3);margin-left:8px">${serModeLabel(d.mode)}</span>`:''}</div>
    <div id="serBody" style="padding:6px 18px 12px;overflow:auto;flex:1">
      ${lock?`<div style="background:#fff1e0;border:1px solid #f0c48a;color:#8a4b0a;border-radius:3px;padding:7px 10px;margin-top:8px;font-size:12px;line-height:1.7">这个系列已经开课：框架（第一回日期 / 星期 / 时间 / 排法）不能在这里改，请在单回里调整，或用「休讲」调整。这里只能改系列名，和每门课的回数（只在这门课末尾加减，接续时后面的课整体往后推 / 往前收，确认前会列出变化）。</div>`:''}
      ${serLbl('系列名')}<input id="serName" value="${escTM(d.name)}" oninput="SER.name=this.value" placeholder="如：社会学专业课" style="${SER_INP};width:100%">
      ${serLbl('专业（单选；系列里的课只限同一个专业）')}<div style="display:flex;flex-wrap:wrap;gap:5px">${majors.map(k=>serChip(d.major===k,majorLabel(k),`serSet('major','${k}')`,lock||lockMem)).join('')||'<span style="color:var(--text-3)">没有可选专业</span>'}</div>
      ${serLbl('排法')}<div style="display:flex;gap:5px;align-items:center">${serChip(d.mode==='chain','接续',"serSet('mode','chain')",lock)}${serChip(d.mode==='split','同日分段',"serSet('mode','split')",lock)}${serChip(d.mode==='mixed','接续＋同日分段',"serSet('mode','mixed')",lock)}<span style="font-size:11px;color:var(--text-3);margin-left:6px">${d.mode==='chain'?'A 的回次全部上完，接着 B，再接着 C：同一个星期、同一个时间，日期一路往下排':d.mode==='split'?'同一天按时间段切开：每门课回数、日期都一样，时间不同':'每门课填时段和回数：时段相同的接续排（先 A 后 B），时段不同的同一天并行'}</span></div>
      ${serLbl('框架')}
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">第一回日期</div><input type="date" id="serFirst" value="${escTM(d.first)}" ${lock?'disabled':''} onchange="SER.first=this.value;serDrawMembers()" style="${SER_INP}"></div>
        ${d.mode==='mixed'?'':d.mode==='chain'?`<div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">上课时间（所有成员共用）</div><input id="serTr" value="${escTM(d.time_range)}" ${lock?'disabled':''} oninput="SER.time_range=this.value;serDrawPreview()" placeholder="14:00-18:00" style="${SER_INP};width:150px"></div>`
          :`<div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">回数（每门课一样）</div><input type="number" min="1" id="serTotal" value="${d.total||''}" ${lock?'disabled':''} oninput="SER.total=parseInt(this.value)||0;serDrawPreview()" style="${SER_INP};width:80px"></div>`}
      </div>
      ${serLbl('星期')}<div style="display:flex;flex-wrap:wrap;gap:5px">${wds.map(w=>serChip(curWd.has(parseWeekdays(w)[0]),w,`serToggleWd('${w}')`,lock)).join('')}</div>
      ${serLbl('校区')}<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">${campusChips}
        <select id="serDelivery" ${lock?'disabled':''} onchange="SER.delivery=this.value" style="${SER_INP};margin-left:8px"><option value="">上课方式</option>${['线下','线上','线下＋线上'].map(x=>`<option${d.delivery===x?' selected':''}>${x}</option>`).join('')}</select></div>
      ${serLbl(`成员（${d.members.length} 门，可上下拖动排顺序）`)}
      <div id="serMembers"></div>
      <div id="serPick"></div>
      ${lock?'':`<div style="margin-top:8px;display:flex;gap:6px"><button type="button" class="btn btn-outline btn-sm" onclick="serAddNew()">＋ 新建一门课</button><button type="button" class="btn btn-outline btn-sm" onclick="serTogglePick()">＋ 选已有的课</button></div>`}
      ${serLbl('预览')}
      <div id="serPreview"></div>
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;align-items:center">
      ${d.id?`<button type="button" class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none;cursor:pointer" onclick="serDissolve()">解散系列</button><button type="button" class="btn btn-outline btn-sm" style="cursor:pointer" onclick="serSaveTemplate()">存为系列模板</button>`:''}
      <span style="flex:1"></span>
      <button type="button" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer" onclick="serClose()">取消</button>
      <button type="button" id="serSaveBtn" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer" onclick="serSave()">保存</button>
    </div></div>`;
  serDrawMembers();
  const b=document.getElementById('serBody'); if(b) b.scrollTop=prevScroll;
}
function serSet(k,v){
  if(!SER) return;
  if(k==='campus'){ SER.campus=v; const o=CAMPUS_OPTS.find(x=>x.value===v); if(o) SER.delivery=o.delivery; }
  else if(k==='mode'){
    if(SER.mode===v) return;
    const was=SER.mode; SER.mode=v;
    if(v==='mixed'){ SER.members.forEach(m=>{ if(!m.tr) m.tr=(was==='chain'?SER.time_range:'')||''; }); }
    if(was==='mixed'&&v==='chain'&&!SER.time_range&&SER.members[0]) SER.time_range=SER.members[0].tr||'';
    if(v==='split'){ let prev=''; SER.members.forEach(m=>{ if(!m.tr) m.tr=prev?serNextTr(prev):''; prev=m.tr; }); if(!SER.total) SER.total=SER.members[0]&&SER.members[0].total||5; }
  }
  else SER[k]=v;
  serDraw();
}
function serToggleWd(w){
  const cur=new Set(parseWeekdays(SER.weekdays)), n=parseWeekdays(w)[0];
  if(cur.has(n)) cur.delete(n); else cur.add(n);
  const order=['周一','周二','周三','周四','周五','周六','周日'];
  SER.weekdays=order.filter(x=>cur.has(parseWeekdays(x)[0])).join(',');
  serDraw();
}
function serToggleExcept(date){ if(SER.except.has(date)) SER.except.delete(date); else SER.except.add(date); serDrawPreview(); }

// ── 成员 ──
function serAddNew(){
  if(!SER) return;
  const prev=SER.members[SER.members.length-1];
  SER.members.push({ key:'m'+(SER.seq++), cid:'', name:'', teacher:'', total:5, cur:0, tr:SER.mode==='split'?serNextTr(prev&&prev.tr):(SER.mode==='mixed'&&prev?prev.tr:'') });
  serDraw();
}
function serTogglePick(){ SER.picking=!SER.picking; SER.pickQ=''; serDrawPick(); }
function serPickCands(){
  const inList=new Set(SER.members.map(m=>m.cid).filter(Boolean)), q=(SER.pickQ||'').trim().toLowerCase();
  return cachedCourses.filter(c=>!inList.has(c.id)&&(!c.series_id||c.series_id===SER.id)&&(!SER.major||(c.major||[]).length===1&&c.major[0]===SER.major||(c.major||[]).includes(SER.major)))
    .filter(c=>!q||((c.name||'')+(c.teacher||'')).toLowerCase().includes(q))
    .sort((a,b)=>(b.first_session_date||'').localeCompare(a.first_session_date||''));
}
function serDrawPick(){
  const box=document.getElementById('serPick'); if(!box) return;
  if(!SER.picking){ box.innerHTML=''; return; }
  if(!SER.major){ box.innerHTML='<div style="margin-top:8px;font-size:12px;color:#8a4b0a">请先选专业，再选已有的课（只列同专业的课）</div>'; return; }
  const list=serPickCands(), shown=list.slice(0,30);
  box.innerHTML=`<div style="margin-top:8px;border:1px solid var(--border);border-radius:3px;padding:8px">
    <input id="serPickQ" value="${escTM(SER.pickQ)}" placeholder="搜索课名 / 老师" oninput="SER.pickQ=this.value;serPickRefresh()" style="${SER_INP};width:100%;margin-bottom:6px">
    <div id="serPickList"></div></div>`;
  serPickRefresh();
}
function serPickRefresh(){
  const el=document.getElementById('serPickList'); if(!el) return;
  const list=serPickCands(), shown=list.slice(0,30);
  el.innerHTML=shown.length?shown.map(c=>{
    const st=serStarted(c);
    return `<div onclick="serPickUse('${c.id}')" style="display:flex;gap:8px;padding:5px 6px;border-bottom:1px solid var(--border-light);cursor:pointer;font-size:12px;${st?'color:var(--text-3)':''}">
      <span style="flex:1">${escTM(c.name)}${c.teacher?` · ${escTM(c.teacher)}`:''}</span><span style="color:var(--text-3)">${escTM(c.first_session_date||'')} · ${c.total_sessions||'?'} 回${st?' · 已开课':''}</span></div>`;
  }).join('')+(list.length>shown.length?`<div style="font-size:11px;color:var(--text-3);padding:4px">还有 ${list.length-shown.length} 门，请用搜索缩小范围</div>`:''):'<div style="font-size:12px;color:var(--text-3)">没有可加入的课（只列同专业、还没在别的系列里的课）</div>';
}
function serPickUse(cid){
  const c=cachedCourses.find(x=>x.id===cid); if(!c) return;
  if(serStarted(c)){ alert('这门课已经开课，不能加入系列重排'); return; }
  const prev=SER.members[SER.members.length-1];
  SER.members.push({ key:'m'+(SER.seq++), cid:c.id, name:c.name||'', teacher:c.teacher||'', total:c.total_sessions||5, cur:serActive(c.id).length, tr:SER.mode==='split'?(c.time_range||serNextTr(prev&&prev.tr)):(SER.mode==='mixed'?(c.time_range||''):'') });
  if(!SER.name) SER.name=c.name||'';
  SER.picking=false; serDraw();
}
function serRemoveMember(i){
  const m=SER.members[i]; if(!m) return;
  if(m.cid&&SER.id&&!confirm(`把《${m.name}》移出系列？课和单回都不动。`)) return;
  SER.members.splice(i,1); serDraw();
}
function serMoveMember(i,dir){ const j=i+dir; if(j<0||j>=SER.members.length) return; const t=SER.members[i]; SER.members[i]=SER.members[j]; SER.members[j]=t; serDraw(); }
let serDragFrom=-1;
function serDragStart(i,ev){ serDragFrom=i; try{ ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain',String(i)); }catch(e){} }
function serDrop(i,ev){
  ev.preventDefault(); const from=serDragFrom; serDragFrom=-1;
  if(from<0||from===i||!SER.members[from]) return;
  const [m]=SER.members.splice(from,1); SER.members.splice(i,0,m); serDraw();
}
function serSetMember(i,k,v){
  const m=SER.members[i]; if(!m) return;
  if(k==='total') m.total=parseInt(v)||0; else m[k]=v;
  serDrawPreview();
}
function serDrawMembers(){
  const box=document.getElementById('serMembers'); if(!box||!SER) return;
  const d=SER, lock=d.phase2;
  if(!d.members.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-3);padding:6px 0">还没有成员：点下面「新建一门课」或「选已有的课」</div>'; serDrawPreview(); return; }
  box.innerHTML=d.members.map((m,i)=>{
    const ex=!!m.cid;
    return `<div ${lock?'':`draggable="true" ondragstart="serDragStart(${i},event)" ondragover="event.preventDefault()" ondrop="serDrop(${i},event)"`} style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;margin-bottom:5px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">
      <span style="color:var(--text-3);${lock?'':'cursor:grab'}" title="拖动排顺序">${lock?'':'☰ '}${i+1}</span>
      ${ex?`<span style="font-size:12px;font-weight:600;min-width:120px">${escTM(m.name)}</span><span style="font-size:11px;color:var(--text-3)">${escTM(m.teacher||'')}（已有的课）</span>`
        :`<input value="${escTM(m.name)}" oninput="serSetMember(${i},'name',this.value)" placeholder="课名" style="${SER_INP};width:150px"><input value="${escTM(m.teacher)}" oninput="serSetMember(${i},'teacher',this.value)" placeholder="老师" style="${SER_INP};width:90px">`}
      ${d.mode!=='split'?`<span style="font-size:11px;color:var(--text-3)">回数</span><input type="number" min="1" value="${m.total||''}" oninput="serSetMember(${i},'total',this.value)" style="${SER_INP};width:60px">`:''}
      ${d.mode!=='chain'?`<span style="font-size:11px;color:var(--text-3)">时段</span><input value="${escTM(m.tr||'')}" ${lock?'disabled':''} oninput="serSetMember(${i},'tr',this.value)" placeholder="10:00-12:00" style="${SER_INP};width:120px">`:''}
      <span style="flex:1"></span>
      ${lock?'':`<span class="filter-chip" onclick="serMoveMember(${i},-1)" style="cursor:pointer;font-size:11px;padding:2px 8px">▲</span><span class="filter-chip" onclick="serMoveMember(${i},1)" style="cursor:pointer;font-size:11px;padding:2px 8px">▼</span><span class="filter-chip" onclick="serRemoveMember(${i})" style="cursor:pointer;font-size:11px;padding:2px 8px;color:var(--danger)">移除</span>`}
    </div>`;
  }).join('');
  serDrawPick(); serDrawPreview();
}
// 预览：每门课的日期
function serDrawPreview(){
  const box=document.getElementById('serPreview'); if(!box||!SER) return;
  const d=SER;
  if(d.phase2){
    box.innerHTML=`<div style="font-size:12px;color:var(--text-2)">${d.members.map((m,i)=>`${escTM(m.name)}：现在 ${m.cur} 回${m.total!==m.cur?` → 改成 ${m.total} 回`:''}`).join('<br>')}</div>`; return;
  }
  const p=serPlan(d), tp=serTrProblems(d);
  if(p.err){ box.innerHTML=`<div style="font-size:12px;color:var(--text-3)">${escTM(p.err)}</div>`+(tp?`<div style="font-size:12px;color:#a33;margin-top:4px">${escTM(tp)}</div>`:''); return; }
  let html='';
  if(d.mode==='mixed'){
    const lanes=new Map(); d.members.forEach((m,i)=>{ const k=serLaneKey(m.tr); if(!lanes.has(k)) lanes.set(k,[]); lanes.get(k).push(i); });
    html+=`<div style="font-size:12px;line-height:1.9">${[...lanes.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,idx])=>`<b>${escTM(k)}</b>：`+idx.map(i=>`${escTM(d.members[i].name||'（未命名）')} ${serMD(p.members[i].dates[0])}～${serMD(p.members[i].dates[p.members[i].dates.length-1])}（${p.members[i].dates.length} 回）`).join(' <span style="color:var(--text-3)">→</span> ')).join('<br>')}</div>`;
  } else if(d.mode==='chain'){
    html+=`<div style="font-size:12px;line-height:1.9">${p.members.map((pm,i)=>`${escTM(d.members[i].name||'（未命名）')} <b>${serMD(pm.dates[0])}～${serMD(pm.dates[pm.dates.length-1])}</b>（${pm.dates.length} 回）`).join(' <span style="color:var(--text-3)">→</span> ')}</div>`;
  } else {
    const ds=p.members[0].dates;
    html+=`<div style="font-size:12px;line-height:1.9">每回：${d.members.map(m=>`<b>${escTM(m.tr||'?')}</b> ${escTM(m.name||'（未命名）')}`).join('、')}</div>
      <div style="font-size:11px;color:var(--text-3)">共 ${ds.length} 回：${ds.map(serMD).join('、')}</div>`;
  }
  html+=`<div style="margin-top:8px">${courseHitsHtml(p.hits,'serToggleExcept')}</div>`;
  if(tp) html+=`<div style="font-size:12px;color:#a33;margin-top:4px">${escTM(tp)}</div>`;
  box.innerHTML=html;
}

// ── 保存 ──
function serCheck(d){
  if(!(d.name||'').trim()) return '请填系列名';
  if(!d.major) return '请选专业';
  if(!d.members.length) return '至少要有一门课';
  if(d.members.some(m=>!(m.name||'').trim())) return '每门课都要有课名';
  if(d.phase2) return '';
  if(!d.campus) return '请选校区';
  if(d.mode==='chain'&&!(d.time_range||'').trim()) return '接续：请填上课时间（所有成员共用）';
  if(d.mode==='mixed'&&d.members.some(m=>!(m.total>0))) return '每门课的回数都要填';
  const tp=serTrProblems(d); if(tp) return tp;
  const p=serPlan(d); if(p.err) return p.err;
  return '';
}
async function serSave(){
  const d=SER; if(!d) return;
  const err=serCheck(d); if(err){ alert(err); return; }
  const btn=document.getElementById('serSaveBtn'); if(btn){ btn.disabled=true; btn.textContent='保存中…'; }
  try{
    if(d.phase2) await serSavePhase2(d); else await serSavePhase1(d);
  }catch(e){ if(e.message!=='__cancel__') alert('保存失败：'+e.message); if(btn){ btn.disabled=false; btn.textContent='保存'; } }
}
// 阶段一：系列还没开课——写系列，所有成员的框架和单回按系列重排
async function serSavePhase1(d){
  const plan=serPlan(d), tNorm=normalizeTimeRanges;
  const sid=d.id||serNewId('ser');
  const row={ name:d.name.trim(), mode:d.mode, major:[d.major], first_session_date:d.first, weekdays:d.weekdays,
    time_range:d.mode==='chain'?tNorm(d.time_range):null, campus:d.campus, holiday_except:[...d.except].sort().join(',')||null };
  // 被移出系列的老成员
  const keep=new Set(d.members.map(m=>m.cid).filter(Boolean));
  const dropped=d.id?serMembersOf(d.id).filter(c=>!keep.has(c.id)):[];
  if(d.id) await sb(`/rest/v1/course_series?id=eq.${encodeURIComponent(sid)}`,'PATCH',row);
  else { const r=await sb('/rest/v1/course_series','POST',[Object.assign({id:sid},row)]); cachedSeries.unshift(Array.isArray(r)&&r[0]?r[0]:Object.assign({id:sid},row)); }
  if(d.id){ const i=cachedSeries.findIndex(x=>x.id===sid); if(i>=0) cachedSeries[i]=Object.assign({},cachedSeries[i],row); }
  for(const c of dropped){
    await sb(`/rest/v1/courses?id=eq.${encodeURIComponent(c.id)}`,'PATCH',{series_id:null,series_order:null});
    c.series_id=null; c.series_order=null;
  }
  const items=[];
  for(let i=0;i<d.members.length;i++){
    const m=d.members[i], pm=plan.members[i];
    const c=await serWriteMember({ sid, order:i+1, d, m, dates:pm.dates, tr:pm.time_range?tNorm(pm.time_range):'' });
    items.push({ course:c, dates:pm.dates });
  }
  serClose();
  serRerender();
  courseConfirmOpen({ title:`系列「${d.name.trim()}」已保存，请核对`, onEdit:openAddCourseModal, items });
}
// 写一门成员课：课程行 + 单回。已有课按先后保留 id / 标题 / 老师；新课新建
async function serWriteMember(o){
  const { sid, order, d, m, dates, tr } = o;
  const first=dates[0], last=dates[dates.length-1];
  const hours=timeRangesHours(tr)||null;
  const ex=m.cid?cachedCourses.find(x=>x.id===m.cid):null;
  const frame={ weekdays:d.weekdays, time_range:tr, campus:d.campus, delivery:d.delivery||(ex&&ex.delivery)||'', holiday_except:[...d.except].sort().join(',')||null,
    total_sessions:dates.length, first_session_date:first, start_date:first, end_date:last, series_id:sid, series_order:order };
  let course, existing=[];
  if(ex){
    const patch=Object.assign({},frame);
    if(hours) patch.actual_hours=hours;
    if(ex.period_auto||!ex.period){ const name=autoPeriodOf(first,last); Object.assign(patch,{ period:/^\d{4}年\d{1,2}月$/.test(name)?stripPeriodYear(name):periodFromDate(first), period_override:name, period_auto:true }); }
    await sb(`/rest/v1/courses?id=eq.${encodeURIComponent(ex.id)}`,'PATCH',patch);
    Object.assign(ex,patch); course=ex;
    existing=cachedSessions.filter(s=>s.course_id===ex.id);
  } else {
    const name=autoPeriodOf(first,last);
    const nc=withCourseDomain(Object.assign({
      id:serNewId('c'), name:m.name.trim(), major:[d.major], course_type:m.course_type||'专业课', teacher:(m.teacher||'').trim(),
      actual_hours:hours, homework_enabled:!!m.homework_enabled, has_details:false,
      period:/^\d{4}年\d{1,2}月$/.test(name)?stripPeriodYear(name):periodFromDate(first), period_override:name, period_auto:true,
    },frame),[d.major]);
    const r=await sb('/rest/v1/courses','POST',[nc]);
    course=Array.isArray(r)&&r[0]?r[0]:nc; cachedCourses.push(course);
  }
  await serWriteSessions(course, dates, tr, existing, m.detail_rows||null, m.teacher);
  return course;
}
async function serWriteSessions(course, dates, tr, existing, detailRows, teacherName){
  const act=existing.filter(s=>!s.is_cancelled).sort((a,b)=>(a.session_date||'').localeCompare(b.session_date||'')||((a.session_number||0)-(b.session_number||0)));
  const cancelled=existing.filter(s=>s.is_cancelled);
  const single=acSingleTeacher(course.teacher||teacherName||'');
  const confirmed=existing[0]?!!existing[0].confirmed:false;
  const hours=timeRangesHours(tr)||course.actual_hours||null;
  const news=[];
  for(let i=0;i<dates.length;i++){
    const s=act[i];
    if(s){
      const patch={ course_name:course.name, major:course.major, session_date:dates[i], session_number:i+1, time_range:tr, actual_hours:hours, delivery:course.delivery, campus:course.campus };
      await sb(`/rest/v1/course_sessions?id=eq.${encodeURIComponent(s.id)}`,'PATCH',patch);
      Object.assign(s,patch);
    } else {
      const dr=detailRows?(detailRows.find(r=>r.num===i+1)||{}):{};
      const tv=dr.teacher||single||'';
      news.push({ id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,5)}`, course_id:course.id, course_name:course.name, major:course.major,
        session_date:dates[i], session_number:i+1, time_range:tr, actual_hours:hours, delivery:course.delivery, campus:course.campus,
        teacher:tv, session_teacher:tv, session_title:dr.title||'', confirmed,
        homework_questions:dr.homework_questions||null, homework_note:dr.homework_note||null,
        homework_enabled:!!dr.homework_questions||course.homework_enabled||false });
    }
  }
  const surplus=act.slice(dates.length);
  if(surplus.length){
    const ids=surplus.map(s=>`"${s.id}"`).join(',');
    const recs=await sb(`/rest/v1/session_records?session_id=in.(${ids})&select=id`).catch(()=>[]);
    if(recs&&recs.length) throw new Error(`《${course.name}》要删掉的课次已有出席 / 作业记录，不能删。请先处理，或减少回数的改动`);
    await sb(`/rest/v1/course_sessions?id=in.(${ids})`,'DELETE');
    cachedSessions=cachedSessions.filter(s=>!surplus.some(x=>x.id===s.id));
  }
  for(let i=0;i<news.length;i+=20){
    const chunk=news.slice(i,i+20), r=await sb('/rest/v1/course_sessions','POST',chunk);
    cachedSessions.push(...(Array.isArray(r)?r:chunk));
  }
  void cancelled;
}

// ── 阶段二：已经开课 ──
// 系列的「上课日」：星期 + 跳过全局假期（豁免的除外）+ 各成员的休讲日
function serDayCtx(sid){
  const s=serById(sid)||{}, ms=serMembersOf(sid);
  const wd=new Set(courseWdList(s.weekdays||(ms[0]&&ms[0].weekdays)||''));
  const except=new Set(), skip=new Set();
  [s.holiday_except].concat(ms.map(c=>c.holiday_except)).forEach(v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>except.add(x)));
  ms.forEach(c=>String(c.skip_dates||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>skip.add(x)));
  return { wd, except, skip };
}
function serDayOk(ctx,d){
  const dt=new Date(d+'T12:00:00');
  if(!ctx.wd.has(dt.getDay())) return false;
  if(ctx.skip.has(d)) return false;
  const h=holidayOn(d); if(h&&!ctx.except.has(d)) return false;
  return true;
}
// 从 date 起往后（n>0）/ 往前（n<0）走 |n| 个上课日；date 本身不算
function serStep(ctx,date,n){
  const dir=n>=0?1:-1; let left=Math.abs(n), d=date, g=0;
  if(!ctx.wd.size) return date;
  while(left>0&&g++<800){
    const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+dir);
    d=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    if(serDayOk(ctx,d)) left--;
  }
  return d;
}
// 把一批课的正常回次整体移动 n 个上课日（n>0 往后）。返回 [{course, s, from, to}]
function serPlanShift(ctx,courses,n){
  const out=[];
  courses.forEach(c=>serActive(c.id).forEach(s=>out.push({ course:c, s, from:s.session_date, to:serStep(ctx,s.session_date,n) })));
  return out;
}
async function serApplyShift(moves){
  // 往后移从最后一回开始，往前移从第一回开始，避免中间状态两回撞在同一天
  const fwd=moves.length&&moves[0].to>moves[0].from;
  const order=moves.slice().sort((a,b)=>fwd?b.from.localeCompare(a.from):a.from.localeCompare(b.from));
  for(const mv of order){
    await sb(`/rest/v1/course_sessions?id=eq.${encodeURIComponent(mv.s.id)}`,'PATCH',{session_date:mv.to});
    mv.s.session_date=mv.to;
  }
  const cs=[...new Set(moves.map(m=>m.course))];
  for(const c of cs) await serSyncCourseDates(c,true);
}
// 课程的开始 / 结束日期跟着正常回次走；frame=true 时第一回日期（框架）也跟着
async function serSyncCourseDates(c,frame){
  const ds=serActive(c.id).map(s=>s.session_date).sort();
  if(!ds.length) return;
  const patch={ start_date:ds[0], end_date:ds[ds.length-1], total_sessions:ds.length };
  if(frame) patch.first_session_date=ds[0];
  await sb(`/rest/v1/courses?id=eq.${encodeURIComponent(c.id)}`,'PATCH',patch);
  Object.assign(c,patch);
}
function serMovesText(moves){
  const byC=new Map();
  moves.forEach(m=>{ if(!byC.has(m.course)) byC.set(m.course,[]); byC.get(m.course).push(m); });
  return [...byC.entries()].map(([c,ms])=>{
    ms.sort((a,b)=>a.from.localeCompare(b.from));
    const nums=ms.map(m=>m.s.session_number||'?');
    return `${c.name} 第 ${nums[0]}～${nums[nums.length-1]} 回整体${ms[0].to>ms[0].from?'后移':'前移'}：${ms.slice(0,3).map(m=>serMD(m.from)+'→'+serMD(m.to)).join('、')}${ms.length>3?' …':''}`;
  });
}
async function serSavePhase2(d){
  const s=serById(d.id), ms=serMembersOf(d.id);
  const ctx=serDayCtx(d.id), today=acToday();
  const lines=[], ops=[];   // ops：真正要执行的 [async fn]
  const moveAll=[];
  for(let i=0;i<ms.length;i++){
    const c=ms[i], want=d.members.find(m=>m.cid===c.id)?.total||0, act=serActive(c.id), cur=act.length, delta=want-cur;
    if(!delta||want<1) { if(want<1) throw new Error(`《${c.name}》回数至少 1 回`); continue; }
    if(delta>0){
      const lastD=act[act.length-1]?act[act.length-1].session_date:c.first_session_date;
      const news=[]; let cd=lastD;
      for(let k=0;k<delta;k++){ cd=serStep(ctx,cd,1); news.push(cd); }
      lines.push(`${c.name}：末尾加 ${delta} 回（${news.map(serMD).join('、')}）`);
      const later=serLaneLater(s,c);
      const mv=serPlanShift(ctx,later,delta); mv.forEach(x=>moveAll.push(x));
      if(mv.length) lines.push(...serMovesText(mv).map(t=>'　'+t));
      ops.push({ kind:'add', c, news, act, mv });
    } else {
      const k=-delta, tail=act.slice(cur-k);
      const bad=tail.find(s2=>s2.session_date<today);
      if(bad) throw new Error(`《${c.name}》第 ${bad.session_number} 回已经上过，不能删。回数最少是 ${act.filter(s2=>s2.session_date<today).length||1}`);
      const recs=await sb(`/rest/v1/session_records?session_id=in.(${tail.map(x=>`"${x.id}"`).join(',')})&select=id`).catch(()=>[]);
      if(recs&&recs.length) throw new Error(`《${c.name}》末尾要删的回次已有出席 / 作业记录，不能删`);
      lines.push(`${c.name}：末尾删 ${k} 回（${tail.map(x=>serMD(x.session_date)).join('、')}）`);
      const later=serLaneLater(s,c);
      const mv=serPlanShift(ctx,later,-k); mv.forEach(x=>moveAll.push(x));
      if(mv.length) lines.push(...serMovesText(mv).map(t=>'　'+t));
      ops.push({ kind:'del', c, tail, mv });
    }
  }
  const nameChanged=(d.name||'').trim()!==(s.name||'');
  if(!ops.length&&!nameChanged){ alert('没有改动'); serClose(); return; }
  if(ops.length&&!confirm('系列已经开课，这次会改这些：\n\n'+lines.join('\n')+'\n\n确定吗？')) throw new Error('__cancel__');
  if(nameChanged){ await sb(`/rest/v1/course_series?id=eq.${encodeURIComponent(d.id)}`,'PATCH',{name:d.name.trim()}); s.name=d.name.trim(); }
  for(const op of ops){
    if(op.mv.length) await serApplyShift(op.mv);
    if(op.kind==='add'){
      const last=op.act[op.act.length-1]||{}, c=op.c;
      const rows=op.news.map((dt,i)=>({ id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,5)}`, course_id:c.id, course_name:c.name, major:c.major,
        session_date:dt, session_number:(op.act.length+i+1), time_range:last.time_range||c.time_range, actual_hours:last.actual_hours||c.actual_hours,
        delivery:c.delivery, campus:c.campus, teacher:last.teacher||acSingleTeacher(c.teacher)||'', session_teacher:last.session_teacher||acSingleTeacher(c.teacher)||'',
        session_title:'', confirmed:!!last.confirmed, homework_enabled:c.homework_enabled||false }));
      const r=await sb('/rest/v1/course_sessions','POST',rows); cachedSessions.push(...(Array.isArray(r)?r:rows));
    } else {
      await sb(`/rest/v1/course_sessions?id=in.(${op.tail.map(x=>`"${x.id}"`).join(',')})`,'DELETE');
      cachedSessions=cachedSessions.filter(x=>!op.tail.some(t=>t.id===x.id));
    }
    await serSyncCourseDates(op.c,false);
  }
  serClose();
  serRerender();
  if(ops.length) alert('已改好：\n\n'+lines.join('\n')+'\n\n教室占用如有变化，请到排课系统确认。');
}

async function serDissolve(){
  const d=SER; if(!d||!d.id) return;
  if(!confirm(`解散系列「${d.name}」？\n成员课和单回都不动，只是不再算同一个系列（以后改日期要各自改）。`)) return;
  try{
    await sb(`/rest/v1/courses?series_id=eq.${encodeURIComponent(d.id)}`,'PATCH',{series_id:null,series_order:null});
    cachedCourses.forEach(c=>{ if(c.series_id===d.id){ c.series_id=null; c.series_order=null; } });
    await sb(`/rest/v1/course_series?id=eq.${encodeURIComponent(d.id)}`,'PATCH',{deleted_at:new Date().toISOString()});
    cachedSeries=cachedSeries.filter(s=>s.id!==d.id);
    serClose();
    serRerender();
  }catch(e){ alert('解散失败：'+e.message); }
}

// ── 课程编辑弹窗：属于系列的课，框架字段变灰 ──
function serLockFrame(c){
  const s=serOf(c);
  const ids=['ac_first_date','ac_time_range','ac_total'];
  const chips=document.getElementById('ac_weekday_chips');
  const old=document.getElementById('ac_series_note'); if(old) old.remove();
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.disabled=!!s; });
  if(chips){ chips.style.pointerEvents=s?'none':''; chips.style.opacity=s?'.5':''; }
  if(!s) return;
  const fg=document.getElementById('ac_first_date').closest('.form-group'); if(!fg||!fg.parentNode) return;
  const note=document.createElement('div');
  note.id='ac_series_note';
  note.style.cssText='grid-column:1/-1;background:#fff8e6;border:1px solid #e8d49a;color:#6b5412;border-radius:3px;padding:6px 10px;font-size:12px;margin-bottom:6px';
  note.innerHTML=`第一回日期、星期、上课时间、回数由系列《${escTM(s.name)}》决定，请在系列里改。<span class="filter-chip" onclick="closeModal('addCourseModal');serOpen('${s.id}')" style="cursor:pointer;font-size:11px;padding:2px 10px;margin-left:6px">打开系列</span>　单回明细照样能逐回改。`;
  fg.parentNode.insertBefore(note,fg);
}

// ── 休讲调整：系列的联动 ──
// 弹窗里「只这一门 ｜ 这一天整个系列」（同日分段才显示）
let serRsScope='all';
function serRsSetScope(v){ serRsScope=v; serRsDraw(); }
function serRsDraw(){
  const box=document.getElementById('rs_series_scope'); if(!box) return;
  const id=document.getElementById('rs_session_id').value, t=cachedSessions.find(x=>x.id===id), c=t&&cachedCourses.find(x=>x.id===t.course_id), s=serOf(c);
  if(!s||(s.mode!=='split'&&s.mode!=='mixed')||rsMode!=='shift'){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='';
  box.innerHTML=`<div style="font-size:11px;color:var(--text-3);margin-bottom:4px">⛓ ${escTM(s.name)}（${serModeLabel(s.mode)}）</div><div style="display:flex;gap:6px">`+
    [['one',s.mode==='mixed'?'只这一条线':'只这一门'],['all','这一天整个系列']].map(([v,l])=>`<span class="filter-chip${serRsScope===v?' active':''}" onclick="serRsSetScope('${v}')" style="cursor:pointer;font-size:12px;padding:4px 12px">${l}</span>`).join('')+'</div>';
}
// 接续系列：休讲并顺延时，补课日期默认＝原来下一门的第一天（最后一门＝系列末尾再往后一个上课日）
function serChainMakeDate(sessionId){
  const t=cachedSessions.find(x=>x.id===sessionId), c=t&&cachedCourses.find(x=>x.id===t.course_id), s=serOf(c);
  if(!serChained(s)) return '';
  const next=serLaneLater(s,c)[0];
  if(next){ const a=serActive(next.id); if(a[0]) return a[0].session_date; }
  const ctx=serDayCtx(s.id), act=serActive(c.id), last=act[act.length-1];
  return last?serStep(ctx,last.session_date,1):'';
}
// 接续：这一回休讲顺延之后，后面成员的回次整体往后挪一个上课日（返回要弹教室确认的课）
async function serChainAfterShift(courseId){
  const c=cachedCourses.find(x=>x.id===courseId), s=serOf(c);
  if(!serChained(s)) return null;
  const later=serLaneLater(s,c);
  if(!later.length) return null;
  const ctx=serDayCtx(s.id), mv=serPlanShift(ctx,later,1);
  if(!mv.length) return null;
  await serApplyShift(mv);
  return { mv, lines:serMovesText(mv) };
}
// 休讲前先列出会变动的内容，确认后才改。返回 true = 继续
function serChainPreviewText(courseId){
  const c=cachedCourses.find(x=>x.id===courseId), s=serOf(c);
  if(!serChained(s)) return '';
  const later=serLaneLater(s,c);
  if(!later.length) return `这条线的末尾会多出一个新的上课日。`;
  const mv=serPlanShift(serDayCtx(s.id),later,1);
  return '系列后面的课会整体往后挪一个上课日：\n'+serMovesText(mv).join('\n');
}
// 撤回休讲（接续）：后面成员整体往前收一个上课日
async function serChainAfterUndo(courseId){
  const c=cachedCourses.find(x=>x.id===courseId), s=serOf(c);
  if(!serChained(s)) return null;
  const later=serLaneLater(s,c);
  if(!later.length) return null;
  const ctx=serDayCtx(s.id), mv=serPlanShift(ctx,later,-1);
  if(!mv.length) return null;
  await serApplyShift(mv);
  return { mv, lines:serMovesText(mv) };
}
// 弹出后面成员的教室确认（每门课一个窗口）
async function serRoomConfirm(res){
  if(!res||!res.mv) return;
  const byC=new Map();
  res.mv.forEach(m=>{ if(!byC.has(m.course)) byC.set(m.course,[]); byC.get(m.course).push(m); });
  for(const [c,ms] of byC.entries()){
    try{
      await srmOpen({ course:c, sessions:cachedSessions.filter(x=>x.course_id===c.id),
        changes:ms.map(m=>({ id:m.s.id, num:m.s.session_number, from:{ date:m.from, time:m.s.time_range||c.time_range||'', cancelled:false }, to:{ date:m.to, time:m.s.time_range||c.time_range||'', cancelled:false } })) });
    }catch(e){ console.warn('教室确认弹框失败', e); }
  }
}

// ── 系列模板 ──
function serDetailRowsOf(c){
  return cachedSessions.filter(s=>s.course_id===c.id&&!s.is_cancelled).sort((a,b)=>(a.session_date||'').localeCompare(b.session_date||'')||((a.session_number||0)-(b.session_number||0)))
    .map((s,i)=>({ num:i+1, title:s.session_title||'', teacher:s.session_teacher||c.teacher||'', homework_questions:s.homework_questions||null, homework_note:s.homework_note||null }));
}
async function serSaveTemplate(){
  const d=SER; if(!d||!d.id){ alert('请先保存系列，再存为模板'); return; }
  const s=serById(d.id), ms=serMembersOf(d.id);
  if(!s||!ms.length) return;
  const name=prompt('系列模板名称：',s.name); if(!name) return;
  const members=ms.map(c=>({ name:c.name, teacher:c.teacher||'', course_type:c.course_type||'专业课', total:serActive(c.id).length||c.total_sessions||0,
    time_range:c.time_range||'', actual_hours:c.actual_hours||null, homework_enabled:!!c.homework_enabled, delivery:c.delivery||'', campus:c.campus||'', detail_rows:serDetailRowsOf(c) }));
  const tpl={ id:`tpl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, name, major:[(s.major&&s.major[0])||ms[0].major&&ms[0].major[0]].filter(Boolean),
    course_type:ms[0].course_type||'专业课', weekdays:s.weekdays||ms[0].weekdays||'', time_range:s.time_range||'', total_sessions:members.reduce((a,m)=>a+m.total,0),
    actual_hours:ms[0].actual_hours||null, delivery:ms[0].delivery||'', campus:s.campus||ms[0].campus||'', teacher:'', homework_enabled:!!ms[0].homework_enabled,
    detail_rows:[], series_mode:s.mode, series_members:members };
  try{
    await sb('/rest/v1/course_templates','POST',tpl);
    if(Array.isArray(cachedTemplates)) cachedTemplates.unshift(tpl);
    const hw=members.reduce((a,m)=>a+m.detail_rows.filter(r=>r.homework_questions).length,0);
    alert(`已保存为系列模板「${name}」（${members.length} 门课）${hw?`\n其中 ${hw} 回的作业已一并保存`:''}`);
  }catch(e){ alert('保存模板失败：'+e.message+'\n（如果提示没有 series_mode / series_members 列，请先执行 seed/course_series.sql）'); }
}
// 套用系列模板：t=模板行，firstDate=第一回日期
async function serApplyTemplate(t,firstDate){
  const members=(t.series_members||[]).map((m,i)=>({ key:'m'+i, cid:'', name:m.name, teacher:m.teacher||'', total:m.total||0, tr:m.time_range||'', course_type:m.course_type, homework_enabled:m.homework_enabled, detail_rows:m.detail_rows||[] }));
  if(!members.length){ alert('这个系列模板里没有成员'); return; }
  const major=(t.major&&t.major[0])||'';
  const d={ id:'', name:t.name, mode:['split','mixed'].includes(t.series_mode)?t.series_mode:'chain', major, first:firstDate, weekdays:t.weekdays||'', campus:t.campus||'', delivery:t.delivery||'',
    time_range:t.time_range||'', except:new Set(), total:members[0].total, members, phase2:false };
  if(!HOLIDAYS.length) await loadHolidaysFromDB();
  const total=d.mode==='split'?d.total:members.reduce((a,m)=>a+m.total,0);
  const except=await courseHolidayPrompt({first_session_date:firstDate,weekdays:d.weekdays,skip_dates:'',holiday_except:''},total,`套用系列模板「${t.name}」：这期间有假期`);
  if(except===null) return;
  d.except=new Set(String(except||'').split(',').map(x=>x.trim()).filter(Boolean));
  const err=serPlan(d).err; if(err){ alert('无法按模板排出日期：'+err); return; }
  SER=d; serDraw();    // 先给人核对一遍：弹窗里能看预览、改课名，确认后点「保存」才建
  alert(`已按模板「${t.name}」排好，请在弹窗里核对预览后点「保存」，才会建出系列和 ${members.length} 门课。\n（单回标题、作业会跟着带进去）`);
}

// ── 课程清理页：勾选几门课，整理成系列 ──
function serOpenWith(courses){
  const ms=courses.slice().sort((a,b)=>(a.first_session_date||'').localeCompare(b.first_session_date||'')||(a.name||'').localeCompare(b.name||''));
  const f=ms[0];
  serOpen(null,{
    major:(f.major&&f.major[0])||'', first:f.first_session_date||'', weekdays:f.weekdays||'', campus:f.campus||'', delivery:f.delivery||'', time_range:f.time_range||'',
    name:'', total:serActive(f.id).length||f.total_sessions||5,
    members:ms.map((c,i)=>({ key:'m'+i, cid:c.id, name:c.name||'', teacher:c.teacher||'', total:serActive(c.id).length||c.total_sessions||0, cur:serActive(c.id).length, tr:c.time_range||'' })),
  });
  SER.seq=ms.length; SER.picking=false; serDraw();
}
function cleanupMakeSeries(){
  const cs=[...cleanupSelected].map(id=>cachedCourses.find(c=>c.id===id)).filter(Boolean);
  if(cs.length<2){ alert('请先在下面点选 2 门以上的课（点课程行选中），再点「整理成系列」'); return; }
  const majors=new Set(cs.map(c=>(c.major||[]).join('/')));
  if(majors.size>1||(cs[0].major||[]).length!==1){ alert('系列里的课只限同一个专业（每门课只属于这一个专业），请重新选'); return; }
  const inSer=cs.find(c=>c.series_id); if(inSer){ alert(`《${inSer.name}》已经在系列里了，请先在课程安排里解散或移出`); return; }
  const st=cs.find(serStarted); if(st){ alert(`《${st.name}》已经开课，不能加入系列重排`); return; }
  serOpenWith(cs);
}
// 整期复制用：这一批课里，成员全都在的系列 → Map(系列id → {s, members})
function serCopyGroups(courses){
  const ids=new Set(courses.map(c=>c.id)), out=new Map();
  courses.forEach(c=>{
    if(!c.series_id||out.has(c.series_id)) return;
    const s=serById(c.series_id); if(!s) return;
    const ms=serMembersOf(s.id);
    if(ms.length&&ms.every(m=>ids.has(m.id))) out.set(s.id,{ s, members:ms });
  });
  return out;
}
