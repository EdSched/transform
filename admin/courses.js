let pendingCourseImport=[];

// 课程名 → 专业映射
// 专业列名 → major key
function detectMajorsFromField(str){
  if(!str) return [];
  const parts=String(str).split(/[,，、\/]/);
  const result=[];
  for(const p of parts){
    const s=p.trim();
    if(/社会人文/i.test(s)){result.push('shakai','shinpan','fukushi')}
    else if(/经营|経営/i.test(s)) result.push('keiei');
    else if(/经济|経済/i.test(s)) result.push('keizai');
    else if(/社会学/i.test(s)) result.push('shakai');
    else if(/新闻|新传|新伝/i.test(s)) result.push('shinpan');
    else if(/福祉/i.test(s)) result.push('fukushi');
  }
  return [...new Set(result)];
}

// JS Date → YYYY-MM-DD
function dateToStr(d){
  if(!d||!(d instanceof Date)||isNaN(d)) return '';
  // Excel日期用UTC，补时区偏移
  const local=new Date(d.getTime()+d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

// 星期字符串 → 星期数组 [0=日,1=一…]
function parseWeekdays(str){
  if(str===null||str===undefined||str==='') return [];
  str=String(str);
  const days=[];
  // 中文：周X/星期X/礼拜X 及单字 一二三…日/天
  const cn={'日':0,'天':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
  const cm=str.match(/[周星期礼拜]+\s*([日天一二三四五六])/g);
  if(cm) cm.forEach(m=>{const ch=m.slice(-1); if(ch in cn) days.push(cn[ch]);});
  // 数字：1-7（ISO：周一=1…周日=7）→ JS getDay()（周日=0）；7→0，1-6原样
  const nm=str.match(/\d+/g);
  if(nm) nm.forEach(n=>{let v=parseInt(n,10); if(v>=1&&v<=7) days.push(v===7?0:v);});
  return [...new Set(days)];
}

// 从第一回日期+星期+回数 生成所有日期
function generateSessionDatesFromFirst(firstDate,weekdays,totalSessions){
  if(!firstDate||!weekdays.length||!totalSessions) return [];
  const dates=[];
  const cur=new Date(firstDate+'T12:00:00');
  // 最多往后推2年防死循环
  const limit=new Date(firstDate+'T12:00:00');
  limit.setFullYear(limit.getFullYear()+2);
  while(dates.length<totalSessions&&cur<=limit){
    if(weekdays.includes(cur.getDay())) dates.push(cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0'));
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

function handleCourseImportFile(input){
  const file=input.files[0];
  if(!file) return;
  input.value='';
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});

      // 读主表
      const mainSheet=wb.Sheets[wb.SheetNames[0]];
      const mainData=XLSX.utils.sheet_to_json(mainSheet,{defval:''});

      // 读单回明细表
      const detailSheetName=wb.SheetNames.find(n=>n.includes('单回')||n.includes('明细'));
      const detailData=detailSheetName
        ?XLSX.utils.sheet_to_json(wb.Sheets[detailSheetName],{defval:''})
        :[];

      // 整理单回明细 {课程名: [{回数,单回名称,单回讲师,备注}]}
      const detailMap={};
      for(const row of detailData){
        const name=String(row['课程名称']||'').trim();
        if(!name) continue;
        if(!detailMap[name]) detailMap[name]=[];
        detailMap[name].push({
          num:parseInt(row['第几回']||0),
          title:String(row['单回名称']||'').trim(),
          teacher:String(row['单回讲师']||'').trim(),
          notes:String(row['备注']||'').trim(),
        });
      }

      const rows=[];
      for(const row of mainData){
        const name=String(row['课程名称']||'').trim();
        if(!name||name==='课程名称') continue;

        const majorStr=String(row['专业']||'').trim();
        const majors=detectMajorsFromField(majorStr);
        const period=String(row['期数']||'').trim();
        const course_type=String(row['课程属性']||'').trim();
        const teacher=String(row['讲师']||'').trim();
        const campus=String(row['校区']||'').trim();
        const delivery=String(row['授课形式']||'').trim();
        const wdStr=String(row['星期']||'').trim();
        const weekdays=parseWeekdays(wdStr);
        const timeRange=String(row['上课时间']||'').trim();
        const total=parseInt(row['课程回数']||0);
        const notes=String(row['备注']||'').trim();

        // 第一回日期：Excel读取后是JS Date对象（因为cellDates:true）
        const rawDate=row['第一回日期'];
        let firstDate='';
        if(rawDate instanceof Date) firstDate=dateToStr(rawDate);
        else if(typeof rawDate==='string'&&rawDate) firstDate=rawDate.slice(0,10);

        const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
        const details=detailMap[name]||[];

        rows.push({
          name,major:majors,period,course_type,teacher,campus,delivery,
          weekdays:wdStr,time_range:timeRange,total_sessions:total,
          first_session_date:firstDate,notes,
          _dates:dates,_details:details
        });
      }

      if(!rows.length){alert('未能解析到课程数据，请检查Excel格式');return}

      // 已存在判断：同课程名+期数 算同一条
      const existingKeys=new Set(cachedCourses.map(c=>`${c.name}|${c.period||''}`));
      pendingCourseImport=rows.map(r=>({...r,_exists:existingKeys.has(`${r.name}|${r.period}`)}));
      showCourseImportPreview();
    }catch(err){alert('解析失败：'+err.message+'\n'+err.stack)}
  };
  reader.readAsArrayBuffer(file);
}

function showCourseImportPreview(){
  const newRows=pendingCourseImport.filter(r=>!r._exists);
  const skipRows=pendingCourseImport.filter(r=>r._exists);
  const preview=document.getElementById('courseImportPreview');
  preview.innerHTML=`
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="background:var(--ok-bg);border-radius:3px;padding:8px 14px;font-size:12px"><strong style="color:var(--ok)">${newRows.length}</strong> <span style="color:var(--text-2)">门课程将导入</span></div>
      <div style="background:var(--warn-bg);border-radius:3px;padding:8px 14px;font-size:12px"><strong style="color:var(--warn)">${skipRows.length}</strong> <span style="color:var(--text-2)">门已存在将跳过</span></div>
    </div>
    ${newRows.length?`<div style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:3px">
      <table class="student-table" style="margin:0">
        <thead><tr><th>课程名称</th><th>专业</th><th>期数</th><th>讲师</th><th>校区</th><th>授课形式</th><th>星期</th><th>第一回</th><th>回数</th><th>日期生成</th></tr></thead>
        <tbody>${newRows.map(r=>`<tr>
          <td style="font-size:11px">${r.name}</td>
          <td style="font-size:11px">${(r.major||[]).map(m=>MAJORS[m]||m).join('・')||'<span style="color:var(--warn)">未识别</span>'}</td>
          <td style="font-size:11px">${r.period}</td>
          <td style="font-size:11px">${r.teacher}</td>
          <td style="font-size:11px">${r.campus}</td>
          <td style="font-size:11px">${r.delivery}</td>
          <td style="font-size:11px">${r.weekdays}</td>
          <td style="font-size:11px">${r.first_session_date||'<span style="color:var(--danger)">缺失</span>'}</td>
          <td style="font-size:11px">${r.total_sessions}回</td>
          <td style="font-size:11px;color:${r._dates.length===r.total_sessions?'var(--ok)':r._dates.length>0?'var(--warn)':'var(--danger)'}">${r._dates.length}/${r.total_sessions}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`:'<div class="empty" style="padding:20px">所有课程已存在，无需导入</div>'}`;
  document.getElementById('courseImportConfirmBtn').disabled=!newRows.length;
  document.getElementById('courseImportModal').classList.add('open');
}

async function confirmCourseImport(){
  const newRows=pendingCourseImport.filter(r=>!r._exists);
  if(!newRows.length){closeModal('courseImportModal');return}
  const confirmed=document.getElementById('importConfirmPublish')?.checked||false;
  const btn=document.getElementById('courseImportConfirmBtn');
  btn.textContent='导入中…';btn.disabled=true;
  try{
    for(const r of newRows){
      const courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      const course={
        id:courseId,name:r.name,major:r.major,period:r.period,
        course_type:r.course_type,teacher:r.teacher,campus:r.campus,
        delivery:r.delivery,weekdays:r.weekdays,time_range:r.time_range,
        total_sessions:r.total_sessions,first_session_date:r.first_session_date||null,
        notes:r.notes
      };
      const res=await sb('/rest/v1/courses','POST',[course]);
      cachedCourses.push(Array.isArray(res)?res[0]:course);

      // 生成每次课
      if(r._dates.length){
        const details=r._details||[];
        const sessions=r._dates.map((date,i)=>{
          const detail=details.find(d=>d.num===i+1)||{};
          return {
            id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
            course_id:courseId,course_name:r.name,major:r.major,
            session_date:date,session_number:i+1,
            time_range:r.time_range,
            delivery:r.delivery,campus:r.campus,
            teacher:detail.teacher||r.teacher,
            session_title:detail.title||'',
            session_teacher:detail.teacher||'',
            confirmed
          };
        });
        for(let i=0;i<sessions.length;i+=20){
          // 每个课次继承课程的 homework_enabled
          const chunk=sessions.slice(i,i+20).map(s=>({...s,homework_enabled:courseData.homework_enabled||false}));
          const sres=await sb('/rest/v1/course_sessions','POST',chunk);
          cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
        }
      }
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    closeModal('courseImportModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`成功导入 ${newRows.length} 门课程！`);
  }catch(e){alert('导入失败：'+e.message);btn.textContent='确认导入';btn.disabled=false}
}

let coursesMajorFilter='none';  // 初始不选任何专业，需手动点选后才显示课程（避免一打开满屏）
let coursesDomainFilter='';  // 总览时按领域筛（空=全部领域）
let coursesPeriodFilter='current'; // 'current' | 'all'

// 判断当前是哪个期（按当前月份）


// 课程名去掉末尾数字 → 归组key
function courseGroupKey(name){
  // 用完整课程名（分班1/2、N1/N2 等都是不同的课，不做任何删减）
  return (name||'').trim();
}

// 课程名颜色（根据关键词）
// 字符串 → 稳定柔和颜色（HSL，低饱和高亮度，保证浅底深字可读）
function autoColorFromStr(str){
  str=String(str||'x');
  let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))%360; }
  return { bg:`hsl(${h},46%,90%)`, text:`hsl(${h},55%,30%)` };
}
function courseColor(name, course){
  const n=name||'';
  // ① 文科现有关键词配色（保留，好看）
  if(/宏观/.test(n)) return {bg:'#ddeaf8',text:'#1a3a6a'};
  if(/微观/.test(n)) return {bg:'#ddf0e0',text:'#1a4a28'};
  if(/数学/.test(n)) return {bg:'#e8e4f8',text:'#3a2a7a'};
  if(/习题/.test(n)) return {bg:'#faecd8',text:'#5a3010'};
  if(/計量|计量|方法論|方法论/.test(n)) return {bg:'#d8f0ea',text:'#0a4038'};
  if(/共通/.test(n)) return {bg:'#ece8e0',text:'#3a3830'};
  if(/過去問|过去问|備考|备考/.test(n)) return {bg:'#f8e4dc',text:'#6a2818'};
  if(/経営|经营/.test(n)) return {bg:'#ddeaf8',text:'#1a3a6a'};
  if(/社会学|社会人文/.test(n)) return {bg:'#ddf0e0',text:'#1a4a28'};
  if(/新闻|新伝/.test(n)) return {bg:'#e8e4f8',text:'#3a2a7a'};
  if(/福祉/.test(n)) return {bg:'#faecd8',text:'#5a3010'};
  if(/zemi|ゼミ|seminar/i.test(n)) return {bg:'#d8f0ea',text:'#0a4038'};
  // ② 其他领域：颜色 = 专业 + 名字关键词 + 校区 组合生成
  //    这样同专业但不同班型（托福/托业）、不同校区的课，颜色都能区分
  const mj=(course&&(course.major||[])[0])||'';
  const kw=(n.match(/托福|托业|托業|衔接|衝刺|冲刺|基础|基礎|N[1-5]|口语|写作|会话|中级|高级|进阶|零基础|特进/)||[])[0]||'';
  const campus=(course&&course.campus)||'';
  const seed = mj+'|'+kw+'|'+campus;
  if(seed!=='||') return autoColorFromStr(seed);
  const per=(course&&course.period)||'';
  if(per) return autoColorFromStr('period_'+per);
  return autoColorFromStr('name_'+n);
}

// 课程期判断（根据 start_date 月份）


// 日期格式 → M/D 周X
function fmtSessionDate(dateStr){
  if(!dateStr) return '';
  const d=new Date(dateStr);
  const dow=['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const dowColor=d.getDay()===6?'#1a4a8a':d.getDay()===0?'#8a1a2c':'var(--text-2)';
  return {short:`${d.getMonth()+1}/${d.getDate()}`,dow,dowColor};
}

let coursesTypeFilter='all';
let coursesCampusFilter='all'; // 校区筛选：all/高马/市谷/线上

// ══════════════════════════════════
// COURSE CLEANUP PAGE
// ══════════════════════════════════
let cleanupSelected=new Set();
let cleanupOpenGroups=new Set();   // 展开的「年+期」分组
let cleanupShowNonDup=new Set();   // 分组内展开「无重复课程」的key
let cleanupTypeFilter='all';
let cleanupCampusFilter='all';
let cleanupMajorFilter='all';
let cleanupPeriodFilter='all';
let cleanupYearFilter='all';

function renderCourseCleanupPage(mc){
  // 按「年份 + 期数」分组，年份取自 first_session_date
  // 领域感知筛选（与课程安排页一致）：先限定当前领域；专业筛选='all'时显示领域内全部课，
  // 选了具体专业才按 major 匹配；无专业的课（学部/语言）靠 domain 显示，不被专业滤掉
  let filtered=cachedCourses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    if(cleanupMajorFilter==='all') return true;
    const majorList=expandMajorFilter(cleanupMajorFilter);
    return (c.major||[]).some(m=>majorList.includes(m));
  });

  if(cleanupTypeFilter==='专业课') filtered=filtered.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(cleanupTypeFilter==='共通课') filtered=filtered.filter(c=>c.course_type?.includes('共通'));
  else if(cleanupTypeFilter==='VIP') filtered=filtered.filter(c=>c.course_type?.includes('VIP'));

  if(cleanupPeriodFilter!=='all') filtered=filtered.filter(c=>effectivePeriod(c)===cleanupPeriodFilter);
  if(cleanupCampusFilter!=='all') filtered=filtered.filter(c=>(c.campus||'')===cleanupCampusFilter);
  if(cleanupYearFilter!=='all') filtered=filtered.filter(c=>c.first_session_date?.startsWith(cleanupYearFilter));

  // 视角过滤后的全部课（筛选项来源，因地制宜——只列本视角实际有的期数/年份/校区）
  const viewCourses=cachedCourses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    return true;
  });
  const allYears=[...new Set(viewCourses.filter(c=>c.first_session_date).map(c=>c.first_session_date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  const allCleanupPeriods=[...new Set(viewCourses.map(c=>effectivePeriod(c)).filter(p=>p&&p!=='未分期'))].sort();
  const allCleanupCampuses=[...new Set(viewCourses.map(c=>c.campus).filter(Boolean))];

  const groups={};
  filtered.forEach(c=>{
    const year=c.first_session_date?c.first_session_date.slice(0,4):'未知年份';
    const period=effectivePeriod(c)||'未设期数';
    const key=`${year}年 ${period}`;
    if(!groups[key]) groups[key]={key,year,period,courses:[]};
    groups[key].courses.push(c);
  });
  const sortedKeys=Object.keys(groups).sort((a,b)=>b.localeCompare(a)); // 新的在前

  // 标记疑似重复：不只看名字——名字+校区+时间段+首回日期 都相同才算真重复
  // （同名但校区/时间/日期不同的，是不同的课，不算重复）
  const dupKeys=new Set();
  Object.values(groups).forEach(g=>{
    const sig=c=>[c.name,c.campus||'',c.time_range||'',c.first_session_date||'',(c.teacher||'')].join('|');
    const sigCount={};
    g.courses.forEach(c=>{ const k=sig(c); sigCount[k]=(sigCount[k]||0)+1; });
    g.courses.forEach(c=>{ if(sigCount[sig(c)]>1) dupKeys.add(c.id); });
  });

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程清理</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="cleanupSelectAllFiltered()">☑ 全选当前筛选</button>
      <button class="btn btn-outline btn-sm" onclick="cleanupClearSelection()">清空选择</button>
      ${(!ACCESS_KEY||ACCESS_KEY.is_admin)?`<button class="btn btn-outline btn-sm" onclick="openHolidayManager()" title="全局假期（与排课系统共用，这段时间所有课放假顺延）">⚙ 全局假期</button>`:''}
      <button class="btn btn-primary btn-sm" onclick="cleanupExportInfo()">📄 导出所选信息</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="cleanupDeleteSelected()">删除已选 (<span id="cleanup_count">0</span>)</button>
    </div>
  </div>

  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${cleanupTypeFilter===t?' active':''}" onclick="setCleanupType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">专业</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${majorFilterKeys({includeAll:true}).map((m,i)=>`
          <div class="filter-chip${cleanupMajorFilter===m?' active':''}" onclick="setCleanupMajor('${m}',this)" style="font-size:11px;padding:3px 10px">
            ${i===0?'全部':majorLabel(m)}
          </div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${cleanupPeriodFilter==='all'?' active':''}" onclick="setCleanupPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allCleanupPeriods.map(p=>`<div class="filter-chip${cleanupPeriodFilter===p?' active':''}" onclick="setCleanupPeriod('${p}',this)" style="font-size:11px;padding:3px 10px">${p}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">年份</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${cleanupYearFilter==='all'?' active':''}" onclick="setCleanupYear('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allYears.map(y=>`<div class="filter-chip${cleanupYearFilter===y?' active':''}" onclick="setCleanupYear('${y}',this)" style="font-size:11px;padding:3px 10px">${y}年</div>`).join('')}
      </div>
    </div>
    ${allCleanupCampuses.length>1?`<div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">校区</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${cleanupCampusFilter==='all'?' active':''}" onclick="setCleanupCampus('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allCleanupCampuses.map(cp=>`<div class="filter-chip${cleanupCampusFilter===cp?' active':''}" onclick="setCleanupCampus('${cp}',this)" style="font-size:11px;padding:3px 10px">${cp}</div>`).join('')}
      </div>
    </div>`:''}
  </div>

  <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">按「年份+期数」折叠分组，标题行显示重复情况；展开后疑似重复的课程排在最前，无重复的收在一条里按需展开。点击课程行可选中批量删除；「存为模板」可把课程结构保存复用。</div>
  ${!filtered.length?`<div class="empty" style="padding:40px 0">没有符合筛选条件的课程</div>`:`
  <div id="cleanup_list">
    ${sortedKeys.map(key=>{
      const g=groups[key];
      const dups=g.courses.filter(c=>dupKeys.has(c.id));
      const rest=g.courses.filter(c=>!dupKeys.has(c.id));
      const open=cleanupOpenGroups.has(key);
      const showRest=cleanupShowNonDup.has(key);
      const rowHtml=c=>{
        const sessions=cachedSessions.filter(s=>s.course_id===c.id);
        const isDup=dupKeys.has(c.id);
        const sel=cleanupSelected.has(c.id);
        return `
        <div class="cleanup_row" data-id="${c.id}" data-dup="${isDup?'1':'0'}" onclick="cleanupRowClick(event,'${c.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid ${sel?'var(--accent)':isDup?'#e0c060':'var(--border-light)'};background:${sel?'var(--accent-light, #e8e0d0)':isDup?'#fffbe8':'var(--surface)'};border-radius:3px;margin-bottom:6px;transition:background-color .12s">
          <div style="flex:1">
            <div style="font-size:12px;font-weight:600">${c.name} ${isDup?'<span style="font-size:9px;background:#e0c060;color:#5a4a10;border-radius:2px;padding:1px 5px;margin-left:4px">疑似重复</span>':''}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">
              ${(c.major||[]).map(m=>majorLabel(m)).join('/')} · ${c.teacher||''} · ${c.time_range||''} ·
              ${sessions.length} 条课次记录（设置回数：${c.total_sessions||'-'}）·
              首回 ${c.first_session_date||'-'}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openSaveAsTemplate('${c.id}')">💾 存为模板</button>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openAddCourseModal('${c.id}')">编辑</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="event.stopPropagation();cleanupDeleteSingle('${c.id}')">删除</button>
        </div>`;
      };
      return `
      <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:4px;overflow:hidden">
        <div onclick="cleanupToggleGroup('${key}')" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;user-select:none;${open?'background:var(--bg)':''}">
          <span style="font-size:12px;font-weight:600;color:var(--text-2)">${key}</span>
          <span style="font-size:10px;color:var(--text-3)">共 ${g.courses.length} 门</span>
          ${dups.length?`<span style="font-size:10px;background:#e0c060;color:#5a4a10;border-radius:2px;padding:1px 7px">⚠ 疑似重复 ${dups.length} 门</span>`:'<span style="font-size:10px;color:var(--ok)">✓ 无重复</span>'}
          <span style="font-size:10px;color:var(--text-3);margin-left:auto">${open?'▾ 收起':'▸ 展开'}</span>
        </div>
        ${open?`<div style="padding:10px 14px;border-top:1px solid var(--border-light)">
          ${dups.length?dups.map(rowHtml).join(''):''}
          ${rest.length?(showRest
            ?`<div onclick="cleanupToggleNonDup('${key}')" style="font-size:10px;color:var(--text-3);cursor:pointer;user-select:none;padding:4px 0;margin-bottom:4px">▾ 收起无重复课程</div>`+rest.map(rowHtml).join('')
            :`<div onclick="cleanupToggleNonDup('${key}')" style="font-size:11px;color:var(--text-2);cursor:pointer;user-select:none;background:var(--bg);border:1px dashed var(--border);border-radius:3px;padding:7px 12px">▸ 其余 ${rest.length} 门无重复课程 — 点击展开</div>`)
          :''}
        </div>`:''}
      </div>`;
    }).join('')}
  </div>`}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="section-title" style="font-size:14px">课程模板</div>
    </div>
    <div id="template_list"></div>
  </div>

  <!-- 批量改期浮动条：选中课时才显示 -->
  <div id="cleanup_period_bar" style="display:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:500;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:10px 16px;align-items:center;gap:8px">
    <span style="font-size:12px;color:var(--text-2)">已选 <b id="cleanup_bar_count">0</b> 门 · 期数改为</span>
    <input id="cp_name" placeholder="期名，如 秋冬期" style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">
    <button class="btn btn-primary btn-sm" onclick="cleanupApplyPeriod()">应用</button>
    <button class="btn btn-outline btn-sm" onclick="cleanupClearSelection()">取消</button>
  </div>`;

  renderTemplateList();
}

function cleanupToggleGroup(key){
  if(cleanupOpenGroups.has(key)) cleanupOpenGroups.delete(key); else cleanupOpenGroups.add(key);
  renderCourseCleanupPage(document.getElementById('mainContent'));
}
function cleanupToggleNonDup(key){
  if(cleanupShowNonDup.has(key)) cleanupShowNonDup.delete(key); else cleanupShowNonDup.add(key);
  renderCourseCleanupPage(document.getElementById('mainContent'));
}
function setCleanupType(t,el){cleanupTypeFilter=t;document.querySelectorAll('#mainContent .filter-chip').forEach(c=>c.classList.remove('active'));renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupCampus(cp,el){cleanupCampusFilter=cp;renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupMajor(m,el){cleanupMajorFilter=m;renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupPeriod(p,el){cleanupPeriodFilter=p;renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupYear(y,el){cleanupYearFilter=y;renderCourseCleanupPage(document.getElementById('mainContent'))}

function cleanupRowClick(e,id){
  const row=e.currentTarget;
  if(cleanupSelected.has(id)){
    cleanupSelected.delete(id);
    row.style.backgroundColor='';
    row.style.borderColor=row.dataset.dup==='1'?'#e0c060':'var(--border-light)';
  } else {
    cleanupSelected.add(id);
    row.style.backgroundColor='var(--accent-light, #e8e0d0)';
    row.style.borderColor='var(--accent)';
  }
  const c2=document.getElementById('cleanup_count2');
  document.getElementById('cleanup_count').textContent=cleanupSelected.size;
  if(c2) c2.textContent=cleanupSelected.size;
  updateCleanupPeriodBar();
}
// 批量改期浮动条：有选中才显示
function updateCleanupPeriodBar(){
  const bar=document.getElementById('cleanup_period_bar');
  const cnt=document.getElementById('cleanup_bar_count');
  if(!bar) return;
  if(cleanupSelected.size>0){ bar.style.display='flex'; if(cnt) cnt.textContent=cleanupSelected.size; }
  else { bar.style.display='none'; }
}
// 批量把选中课的期数设为指定值（写 period_override）；__auto__=清除覆盖恢复自动
async function cleanupApplyPeriod(){
  if(!cleanupSelected.size){alert('请先选中课程');return}
  const name=document.getElementById('cp_name').value.trim();
  if(!name){alert('请填期名');return}
  if(!confirm(`把选中的 ${cleanupSelected.size} 门课定义为「${name}」？`))return;
  try{
    for(const id of cleanupSelected){
      await sb(`/rest/v1/courses?id=eq.${id}`,'PATCH',{period_override:name});
      const c=cachedCourses.find(x=>x.id===id); if(c) c.period_override=name;
    }
    alert(`已把 ${cleanupSelected.size} 门课定义为「${name}」`);
    cleanupSelected.clear();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(err){alert('设置失败：'+err.message)}
}
function cleanupClearSelection(){
  cleanupSelected.clear();
  document.querySelectorAll('.cleanup_row').forEach(row=>{
    row.style.backgroundColor='';
    row.style.borderColor=row.dataset.dup==='1'?'#e0c060':'var(--border-light)';
  });
  document.getElementById('cleanup_count').textContent=0;
  updateCleanupPeriodBar();
}
async function cleanupDeleteSingle(courseId){
  if(!confirm('确定删除这门课程及其所有课次记录？此操作不可恢复。'))return;
  try{
    await sb(`/rest/v1/session_records?session_id=in.(${cachedSessions.filter(s=>s.course_id===courseId).map(s=>`"${s.id}"`).join(',')||'""'})`,'DELETE').catch(()=>{});
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'DELETE');
    await sb(`/rest/v1/courses?id=eq.${courseId}`,'DELETE');
    cachedCourses=cachedCourses.filter(c=>c.id!==courseId);
    cachedSessions=cachedSessions.filter(s=>s.course_id!==courseId);
    cleanupSelected.delete(courseId);
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}
async function cleanupDeleteSelected(){
  if(!cleanupSelected.size){alert('请先勾选要删除的课程');return}
  if(!confirm(`确定删除已选中的 ${cleanupSelected.size} 门课程及其所有课次记录？此操作不可恢复。`))return;
  try{
    for(const courseId of cleanupSelected){
      const sessionIds=cachedSessions.filter(s=>s.course_id===courseId).map(s=>s.id);
      if(sessionIds.length) await sb(`/rest/v1/session_records?session_id=in.(${sessionIds.map(i=>`"${i}"`).join(',')})`,'DELETE').catch(()=>{});
      await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'DELETE');
      await sb(`/rest/v1/courses?id=eq.${courseId}`,'DELETE');
    }
    cachedCourses=cachedCourses.filter(c=>!cleanupSelected.has(c.id));
    cachedSessions=cachedSessions.filter(s=>!cleanupSelected.has(s.course_id));
    cleanupSelected.clear();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

// ── 课程模板 ──
function openSaveAsTemplate(courseId){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c){alert('找不到课程');return}
  const name=prompt('模板名称：',c.name);
  if(!name)return;
  saveAsTemplate(courseId,name);
}
async function saveAsTemplate(courseId,templateName){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c)return;
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const detailRows=sessions.map((s,i)=>({
    num:s.session_number, title:s.session_title||'', teacher:s.session_teacher||c.teacher||'',
    homework_questions:s.homework_questions||null,   // 单回作业随模板保存
    homework_note:s.homework_note||null,
  }));
  const hwCount=detailRows.filter(r=>r.homework_questions).length;
  const tpl={
    id:`tpl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    name:templateName,
    major:c.major,
    course_type:c.course_type,
    weekdays:c.weekdays,
    time_range:c.time_range,
    total_sessions:c.total_sessions,
    actual_hours:c.actual_hours,
    delivery:c.delivery,
    campus:c.campus,
    teacher:c.teacher,
    homework_enabled:c.homework_enabled,
    detail_rows:detailRows
  };
  try{
    await sb('/rest/v1/course_templates','POST',tpl);
    alert(`已保存为模板「${templateName}」${hwCount?`\n其中 ${hwCount} 回的作业已一并保存，套用时自动带出`:''}`);
    renderTemplateList();
  }catch(e){alert('保存模板失败：'+e.message)}
}
let cachedTemplates=null;
let tplOpenMajors=new Set();
let tplEditingId=null;

async function renderTemplateList(){
  const wrap=document.getElementById('template_list');
  if(!wrap)return;
  wrap.innerHTML='<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  try{
    cachedTemplates=await sb('/rest/v1/course_templates?select=*&order=created_at.desc');
    tplRenderGroups();
  }catch(e){
    wrap.innerHTML=`<div style="font-size:12px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}

function tplRenderGroups(){
  const wrap=document.getElementById('template_list');
  if(!wrap||!cachedTemplates)return;
  if(!cachedTemplates.length){
    wrap.innerHTML='<div style="font-size:12px;color:var(--text-3);padding:8px 0">暂无保存的模板</div>';
    return;
  }
  // 视角过滤（跟随链接）：非总览只看当前领域/专业的模板（模板任一专业匹配即显示；无专业模板总览才显示）
  let tpls=cachedTemplates;
  if(CURRENT_MAJOR){
    tpls=tpls.filter(t=>(t.major||[]).some(m=>m===CURRENT_MAJOR));
  }else if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'){
    tpls=tpls.filter(t=>(t.major||[]).some(m=>majorInCurrentView(m)));
  }
  if(!tpls.length){
    wrap.innerHTML='<div style="font-size:12px;color:var(--text-3);padding:8px 0">暂无匹配当前领域的模板</div>';
    return;
  }
  // 按专业分组（多专业模板按专业组合归为一组）
  const groups={};
  tpls.forEach(t=>{
    const key=(t.major||[]).length?(t.major||[]).map(m=>majorLabel(m)).join('/'):'未设专业';
    if(!groups[key]) groups[key]=[];
    groups[key].push(t);
  });
  wrap.innerHTML=Object.entries(groups).map(([key,list])=>{
    const open=tplOpenMajors.has(key);
    return `<div style="margin-bottom:8px;border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div onclick="tplToggleMajor('${key.replace(/'/g,"\\'")}')" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;user-select:none;${open?'background:var(--bg)':''}">
        <span style="font-size:12px;font-weight:600;color:var(--text-2)">${key}</span>
        <span style="font-size:10px;color:var(--text-3)">${list.length} 个模板</span>
        <span style="font-size:10px;color:var(--text-3);margin-left:auto">${open?'▾ 收起':'▸ 展开'}</span>
      </div>
      ${open?`<div style="padding:8px 14px;border-top:1px solid var(--border-light)">
        ${list.map(t=>tplEditingId===t.id?tplEditFormHtml(t):`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border-light);border-radius:3px;margin-bottom:6px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-size:12px;font-weight:600">${t.name}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">
              ${t.teacher||''} · ${t.weekdays||''} ${t.time_range||''} · 共${t.total_sessions||'-'}回 · ${t.delivery||''} ${t.campus||''} · ${t.detail_rows?.length||0}条单回明细${(t.detail_rows||[]).filter(r=>r.homework_questions).length?` · <span style="color:var(--accent)">📝 ${(t.detail_rows||[]).filter(r=>r.homework_questions).length}回带作业</span>`:''}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openApplyTemplate('${t.id}')">套用</button>
          <button class="btn btn-outline btn-sm" onclick="tplEditingId='${t.id}';tplRenderGroups()">✏ 编辑</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="deleteTemplate('${t.id}')">删除</button>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  }).join('');
}

function tplToggleMajor(key){
  if(tplOpenMajors.has(key)) tplOpenMajors.delete(key); else tplOpenMajors.add(key);
  tplRenderGroups();
}

// 模板编辑表单（基础字段 + 单回明细「回数|标题|讲师」逐行编辑）
function tplEditFormHtml(t){
  const inp='width:100%;font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld=(id,label,val,ph)=>`<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label><input id="${id}" value="${String(val==null?'':val).replace(/"/g,'&quot;')}" placeholder="${ph||''}" style="${inp}"></div>`;
  const detailText=(t.detail_rows||[]).map(r=>`${r.num||''}|${r.title||''}|${r.teacher||''}${r.homework_questions?'|📝':''}`).join('\n');
  return `<div style="border:1px solid var(--accent);border-radius:3px;padding:12px;margin-bottom:6px;background:var(--bg)">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">✏ 编辑模板</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:8px">
      ${fld('te_name','模板/课程名称 *',t.name)}
      ${fld('te_teacher','主讲老师',t.teacher)}
      ${fld('te_weekdays','星期（如 周六）',t.weekdays)}
      ${fld('te_time','上课时间',t.time_range,'10:00-15:00')}
      ${fld('te_total','总回数',t.total_sessions)}
      ${fld('te_hours','课时（小时）',t.actual_hours)}
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">上课形式</label>
        <select id="te_delivery" style="${inp}"><option value="">请选择</option>${['线下','线上','线下＋线上'].map(d=>`<option ${t.delivery===d?'selected':''}>${d}</option>`).join('')}</select></div>
      ${fld('te_campus','校区/教室',t.campus)}
      ${fld('te_type','课程属性',t.course_type,'专业课 / 共通课 / VIP')}
    </div>
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">单回明细（每行一条：回数|标题|讲师；行尾 📝 表示该回已绑定作业，编辑时保留即可）</label>
    <textarea id="te_details" rows="${Math.min(10,Math.max(3,(t.detail_rows||[]).length))}" style="width:100%;font-size:11px;line-height:1.7;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:'DM Mono',monospace;resize:vertical">${detailText}</textarea>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="tplSaveEdit('${t.id}')">保存修改</button>
      <button class="btn btn-outline btn-sm" onclick="tplEditingId=null;tplRenderGroups()">取消</button>
    </div>
  </div>`;
}

async function tplSaveEdit(id){
  const g=x=>(document.getElementById(x)||{}).value||'';
  const name=g('te_name').trim();
  if(!name){alert('请填写模板名称');return}
  const oldRows=((cachedTemplates||[]).find(x=>x.id===id)||{}).detail_rows||[];
  const detail_rows=g('te_details').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const [num,title,teacher]=l.split('|').map(x=>(x||'').trim());
    const n = num==='休讲'?'休讲':(parseInt(num)||num);
    const prev = oldRows.find(r=>String(r.num)===String(n)) || {};
    return { num:n, title:title||'', teacher:teacher||'',
      homework_questions: prev.homework_questions||null,   // 编辑明细不丢作业绑定
      homework_note: prev.homework_note||null };
  });
  const patch={
    name, teacher:g('te_teacher').trim(), weekdays:g('te_weekdays').trim(), time_range:g('te_time').trim(),
    total_sessions:parseInt(g('te_total'))||null, actual_hours:parseFloat(g('te_hours'))||null,
    delivery:g('te_delivery'), campus:g('te_campus').trim(), course_type:g('te_type').trim(),
    detail_rows,
  };
  try{
    await sb(`/rest/v1/course_templates?id=eq.${id}`,'PATCH',patch);
    const idx=cachedTemplates.findIndex(t=>t.id===id);
    if(idx>=0) Object.assign(cachedTemplates[idx],patch);
    tplEditingId=null;
    tplRenderGroups();
  }catch(e){alert('保存失败：'+e.message)}
}

async function deleteTemplate(templateId){
  if(!confirm('确定删除这个模板？'))return;
  try{
    await sb(`/rest/v1/course_templates?id=eq.${templateId}`,'DELETE');
    if(cachedTemplates) cachedTemplates=cachedTemplates.filter(t=>t.id!==templateId);
    tplRenderGroups();
  }catch(e){alert('删除失败：'+e.message)}
}
async function openApplyTemplate(templateId){
  const firstDate=prompt('请输入新一期的第一回日期（格式 YYYY-MM-DD）：');
  if(!firstDate)return;
  try{
    const templates=await sb(`/rest/v1/course_templates?id=eq.${templateId}&select=*`);
    const t=templates[0];
    if(!t){alert('模板不存在');return}
    const weekdays=parseWeekdays(t.weekdays||'');
    const dates=generateSessionDatesFromFirst(firstDate,weekdays,t.total_sessions||0);
    if(!dates.length){alert('无法根据模板生成日期，请检查模板的星期设置');return}

    const courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    const fdMonth=parseInt(firstDate.slice(5,7));
    const period=fdMonth<=3?'1月期':fdMonth<=6?'4月期':fdMonth<=9?'7月期':'10月期';
    await sb('/rest/v1/courses','POST',{
      id:courseId,name:t.name,major:t.major,course_type:t.course_type,
      weekdays:t.weekdays,time_range:t.time_range,total_sessions:t.total_sessions,
      actual_hours:t.actual_hours,delivery:t.delivery,campus:t.campus,teacher:t.teacher,
      homework_enabled:t.homework_enabled,first_session_date:firstDate,period
    });

    const sessions=dates.map((date,i)=>{
      const detail=(t.detail_rows||[]).find(r=>r.num===i+1)||{};
      return {
        id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
        course_id:courseId,course_name:t.name,major:t.major,
        session_date:date,session_number:i+1,
        time_range:t.time_range,actual_hours:t.actual_hours,
        delivery:t.delivery,campus:t.campus,
        teacher:detail.teacher||t.teacher,
        session_title:detail.title||'',
        session_teacher:detail.teacher||t.teacher,
        homework_questions:detail.homework_questions||null,
        homework_note:detail.homework_note||null,
        homework_enabled:!!detail.homework_questions||t.homework_enabled||false
      };
    });
    for(let i=0;i<sessions.length;i+=20){
      await sb('/rest/v1/course_sessions','POST',sessions.slice(i,i+20));
    }
    const hwN=(t.detail_rows||[]).filter(r=>r.homework_questions).length;
    alert(`已根据模板「${t.name}」生成新一期课程（${dates.length}回）${hwN?`，其中 ${hwN} 回已自动带出作业`:''}，请到「课程安排」中查看并发布`);
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('套用模板失败：'+e.message)}
}

function renderCoursesPage(mc){
  // 专业钥匙锁定：强制默认选中锁定的专业（用户不能改）
  if(CURRENT_MAJOR) coursesMajorFilter=CURRENT_MAJOR;
  // 锁定在具体领域（领域账号/切换视角进入）：默认显示该领域全部课（不管领域有没有建专业）
  else if(CURRENT_DOMAIN && CURRENT_DOMAIN!=='all' && coursesMajorFilter==='none') coursesMajorFilter='all';

  const curPeriod=currentPeriodKey();
  // 领域感知筛选：
  //  - coursesMajorFilter==='none'：未选专业，不显示任何课（初始态，避免满屏）
  //  - 非总览视角：先限定在当前领域 CURRENT_DOMAIN 的课
  //  - 有专业的课按专业 majorList 筛；无专业的课（学部/语言）靠 domain 圈定，不被专业滤掉
  let majorList=coursesMajorFilter==='none'?[]:expandMajorFilter(coursesMajorFilter);
  let filtered=coursesMajorFilter==='none'?[]:cachedCourses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(coursesMajorFilter==='all'){
      // 「全部」：本视角内所有课都要（含无专业的学部/语言课）
      return true;
    }
    if(c.major&&c.major.length) return c.major.some(m=>majorList.includes(m));
    return false; // 选了具体专业时，无专业的课不匹配
  });
  if(coursesPeriodFilter==='current') filtered=filtered.filter(c=>effectivePeriod(c)===curPeriod);
  else if(coursesPeriodFilter!=='all'){
    const [filterYear,filterPeriod]=coursesPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) filtered=filtered.filter(c=>effectivePeriod(c)===filterPeriod&&c.first_session_date?.startsWith(filterYear));
    else filtered=filtered.filter(c=>effectivePeriod(c)===coursesPeriodFilter);
  }
  // 课程属性筛选
  if(coursesTypeFilter==='专业课') filtered=filtered.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(coursesTypeFilter==='共通课') filtered=filtered.filter(c=>c.course_type?.includes('共通'));
  else if(coursesTypeFilter==='VIP') filtered=filtered.filter(c=>c.course_type?.includes('VIP'));
  if(coursesCampusFilter!=='all') filtered=filtered.filter(c=>(c.campus||'')===coursesCampusFilter);

  const allPeriods=[...new Map(cachedCourses
    .filter(c=>c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const per=effectivePeriod(c);const key=`${year}年${per}`;return [key,{key,period:per,year}]})
  ).values()].sort((a,b)=>a.key.localeCompare(b.key));

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程安排</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ok btn-sm" onclick="openPublishModal()" style="background:var(--ok);color:#fff;border:none">📢 发布管理</button>
      <button class="btn btn-outline btn-sm" onclick="openWeeklyNotice()">📣 每周通知</button>
      <button class="btn btn-outline btn-sm" onclick="openScheduleShare()">🗓 学生课表</button>
      <button class="btn btn-primary btn-sm" onclick="openAddCourseModal()">＋ 手动添加</button>
      <button class="btn btn-outline btn-sm" onclick="exportCoursesExcel()">↓ 导出 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('courseImportFileInput').click()">↑ 导入 Excel</button>
      <input type="file" id="courseImportFileInput" accept=".xlsx,.xls" style="display:none" onchange="handleCourseImportFile(this)">
    </div>
  </div>

  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${coursesTypeFilter===t?' active':''}" onclick="setCoursesType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">专业</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${majorFilterKeys({includeAll:true}).map((m,i)=>`
          <div class="filter-chip${coursesMajorFilter===m?' active':''}" onclick="setCoursesMajor('${m}',this)" style="font-size:11px;padding:3px 10px">
            ${i===0?'全部':majorLabel(m)}
          </div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${coursesPeriodFilter==='current'?' active':''}" onclick="setCoursesPeriod('current',this)" style="font-size:11px;padding:3px 10px">当前期（${curPeriod}）</div>
        ${allPeriods.map(p=>`<div class="filter-chip${coursesPeriodFilter===p.key?' active':''}" onclick="setCoursesPeriod('${p.key}',this)" style="font-size:11px;padding:3px 10px">${p.key}</div>`).join('')}
        <div class="filter-chip${coursesPeriodFilter==='all'?' active':''}" onclick="setCoursesPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">校区</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${coursesCampusFilter==='all'?' active':''}" onclick="setCoursesCampus('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        <div class="filter-chip${coursesCampusFilter==='高马'?' active':''}" onclick="setCoursesCampus('高马',this)" style="font-size:11px;padding:3px 10px">高马</div>
        <div class="filter-chip${coursesCampusFilter==='市谷'?' active':''}" onclick="setCoursesCampus('市谷',this)" style="font-size:11px;padding:3px 10px">市谷</div>
        <div class="filter-chip${coursesCampusFilter==='线上'?' active':''}" onclick="setCoursesCampus('线上',this)" style="font-size:11px;padding:3px 10px">线上</div>
      </div>
    </div>
  </div>

  ${coursesMajorFilter==='none'
    ?`<div class="empty" style="padding:60px 0">请先在上方选择专业<br><span style="font-size:11px;color:var(--text-3);margin-top:6px;display:block">点「全部」查看本视角所有课程，或点某个专业查看该专业课程</span></div>`
    :!filtered.length
    ?`<div class="empty" style="padding:60px 0">暂无课程数据<br><span style="font-size:11px;color:var(--text-3);margin-top:6px;display:block">请切换期数/专业筛选，或点击右上角导入课程安排</span></div>`
    :renderCoursesSummary(filtered)
  }`;
}

function renderCoursesSummary(courses){
  // 共通課など複数専業に属するコースが重複表示されないようにIDでユニーク化
  const seen=new Set();
  const uniqueCourses=courses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  // 按课程组key聚合（去掉末尾数字）
  const groups={};
  const groupOrder=[];
  uniqueCourses.forEach(c=>{
    // 分组 key = 课程名（去末尾数字，合并分班1/2）+ 期数 + 年份
    // 这样同名不同期的课分成独立组，不再混在一起；同期同名（含分班）才合并
    const nameKey=courseGroupKey(c.name);
    const yr=c.first_session_date?c.first_session_date.slice(0,4):'';
    const key=`${nameKey}|${effectivePeriod(c)}|${yr}|${c.campus||''}`;
    if(!groups[key]){groups[key]={course:c,sessions:[]};groupOrder.push(key)}
    const sess=cachedSessions.filter(s=>s.course_id===c.id).sort((a,b)=>a.session_date.localeCompare(b.session_date));
    groups[key].sessions.push(...sess);
  });
  groupOrder.sort((a,b)=>{
    const sa=groups[a].sessions[0]?.session_date||groups[a].course.start_date||'';
    const sb=groups[b].sessions[0]?.session_date||groups[b].course.start_date||'';
    return sa.localeCompare(sb);
  });
  groupOrder.forEach(k=>{
    const seen2=new Set();
    groups[k].sessions=groups[k].sessions.filter(s=>{if(seen2.has(s.id))return false;seen2.add(s.id);return true});
  });

  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${groupOrder.map(key=>{
      const {course,sessions}=groups[key];
      const dispName=courseGroupKey(course.name);
      const color=courseColor(dispName,course);
      const total=sessions.length||course.total_sessions||0;
      const teacherStr=course.teacher?` · ${course.teacher}`:'';
      const timeStr=course.time_range?` · ${course.time_range}`:'';
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
        <div style="background:${color.bg};color:${color.text};padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:600">${dispName}</span>
            ${course.first_session_date?`<span style="font-size:10px;opacity:.7;background:rgba(0,0,0,.08);border-radius:2px;padding:1px 6px">${effectivePeriod(course)}</span>`:''}
            ${course.first_session_date?`<span style="font-size:10px;opacity:.6;background:rgba(0,0,0,.08);border-radius:2px;padding:1px 5px">${course.first_session_date.slice(0,4)}年</span>`:''}
            ${(course.major||[]).length>1?`<span style="font-size:9px;opacity:.6">${(course.major||[]).map(m=>MAJORS[m]||m).join('・')}</span>`:''}
            ${course.teacher?`<span style="font-size:10px;opacity:.75">👤 ${course.teacher}</span>`:''}
            ${course.campus?`<span style="font-size:10px;opacity:.75">📍 ${course.campus}</span>`:''}
            ${course.delivery?`<span style="font-size:10px;opacity:.75">${course.delivery.includes('线下')&&course.delivery.includes('线上')?'🔀':course.delivery==='线下'?'🏫':'💻'} ${course.delivery}</span>`:''}
            ${course.time_range?`<span style="font-size:10px;opacity:.75">⏰ ${course.time_range}</span>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;opacity:.7;white-space:nowrap">${total} 課次</span>
            ${(()=>{
              const isConfirmed=sessions.length>0&&sessions.every(s=>s.confirmed);
              const someConfirmed=sessions.some(s=>s.confirmed);
              if(isConfirmed) return `<span style="font-size:10px;background:rgba(42,158,106,.2);color:#1a5a3a;border-radius:2px;padding:1px 7px;font-weight:600">✓ 已发布</span>`;
              if(someConfirmed) return `<span style="font-size:10px;background:rgba(184,120,32,.15);color:var(--warn);border-radius:2px;padding:1px 7px">部分发布</span>`;
              return `<span style="font-size:10px;background:var(--bg);color:var(--text-3);border:1px solid var(--border);border-radius:2px;padding:1px 7px">未发布</span>`;
            })()}
            <button onclick="openAddCourseModal('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">编辑</button>
            <button onclick="openCopyPeriod('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">复制到新期</button>
            <button onclick="deleteCourse('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.2);border:1px solid rgba(180,0,0,.25);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:#8a2020">删除</button>
          </div>
        </div>
        ${sessions.length
          ?`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0">
              ${sessions.map((s,i)=>{
                const f=fmtSessionDate(s.session_date);
                const recCount=cachedSessionRecords.filter(r=>r.session_id===s.id&&r.attendance).length;
                const hasRec=recCount>0;
                const border=i%5!==0?'border-left:1px solid var(--border-light)':'';
                const borderT=i>=5?'border-top:1px solid var(--border-light)':'';
                const titleStr=s.session_title?`<div style="font-size:9px;color:var(--text-2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.session_title}</div>`:'';
                if(s.is_cancelled){
                  return `<div style="padding:8px 10px;${border};${borderT};position:relative;background:rgba(0,0,0,.03)" title="休讲${s.cancel_note?'：'+s.cancel_note:''}">
                    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px">
                      <div style="display:flex;align-items:baseline;gap:4px">
                        <span style="font-size:13px;font-weight:600;color:var(--text-3);text-decoration:line-through">${f.short}</span>
                        <span style="font-size:10px;font-weight:500;color:var(--text-3)">${f.dow}</span>
                      </div>
                      <button onclick="openReschedule('${s.id}')" title="调整日期" style="font-size:9px;background:none;border:none;cursor:pointer;color:var(--text-3);padding:0;line-height:1">⇄</button>
                    </div>
                    <div style="font-size:9px;color:#b07020;margin-top:1px;font-weight:600">休讲${s.cancel_reason?'・'+s.cancel_reason:''}</div>
                  </div>`;
                }
                return `<div style="padding:8px 10px;${border};${borderT};position:relative" title="${s.session_title||''}">
                  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px">
                    <div style="display:flex;align-items:baseline;gap:4px">
                      <span style="font-size:13px;font-weight:600">${f.short}</span>
                      <span style="font-size:10px;font-weight:500;color:${f.dowColor}">${f.dow}</span>
                    </div>
                    <button onclick="openReschedule('${s.id}')" title="调整日期" style="font-size:9px;background:none;border:none;cursor:pointer;color:var(--text-3);padding:0;line-height:1">⇄</button>
                  </div>
                  ${titleStr}
                  <div style="font-size:10px;color:var(--text-3);margin-top:1px">${s.time_range||course.time_range||''}</div>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                    ${hasRec?`<span style="font-size:9px;color:var(--ok)">✓ ${recCount}人</span>`:''}
                    <span onclick="event.stopPropagation();openHwEditor('${s.id}')" title="布置作业" style="font-size:9px;cursor:pointer;margin-left:auto;${s.homework_enabled?'color:var(--accent);font-weight:600':'color:var(--text-3)'}">📝${s.homework_enabled?' 已布置':''}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>`
          :`<div style="padding:14px;font-size:11px;color:var(--text-3)">暂无课次数据</div>`
        }
      </div>`;
    }).join('')}
  </div>`;
}

function setCoursesMajor(m,el){
  coursesMajorFilter=m;
  renderCoursesPage(document.getElementById('mainContent'));
}
function setCoursesPeriod(p,el){
  coursesPeriodFilter=p;
  renderCoursesPage(document.getElementById('mainContent'));
}
function setCoursesCampus(c,el){
  coursesCampusFilter=c;
  renderCoursesPage(document.getElementById('mainContent'));
}
function setCoursesDomain(d,el){
  coursesDomainFilter=d;
  coursesMajorFilter=d?'all':'none'; // 选了领域自动显示该领域全部；清领域回到不选
  renderCoursesPage(document.getElementById('mainContent'));
}

// ══════════ 期数管理（自定义月份范围） ══════════
// ══════════ 全局假期管理（与排课系统共用 sched_holidays）══════════
function openHolidayManager(){
  let ov=document.getElementById('holidayMgrOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='holidayMgrOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center';
    document.body.appendChild(ov);
  }
  ov.style.display='flex';
  renderHolidayMgr();
}
function closeHolidayMgr(){ const ov=document.getElementById('holidayMgrOverlay'); if(ov) ov.style.display='none'; }
function renderHolidayMgr(){
  const ov=document.getElementById('holidayMgrOverlay');
  const rows=(HOLIDAYS||[]).slice().sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||'')).map(h=>{
    const col=h.color==='green'?'#2c8a4f':'#c0392b';
    const bg=h.color==='green'?'#e7f6ec':'#fdecea';
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light)">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col}"></span>
      <span style="font-size:12px;flex:1">${h.label||'假期'}　<span style="color:var(--text-3)">${h.start_date||''}${h.end_date&&h.end_date!==h.start_date?(' ~ '+h.end_date):''}</span></span>
      <button onclick="delHoliday('${h.id}')" class="btn btn-outline btn-sm">删除</button>
    </div>`;
  }).join('');
  ov.innerHTML=`
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:24px 28px;width:min(560px,94vw);max-height:86vh;overflow:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:1.1rem;font-weight:600">全局假期</div>
      <button onclick="closeHolidayMgr()" class="btn btn-outline btn-sm">关闭</button>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">与排课系统共用同一份假期。这段时间内所有课默认放假、单回顺延（个别课可豁免）。红＝全员放假，绿＝特殊考试假（分领域）。</div>
    ${rows||'<div style="color:var(--text-3);font-size:12px;padding:10px 0">暂无全局假期</div>'}
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">＋ 新增假期</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input id="hol_label" placeholder="假期名（如 春节）" style="width:120px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px">
        <input id="hol_start" type="date" style="padding:5px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px">
        <span style="font-size:11px;color:var(--text-3)">到</span>
        <input id="hol_end" type="date" style="padding:5px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px">
        <select id="hol_color" style="padding:5px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px">
          <option value="red">红·全员放假</option>
          <option value="green">绿·特殊考试假</option>
        </select>
        <button onclick="addHoliday()" class="btn btn-primary btn-sm">新增</button>
      </div>
      <div style="font-size:10px;color:var(--text-3);margin-top:6px">单日假期：结束日留空或与开始日相同。</div>
    </div>
  </div>`;
}
async function addHoliday(){
  const label=document.getElementById('hol_label').value.trim();
  const start=document.getElementById('hol_start').value;
  let end=document.getElementById('hol_end').value||start;
  const color=document.getElementById('hol_color').value||'red';
  if(!start){ alert('请选开始日'); return; }
  if(end<start) end=start;
  try{
    await sb('/rest/v1/sched_holidays','POST',[{start_date:start,end_date:end,label:label||'假期',color}]);
    await loadHolidaysFromDB();
    renderHolidayMgr();
  }catch(e){ alert('新增失败：'+e.message); }
}
async function delHoliday(id){
  if(!confirm('删除这个全局假期？（排课系统也会同步删除）')) return;
  try{
    await sb(`/rest/v1/sched_holidays?id=eq.${id}`,'DELETE');
    await loadHolidaysFromDB();
    renderHolidayMgr();
  }catch(e){ alert('删除失败：'+e.message); }
}

function openPeriodManager(){
  let ov=document.getElementById('periodMgrOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='periodMgrOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center';
    document.body.appendChild(ov);
  }
  ov.style.display='flex';
  renderPeriodMgr();
}
function closePeriodMgr(){ const ov=document.getElementById('periodMgrOverlay'); if(ov) ov.style.display='none'; }
function renderPeriodMgr(){
  const ov=document.getElementById('periodMgrOverlay');
  const monthOpts=(sel)=>Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}"${sel==m?' selected':''}>${m}月</option>`).join('');
  let rows=PERIODS.map(p=>`
    <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-light)">
      <input id="pm_name_${p.id}" value="${p.name}" style="width:110px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px">
      <select id="pm_start_${p.id}" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px">${monthOpts(p.start_month)}</select>
      <span style="font-size:11px;color:var(--text-3)">到</span>
      <select id="pm_end_${p.id}" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px">${monthOpts(p.end_month)}</select>
      ${p.start_month>p.end_month?'<span style="font-size:9px;color:var(--primary,#8b5cf6)">跨年</span>':''}
      <button onclick="savePeriod(${p.id})" class="btn btn-outline btn-sm" style="margin-left:auto">保存</button>
      <button onclick="deletePeriod(${p.id})" class="btn btn-outline btn-sm">删除</button>
    </div>`).join('');
  ov.innerHTML=`
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:24px 28px;width:min(560px,94vw);max-height:86vh;overflow:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:1.1rem;font-weight:600">期数管理</div>
      <button onclick="closePeriodMgr()" class="btn btn-outline btn-sm">关闭</button>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">每个期是一个月份范围（结束月小于起始月＝跨年，如 9月到1月）。课按开课月份落入对应期。</div>
    ${rows||'<div style="color:var(--text-3);font-size:12px;padding:10px 0">暂无期数</div>'}
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">＋ 新增期</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="pm_new_name" placeholder="期名" style="width:110px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px">
        <select id="pm_new_start" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px">${monthOpts(1)}</select>
        <span style="font-size:11px;color:var(--text-3)">到</span>
        <select id="pm_new_end" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px">${monthOpts(3)}</select>
        <button onclick="addPeriod()" class="btn btn-primary btn-sm" style="margin-left:auto">新增</button>
      </div>
    </div>
  </div>`;
}
async function savePeriod(id){
  const name=document.getElementById('pm_name_'+id).value.trim();
  const s=parseInt(document.getElementById('pm_start_'+id).value);
  const e=parseInt(document.getElementById('pm_end_'+id).value);
  if(!name){ alert('请填期名'); return; }
  try{
    await sb(`/rest/v1/periods?id=eq.${id}`,'PATCH',{name,start_month:s,end_month:e});
    await loadPeriodsFromDB(); renderPeriodMgr();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(err){ alert('保存失败：'+err.message); }
}
async function addPeriod(){
  const name=document.getElementById('pm_new_name').value.trim();
  const s=parseInt(document.getElementById('pm_new_start').value);
  const e=parseInt(document.getElementById('pm_new_end').value);
  if(!name){ alert('请填期名'); return; }
  try{
    const maxOrder=Math.max(0,...PERIODS.map(p=>p.sort_order||0));
    await sb('/rest/v1/periods','POST',{name,start_month:s,end_month:e,sort_order:maxOrder+1});
    await loadPeriodsFromDB(); renderPeriodMgr();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(err){ alert('新增失败：'+err.message); }
}
async function deletePeriod(id){
  if(!confirm('确定删除这个期？')) return;
  try{
    await sb(`/rest/v1/periods?id=eq.${id}`,'DELETE');
    await loadPeriodsFromDB(); renderPeriodMgr();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(err){ alert('删除失败：'+err.message); }
}
function setCoursesType(t,el){
  coursesTypeFilter=t;
  renderCoursesPage(document.getElementById('mainContent'));
}

async function toggleCourseConfirm(courseId, isCurrentlyConfirmed){
  const sessions=cachedSessions.filter(s=>s.course_id===courseId);
  if(!sessions.length){alert('该课程暂无课次');return}
  const newVal=!isCurrentlyConfirmed;
  const action=newVal?'发布':'取消发布';
  if(!confirm(`确定${action}该课程所有 ${sessions.length} 个课次？${newVal?'\n\n发布后老师可在「我的课表」中看到这门课。':''}`)){ return}
  try{
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'PATCH',{confirmed:newVal});
    sessions.forEach(s=>s.confirmed=newVal);
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

async function deleteCourse(id){
  try{
    await sb(`/rest/v1/session_records?session_id=in.(${cachedSessions.filter(s=>s.course_id===id).map(s=>`"${s.id}"`).join(',')||'""'})`,'DELETE').catch(()=>{});
    await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'DELETE');
    await sb(`/rest/v1/courses?id=eq.${id}`,'DELETE');
    cachedSessions=cachedSessions.filter(s=>s.course_id!==id);
    cachedSessionRecords=cachedSessionRecords.filter(r=>!cachedSessions.find(s=>s.id===r.session_id));
    cachedCourses=cachedCourses.filter(c=>c.id!==id);
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

// ── 发布管理 ──
let publishMajorFilter='all', publishPeriodFilter='all';

function openPublishModal(){
  publishMajorFilter='all'; publishPeriodFilter='all';
  renderPublishModal();
  document.getElementById('publishModal').classList.add('open');
}

function renderPublishModal(){
  const allPeriods=[...new Map(cachedCourses
    .filter(c=>c.period&&c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const key=`${year}年${c.period}`;return[key,key]})
  ).values()].sort();

  document.getElementById('publishFilters').innerHTML=`
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
      <span style="font-size:10px;color:var(--text-3);margin-right:2px">专业</span>
      ${majorFilterKeys({includeAll:true}).map((m,i)=>`
        <div class="filter-chip${publishMajorFilter===m?' active':''}" onclick="setPubMajor('${m}',this)" style="font-size:11px;padding:2px 8px">${i===0?'全部':majorLabel(m)}</div>`).join('')}
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px">
      <span style="font-size:10px;color:var(--text-3);margin-right:2px">期数</span>
      <div class="filter-chip${publishPeriodFilter==='all'?' active':''}" onclick="setPubPeriod('all',this)" style="font-size:11px;padding:2px 8px">全部</div>
      ${allPeriods.map(p=>`<div class="filter-chip${publishPeriodFilter===p?' active':''}" onclick="setPubPeriod('${p}',this)" style="font-size:11px;padding:2px 8px">${p}</div>`).join('')}
    </div>`;

  let courses=cachedCourses;
  if(publishMajorFilter!=='all'){
    const ml=expandMajorFilter(publishMajorFilter);
    courses=courses.filter(c=>(c.major||[]).some(m=>ml.includes(m)));
  }
  if(publishPeriodFilter!=='all'){
    const[y,p]=publishPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(y&&p) courses=courses.filter(c=>c.period===p&&c.first_session_date?.startsWith(y));
  }
  // deduplicate
  const seen=new Set();
  courses=courses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  document.getElementById('publishList').innerHTML=courses.length
    ?`<table class="student-table" style="margin:0">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="pubSelectAll" onchange="pubToggleAll(this.checked)" style="accent-color:var(--accent)"></th>
          <th>课程名称</th><th>期数</th><th>专业</th><th>属性</th><th>状态</th>
        </tr></thead>
        <tbody>
          ${courses.map(c=>{
            const sessions=cachedSessions.filter(s=>s.course_id===c.id);
            const isConfirmed=sessions.length>0&&sessions.every(s=>s.confirmed);
            const someConfirmed=sessions.some(s=>s.confirmed);
            const statusLabel=isConfirmed?'<span style="color:var(--ok);font-size:11px">✓ 已发布</span>':someConfirmed?'<span style="color:var(--warn);font-size:11px">部分</span>':'<span style="color:var(--text-3);font-size:11px">未发布</span>';
            const year=c.first_session_date?.slice(0,4)||'';
            return `<tr>
              <td><input type="checkbox" class="pub-course-cb" value="${c.id}" style="accent-color:var(--accent)" ${isConfirmed?'checked':''}></td>
              <td style="font-size:12px;font-weight:600">${c.name}</td>
              <td style="font-size:11px">${year?year+'年':''}${c.period||''}</td>
              <td style="font-size:11px">${(c.major||[]).map(m=>MAJORS[m]||m).join('・')}</td>
              <td style="font-size:11px">${c.course_type||''}</td>
              <td>${statusLabel}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`
    :'<div class="empty" style="padding:30px">暂无课程</div>';
}

function setPubMajor(m,el){publishMajorFilter=m;renderPublishModal()}
function setPubPeriod(p,el){publishPeriodFilter=p;renderPublishModal()}
function pubToggleAll(checked){
  document.querySelectorAll('.pub-course-cb').forEach(cb=>cb.checked=checked);
}

async function publishSelected(confirm_val){
  const ids=[...document.querySelectorAll('.pub-course-cb:checked')].map(cb=>cb.value);
  if(!ids.length){alert('请先勾选课程');return}
  const action=confirm_val?'发布':'取消发布';
  if(!confirm(`确定${action}所选 ${ids.length} 门课程？`)) return;
  try{
    for(const id of ids){
      await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'PATCH',{confirmed:confirm_val});
      cachedSessions.filter(s=>s.course_id===id).forEach(s=>s.confirmed=confirm_val);
    }
    renderPublishModal();
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已${action} ${ids.length} 门课程`);
  }catch(e){alert('操作失败：'+e.message)}
}
function openAddCourseModal(editId){
  document.getElementById('addCourseModalTitle').textContent=editId?'编辑课程':'手动添加课程';
  document.getElementById('ac_editing_id').value=editId||'';
  acRenderMajorCheckboxes();
  if(editId){
    const c=cachedCourses.find(x=>x.id===editId);
    if(!c) return;
    document.getElementById('ac_name').value=c.name||'';
    // set majors
    acSetMajors(c.major||[]);
    document.getElementById('ac_period').value=c.period||'';
    document.getElementById('ac_course_type').value=c.course_type||'';
    document.getElementById('ac_teacher').value=c.teacher||'';
    document.getElementById('ac_campus').value=c.campus||'';
    document.getElementById('ac_delivery').value=c.delivery||'';
    acSetWeekdayChips(c.weekdays||'');
    document.getElementById('ac_time_range').value=c.time_range||'';
    document.getElementById('ac_total').value=c.total_sessions||'';
    document.getElementById('ac_first_date').value=c.first_session_date||'';
    document.getElementById('ac_notes').value=c.notes||'';
    document.getElementById('ac_homework_enabled').value=c.homework_enabled?'true':'false';
    document.getElementById('ac_meeting_url').value=c.meeting_url||'';
    document.getElementById('ac_host_key').value=c.host_key||'';
    document.getElementById('ac_recording').value = c.needs_recording ? 'yes' : 'no';
    // set confirmed state
    const isConfirmed=cachedSessions.filter(s=>s.course_id===editId).every(s=>s.confirmed);
    document.getElementById('ac_confirm_publish').checked=isConfirmed;
    // load existing session details（编辑时始终展示明细表，date 按真实日期排序，便于直接调整）
    const sessions=cachedSessions.filter(s=>s.course_id===editId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
    // 有单回才勾「有单回明细」并展开明细表；没有单回的课（如排课来的）保持不勾、不展开
    const hasDetails=sessions.length>0;
    document.getElementById('ac_has_details').checked=hasDetails;
    document.getElementById('ac_details_section').style.display=hasDetails?'':'none';
    acPopulateRows(sessions.map(s=>({
      id:s.id,
      num:s.is_cancelled?'休讲':s.session_number,
      date:s.session_date,
      title:s.is_cancelled?(s.cancel_reason||'休讲'):(s.session_title||''),
      teacher:s.session_teacher||c.teacher||'',
      time_range:s.time_range||''
    })));
  } else {
    ['ac_name','ac_teacher','ac_campus','ac_time_range','ac_notes','ac_meeting_url','ac_host_key'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ac_recording').value = 'no';
    document.getElementById('ac_homework_enabled').value = 'false';
    ['ac_period','ac_course_type','ac_delivery'].forEach(id=>document.getElementById(id).value='');
    acSetWeekdayChips('');
    document.getElementById('ac_total').value='';
    document.getElementById('ac_first_date').value='';
    document.getElementById('ac_has_details').checked=false;
    acSetMajors([]);
    toggleAcDetails(false);
  }
  if(typeof acRenderHolidayExcept==='function') acRenderHolidayExcept();
  document.getElementById('addCourseModal').classList.add('open');
}

function acOnTypeChange(val){
  if(val==='共通课'){
    document.querySelectorAll('#ac_major_checkboxes input').forEach(cb=>cb.checked=true);
  }
}

// 动态生成课程专业勾选项（含社会人文组 + 全部真实专业；数据库新增专业自动出现）
function acRenderMajorCheckboxes(){
  const box=document.getElementById('ac_major_checkboxes');
  if(!box) return;
  box.innerHTML=majorFilterKeys().map(m=>
    `<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;white-space:nowrap"><input type="checkbox" value="${m}" style="accent-color:var(--accent)">${majorLabel(m)}</label>`
  ).join('');
}

function acGetMajors(){
  return [...document.querySelectorAll('#ac_major_checkboxes input:checked')].map(cb=>cb.value);
}

function acSetMajors(majors){
  document.querySelectorAll('#ac_major_checkboxes input').forEach(cb=>{
    cb.checked=majors.includes(cb.value);
  });
}

function toggleAcDetails(show){
  document.getElementById('ac_details_section').style.display=show?'':'none';
  if(show) acSyncRows();
}

function acSyncRows(){
  const total=parseInt(document.getElementById('ac_total').value)||0;
  if(!total){
    // 如果还没填回数，先显示空提示
    document.getElementById('ac_details_body').innerHTML=
      `<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text-3);font-size:11px">请先填写课程回数，再点「↺ 同步行数」</td></tr>`;
    return;
  }
  const teacher=document.getElementById('ac_teacher').value.trim();
  const existing=acGetRows().filter(r=>r.title||r.teacher);
  document.getElementById('ac_details_body').innerHTML='';
  for(let i=1;i<=total;i++){
    const ex=existing.find(r=>r.num===i)||{num:i,title:'',teacher};
    acAddRow(ex);
  }
}

function acPasteImport(){
  const raw=document.getElementById('ac_paste_input').value.trim();
  if(!raw){alert('请先粘贴数据');return}
  // handle Windows \r\n and Mac \r line endings
  const lines=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if(!lines.length) return;

  // 如果表格是空的或只有提示行，先同步行数
  const tbody=document.getElementById('ac_details_body');
  const hasRealRows=tbody.querySelectorAll('tr input').length>0;
  if(!hasRealRows) acSyncRows();

  // 再次获取行（同步后）
  lines.forEach((line,i)=>{
    const parts=line.split('\t');
    const title=(parts[0]||'').trim();
    const teacher=(parts[1]||'').trim();
    const rows=document.querySelectorAll('#ac_details_body tr');
    if(rows[i]){
      const inputs=rows[i].querySelectorAll('input');
      // input 顺序：[0]回数 [1]日期 [2]时间 [3]标题 [4]老师 —— 只改标题和老师
      if(inputs[3]&&title) inputs[3].value=title;
      if(inputs[4]&&teacher) inputs[4].value=teacher;
    } else {
      acAddRow({num:i+1,title,teacher});
    }
  });
  document.getElementById('ac_paste_input').value='';
  document.getElementById('ac_paste_area').style.display='none';
  // 给个确认提示
  const count=lines.length;
  const hint=document.createElement('div');
  hint.style.cssText='font-size:11px;color:var(--ok);margin-top:4px';
  hint.textContent=`✓ 已导入 ${count} 行`;
  const btn=document.querySelector('#ac_details_section .btn-outline:last-child');
  btn?.parentNode?.insertBefore(hint,btn);
  setTimeout(()=>hint.remove(),2500);
}

function acAddRow(data){
  const tbody=document.getElementById('ac_details_body');
  const rowNum=data?.num??(tbody.children.length+1);
  const tr=document.createElement('tr');
  tr.dataset.id=data?.id||'';
  tr.innerHTML=`
    <td style="width:64px"><input value="${rowNum}" placeholder="第几回" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);text-align:center;font-family:'DM Mono',monospace"></td>
    <td style="width:120px"><input type="date" value="${data?.date||''}" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg)"></td>
    <td style="width:100px"><input value="${data?.time_range||''}" placeholder="时间（如 10:00-12:00）" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><input value="${data?.title||''}" placeholder="单回名称（可留空，也可填「休讲」）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><input value="${data?.teacher||''}" placeholder="任课老师（可留空）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><button class="btn-ghost" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(tr);
}

// 周几多选 chip：读取点亮的（返回"周二,周四"），设置（按已有值点亮）
function acGetWeekdayChips(){
  return [...document.querySelectorAll('#ac_weekday_chips .filter-chip.active')].map(c=>c.dataset.wd).join(',');
}
function acSetWeekdayChips(str){
  const set=new Set(parseWeekdays(str)); // 兼容"周二,周四"/"2,4"/中文等各种格式
  document.querySelectorAll('#ac_weekday_chips .filter-chip').forEach(c=>{
    const wdNum=parseWeekdays(c.dataset.wd)[0]; // 该chip对应的数字(周日=0)
    c.classList.toggle('active', set.has(wdNum));
  });
}
function acGetRows(){
  return [...document.querySelectorAll('#ac_details_body tr')].map((tr)=>{
    const inputs=tr.querySelectorAll('input');
    return {
      id: tr.dataset.id||'',
      num: inputs[0]?.value.trim()||'',
      date: inputs[1]?.value||'',
      time_range: inputs[2]?.value.trim()||'',
      title: inputs[3]?.value.trim()||'',
      teacher: inputs[4]?.value.trim()||''
    };
  });
}
// 文本模式：把当前明细表格转成「回数|日期|时间|标题|老师」文本，显示文本区供批量修改
// ── 假期豁免：直接读写 sched_courses.holiday_except（与排课系统同一字段，两边同步）──
function acNextDay(d){ const nd=new Date(d+'T12:00:00'); nd.setDate(nd.getDate()+1); return nd.getFullYear()+'-'+String(nd.getMonth()+1).padStart(2,'0')+'-'+String(nd.getDate()).padStart(2,'0'); }
function acHolidayDates(h){ const out=[]; let d=h.start_date, g=0; const e=h.end_date||h.start_date; while(d&&d<=e&&g++<400){ out.push(d); d=acNextDay(d); } return out; }
function acRenderHolidayExcept(){
  const box=document.getElementById('ac_holiday_except'); if(!box) return;
  const editingId=document.getElementById('ac_editing_id').value;
  const co=editingId?cachedCourses.find(c=>c.id===editingId):null;
  if(!editingId){ box.innerHTML='<span style="font-size:10px;color:var(--text-3)">新课请先保存，再设置假期豁免</span>'; return; }
  const first=document.getElementById('ac_first_date').value||'';
  const end=(co&&co.end_date)||'';
  let hols=(typeof HOLIDAYS!=='undefined'?HOLIDAYS:[]).slice().sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||''));
  if(first){ hols=hols.filter(h=>{ const he=h.end_date||h.start_date; return (end? h.start_date<=end : true) && he>=first; }); }
  if(!hols.length){ box.innerHTML='<span style="font-size:10px;color:var(--text-3)">该课时间段内暂无全局假期</span>'; return; }
  const cur=new Set(((co&&co.holiday_except)||'').split(',').map(x=>x.trim()).filter(Boolean));
  box.innerHTML=hols.map(h=>{
    const on=acHolidayDates(h).some(x=>cur.has(x));
    const e=h.end_date||h.start_date;
    const range=h.start_date+(e!==h.start_date?('~'+e):'');
    return `<span onclick="acToggleHolidayExcept('${h.id}')" title="点击切换：这门课在该假期是否照常上课" style="cursor:pointer;font-size:10px;border:1px solid ${on?'var(--ok,#2a7a3a)':'var(--border)'};background:${on?'var(--ok-bg,#e8f4ea)':'transparent'};color:${on?'var(--ok,#2a7a3a)':'var(--text-2)'};border-radius:10px;padding:2px 10px;white-space:nowrap">${on?'✓ 照常上课':'放假'} · ${h.label||'假期'} <span style="opacity:.6">${range}</span></span>`;
  }).join('');
}
async function acToggleHolidayExcept(holId){
  const editingId=document.getElementById('ac_editing_id').value;
  const co=editingId?cachedCourses.find(c=>c.id===editingId):null;
  if(!co){ alert('请先保存课程，再设置假期豁免'); return; }
  if(!co._sched_id){ alert('这门课还没同步到排课系统，暂时无法设置豁免。\n请先在课程安排里保存一次（会同步到 sched），再回来设置。'); return; }
  const hol=(typeof HOLIDAYS!=='undefined'?HOLIDAYS:[]).find(h=>String(h.id)===String(holId));
  if(!hol) return;
  const exDates=acHolidayDates(hol);
  const cur=new Set((co.holiday_except||'').split(',').map(x=>x.trim()).filter(Boolean));
  const isOn=exDates.some(x=>cur.has(x));
  if(isOn){ exDates.forEach(x=>cur.delete(x)); } else { exDates.forEach(x=>cur.add(x)); }
  const newVal=[...cur].sort().join(',');
  try{
    await sb(`/rest/v1/sched_courses?id=eq.${co._sched_id}`,'PATCH',{holiday_except:newVal||null});
    co.holiday_except=newVal;
    acRenderHolidayExcept();
  }catch(e){ alert('保存豁免失败：'+e.message); }
}
// 按「休讲日 + 假期豁免」重算所有单回日期（豁免的假期照常上课、被顺延的课次拉回）。仅改表格，保存后写库。
function acRecomputeDates(){
  const firstDate=document.getElementById('ac_first_date').value;
  const weekdayStr=(typeof acGetWeekdayChips==='function')?acGetWeekdayChips():'';
  if(!firstDate||!weekdayStr){ alert('请先填「第一回日期」和「星期」再重算'); return; }
  const editingId=document.getElementById('ac_editing_id').value;
  const co=cachedCourses.find(c=>c.id===editingId)||{};
  const rows=acGetRows();
  const N=rows.length;
  if(!N){ alert('请先「同步行数」生成课次再重算'); return; }
  if(typeof computeSessionDates!=='function'){ alert('日期算法未加载'); return; }
  const dates=computeSessionDates({first_session_date:firstDate,weekdays:weekdayStr,skip_dates:co.skip_dates||'',holiday_except:co.holiday_except||''},N);
  if(dates.length!==N){ alert(`重算失败：算出 ${dates.length} 个日期、需要 ${N} 个（可能假期太多排不下，或星期设置有误）`); return; }
  const exN=(co.holiday_except||'').split(',').filter(Boolean).length;
  rows.forEach((r,i)=>{ r.date=dates[i]; });
  acSetRowsFromData(rows);
  alert(`已按休讲/豁免重算 ${N} 个单回日期${exN?`（含 ${exN} 个豁免日：照常上课不顺延）`:''}。\n请核对后点保存写入。`);
}
function acToggleTextMode(){
  const area=document.getElementById('ac_text_area');
  if(!area) return;
  if(area.style.display==='none'){
    const rows=acGetRows();
    document.getElementById('ac_text_input').value =
      rows.map(r=>[r.num,r.date,r.time_range,r.title,r.teacher].join('\t')).join('\n');
    area.style.display='block';
  } else {
    area.style.display='none';
  }
}
// 应用文本：解析每行「回数|日期|时间|标题|老师」回明细表格（保留原行的 id/作业绑定按回数对应）
// 把各种日期写法规整成 YYYY-MM-DD（<input type=date> 只认这个格式）
// 兼容：2026-07-16 / 2026/7/16 / 2026.7.16 / 2026年7月16日 等
function normalizeDateStr(s){
  s=String(s||'').trim();
  if(!s) return '';
  const m=s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if(m){
    const y=m[1], mo=String(m[2]).padStart(2,'0'), d=String(m[3]).padStart(2,'0');
    return `${y}-${mo}-${d}`;
  }
  return s; // 认不出就原样（若已是标准格式则前面已匹配）
}
function acApplyTextMode(){
  const text=document.getElementById('ac_text_input').value;
  const oldRows=acGetRows();
  const lines=text.split('\n').map(l=>l.replace(/\r$/,'')).filter(l=>l.trim());
  const maxCols=Math.max(...lines.map(l=>l.split('\t').length),1);
  const newRows=lines.map((l,i)=>{
    const p=l.split('\t').map(x=>x.trim());
    // 简略格式(<=3列)：按行序对应旧行，只改标题/老师，日期时间回数全保留
    if(maxCols<=3){
      const prev=oldRows[i]||{};
      return {
        id: prev.id||'', num: prev.num||String(i+1),
        date: prev.date||'', time_range: prev.time_range||'',
        title: (p[0]!==undefined&&p[0]!=='')?p[0]:(prev.title||''),
        teacher: (p[1]!==undefined&&p[1]!=='')?p[1]:(prev.teacher||'')
      };
    }
    // 完整格式(回数|日期|时间|标题|老师)：每列为空则保留原值，不覆盖
    const num=p[0]||String(i+1);
    const prev=oldRows.find(r=>String(r.num)===String(num))||oldRows[i]||{};
    return {
      id: prev.id||'', num,
      date: (p[1]&&p[1].trim())?normalizeDateStr(p[1]):(prev.date||''),
      time_range: (p[2]&&p[2].trim())?p[2]:(prev.time_range||''),
      title: p[3]!==undefined?p[3]:(prev.title||''),
      teacher: p[4]!==undefined?p[4]:(prev.teacher||'')
    };
  });
  if(!newRows.length){ alert('文本为空，未应用'); return; }
  acSetRowsFromData(newRows);
  document.getElementById('ac_text_area').style.display='none';
}
// 用给定数据重建明细表格行（复用 acAddRow）
function acSetRowsFromData(rows){
  const tbody=document.getElementById('ac_details_body');
  if(!tbody) return;
  tbody.innerHTML='';
  rows.forEach(r=>acAddRow(r));
}

async function saveAddCourse(){
  const name=document.getElementById('ac_name').value.trim();
  const period=document.getElementById('ac_period').value;
  const total=parseInt(document.getElementById('ac_total').value)||0;
  const firstDate=document.getElementById('ac_first_date').value;
  const weekdayStr=acGetWeekdayChips();
  if(!name){alert('请填写课程名称');return}
  if(!period){alert('请选择期数');return}
  if(!total||!firstDate||!weekdayStr){alert('请填写回数、第一回日期和星期');return}

  const majors=acGetMajors();
  if(!majors.length){alert('请至少选择一个专业');return}
  const weekdays=parseWeekdays(weekdayStr);
  const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
  const hasDetails=document.getElementById('ac_has_details').checked;
  const detailRows=hasDetails?acGetRows():[];
  const editingId=document.getElementById('ac_editing_id').value;

  const courseData={
    name,major:majors,period,
    course_type:document.getElementById('ac_course_type').value,
    teacher:document.getElementById('ac_teacher').value.trim(),
    campus:document.getElementById('ac_campus').value.trim(),
    delivery:document.getElementById('ac_delivery').value,
    weekdays:weekdayStr,
    time_range:document.getElementById('ac_time_range').value.trim(),
    actual_hours:parseFloat(document.getElementById('ac_actual_hours').value)||null,
    total_sessions:total,
    first_session_date:firstDate,
    notes:document.getElementById('ac_notes').value.trim(),
    homework_enabled:document.getElementById('ac_homework_enabled').value==='true',
    meeting_url:document.getElementById('ac_meeting_url').value.trim(),
    host_key:document.getElementById('ac_host_key').value.trim(),
    needs_recording:document.getElementById('ac_recording').value==='yes',
  };

  try{
    let courseId;
    if(editingId){
      await sb(`/rest/v1/courses?id=eq.${editingId}`,'PATCH',courseData);
      const idx=cachedCourses.findIndex(c=>c.id===editingId);
      if(idx>=0) cachedCourses[idx]={...cachedCourses[idx],...courseData};
      courseId=editingId;

      // ── 编辑模式：单回明细表是唯一真相来源，按行直接覆盖更新，不再按总回数重铺日期 ──
      // 这样可以保留休讲、调课等手动调整的结果，不会被「总回数」逻辑误删
      const existing=cachedSessions.filter(s=>s.course_id===editingId);
      const existingMap={}; existing.forEach(s=>{ existingMap[s.id]=s; });
      // 记录保存前的日期（按id），保存后对比，检测单回日期变动
      const oldDateById={}; existing.forEach(s=>{ oldDateById[s.id]=s.session_date; });

      const rows=detailRows; // 来自 acGetRows()：[{id,num,date,title,teacher}, ...]
      if(!rows.length){ alert('单回明细不能为空，至少需要一行课次'); return; }
      // 若首回日期变了：按新首回用 sched 算法重排所有单回日期（跳假期顺延），标题/老师保留
      const oldFirst=(existing[0]?.session_date)||'';
      const firstChanged = oldFirst && firstDate && oldFirst!==firstDate;
      if(firstChanged && typeof computeSessionDates==='function'){
        const N=rows.length;
        const _co=cachedCourses.find(c=>c.id===editingId)||{};
        const newDates=computeSessionDates({first_session_date:firstDate,weekdays:weekdayStr,skip_dates:_co.skip_dates||'',holiday_except:_co.holiday_except||''},N);
        if(newDates.length===N){
          rows.forEach((r,i)=>{ r.date=newDates[i]; });
        }
      }
      for(const r of rows){
        if(!r.date){ alert(`第「${r.num}」行缺少日期，请补全后再保存`); return; }
      }

      const rowIds=new Set(rows.filter(r=>r.id).map(r=>r.id));
      const toRemove=existing.filter(s=>!rowIds.has(s.id));

      // 检查将被删除的行是否已有出席/作业记录
      if(toRemove.length){
        const toRemoveIds=toRemove.map(s=>s.id);
        const records=await sb(`/rest/v1/session_records?session_id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})&select=id`).catch(()=>[]);
        if(records.length){
          alert('无法保存：表格中被删除的某些课次已有出席/作业记录，不能删除。请恢复该行或先处理相关记录。');
          return;
        }
        await sb(`/rest/v1/course_sessions?id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})`,'DELETE');
        cachedSessions=cachedSessions.filter(s=>!toRemoveIds.includes(s.id));
      }

      const confirmed=document.getElementById('ac_confirm_publish')?.checked ?? (existing[0]?.confirmed||false);
      const mainTeacher=courseData.teacher;

      for(const r of rows){
        const isCancelled = r.num==='休讲' || r.title==='休讲';
        const patchCommon={
          course_name:name, major:majors,
          session_date:r.date,
          session_number: isCancelled ? (existingMap[r.id]?.session_number ?? null) : (parseInt(r.num)||null),
          time_range:r.time_range||courseData.time_range,
          actual_hours:courseData.actual_hours,
          delivery:courseData.delivery,campus:courseData.campus,
          homework_enabled:courseData.homework_enabled,
          teacher:r.teacher||mainTeacher,
          session_title:r.title||'',
          session_teacher:r.teacher||mainTeacher,
          is_cancelled:isCancelled,
          cancel_reason:isCancelled?(r.title||'休讲'):null,
          confirmed,
        };
        if(r.id && existingMap[r.id]){
          // 已有记录：PATCH，id 不变，所有关联（出席/作业）保持
          await sb(`/rest/v1/course_sessions?id=eq.${r.id}`,'PATCH',patchCommon);
          Object.assign(existingMap[r.id],patchCommon);
        } else {
          // 表格里新增的行：新建记录
          const newRow={
            id:`s-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
            course_id:editingId,
            confirmed,
            ...patchCommon
          };
          const sres=await sb('/rest/v1/course_sessions','POST',[newRow]);
          cachedSessions.push(Array.isArray(sres)?sres[0]:newRow);
        }
      }

      closeModal('addCourseModal');
      renderCoursesPage(document.getElementById('mainContent'));
      // 检测单回日期是否有变动（改日期 / 休讲顺延 / 新增行）
      let dateChanged=false;
      for(const r of rows){
        if(r.id && oldDateById[r.id]!==undefined){ if(oldDateById[r.id]!==r.date) dateChanged=true; }
        else { dateChanged=true; } // 新增的行也算变动
      }
      if(dateChanged){
        if(confirm('课程已更新。\n\n检测到单回日期有变动（改期/休讲顺延/新增课次），这可能影响排课系统里的教室占用与腾讯会议安排。\n\n是否现在前往排课系统，为变动的日期确认/补上临时教室占用？')){
          const schedUrl=location.origin+location.pathname.replace(/admin\/.*$/,'sched/index.html');
          window.open(schedUrl,'_blank');
        }
      } else {
        alert('课程信息已更新，已同步到所有相关页面');
      }
      return;
    } else {
      courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      const res=await sb('/rest/v1/courses','POST',[{...courseData,id:courseId}]);
      cachedCourses.push(Array.isArray(res)?res[0]:{...courseData,id:courseId});
    }
    // 新增课程时生成课次
    if(dates.length){
      const confirmed=document.getElementById('ac_confirm_publish')?.checked||false;
      const sessions=dates.map((date,i)=>{
        const detail=detailRows.find(r=>r.num===i+1)||{};
        const mainTeacher=courseData.teacher;
        return {
          id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
          course_id:courseId,course_name:name,major:majors,
          session_date:date,session_number:i+1,
          time_range:detail.time_range||courseData.time_range,
          actual_hours:courseData.actual_hours,
          delivery:courseData.delivery,campus:courseData.campus,
          teacher:detail.teacher||mainTeacher,
          session_title:detail.title||'',
          session_teacher:detail.teacher||mainTeacher,
          confirmed
        };
      });
      for(let i=0;i<sessions.length;i+=20){
        const chunk=sessions.slice(i,i+20).map(s=>({...s,homework_enabled:courseData.homework_enabled||false}));
        const sres=await sb('/rest/v1/course_sessions','POST',chunk);
        cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
      }
    }
    closeModal('addCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert('添加成功！已生成 ' + dates.length + ' 个课次');
  }catch(e){alert('保存失败：'+e.message)}
}

function acPopulateRows(rows){
  document.getElementById('ac_details_body').innerHTML='';
  rows.forEach(r=>acAddRow(r));
}
function openEditCourse(id){
  const c=cachedCourses.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('ec_id').value=id;
  document.getElementById('ec_name').value=c.name||'';
  document.getElementById('ec_period').value=c.period||'7月期';
  document.getElementById('ec_course_type').value=c.course_type||'';
  document.getElementById('ec_teacher').value=c.teacher||'';
  document.getElementById('ec_campus').value=c.campus||'';
  document.getElementById('ec_delivery').value=c.delivery||'';
  document.getElementById('ec_weekdays').value=c.weekdays||'';
  document.getElementById('ec_time_range').value=c.time_range||'';
  document.getElementById('ec_actual_hours').value=c.actual_hours||'';
  document.getElementById('ec_total').value=c.total_sessions||'';
  document.getElementById('ec_first_date').value=c.first_session_date||'';
  document.getElementById('ec_notes').value=c.notes||'';
  document.getElementById('ec_homework_enabled').value=c.homework_enabled?'true':'false';
  document.getElementById('ec_meeting_url').value=c.meeting_url||'';
  document.getElementById('ec_host_key').value=c.host_key||'';
  document.getElementById('ec_recording').value = c.needs_recording ? 'yes' : 'no';
  document.getElementById('editCourseModal').classList.add('open');
}
async function saveEditCourse(){
  const id=document.getElementById('ec_id').value;
  const data={
    name:document.getElementById('ec_name').value.trim(),
    period:document.getElementById('ec_period').value,
    course_type:document.getElementById('ec_course_type').value.trim(),
    teacher:document.getElementById('ec_teacher').value.trim(),
    campus:document.getElementById('ec_campus').value.trim(),
    delivery:document.getElementById('ec_delivery').value,
    weekdays:document.getElementById('ec_weekdays').value.trim(),
    time_range:document.getElementById('ec_time_range').value.trim(),
    actual_hours:parseFloat(document.getElementById('ec_actual_hours').value)||null,
    total_sessions:parseInt(document.getElementById('ec_total').value)||0,
    first_session_date:document.getElementById('ec_first_date').value||null,
    notes:document.getElementById('ec_notes').value.trim(),
    homework_enabled:document.getElementById('ec_homework_enabled').value==='true',
    meeting_url:document.getElementById('ec_meeting_url').value.trim(),
    host_key:document.getElementById('ec_host_key').value.trim(),
    needs_recording:document.getElementById('ec_recording').value==='yes',
  };
  try{
    await sb(`/rest/v1/courses?id=eq.${id}`,'PATCH',data);
    const idx=cachedCourses.findIndex(c=>c.id===id);
    if(idx>=0) cachedCourses[idx]={...cachedCourses[idx],...data};
    closeModal('editCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}
async function regenerateSessions(){
  const id=document.getElementById('ec_id').value;
  const c=cachedCourses.find(x=>x.id===id);
  if(!c) return;
  const firstDate=document.getElementById('ec_first_date').value;
  const total=parseInt(document.getElementById('ec_total').value)||0;
  const wdStr=document.getElementById('ec_weekdays').value;
  const weekdays=parseWeekdays(wdStr);
  const timeRange=document.getElementById('ec_time_range').value.trim();
  if(!firstDate||!weekdays.length||!total){alert('请填写第一回日期、星期和回数');return}
  if(!confirm(`将删除该课程现有 ${cachedSessions.filter(s=>s.course_id===id).length} 个课次并重新生成 ${total} 个，是否继续？`))return;
  try{
    await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'DELETE');
    cachedSessions=cachedSessions.filter(s=>s.course_id!==id);
    const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
    const sessions=dates.map((date,i)=>({
      id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
      course_id:id,course_name:c.name,major:c.major,
      session_date:date,session_number:i+1,
      time_range:timeRange||c.time_range,teacher:c.teacher,
      session_teacher:c.teacher,
      delivery:c.delivery,campus:c.campus
    }));
    for(let i=0;i<sessions.length;i+=20){
      const chunk=sessions.slice(i,i+20);
      const res=await sb('/rest/v1/course_sessions','POST',chunk);
      cachedSessions.push(...(Array.isArray(res)?res:chunk));
    }
    // 同步保存新的first_session_date和total
    await sb(`/rest/v1/courses?id=eq.${id}`,'PATCH',{first_session_date:firstDate,total_sessions:total,weekdays:wdStr,time_range:timeRange});
    const idx=cachedCourses.findIndex(c=>c.id===id);
    if(idx>=0) Object.assign(cachedCourses[idx],{first_session_date:firstDate,total_sessions:total,weekdays:wdStr,time_range:timeRange});
    closeModal('editCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已重新生成 ${sessions.length} 个课次`);
  }catch(e){alert('操作失败：'+e.message)}
}

// ── 复制到新期数 ──
function openCopyPeriod(courseId){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c) return;
  document.getElementById('cp_source_ids').value=courseId;
  // 默认目标期为下一期
  const periods=['1月期','4月期','7月期','10月期'];
  const cur=c.period||'7月期';
  const next=periods[(periods.indexOf(cur)+1)%4];
  document.getElementById('cp_period').value=next;
  // 列出该课程的课次，每个显示一行让用户设置新第一回日期
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  document.getElementById('cp_courses_list').innerHTML=`
    <div style="margin-bottom:10px;font-size:11px;color:var(--text-2)">
      课程：<strong>${c.name}</strong>　讲师：${c.teacher||''}　${c.total_sessions}回　${c.weekdays||''}
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <label style="font-size:11px;color:var(--text-2);white-space:nowrap">新第一回日期</label>
      <input type="date" id="cp_first_date" style="flex:1">
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">系统将按「${c.weekdays||'星期'}」自动生成 ${c.total_sessions} 次课</div>`;
  document.getElementById('copyPeriodModal').classList.add('open');
}
async function confirmCopyPeriod(){
  const courseId=document.getElementById('cp_source_ids').value;
  const newPeriod=document.getElementById('cp_period').value;
  const newFirstDate=document.getElementById('cp_first_date').value;
  if(!newFirstDate){alert('请填写新第一回日期');return}
  const src=cachedCourses.find(c=>c.id===courseId);
  if(!src) return;
  const weekdays=parseWeekdays(src.weekdays||'');
  if(!weekdays.length){alert('原课程未设置星期，无法自动生成日期');return}
  const dates=generateSessionDatesFromFirst(newFirstDate,weekdays,src.total_sessions||0);
  if(!dates.length){alert('无法生成课次，请检查日期和星期设置');return}
  const btn=document.querySelector('#copyPeriodModal .btn-primary');
  btn.textContent='生成中…';btn.disabled=true;
  try{
    const newId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    // 用生成的课次首尾日期设置 start_date/end_date（sched 靠这两个显示日期区间）
    const newStart=dates[0];
    const newEnd=dates[dates.length-1];
    const newCourse={...src,id:newId,period:newPeriod,first_session_date:newFirstDate,start_date:newStart,end_date:newEnd,period_override:null};
    delete newCourse.created_at;
    const res=await sb('/rest/v1/courses','POST',[newCourse]);
    cachedCourses.push(Array.isArray(res)?res[0]:newCourse);
    const sessions=dates.map((date,i)=>({
      id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
      course_id:newId,course_name:src.name,major:src.major,
      session_date:date,session_number:i+1,
      time_range:src.time_range,teacher:src.teacher,
      session_teacher:src.teacher,
      delivery:src.delivery,campus:src.campus,
      actual_hours:src.actual_hours,
      homework_enabled:src.homework_enabled||false,
    }));
    for(let i=0;i<sessions.length;i+=20){
      const chunk=sessions.slice(i,i+20);
      const sres=await sb('/rest/v1/course_sessions','POST',chunk);
      cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
    }
    coursesPeriodFilter=newPeriod;
    closeModal('copyPeriodModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已复制到${newPeriod}，生成 ${sessions.length} 次课`);
  }catch(e){alert('操作失败：'+e.message)}
  finally{btn.textContent='复制并生成';btn.disabled=false}
}

// ── 休讲调整（标记休讲 + 内容顺延 + 末尾补课）──
function openReschedule(sessionId){
  const s=cachedSessions.find(x=>x.id===sessionId);
  if(!s) return;
  if(s.is_cancelled){ alert('该课次已标记为休讲'); return; }
  document.getElementById('rs_session_id').value=sessionId;
  document.getElementById('reschedule_sub').textContent=`${s.course_name} 第${s.session_number}回 · ${s.session_date}`;
  document.getElementById('rs_orig_date').value=s.session_date;
  document.getElementById('rs_reason').value='老师请假';
  document.getElementById('rs_note').value='';
  document.getElementById('rescheduleModal').classList.add('open');
}
async function confirmReschedule(){
  const id=document.getElementById('rs_session_id').value;
  const reason=document.getElementById('rs_reason').value;
  const note=document.getElementById('rs_note').value;
  const target=cachedSessions.find(x=>x.id===id);
  if(!target){alert('找不到该课次');return}

  const courseId=target.course_id;
  const allSessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const idx=allSessions.findIndex(s=>s.id===id);
  if(idx===-1){alert('找不到该课次');return}

  const course=cachedCourses.find(c=>c.id===courseId);
  const weekdays=parseWeekdays(course?.weekdays||'');
  const lastSession=allSessions[allSessions.length-1];
  const after=allSessions.slice(idx+1); // 休讲之后的所有课次（日期固定，等待填入顺延后的内容）

  if(!confirm(`确认将 ${target.session_date}（第${target.session_number}回）标记为休讲？\n该日期作废、不计入回数。被休讲掉的内容（连同之后所有内容）整体顺延一位，末尾新增一个日期承接原本最后一回的内容。\n\n如需更精细的手动调整（如改回数、改日期），可在「编辑课程」的单回明细表中直接修改。`)) return;

  try{
    // ── 第一步：在做任何修改之前，构造完整的「内容链」快照 ──
    // 内容链 = [target自己原本的内容, after[0]原本的内容, after[1]原本的内容, ..., after[n-1]原本的内容]
    // 共 after.length + 1 份，要依次贴到 [after[0]的日期, after[1]的日期, ..., after[n-1]的日期, 新增日期] 这 after.length+1 个日期上
    const contentChain = [
      { session_title: target.session_title, teacher: target.teacher, session_teacher: target.session_teacher },
      ...after.map(s => ({ session_title: s.session_title, teacher: s.teacher, session_teacher: s.session_teacher }))
    ];
    // contentChain[0] 是休讲那天原本的内容 → 贴到 after[0] 的日期上
    // contentChain[1] 是 after[0] 原本的内容 → 贴到 after[1] 的日期上
    // ...
    // contentChain[after.length] 是 after[after.length-1]（也就是 lastSession）原本的内容 → 贴到新增日期上

    // 1. 标记休讲：日期不变，不计入回数，内容清空
    await sb(`/rest/v1/course_sessions?id=eq.${id}`,'PATCH',{
      is_cancelled:true,
      cancel_reason:reason,
      cancel_note:note||null,
      session_title:'休讲',
      session_teacher:'',
    });
    target.is_cancelled=true; target.cancel_reason=reason; target.cancel_note=note||null;
    target.session_title='休讲'; target.session_teacher='';

    // 2. after 中每节课：日期不变，session_number 减 1，内容＝contentChain 中对应的「前一份」内容
    //    session_teacher 为空时退回用 teacher 字段兜底，避免老师端按 session_teacher 查询时漏掉这节课
    for(let i=0;i<after.length;i++){
      const s=after[i];
      const content=contentChain[i]; // 注意：是 contentChain[i] 不是 [i+1]，因为 contentChain[0] 就是要贴给 after[0] 的
      const teacherVal = content.teacher || s.teacher;
      const patch={
        session_number: s.session_number - 1,
        session_title: content.session_title || '',
        teacher: teacherVal,
        session_teacher: content.session_teacher || teacherVal || '',
      };
      await sb(`/rest/v1/course_sessions?id=eq.${s.id}`,'PATCH',patch);
      Object.assign(s,patch);
    }

    // 3. 新增补课日期，内容＝contentChain 最后一项（原本 lastSession 自己的内容）
    //    补课日跳过全局假期（与 sched 一致），避免补到放假日
    let newDate=new Date(lastSession.session_date+'T12:00:00');
    const fmtD=dt=>dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    do{
      newDate.setDate(newDate.getDate()+1);
    } while( (weekdays.length && !weekdays.includes(newDate.getDay())) || (typeof dateInHoliday==='function' && dateInHoliday(fmtD(newDate))) );
    const newDateStr=fmtD(newDate);
    const lastContent=contentChain[contentChain.length-1];
    const newTeacherVal = lastContent.teacher || lastSession.teacher;

    const newSession={
      id:`s-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      course_id:courseId,course_name:lastSession.course_name,major:lastSession.major,
      session_date:newDateStr,session_number:lastSession.session_number, // 原始最后编号（顺延前）
      time_range:lastSession.time_range,actual_hours:lastSession.actual_hours,
      delivery:lastSession.delivery,campus:lastSession.campus,
      teacher:newTeacherVal,
      session_title:lastContent.session_title||'',
      session_teacher:lastContent.session_teacher||newTeacherVal||'',
      homework_enabled:lastSession.homework_enabled,confirmed:lastSession.confirmed,
      is_cancelled:false
    };
    const sres=await sb('/rest/v1/course_sessions','POST',[newSession]);
    cachedSessions.push(Array.isArray(sres)?sres[0]:newSession);

    // 同步给 sched：休讲日加进 courses.skip_dates + 更新 end_date（触发器会推给 sched_courses，sched 重算即一致）
    try{
      const co=cachedCourses.find(x=>x.id===courseId);
      const skipSet=new Set(((co?.skip_dates)||'').split(',').map(s=>s.trim()).filter(Boolean));
      skipSet.add(target.session_date);
      const newSkip=[...skipSet].sort().join(',');
      await sb(`/rest/v1/courses?id=eq.${courseId}`,'PATCH',{skip_dates:newSkip,end_date:newDateStr});
      if(co){ co.skip_dates=newSkip; co.end_date=newDateStr; }
    }catch(e){ /* 同步失败不阻断休讲本身 */ }

    closeModal('rescheduleModal');
    renderCoursesPage(document.getElementById('mainContent'));
    if(confirm(`已将 ${target.session_date} 标记为休讲，内容顺延，末尾 ${newDateStr} 补第${newSession.session_number}回。\n\n新增的补课日期需要在排课系统确认教室占用（可能与其他课撞车）。是否现在前往排课系统确认？`)){
      const schedUrl=location.origin+location.pathname.replace(/admin\/.*$/,'sched/index.html');
      window.open(schedUrl,'_blank');
    }
  }catch(e){alert('操作失败：'+e.message)}
}

// ── 出席・作业（see attendance.js）──

// ── Shared ──
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){/* 点遮罩不再关闭，避免编辑时误触关闭；请用取消/关闭按钮 */}));

// ══════════════════════════════════
// SCHEDULE (课程预定) PAGE
// ══════════════════════════════════
let cachedScheduleSlots=[], cachedTeacherAvail=[], cachedTeachers=[];
let schedPeriodFilter='all', schedTypeFilter='all', schedCourseFilter='all';

function renderSchedulePage(mc){
  // 视角过滤后的课（筛选项来源，因地制宜——只列本视角实际有的期数）
  const viewCourses=cachedCourses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    return true;
  });
  // 带年份的期数列表（用季度 effectivePeriod，和其他页统一）
  const allPeriods=[...new Map(viewCourses
    .filter(c=>c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const per=effectivePeriod(c);const key=`${year}年${per}`;return [key,{key,period:per,year}]})
  ).values()].sort((a,b)=>a.key.localeCompare(b.key));

  // 按属性+期数+课程筛选
  let filteredCourses=viewCourses;
  if(schedTypeFilter==='共通课') filteredCourses=filteredCourses.filter(c=>c.course_type?.includes('共通'));
  else if(schedTypeFilter==='专业课') filteredCourses=filteredCourses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(schedTypeFilter==='VIP') filteredCourses=filteredCourses.filter(c=>c.course_type?.includes('VIP'));

  if(schedPeriodFilter!=='all'){
    const [filterYear,filterPeriod]=schedPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) filteredCourses=filteredCourses.filter(c=>effectivePeriod(c)===filterPeriod&&c.first_session_date?.startsWith(filterYear));
  }
  if(schedCourseFilter!=='all') filteredCourses=filteredCourses.filter(c=>c.id===schedCourseFilter);

  // 只显示有时间槽的课程的槽
  const filteredSlots=schedCourseFilter==='all'
    ?cachedScheduleSlots.filter(sl=>filteredCourses.find(c=>c.name===sl.course_name))
    :cachedScheduleSlots.filter(sl=>filteredCourses.find(c=>c.name===sl.course_name));

  const showPeriod=schedTypeFilter!=='VIP';

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程预定</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger btn-sm" onclick="clearAllScheduleSlots()" style="font-size:11px">🗑 清空全部</button>
      <button class="btn btn-primary btn-sm" onclick="switchPage('teachers')">👤 管理老师</button>
      <button class="btn btn-outline btn-sm" onclick="openCreateSlots()">＋ 创建时间槽</button>
    </div>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-start">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${schedTypeFilter===t?' active':''}" onclick="setSchedType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    ${showPeriod?`<div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${schedPeriodFilter==='all'?' active':''}" onclick="setSchedPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allPeriods.map(p=>`<div class="filter-chip${schedPeriodFilter===p.key?' active':''}" onclick="setSchedPeriod('${p.key}',this)" style="font-size:11px;padding:3px 10px">${p.key}</div>`).join('')}
      </div>
    </div>`:''}
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${schedCourseFilter==='all'?' active':''}" onclick="setSchedCourse('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${filteredCourses.slice(0,20).map(c=>`<div class="filter-chip${schedCourseFilter===c.id?' active':''}" onclick="setSchedCourse('${c.id}',this)" style="font-size:11px;padding:3px 10px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.name}（${c.first_session_date?.slice(0,4)||''}年${c.period||''}）">${c.name}</div>`).join('')}
      </div>
    </div>
  </div>

  ${!filteredSlots.length
    ?`<div class="empty" style="padding:60px 0">
        暂无排班时间槽<br>
        <span style="font-size:11px;color:var(--text-3);margin-top:6px;display:block">点击右上角「创建时间槽」，为需要确认老师的课次发送排班链接</span>
      </div>`
    :renderScheduleSlots(filteredSlots)
  }`;
}

function renderScheduleSlots(slots){
  const byCourse={};
  (slots||cachedScheduleSlots).forEach(slot=>{
    if(!byCourse[slot.course_name]) byCourse[slot.course_name]=[];
    byCourse[slot.course_name].push(slot);
  });

  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${Object.entries(byCourse).map(([courseName,courseSlots])=>{
      const course=cachedCourses.find(c=>c.name===courseName)||{};
      const color=courseColor(courseName,course);
      const yearStr=course.first_session_date?.slice(0,4)||'';
      const periodStr=course.period||'';
      // 按日期去重
      const byDate={};
      courseSlots.forEach(slot=>{
        if(!byDate[slot.session_date]) byDate[slot.session_date]={session_date:slot.session_date,time_range:slot.time_range,slots:[]};
        byDate[slot.session_date].slots.push(slot);
      });
      const dateSessions=Object.values(byDate).sort((a,b)=>a.session_date.localeCompare(b.session_date));
      // 从 course_sessions 读确认结果
      const confirmedFromCourse=cachedSessions.filter(s=>s.course_name===courseName&&s.session_title&&s.session_teacher);
      const confirmedCount=confirmedFromCourse.length;
      const totalCount=dateSessions.length;
      const allConfirmed=confirmedCount>=totalCount&&totalCount>0;

      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
        <div style="background:${color.bg};color:${color.text};padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;font-weight:600">${courseName}</span>
            ${yearStr?`<span style="font-size:10px;opacity:.6;background:rgba(0,0,0,.08);border-radius:2px;padding:1px 5px">${yearStr}年${periodStr}</span>`:''}
            <span style="font-size:10px;opacity:.7">已确认 ${confirmedCount}/${totalCount} 回</span>
            ${allConfirmed?`<span style="font-size:10px;background:rgba(42,158,106,.25);color:#1a5a3a;border-radius:2px;padding:1px 6px;font-weight:600">✓ 排课完成</span>`:''}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button onclick="copyTeacherLinks('${courseName}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">📋 复制链接</button>
            <button onclick="openScheduleSummary('${courseName}')" style="font-size:10px;background:rgba(255,255,255,.5);border:1px solid rgba(0,0,0,.2);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text};font-weight:600">📊 排课汇总</button>
            ${allConfirmed?`<button onclick="openCompleteSchedule('${courseName}')" style="font-size:10px;background:rgba(42,158,106,.2);border:1px solid rgba(42,158,106,.4);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:#1a5a3a;font-weight:600">✓ 归档</button>`:''}
          </div>
        </div>
        <table class="student-table" style="margin:0">
          <thead><tr>
            <th style="width:55px">序号</th><th style="width:100px">日期</th><th style="width:120px">时间</th>
            <th>可上老师</th><th style="width:150px">单回内容</th><th style="width:130px">确认老师</th><th style="width:36px"></th>
          </tr></thead>
          <tbody>
            ${dateSessions.map((ds,idx)=>{
              const f=fmtSessionDate(ds.session_date);
              // 从 course_sessions 读确认结果
              const csSession=cachedSessions.find(s=>s.course_name===courseName&&s.session_date===ds.session_date&&s.session_title);
              const confirmedTitle=csSession?.session_title||'';
              const confirmedTeacher=csSession?.session_teacher||'';
              const isConfirmed=!!(confirmedTitle&&confirmedTeacher);
              // 可上老师
              const allAvailTeachers=[];
              ds.slots.forEach(slot=>{
                cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
                  if(!allAvailTeachers.find(x=>x.name===a.teacher_name))
                    allAvailTeachers.push({name:a.teacher_name,time:a.available_time||''});
                });
              });
              const allTeacherNames=[...new Set(ds.slots.flatMap(sl=>sl.teacher_names||[]))];
              const firstSlot=ds.slots[0];
              const slotIds=JSON.stringify(ds.slots.map(s=>s.id));
              return `<tr style="${isConfirmed?'background:var(--ok-bg)':''}">
                <td style="font-size:11px;color:var(--text-3)">${idx+1}</td>
                <td style="font-size:12px;font-weight:600">${f.short} <span style="color:${f.dowColor};font-size:10px">${f.dow}</span></td>
                <td style="font-size:11px">${ds.time_range||''}</td>
                <td>
                  ${allAvailTeachers.length
                    ?allAvailTeachers.map(t=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px;margin:1px;display:inline-block">${t.name}${t.time?' · '+t.time:''}</span>`).join('')
                    :`<span style="font-size:11px;color:var(--text-3)">等待回复</span>`}
                </td>
                <td style="font-size:11px;${isConfirmed?'color:var(--ok);font-weight:600':'color:var(--text-3)'}">
                  ${confirmedTitle||'—'}
                </td>
                <td>
                  ${isConfirmed
                    ?`<span style="color:var(--ok);font-size:11px;font-weight:600">✓ ${confirmedTeacher}</span>`
                    :`<select onchange="confirmSlotTeacher('${firstSlot?.id}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
                        <option value="">— 选择老师 —</option>
                        ${allAvailTeachers.map(t=>`<option value="${t.name}">${t.name}</option>`).join('')}
                        ${allTeacherNames.filter(n=>!allAvailTeachers.find(x=>x.name===n)).map(n=>`<option value="${n}">${n}（未回复）</option>`).join('')}
                      </select>`}
                </td>
                <td><button class="btn-ghost" onclick="deleteSessionSlots(${slotIds})">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}
  </div>`;
}


function setSchedType(t,el){schedTypeFilter=t;if(t==='VIP')schedPeriodFilter='all';renderSchedulePage(document.getElementById('mainContent'))}
function setSchedPeriod(p,el){schedPeriodFilter=p;renderSchedulePage(document.getElementById('mainContent'))}
function setSchedCourse(id,el){schedCourseFilter=id;renderSchedulePage(document.getElementById('mainContent'))}
async function clearAllScheduleSlots(){
  if(!confirm('确定清空所有排班时间槽和老师回复数据？此操作不可恢复。'))return;
  try{
    await sb('/rest/v1/teacher_availability?id=neq.null','DELETE').catch(()=>{});
    await sb('/rest/v1/schedule_slots?id=neq.null','DELETE');
    cachedScheduleSlots=[];cachedTeacherAvail=[];
    renderSchedulePage(document.getElementById('mainContent'));
    alert('已清空所有排班数据');
  }catch(e){alert('操作失败：'+e.message)}
}

async function confirmSlotTeacher(slotId,teacher){
  if(!teacher) return;
  try{
    await sb(`/rest/v1/schedule_slots?id=eq.${slotId}`,'PATCH',{confirmed_teacher:teacher,status:'confirmed'});
    const slot=cachedScheduleSlots.find(s=>s.id===slotId);
    if(slot){slot.confirmed_teacher=teacher;slot.status='confirmed'}
    // 同步到 course_sessions
    if(slot?.session_id){
      await sb(`/rest/v1/course_sessions?id=eq.${slot.session_id}`,'PATCH',{session_teacher:teacher});
      const sess=cachedSessions.find(s=>s.id===slot.session_id);
      if(sess) sess.session_teacher=teacher;
    }
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}

async function unconfirmSlot(slotId){
  try{
    await sb(`/rest/v1/schedule_slots?id=eq.${slotId}`,'PATCH',{confirmed_teacher:null,confirmed_title:null,status:'pending'});
    const slot=cachedScheduleSlots.find(s=>s.id===slotId);
    if(slot){slot.confirmed_teacher=null;slot.confirmed_title=null;slot.status='pending'}
    // also clear session_teacher on course_session
    if(slot?.session_id) await sb(`/rest/v1/course_sessions?id=eq.${slot.session_id}`,'PATCH',{session_teacher:''}).catch(()=>{});
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

async function deleteSessionSlots(slotIds){
  if(!confirm('确定删除此回的所有排班时间槽？'))return;
  try{
    for(const id of slotIds){
      await sb(`/rest/v1/teacher_availability?slot_id=eq.${id}`,'DELETE').catch(()=>{});
      await sb(`/rest/v1/schedule_slots?id=eq.${id}`,'DELETE');
      cachedTeacherAvail=cachedTeacherAvail.filter(a=>a.slot_id!==id);
      cachedScheduleSlots=cachedScheduleSlots.filter(s=>s.id!==id);
    }
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

function copyTeacherLinks(courseName){
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  const teacherNames=[...new Set(slots.flatMap(s=>s.teacher_names||[]))];
  const base=location.origin+location.pathname.replace(/\/admin\/.*$/,'/teacher/');
  const links=teacherNames.map(name=>`${name}：${base}?teacher=${encodeURIComponent(name)}`).join('\n');
  navigator.clipboard.writeText(links).then(()=>alert('已复制所有老师链接：\n\n'+links)).catch(()=>alert('链接：\n\n'+links));
}

// ── 创建时间槽 modal ──
// ── 创建时间槽 ──
let csTypeFilter='全部';
let csSelectedTitles=new Set();

function openCreateSlots(){
  csTypeFilter='全部';
  csSelectedTitles=new Set();
  document.getElementById('cs_time_range_2').value='';
  document.getElementById('cs_weekday_2').value='';
  // init type chips
  document.querySelectorAll('#cs_type_chips .filter-chip').forEach((el,i)=>{
    el.classList.toggle('active',i===0);
  });
  csPopulatePeriods();
  csFilterCourses();
  document.getElementById('createSlotsModal').classList.add('open');
}

function csSetType(t,el){
  csTypeFilter=t;
  document.querySelectorAll('#cs_type_chips .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  csPopulatePeriods();
  csFilterCourses();
}

function csPopulatePeriods(){
  let courses=cachedCourses;
  courses=courses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    return true;
  });
  if(csTypeFilter!=='全部'){
    if(csTypeFilter==='共通课') courses=courses.filter(c=>c.course_type?.includes('共通'));
    else if(csTypeFilter==='专业课') courses=courses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
    else if(csTypeFilter==='VIP') courses=courses.filter(c=>c.course_type?.includes('VIP'));
  }
  const periods=[...new Map(courses.filter(c=>c.period&&c.first_session_date).map(c=>{
    const year=c.first_session_date.slice(0,4);
    const key=`${year}年${c.period}`;
    return [key,key];
  })).values()].sort();
  const sel=document.getElementById('cs_period');
  sel.innerHTML=`<option value="">全部期数</option>`+periods.map(p=>`<option value="${p}">${p}</option>`).join('');
}

function csFilterCourses(){
  let courses=cachedCourses;
  // 视角过滤（跟随链接）：非总览只看当前领域/专业的课
  courses=courses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    return true;
  });
  if(csTypeFilter!=='全部'){
    if(csTypeFilter==='共通课') courses=courses.filter(c=>c.course_type?.includes('共通'));
    else if(csTypeFilter==='专业课') courses=courses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
    else if(csTypeFilter==='VIP') courses=courses.filter(c=>c.course_type?.includes('VIP'));
  }
  const periodVal=document.getElementById('cs_period').value;
  if(periodVal){
    const [filterYear,filterPeriod]=periodVal.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) courses=courses.filter(c=>c.period===filterPeriod&&c.first_session_date?.startsWith(filterYear));
  }
  const sel=document.getElementById('cs_course');
  sel.innerHTML=courses.length
    ?courses.map(c=>`<option value="${c.id}">${c.name}（${c.first_session_date?.slice(0,4)||''}年${c.period||''}）</option>`).join('')
    :'<option value="">暂无匹配课程</option>';
  onCreateSlotCourseChange();
}

function onCreateSlotCourseChange(){
  csSelectedTitles=new Set();
  const courseId=document.getElementById('cs_course').value;
  const course=cachedCourses.find(c=>c.id===courseId);
  if(!course){
    document.getElementById('cs_sessions_preview').innerHTML='<span style="color:var(--text-3)">请先选择课程</span>';
    document.getElementById('cs_titles_select').innerHTML='<span style="font-size:11px;color:var(--text-3)">选择课程后显示</span>';
    document.getElementById('cs_teachers_list').innerHTML='';
    return;
  }
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const existingIds=new Set(cachedScheduleSlots.map(s=>s.session_id));
  const newCount=sessions.filter(s=>!existingIds.has(s.id)).length;

  document.getElementById('cs_sessions_preview').innerHTML=sessions.length
    ?`共 <strong>${sessions.length}</strong> 个课次，<strong style="color:var(--ok)">${newCount}</strong> 个待创建，${sessions.length-newCount} 个已存在<br>
      <span style="color:var(--text-3)">${sessions.slice(0,6).map(s=>{const d=new Date(s.session_date+'T12:00:00');return `${d.getMonth()+1}/${d.getDate()}`}).join(' · ')}${sessions.length>6?` … 共${sessions.length}回`:''}</span>`
    :'该课程暂无课次';

  // 从 session_teacher 推算每位老师负责的内容
  const teacherTitleMap={};
  sessions.forEach(s=>{
    if(!s.session_teacher) return;
    const teachers=s.session_teacher.split(/[/／,，]/).map(t=>t.trim()).filter(Boolean);
    teachers.forEach(t=>{
      if(!teacherTitleMap[t]) teacherTitleMap[t]=new Set();
      if(s.session_title) teacherTitleMap[t].add(s.session_title);
    });
  });
  const hasTeacherMapping=Object.keys(teacherTitleMap).length>0;

  // 显示老师-内容对应（自动推算）
  document.getElementById('cs_titles_select').innerHTML=hasTeacherMapping
    ?`<div style="width:100%">
        <div style="font-size:10px;color:var(--ok);margin-bottom:6px">✓ 已从单回明细自动识别老师和内容对应关系</div>
        ${Object.entries(teacherTitleMap).map(([teacher,titles])=>`
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:600;min-width:60px;padding-top:2px">${teacher}</span>
            <div style="display:flex;flex-wrap:wrap;gap:3px">
              ${[...titles].map(t=>`<span style="background:var(--surface);border:1px solid var(--border);border-radius:2px;padding:1px 7px;font-size:10px">${t}</span>`).join('')}
              ${!titles.size?'<span style="font-size:10px;color:var(--text-3)">全部内容</span>':''}
            </div>
          </div>`).join('')}
      </div>`
    :'<span style="font-size:11px;color:var(--text-3)">该课程单回明细未填写任课老师，请手动选择老师</span>';

  // 老师列表：有明细的自动勾选，没有的显示全部让手动选
  const autoTeachers=Object.keys(teacherTitleMap);
  document.getElementById('cs_teachers_list').innerHTML=cachedTeachers.length
    ?cachedTeachers.map(t=>{
        const isAuto=autoTeachers.includes(t.name);
        const titles=teacherTitleMap[t.name]?[...teacherTitleMap[t.name]]:[];
        return `<label style="display:flex;align-items:center;gap:5px;padding:4px 8px;background:${isAuto?'var(--ok-bg)':'var(--bg)'};border:1px solid ${isAuto?'var(--ok)':'var(--border-light)'};border-radius:2px;cursor:pointer;font-size:11px">
          <input type="checkbox" value="${t.name}" ${isAuto?'checked':''} data-titles="${titles.join('|')}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;min-width:16px">
          ${t.name}${isAuto&&titles.length?`<span style="font-size:9px;color:var(--ok)">(${titles.join('・')})</span>`:''}
        </label>`;
      }).join('')
    :'<span style="font-size:11px;color:var(--text-3)">暂无老师，请先在「管理老师」中添加</span>';
}

async function confirmCreateSlots(){
  const courseId=document.getElementById('cs_course').value;
  const course=cachedCourses.find(c=>c.id===courseId);
  if(!course){alert('请选择课程');return}
  const checkedTeachers=[...document.querySelectorAll('#cs_teachers_list input[type=checkbox]:checked')];
  if(!checkedTeachers.length){alert('请选择至少一位候选老师');return}
  const timeRange2=document.getElementById('cs_time_range_2').value.trim();
  const weekday2=document.getElementById('cs_weekday_2')?.value||'';
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const existingIds=new Set(cachedScheduleSlots.map(s=>s.session_id));
  const newSessions=sessions.filter(s=>!existingIds.has(s.id));
  if(!newSessions.length){alert('该课程所有课次已创建过时间槽');return}

  const btn=document.getElementById('createSlotsConfirmBtn');
  btn.textContent='创建中…';btn.disabled=true;
  try{
    // 为每位老师分别创建slots，带上他自己的内容
    for(const cb of checkedTeachers){
      const teacherName=cb.value;
      const titles=cb.dataset.titles?cb.dataset.titles.split('|').filter(Boolean):[];
      // 如果没有titles（手动选的），用所有单回内容
      const allTitles=titles.length?titles:[...new Set(sessions.map(s=>s.session_title).filter(Boolean))];
      const slots=newSessions.map(s=>({
        id:`sl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        session_id:s.id,course_name:course.name,
        session_date:s.session_date,session_number:s.session_number,
        time_range:s.time_range||course.time_range||'',
        time_range_2:timeRange2||null,
        weekday_2:weekday2||null,
        teacher_names:[teacherName],
        session_titles:allTitles.length?allTitles:null,
        status:'pending'
      }));
      for(let i=0;i<slots.length;i+=20){
        const chunk=slots.slice(i,i+20);
        const res=await sb('/rest/v1/schedule_slots','POST',chunk);
        cachedScheduleSlots.push(...(Array.isArray(res)?res:chunk));
      }
      await new Promise(r=>setTimeout(r,80));
    }
    closeModal('createSlotsModal');
    renderSchedulePage(document.getElementById('mainContent'));
    alert(`已为 ${checkedTeachers.map(cb=>cb.value).join('・')} 分别创建排班时间槽`);
  }catch(e){alert('创建失败：'+e.message);btn.textContent='确认创建';btn.disabled=false}
}

// ── 排课汇总 ──
let arrangementDraft={}; // {slotId: {teacher, title}}

function openScheduleSummary(courseName){
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const course=cachedCourses.find(c=>c.name===courseName)||{};
  const year=course.first_session_date?.slice(0,4)||'';
  const uniqueDates=[...new Map(slots.map(s=>[s.session_date,s])).values()];
  document.getElementById('scheduleSummarySub').textContent=`${courseName}\u3000${year}年${course.period||''}\u3000共${uniqueDates.length}课次`;
  arrangementDraft={};
  // 只恢复本次排课汇总手动确认的（不从course_sessions读旧数据）
  renderSummaryBody(slots,courseName);
  document.getElementById('scheduleSummaryModal').classList.add('open');
}

function renderSummaryBody(slots,courseName){
  const allTitles=[...new Set(slots.flatMap(s=>s.session_titles||[]))];
  // 按日期去重
  const dateMap=new Map();
  slots.forEach(slot=>{
    if(!dateMap.has(slot.session_date)) dateMap.set(slot.session_date,{date:slot.session_date,time_range:slot.time_range,slots:[]});
    dateMap.get(slot.session_date).slots.push(slot);
  });
  const dates=[...dateMap.values()].sort((a,b)=>a.date.localeCompare(b.date));

  // 老师-内容对应（优先用老师回复里的preferred_titles）
  const teacherTitleMap={};
  cachedTeacherAvail.filter(a=>slots.find(s=>s.id===a.slot_id)).forEach(a=>{
    if(!teacherTitleMap[a.teacher_name]) teacherTitleMap[a.teacher_name]=new Set();
    if(a.preferred_titles?.length) a.preferred_titles.forEach(t=>teacherTitleMap[a.teacher_name].add(t));
    else (slots.find(s=>s.id===a.slot_id)?.session_titles||[]).forEach(t=>teacherTitleMap[a.teacher_name].add(t));
  });

  document.getElementById('scheduleSummaryBody').innerHTML=`
  ${allTitles.length?`<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--text-2)">
    本期单回内容：${allTitles.map(t=>`<span style="background:var(--surface);border:1px solid var(--border);border-radius:2px;padding:1px 7px;margin-right:4px">${t}</span>`).join('')}
  </div>`:''}
  <table class="student-table" style="margin:0">
    <thead><tr>
      <th style="width:50px">序号</th><th style="width:90px">日期</th><th style="width:110px">时间</th>
      <th>当天有空的老师</th><th style="width:150px">单回内容</th><th style="width:150px">上课老师</th><th style="width:55px">状态</th>
    </tr></thead>
    <tbody>
      ${dates.map((d,idx)=>{
        const f=fmtSessionDate(d.date);
        const draft=arrangementDraft[d.date]||{};
        const isConfirmed=!!(draft.session_id||draft.confirmed);
        const availOnDate=[];
        d.slots.forEach(slot=>{
          cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
            if(!availOnDate.find(x=>x.name===a.teacher_name))
              availOnDate.push({name:a.teacher_name,time:a.available_time||'',dow:a.preferred_dow||'',date:a.preferred_date||''});
          });
        });
        const selectedTitle=draft.title||'';
        const teachersForTitle=selectedTitle
          ?availOnDate.filter(t=>!teacherTitleMap[t.name]?.size||teacherTitleMap[t.name]?.has(selectedTitle))
          :availOnDate;
        return `<tr style="${isConfirmed?'background:var(--ok-bg)':''}">
          <td style="font-size:11px;color:var(--text-3)">${idx+1}</td>
          ${(() => {
            // 取老师偏好日期中出现最多的那个，否则用原始日期
            const prefDates = availOnDate.filter(t=>t.date).map(t=>t.date);
            const preferredDate = prefDates.length ? prefDates.sort((a,b)=>prefDates.filter(x=>x===b).length-prefDates.filter(x=>x===a).length)[0] : null;
            const showDate = preferredDate || d.date;
            const sd = new Date(showDate+'T12:00:00');
            const sdFmt = fmtSessionDate(showDate);
            const isChanged = showDate !== d.date;
            return `<td style="font-size:12px;font-weight:600;color:${isChanged?'var(--accent)':'inherit'}">
              ${sdFmt.short} <span style="color:${sdFmt.dowColor};font-size:10px">${sdFmt.dow}</span>
              ${isChanged?`<div style="font-size:10px;color:var(--text-muted);text-decoration:line-through">${f.short} ${f.dow}</div>`:''}
            </td>`;
          })()}
          <td style="font-size:11px">${d.time_range||''}</td>
          <td>
            ${availOnDate.length
              ?availOnDate.map(t=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px;margin:1px;display:inline-block">${t.name}${t.dow?' · '+t.dow:''}${t.date?' ('+t.date+')':''}${t.time?' · '+t.time:''}${teacherTitleMap[t.name]?.size?` (${[...teacherTitleMap[t.name]].join('/')})`:''}</span>`).join('')
              :`<span style="font-size:11px;color:var(--danger)">暂无</span>`}
          </td>
          <td>
            <select id="title-${d.date}" onchange="onSummaryTitleChange('${d.date}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
              <option value="">— 选内容 —</option>
              ${allTitles.map(t=>`<option value="${t}" ${draft.title===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </td>
          <td>
            <select id="teacher-${d.date}" onchange="onSummaryTeacherChange('${d.date}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
              <option value="">— 选老师 —</option>
              ${teachersForTitle.map(t=>`<option value="${t.name}" ${draft.teacher===t.name?'selected':''}>${t.name}</option>`).join('')}
              ${availOnDate.filter(t=>!teachersForTitle.find(x=>x.name===t.name)).map(t=>`<option value="${t.name}" ${draft.teacher===t.name?'selected':''}>${t.name}（其他内容）</option>`).join('')}
            </select>
          </td>
          <td style="font-size:10px;color:${isConfirmed?'var(--ok)':availOnDate.length?'var(--warn)':'var(--danger)'}">
            ${isConfirmed?'✓ 已定':availOnDate.length?'待确认':'⚠ 无人'}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function onSummaryTitleChange(date,title){
  if(!arrangementDraft[date]) arrangementDraft[date]={};
  arrangementDraft[date].title=title;
  arrangementDraft[date].teacher='';
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  renderSummaryBody(slots,courseName);
}
function onSummaryTeacherChange(date,teacher){
  if(!arrangementDraft[date]) arrangementDraft[date]={};
  arrangementDraft[date].teacher=teacher;
}
function setDraftTeacher(k,v){if(!arrangementDraft[k])arrangementDraft[k]={};arrangementDraft[k].teacher=v;}
function setDraftTitle(k,v){if(!arrangementDraft[k])arrangementDraft[k]={};arrangementDraft[k].title=v;}


function autoArrange(){
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  const allTitles=[...new Set(slots.flatMap(s=>s.session_titles||[]))];
  // 按日期去重
  const dateMap=new Map();
  slots.forEach(slot=>{
    if(!dateMap.has(slot.session_date)) dateMap.set(slot.session_date,{date:slot.session_date,slots:[]});
    dateMap.get(slot.session_date).slots.push(slot);
  });
  const dates=[...dateMap.values()].sort((a,b)=>a.date.localeCompare(b.date));
  // 老师-内容对应
  const teacherTitleMap={};
  cachedTeacherAvail.filter(a=>slots.find(s=>s.id===a.slot_id)).forEach(a=>{
    if(!teacherTitleMap[a.teacher_name]) teacherTitleMap[a.teacher_name]=new Set();
    if(a.preferred_titles?.length) a.preferred_titles.forEach(t=>teacherTitleMap[a.teacher_name].add(t));
    else (slots.find(s=>s.id===a.slot_id)?.session_titles||[]).forEach(t=>teacherTitleMap[a.teacher_name].add(t));
  });
  // 跳过已确认
  const unconfirmedDates=dates.filter(d=>!arrangementDraft[d.date]?.session_id);
  // 每个内容要分配一次
  const titleAssigned=new Set(Object.values(arrangementDraft).map(v=>v.title).filter(Boolean));
  const remainingTitles=allTitles.filter(t=>!titleAssigned.has(t));
  const teacherUsed={};
  let done=0;
  for(const d of unconfirmedDates){
    if(done>=remainingTitles.length) break;
    const availOnDate=[];
    d.slots.forEach(slot=>{
      cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
        if(!availOnDate.find(x=>x.name===a.teacher_name)) availOnDate.push(a.teacher_name);
      });
    });
    if(!availOnDate.length) continue;
    // 找一个还没分配的内容，且当天有人能上
    for(const title of remainingTitles){
      if(titleAssigned.has(title)) continue;
      const capable=availOnDate.filter(t=>!teacherTitleMap[t]?.size||teacherTitleMap[t]?.has(title));
      if(!capable.length) continue;
      const best=capable.sort((a,b)=>(teacherUsed[a]||0)-(teacherUsed[b]||0))[0];
      arrangementDraft[d.date]={title,teacher:best};
      teacherUsed[best]=(teacherUsed[best]||0)+1;
      titleAssigned.add(title);
      done++;
      break;
    }
  }
  renderSummaryBody(slots,courseName);
  alert(`自动排课完成：已分配 ${done} 个课次`);
}

async function confirmArrangement(){
  const entries=Object.entries(arrangementDraft).filter(([,v])=>v.title&&v.teacher&&!v.session_id);
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const allSlots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  if(!entries.length){
    const allDates=[...new Set(allSlots.map(s=>s.session_date))];
    const allDone=allDates.every(d=>arrangementDraft[d]?.session_id||arrangementDraft[d]?.confirmed);
    if(allDone) openCompleteSchedule(courseName);
    else alert('请先选择内容和老师');
    return;
  }
  if(!confirm(`确认将 ${entries.length} 个课次的排课结果同步到课程安排？`))return;
  try{
    let synced=0;
    for(const [date,{title,teacher}] of entries){
      const session=cachedSessions.find(s=>s.course_name===courseName&&s.session_date===date);
      if(session){
        // 取老师偏好日期（如果有）
        const allSlotIds=cachedScheduleSlots.filter(s=>s.course_name===courseName&&s.session_date===date).map(s=>s.id);
        const prefDates=cachedTeacherAvail.filter(a=>allSlotIds.includes(a.slot_id)&&a.available&&a.preferred_date).map(a=>a.preferred_date);
        const preferredDate=prefDates.length ? prefDates.sort((a,b)=>prefDates.filter(x=>x===b).length-prefDates.filter(x=>x===a).length)[0] : null;
        const finalDate=preferredDate||date;
        const patchData={session_title:title,session_teacher:teacher};
        if(preferredDate&&preferredDate!==date) patchData.session_date=preferredDate;
        await sb(`/rest/v1/course_sessions?id=eq.${session.id}`,'PATCH',patchData);
        session.session_title=title;session.session_teacher=teacher;
        if(patchData.session_date) session.session_date=patchData.session_date;
        arrangementDraft[date].session_id=session.id;
        arrangementDraft[date].confirmed=true;
        synced++;
      }
      const relatedSlots=cachedScheduleSlots.filter(s=>s.course_name===courseName&&s.session_date===date);
      for(const slot of relatedSlots){
        if((slot.teacher_names||[]).includes(teacher)){
          await sb(`/rest/v1/schedule_slots?id=eq.${slot.id}`,'PATCH',{confirmed_teacher:teacher,confirmed_title:title,status:'confirmed'});
          slot.confirmed_teacher=teacher;slot.confirmed_title=title;slot.status='confirmed';
        }
      }
    }
    // re-render summary
    renderSummaryBody(allSlots,courseName);
    // update courses page in background
    if(curPage==='courses') renderCoursesPage(document.getElementById('mainContent'));
    // check if all done → show complete button
    const allDates=[...new Set(allSlots.map(s=>s.session_date))];
    const allDone=allDates.every(d=>arrangementDraft[d]?.session_id||arrangementDraft[d]?.confirmed);
    const actionsEl=document.querySelector('#scheduleSummaryModal .modal-actions');
    if(allDone&&actionsEl&&!document.getElementById('completeScheduleBtn')){
      const btn=document.createElement('button');
      btn.id='completeScheduleBtn';
      btn.className='btn';
      btn.style.cssText='background:var(--ok);color:#fff;border:none;padding:7px 14px;border-radius:3px;font-family:inherit;font-size:12px;cursor:pointer;margin-right:auto';
      btn.textContent='✓ 完成排课并归档';
      btn.onclick=()=>openCompleteSchedule(courseName);
      actionsEl.insertBefore(btn,actionsEl.firstChild);
    }
    alert(`已同步 ${synced} 个课次！${allDone?'\n\n全部课次已排完，可点「完成排课并归档」。':''}`);
  }catch(e){alert('同步失败：'+e.message)}
}

function openCompleteSchedule(courseName){
  if(!confirm(`「${courseName}」排课已完成。\n\n点确定后：\n• 课程安排显示最终结果\n• 老师课表同步更新\n• 排班时间槽从课程预定中移除\n\n确认归档？`))return;
  completeSchedule(courseName);
}

async function completeSchedule(courseName){
  try{
    const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
    for(const slot of slots){
      await sb(`/rest/v1/teacher_availability?slot_id=eq.${slot.id}`,'DELETE').catch(()=>{});
    }
    if(slots.length){
      const ids=slots.map(s=>`"${s.id}"`);
      for(let i=0;i<ids.length;i+=20){
        await sb(`/rest/v1/schedule_slots?id=in.(${ids.slice(i,i+20).join(',')})`, 'DELETE').catch(()=>{});
      }
      cachedTeacherAvail=cachedTeacherAvail.filter(a=>!slots.find(s=>s.id===a.slot_id));
      cachedScheduleSlots=cachedScheduleSlots.filter(s=>s.course_name!==courseName);
    }
    closeModal('scheduleSummaryModal');
    [cachedCourses,cachedSessions]=await Promise.all([
      sb('/rest/v1/courses?select=*&order=created_at.desc'),
      sb('/rest/v1/course_sessions?select=*&order=session_date.asc')
    ]);
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`「${courseName}」排课已归档完成！`);
  }catch(e){alert('操作失败：'+e.message)}
}

// ══════════════════════════════════
// 每周上课通知生成（admin）
// 默认覆盖即将到来的周六 ~ 下周五；按专业生成可编辑文案，复制后发群
// ══════════════════════════════════
function openWeeklyNotice(){
  const existing=document.getElementById('weeklyNoticeModal');
  if(existing) existing.remove();
  // 默认起始日：即将到来的周六（今天是周六则取今天）
  const now=new Date();
  const sat=new Date(now);
  sat.setDate(now.getDate()+((6-now.getDay())+7)%7);
  const defDate=`${sat.getFullYear()}-${String(sat.getMonth()+1).padStart(2,'0')}-${String(sat.getDate()).padStart(2,'0')}`;
  const modal=document.createElement('div');
  modal.id='weeklyNoticeModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:640px;width:100%;max-height:88vh;display:flex;flex-direction:column">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">📣 生成每周上课通知</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">起始日期（覆盖该日起7天）</label>
        <input type="date" id="wn_start" value="${defDate}" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit"></div>
      <div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">专业</label>
        <select id="wn_major" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit">
          ${majorFilterKeys().map(k=>`<option value="${k}">${k==='shakai_group'?'社会人文（社会学+新传+福祉）':majorLabel(k)}</option>`).join('')}
          <option value="all">全部专业</option>
        </select></div>
      <button class="btn btn-primary btn-sm" onclick="wnGenerate()">生成</button>
      <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('wn_text').value).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制全文',2000)})">📋 复制全文</button>
    </div>
    <textarea id="wn_text" style="flex:1;min-height:320px;width:100%;font-size:12px;line-height:1.9;padding:12px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;resize:vertical" placeholder="点击「生成」后在此编辑（会议号等可手动补充），确认无误后复制发群"></textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span style="font-size:9px;color:var(--text-3)">生成内容可直接编辑；主持人密钥不会出现在通知里</span>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('weeklyNoticeModal').remove()">关闭</button>
    </div>
  </div>`;
  /* 点外不关闭，避免误触 */
  document.body.appendChild(modal);
  wnGenerate();
}

function wnGenerate(){
  const startStr=(document.getElementById('wn_start')||{}).value;
  const majorKey=(document.getElementById('wn_major')||{}).value||'all';
  if(!startStr) return;
  const majorList=expandMajorFilter(majorKey);
  const start=new Date(startStr+'T00:00:00');
  const dates=[];
  for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)}
  const wdLabel=['周日','周一','周二','周三','周四','周五','周六'];
  const dLabel=ds=>{const d=new Date(ds+'T00:00:00');return `${wdLabel[d.getDay()]} ${d.getMonth()+1}月${d.getDate()}日`};
  const dvLabel=v=>v==='线下＋线上'?'线上线下同步':(v||'');

  // 该周范围内、指定专业、非休讲的课次，按日期+时间排序
  const list=cachedSessions
    .filter(s=>dates.includes(s.session_date))
    .filter(s=>(s.major||[]).some(m=>majorList.includes(m)))
    .filter(s=>s.session_title!=='休讲')
    .sort((a,b)=>a.session_date===b.session_date?String(a.time_range||'').localeCompare(String(b.time_range||'')):a.session_date.localeCompare(b.session_date));

  let text='@所有人 本周课程安排如下\n';
  if(!list.length){
    text+='（该周暂无排课）';
  }else{
    let curDate='';
    list.forEach(s=>{
      const c=cachedCourses.find(x=>x.id===s.course_id)||{};
      if(s.session_date!==curDate){
        curDate=s.session_date;
        text+=`${dLabel(curDate)}\n`;
      }
      const dv=dvLabel(s.delivery||c.delivery);
      const st=(s.session_title||'').trim();
      text+=`${s.time_range||c.time_range||''} ${s.course_name||c.name||''}${st?'（'+st+'）':''}${dv?' '+dv:''}\n`;
      if(c.meeting_url) text+=`${c.meeting_url}\n`;
      const campus=s.campus||c.campus||'';
      const isOffline=(s.delivery||c.delivery||'').includes('线下');
      if(isOffline&&campus) text+=`线下教室：${campus}\n`;
      text+='\n';
    });
    text=text.trimEnd()+'\n';
  }
  const ta=document.getElementById('wn_text');
  if(ta) ta.value=text;
}

// ══════════════════════════════════
// 学生课表生成（admin 挑选课程 → 发布给指定专业的学习记录页）
// 表 course_schedule_shares：id, major(发布对象), title, course_ids(jsonb), created_at
// 学生端取该专业最新一条渲染；同专业重复发布以最新为准
// ══════════════════════════════════
let ssSelected=new Set();

async function openScheduleShare(){
  const existing=document.getElementById('schedShareModal');
  if(existing) existing.remove();
  ssSelected=new Set();
  const modal=document.createElement('div');
  modal.id='schedShareModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const now=new Date();
  const defTitle=`${now.getFullYear()}年${now.getMonth()<3?'1':now.getMonth()<6?'4':now.getMonth()<9?'7':'10'}月期课程表`;
  modal.innerHTML=`<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">🗓 生成学生课表</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">发布给（学生按档案专业看到对应课表）</label>
        <select id="ss_major" onchange="ssRenderCourseList()" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit">
          <option value="shakai_group">社会人文（社会学+新传+福祉共用）</option>
          ${allMajorKeys().map(k=>`<option value="${k}">${majorLabel(k)}</option>`).join('')}
        </select></div>
      <div style="flex:1;min-width:160px"><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">课表标题</label>
        <input id="ss_title" value="${defTitle}" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit"></div>
      <button class="btn btn-primary btn-sm" onclick="ssPublish()">发布课表 (<span id="ss_count">0</span>门)</button>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">点击课程行选中/取消（高亮为已选）：</div>
    <div id="ss_course_list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:3px;padding:8px;min-height:200px"></div>
    <div style="margin-top:10px">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">已发布的课表（同专业以最新为准）：</div>
      <div id="ss_existing" style="font-size:11px"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('schedShareModal').remove()">关闭</button>
    </div>
  </div>`;
  /* 点外不关闭，避免误触 */
  document.body.appendChild(modal);
  ssRenderCourseList();
  ssRenderExisting();
}

function ssRenderCourseList(){
  const box=document.getElementById('ss_course_list');
  if(!box)return;
  const majorKey=(document.getElementById('ss_major')||{}).value||'shakai_group';
  const majorList=expandMajorFilter(majorKey);
  const list=cachedCourses
    .filter(c=>(c.major||[]).some(m=>majorList.includes(m)))
    .sort((a,b)=>String(b.first_session_date||'').localeCompare(String(a.first_session_date||'')));
  box.innerHTML=list.length?list.map(c=>{
    const sel=ssSelected.has(c.id);
    const sessions=cachedSessions.filter(s=>s.course_id===c.id);
    return `<div onclick="ssToggle('${c.id}')" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid ${sel?'var(--accent)':'var(--border-light)'};background:${sel?'var(--accent-light, #e8e0d0)':'var(--surface)'};border-radius:3px;margin-bottom:5px">
      <span style="font-size:12px;font-weight:600">${c.name}</span>
      <span style="font-size:10px;color:var(--text-3)">${c.period||''} · ${c.teacher||''} · ${c.weekdays||''} ${c.time_range||''} · ${sessions.length}回 · 首回 ${c.first_session_date||'-'}</span>
      <span style="margin-left:auto;font-size:11px;color:${sel?'var(--accent)':'var(--text-3)'}">${sel?'✓ 已选':'选择'}</span>
    </div>`;
  }).join(''):'<div style="font-size:11px;color:var(--text-3);padding:12px">该专业暂无课程</div>';
  const cnt=document.getElementById('ss_count');
  if(cnt) cnt.textContent=ssSelected.size;
}

function ssToggle(id){
  if(ssSelected.has(id)) ssSelected.delete(id); else ssSelected.add(id);
  ssRenderCourseList();
}

async function ssRenderExisting(){
  const box=document.getElementById('ss_existing');
  if(!box)return;
  try{
    const shares=await sb('/rest/v1/course_schedule_shares?select=*&order=created_at.desc&limit=30');
    box.innerHTML=(shares||[]).length?shares.map(s=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed var(--border-light)">
      <span>${majorLabel(s.major)==='shakai_group'?'社会人文':majorLabel(s.major)}</span>
      <span style="color:var(--text-2)">${s.title||''}</span>
      <span style="color:var(--text-3);font-size:10px">${(s.course_ids||[]).length}门 · ${(s.created_at||'').slice(0,10)}</span>
      <button onclick="ssDelete('${s.id}')" style="margin-left:auto;font-size:10px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:2px;padding:1px 8px;cursor:pointer;font-family:inherit">删除</button>
    </div>`).join(''):'<span style="color:var(--text-3)">暂无</span>';
  }catch(e){box.innerHTML=`<span style="color:var(--danger)">加载失败：${e.message}</span>`}
}

async function ssDelete(id){
  if(!confirm('删除这份课表？学生端将不再显示。'))return;
  try{ await sb(`/rest/v1/course_schedule_shares?id=eq.${id}`,'DELETE'); ssRenderExisting(); }catch(e){alert('删除失败：'+e.message)}
}

async function ssPublish(){
  if(!ssSelected.size){alert('请先选择要展示的课程');return}
  const major=(document.getElementById('ss_major')||{}).value;
  const title=(document.getElementById('ss_title')||{}).value.trim()||'课程表';
  try{
    await sb('/rest/v1/course_schedule_shares','POST',{
      id:`ss-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      major, title, course_ids:[...ssSelected],
    });
    alert(`已发布「${title}」（${ssSelected.size}门课程）\n${major==='shakai_group'?'社会学/新传/福祉':majorLabel(major)} 的学生在学习记录 → 课程表中可见`);
    ssSelected=new Set();
    ssRenderCourseList();
    ssRenderExisting();
  }catch(e){alert('发布失败：'+e.message)}
}

// ══════════════════════════════════
// 课程清理：导出所选课程的基础信息 Excel（一课一行，发给老师做纸质课程表用）
// 字段：专业 课程 校区 讲师 开课时间 结课时间 课程回数 星期 上课时间 是否确认 备注 课程链接
// ══════════════════════════════════

// 全选当前筛选条件下显示的全部课程（沿用清理页的专业/期数筛选逻辑）
function cleanupSelectAllFiltered(){
  let filtered=cachedCourses.filter(c=>{
    if(CURRENT_DOMAIN&&CURRENT_DOMAIN!=='all'&&c.domain!==CURRENT_DOMAIN) return false;
    if(CURRENT_MAJOR) return (c.major||[]).some(m=>m===CURRENT_MAJOR);
    if(cleanupMajorFilter==='all') return true;
    const majorList=expandMajorFilter(cleanupMajorFilter);
    return (c.major||[]).some(m=>majorList.includes(m));
  });
  // 与清理页筛选逻辑完全一致（类型三分支 + 期数）
  if(cleanupTypeFilter==='专业课') filtered=filtered.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(cleanupTypeFilter==='共通课') filtered=filtered.filter(c=>c.course_type?.includes('共通'));
  else if(cleanupTypeFilter==='VIP') filtered=filtered.filter(c=>c.course_type?.includes('VIP'));
  if(typeof cleanupPeriodFilter!=='undefined'&&cleanupPeriodFilter!=='all') filtered=filtered.filter(c=>effectivePeriod(c)===cleanupPeriodFilter);
  filtered.forEach(c=>cleanupSelected.add(c.id));
  renderCourseCleanupPage(document.getElementById('mainContent'));
}

function cleanupExportInfo(){
  if(!cleanupSelected.size){alert('请先选中要导出的课程（点击课程行选中，或用「全选当前筛选」）');return}
  if(typeof XLSX==='undefined'){alert('Excel 组件未加载，请刷新页面重试');return}
  const list=cachedCourses.filter(c=>cleanupSelected.has(c.id));
  const rows=list.map(c=>{
    const ss=cachedSessions.filter(s=>s.course_id===c.id&&s.session_title!=='休讲'&&s.session_date);
    const dates=ss.map(s=>s.session_date).sort();
    return {
      '专业':(c.major||[]).map(m=>majorLabel(m)).join('/'),
      '课程':c.name||'',
      '校区':c.campus||'',
      '讲师':c.teacher||'',
      '开课时间':dates[0]||c.first_session_date||'',
      '结课时间':dates[dates.length-1]||'',
      '课程回数':c.total_sessions||ss.length||'',
      '星期':c.weekdays||'',
      '上课时间':c.time_range||'',
      '是否确认':'',
      '备注':'',
      '课程链接':c.meeting_url||'',
    };
  });
  const ws=XLSX.utils.json_to_sheet(rows,{header:['专业','课程','校区','讲师','开课时间','结课时间','课程回数','星期','上课时间','是否确认','备注','课程链接']});
  ws['!cols']=[{wch:22},{wch:24},{wch:14},{wch:18},{wch:12},{wch:12},{wch:8},{wch:8},{wch:12},{wch:8},{wch:14},{wch:40}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'课程信息');
  const d=new Date();
  XLSX.writeFile(wb,`课程信息_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${rows.length}门.xlsx`);
}

// ══════════════════════════════════
// 单回作业布置（结构化：级别 → 题型区块 → 小题；支持题目PDF与参考资料）
// homework_questions 结构：{ version:2, levels:[{key,blocks:[...]}], refs:[...] }
//   block.type: choice 选择题 | calc 计算题 | term 名词解释 | essay 论述题 | free 自由题
// ══════════════════════════════════
const HW_TYPES = [
  ['choice','选择题','设定题数，学生逐题填答案（题目见附件PDF）'],
  ['calc','计算题','设定大题数与每题问数，学生按「问」拍照上传'],
  ['term','名词解释','设定问数，学生逐问作答或拍照'],
  ['essay','论述题','设定题数，学生逐题作答，可多张照片'],
  ['free','自由题','直接写题干，学生作答'],
];
const HW_LEVELS = [['','不分级别'],['上','上级'],['中','中级'],['下','下级']];
let hwEditSession = null;
let hwEditData = null;   // { levels:[{key,blocks:[]}], refs:[], note:'' }
let hwEditLevel = 0;     // 当前编辑的级别索引

function hwNormalize(s){
  const q = s.homework_questions;
  if (q && !Array.isArray(q) && q.version === 2) {
    return { levels: q.levels || [{key:'',blocks:[]}], refs: q.refs || [], note: s.homework_note || '' };
  }
  // 兼容旧格式（简单题目列表）→ 转成自由题区块
  if (Array.isArray(q) && q.length) {
    return { levels: [{ key:'', blocks:[{ type:'free', title:'作业', items: q.map(x=>({num:x.num, text:x.text})) }] }], refs: [], note: s.homework_note || '' };
  }
  return { levels: [{ key:'', blocks: [] }], refs: [], note: s.homework_note || '' };
}

function openHwEditor(sessionId){
  const s = cachedSessions.find(x=>x.id===sessionId);
  if(!s){alert('未找到该课次');return}
  hwEditSession = s;
  hwEditData = hwNormalize(s);
  hwEditLevel = 0;
  const existing=document.getElementById('hwEditorModal');
  if(existing) existing.remove();
  const modal=document.createElement('div');
  modal.id='hwEditorModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div id="hwEditorBody" style="background:var(--surface);border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto"></div>';
  /* 点外不关闭，避免误触 */
  document.body.appendChild(modal);
  hwEditorRender();
}

function hwEditorRender(){
  const box=document.getElementById('hwEditorBody');
  if(!box)return;
  const s=hwEditSession, D=hwEditData;
  const inp='width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const lv=D.levels[hwEditLevel]||{key:'',blocks:[]};
  box.innerHTML=`
    <div style="font-size:13px;font-weight:600;margin-bottom:3px">📝 布置作业 — ${s.course_name||''} 第${s.session_number||''}回</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${s.session_date||''} ${s.session_title||''}　·　保存后学生端才会出现该次作业</div>

    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">作业说明（可选）</label>
    <textarea id="hw_note" rows="2" placeholder="例：请于下周三前提交，手写题按题号顺序拍照上传" style="${inp};line-height:1.8;resize:vertical;margin-bottom:10px">${(D.note||'').replace(/</g,'&lt;')}</textarea>

    <!-- 参考资料 -->
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 10px;margin-bottom:10px">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">📚 参考资料 / 阅读材料（与作业题目分开，学生可下载）</div>
      <div id="hw_refs_list" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:5px">${hwRefsHtml()}</div>
      <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:3px 10px">＋ 上传参考资料
        <input type="file" accept=".pdf,.doc,.docx,image/*" multiple style="display:none" onchange="hwUploadRef(this)"></label>
    </div>

    <!-- 级别切换 -->
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--text-3)">作业级别：</span>
      ${D.levels.map((L,i)=>`<div onclick="hwEditLevel=${i};hwEditorRender()" class="filter-chip ${i===hwEditLevel?'active':''}" style="padding:3px 10px;font-size:10px">${HW_LEVELS.find(x=>x[0]===L.key)?.[1]||L.key||'不分级别'}${(L.blocks||[]).length?` (${L.blocks.length})`:''}</div>`).join('')}
      ${D.levels.length<3?`<select onchange="hwAddLevel(this.value);this.value=''" style="font-size:10px;padding:2px 6px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit">
        <option value="">＋ 添加级别</option>
        ${HW_LEVELS.filter(([k])=>k&&!D.levels.some(L=>L.key===k)).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}
      </select>`:''}
      ${D.levels.length>1?`<span onclick="hwDelLevel(${hwEditLevel})" style="font-size:10px;color:var(--danger);cursor:pointer">删除当前级别</span>`:''}
    </div>

    <!-- 题型区块 -->
    <div style="border:1px solid var(--border);border-radius:3px;padding:10px;background:var(--bg);margin-bottom:10px">
      <div id="hw_blocks">${(lv.blocks||[]).map((b,bi)=>hwBlockHtml(b,bi)).join('')||'<div style="font-size:10px;color:var(--text-3);padding:8px 0">尚未添加题型，请在下方选择</div>'}</div>
      <select onchange="hwAddBlock(this.value);this.value=''" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;margin-top:6px">
        <option value="">＋ 添加题型区块</option>
        ${HW_TYPES.map(([k,l,d])=>`<option value="${k}">${l} — ${d}</option>`).join('')}
      </select>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('hwEditorModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="hwSaveToTemplate('${s.id}')" style="font-size:12px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">💾 保存并写入模板</button>
      <button onclick="hwSaveQuestions('${s.id}')" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存作业</button>
    </div>`;
}

function hwRefsHtml(){
  const refs=hwEditData.refs||[];
  return refs.length?refs.map((r,i)=>`<span style="font-size:10px;background:var(--surface);border:1px solid var(--border-light);border-radius:2px;padding:2px 8px">📎 ${r.name||'资料'}<span onclick="hwDelRef(${i})" style="color:var(--danger);cursor:pointer;margin-left:6px">✕</span></span>`).join(''):'<span style="font-size:10px;color:var(--text-3)">尚未上传</span>';
}

function hwBlockHtml(b,bi){
  const inp='font-size:11px;padding:4px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
  const T=HW_TYPES.find(t=>t[0]===b.type)||['','题目',''];
  let cfg='';
  if(b.type==='choice'){
    cfg=`<label style="font-size:10px;color:var(--text-3)">题数 <input type="number" min="1" value="${b.count||10}" onchange="hwSetBlock(${bi},'count',parseInt(this.value)||1)" style="${inp};width:60px"></label>`;
  } else if(b.type==='calc'){
    const legacy=(b.questions||[]).some(q=>(q.subs||1)>1);
    cfg=`<div style="font-size:10px;color:var(--text-3)">
      <label>大题数 <input type="number" min="1" value="${b.count||(b.questions||[]).length||3}" onchange="hwSetBlock(${bi},'count',parseInt(this.value)||1);hwSetBlock(${bi},'questions',null)" style="${inp};width:60px"></label>
      <span style="margin-left:8px">学生端每道大题可上传多张图（按顺序），无需分问</span>
      ${legacy?`<div style="margin-top:3px;color:var(--warn,#b8860b)">⚠ 此区块为旧版分问设置，修改大题数后将转为多图模式</div>`:''}
    </div>`;
  } else if(b.type==='term'||b.type==='essay'){
    const unit=b.type==='term'?'问':'题';
    cfg=`<div style="font-size:10px;color:var(--text-3)">
      题目内容（每${unit}一行，以「1. 」开头；直接粘贴即可）
      <textarea onchange="hwSetItems(${bi},this.value)" rows="5" placeholder="1. 请解释「社会资本」这一概念&#10;2. 请解释「文化再生产」&#10;3. 请解释「象征暴力」" style="${inp};width:100%;line-height:1.8;margin-top:3px;resize:vertical">${(b.items||[]).map(x=>`${x.num}. ${x.text}`).join('\n').replace(/</g,'&lt;')}</textarea>
      <div style="display:flex;gap:12px;align-items:center;margin-top:5px;flex-wrap:wrap">
        <label>选做数 <input type="number" min="0" value="${b.pick||0}" onchange="hwSetBlock(${bi},'pick',parseInt(this.value)||0)" style="${inp};width:56px"></label>
        <span>0＝全部作答；填 2 即「以上${unit}中任选 2 ${unit}作答」，学生端可勾选所答${unit}号</span>
      </div>
      ${(b.items||[]).length?'':`<div style="margin-top:3px">也可只设数量不写题干：<label>${unit}数 <input type="number" min="1" value="${b.count||3}" onchange="hwSetBlock(${bi},'count',parseInt(this.value)||1)" style="${inp};width:56px"></label></div>`}
    </div>`;
  } else if(b.type==='free'){
    cfg=`<div style="font-size:10px;color:var(--text-3)">题目（每题一行，以「1. 」开头）
      <textarea onchange="hwSetFree(${bi},this.value)" rows="4" placeholder="1. 请说明…&#10;2. 请分析…" style="${inp};width:100%;line-height:1.8;margin-top:3px;resize:vertical">${(b.items||[]).map(x=>`${x.num}. ${x.text}`).join('\n').replace(/</g,'&lt;')}</textarea>
      <label style="display:block;margin-top:5px">作答方式
        <select onchange="hwSetBlock(${bi},'answerMode',this.value)" style="${inp};margin-left:4px">
          <option value="whole" ${(b.answerMode||'whole')==='whole'?'selected':''}>整块统一作答（小问同属一个大题，只需一处上传/作答）</option>
          <option value="each" ${b.answerMode==='each'?'selected':''}>每题分别作答（每题独立作答与上传）</option>
        </select>
      </label></div>`;
  }
  return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 10px;margin-bottom:6px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:600">### ${bi+1}　${T[1]}</span>
      <input value="${(b.title||'').replace(/"/g,'&quot;')}" placeholder="区块标题（可选，如 ERE过去问 第3章）" onchange="hwSetBlock(${bi},'title',this.value)" style="${inp};flex:1;min-width:140px">
      <span onclick="hwDelBlock(${bi})" style="font-size:10px;color:var(--danger);cursor:pointer">删除</span>
    </div>
    ${cfg}
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
      <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:2px 9px">📎 ${b.file?'更换题目文件':'上传题目 PDF / 图片'}
        <input type="file" accept=".pdf,image/*,.doc,.docx" style="display:none" onchange="hwUploadBlockFile(${bi},this)"></label>
      <span style="font-size:10px;color:var(--text-3)">${b.file?`已上传：${b.file.name||'文件'}`:'（选择题/计算题建议上传题目PDF）'}</span>
    </div>
  </div>`;
}

function hwCurLevel(){ return hwEditData.levels[hwEditLevel] || (hwEditData.levels[hwEditLevel] = {key:'',blocks:[]}); }
function hwAddLevel(k){ if(!k)return; hwEditData.levels.push({key:k,blocks:[]}); hwEditLevel=hwEditData.levels.length-1; hwEditorRender(); }
function hwDelLevel(i){ if(hwEditData.levels.length<=1)return; if(!confirm('删除该级别及其题目？'))return; hwEditData.levels.splice(i,1); hwEditLevel=0; hwEditorRender(); }
function hwAddBlock(t){ if(!t)return; const b={type:t,title:''}; if(t==='choice')b.count=10; if(t==='term'||t==='essay')b.count=3; if(t==='calc')b.count=3; if(t==='free'){b.items=[];b.answerMode='whole'} hwCurLevel().blocks.push(b); hwEditorRender(); }
function hwDelBlock(i){ hwCurLevel().blocks.splice(i,1); hwEditorRender(); }
function hwSetBlock(i,k,v){ hwCurLevel().blocks[i][k]=v; }
function hwSetCalc(i,raw){
  hwCurLevel().blocks[i].questions=String(raw||'').split('\n').map(l=>l.trim()).filter(Boolean).map((l,idx)=>{
    const [a,b]=l.split(/[|｜]/);
    const subs=parseInt(b);
    return { num: parseInt(a)||idx+1, subs: (subs&&subs>1)?subs:1 };  // 只写题号=不分问
  });
}
function hwSetItems(i,raw){
  const out=[];
  String(raw||'').replace(/\r/g,'').split('\n').forEach(line=>{
    const t=line.trim(); if(!t)return;
    const m=t.match(/^(\d+)[.、)]\s*(.*)$/);
    if(m) out.push({num:parseInt(m[1]),text:m[2].trim()});
    else if(out.length) out[out.length-1].text+='\n'+t;
    else out.push({num:1,text:t});
  });
  const items=out.filter(x=>x.text).map((x,ix)=>({num:ix+1,text:x.text}));
  const b=hwCurLevel().blocks[i];
  b.items=items;
  if(items.length) b.count=items.length;
}

function hwSetFree(i,raw){
  const out=[];
  String(raw||'').replace(/\r/g,'').split('\n').forEach(line=>{
    const t=line.trim(); if(!t)return;
    const m=t.match(/^(\d+)[.、)]\s*(.*)$/);
    if(m) out.push({num:parseInt(m[1]),text:m[2].trim()});
    else if(out.length) out[out.length-1].text+='\n'+t;
    else out.push({num:1,text:t});
  });
  hwCurLevel().blocks[i].items=out.filter(x=>x.text).map((x,ix)=>({num:ix+1,text:x.text}));
}

async function hwUploadRef(input){
  const files=[...(input.files||[])];
  if(!files.length)return;
  try{
    for(const f of files){
      const ext=(f.name.split('.').pop()||'pdf').toLowerCase();
      const url=await sbUpload('homework',`refs/${hwEditSession.id}-${Date.now()}.${ext}`,f);
      (hwEditData.refs=hwEditData.refs||[]).push({url,name:f.name});
    }
    hwEditorRender();
  }catch(e){alert('上传失败：'+e.message)}
  input.value='';
}
function hwDelRef(i){ hwEditData.refs.splice(i,1); hwEditorRender(); }

async function hwUploadBlockFile(bi,input){
  const f=input.files[0];
  if(!f)return;
  try{
    const ext=(f.name.split('.').pop()||'pdf').toLowerCase();
    const url=await sbUpload('homework',`q/${hwEditSession.id}-${Date.now()}.${ext}`,f);
    hwCurLevel().blocks[bi].file={url,name:f.name};
    hwEditorRender();
  }catch(e){alert('上传失败：'+e.message)}
  input.value='';
}

async function hwSaveQuestions(sessionId, silent){
  const note=((document.getElementById('hw_note')||{}).value||'').trim();
  const levels=hwEditData.levels.filter(L=>(L.blocks||[]).length);
  const payload=levels.length?{version:2,levels,refs:hwEditData.refs||[]}:null;
  try{
    await sb(`/rest/v1/course_sessions?id=eq.${sessionId}`,'PATCH',{
      homework_questions:payload, homework_note:note||null, homework_enabled:!!payload,
    });
    const s=cachedSessions.find(x=>x.id===sessionId);
    if(s){s.homework_questions=payload;s.homework_note=note||null;s.homework_enabled=!!payload}
    if(silent) return;
    document.getElementById('hwEditorModal')?.remove();
    renderCoursesPage(document.getElementById('mainContent'));
    alert(payload?`已布置作业（${levels.length}个级别，共 ${levels.reduce((n,L)=>n+L.blocks.length,0)} 个题型区块）`:'已清空该次作业');
  }catch(e){alert('保存失败：'+e.message)}
}

// ══ 作业写入课程模板（按模板名/课程名 + 回数绑定，套用模板时自动带出） ══
async function hwSaveToTemplate(sessionId){
  const s=cachedSessions.find(x=>x.id===sessionId);
  if(!s){alert('未找到课次');return}
  // 先保存到课次本身
  await hwSaveQuestions(sessionId, true);
  const payload=s.homework_questions, note=s.homework_note;
  if(!payload){alert('该回没有作业内容，已清空课次作业；如需同步清空模板请手动编辑模板');return}
  try{
    if(!cachedTemplates) cachedTemplates=await sb('/rest/v1/course_templates?select=*&order=created_at.desc');
    const cname=(s.course_name||'').trim();
    const cands=(cachedTemplates||[]).filter(t=>(t.name||'').trim()===cname);
    let tpl=cands[0];
    if(!cands.length){
      const pick=prompt(`没有找到与课程「${cname}」同名的模板。\n请输入要写入的模板名称（需与列表中的模板名完全一致）：`,cname);
      if(!pick)return;
      tpl=(cachedTemplates||[]).find(t=>(t.name||'').trim()===pick.trim());
      if(!tpl){alert('未找到该模板，请先在课程清理中「存为模板」');return}
    }else if(cands.length>1){
      const pick=prompt(`有 ${cands.length} 个同名模板，请输入要写入的序号（1-${cands.length}）：\n`+cands.map((t,i)=>`${i+1}. ${t.name}（${(t.detail_rows||[]).length}回，创建于 ${(t.created_at||'').slice(0,10)}）`).join('\n'),'1');
      const idx=parseInt(pick)-1;
      if(isNaN(idx)||!cands[idx])return;
      tpl=cands[idx];
    }
    const rows=[...(tpl.detail_rows||[])];
    const n=s.session_number;
    const i=rows.findIndex(r=>String(r.num)===String(n));
    if(i>=0){ rows[i]={...rows[i], homework_questions:payload, homework_note:note||null}; }
    else { rows.push({num:n,title:s.session_title||'',teacher:s.session_teacher||'',homework_questions:payload,homework_note:note||null}); }
    await sb(`/rest/v1/course_templates?id=eq.${tpl.id}`,'PATCH',{detail_rows:rows});
    const ci=cachedTemplates.findIndex(x=>x.id===tpl.id);
    if(ci>=0) cachedTemplates[ci].detail_rows=rows;
    document.getElementById('hwEditorModal')?.remove();
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已保存，并写入模板「${tpl.name}」第 ${n} 回\n以后用该模板开新一期，这一回的作业会自动带出`);
  }catch(e){alert('写入模板失败：'+e.message)}
}
