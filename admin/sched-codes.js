// 中枢 → 排课口令：管理排课系统（sched/）的旧口令链接 ?k=<口令>。只有管理员能进（口令表数据库里也只允许 is_admin() 读写）。
// 权限选项沿用 RESOURCE_PERM_DEFS（与老师「资源管理权限」同一套代号）；停用代替删除，删除要二次确认。
const SCC_LEAD_SCOPES = ['学部文科','学部理科','大学院文科','大学院理科','语言-日语','语言-英语'];
const SCC_LINK_BASE = 'https://edsched.github.io/transform/sched/index.html?k=';
let sccRows = [];       // sched_access_codes 全部行
let sccEdit = null;     // 正在编辑：{id|null, code, label, role, sort, perms:[], cats:[]}
function sccEsc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function sccSplit(s){ return String(s||'').split(',').map(x=>x.trim()).filter(Boolean); }
function sccPermLabel(code){ const d=RESOURCE_PERM_DEFS.find(x=>x[0]===code); return d?d[1]:code; }

async function sccMount(body){
  body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try{
    sccRows=await sbAll('/rest/v1/sched_access_codes?select=*&order=sort.asc,id.asc');
  }catch(e){ body.innerHTML=`<div style="padding:20px;color:var(--danger)">加载失败：${sccEsc(e.message)}</div>`; return; }
  sccRender();
}
function sccBody(){ return document.getElementById('consoleBody'); }
function sccRender(){
  const body=sccBody(); if(!body) return;
  let h=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <div style="font-size:12px;font-weight:600">排课口令</div>
    <span style="font-size:10px;color:var(--text-3)">排课系统（资源管理）旧口令链接 ?k=口令 的身份与功能权限；停用后该链接立即打不开</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="sccOpenEdit(null)">＋ 新增口令</button>
  </div>`;
  if(sccEdit && sccEdit.id==null) h+=sccFormHtml();
  if(!sccRows.length) h+='<div style="padding:16px;color:var(--text-3);font-size:12px">暂无口令</div>';
  else{
    h+='<div style="display:flex;flex-direction:column;gap:8px">';
    sccRows.forEach(r=>{
      const perms=sccSplit(r.perms), cats=sccSplit(r.lead_cats);
      const chips=perms.length?perms.map(p=>`<span class="filter-chip active" style="padding:2px 8px;font-size:10px;cursor:default">${sccEsc(sccPermLabel(p))}</span>`).join(''):'<span style="font-size:10px;color:var(--text-3)">没有任何权限</span>';
      h+=`<div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;${r.active?'':'opacity:.55'}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:13px">${sccEsc(r.label||r.role||'')}</span>
          <span style="font-size:10px;color:var(--text-3)">角色 ${sccEsc(r.role||'')}</span>
          <span style="font-size:11px;color:var(--text-2)">口令 ${sccEsc(r.code)}</span>
          ${r.active?'<span style="font-size:10px;color:var(--text-3)">启用</span>':'<span style="font-size:10px;color:var(--danger)">已停用</span>'}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="sccCopy(${r.id})">复制链接</button>
            <button class="btn btn-outline btn-sm" onclick="sccOpenEdit(${r.id})">编辑</button>
            <button class="btn btn-outline btn-sm" onclick="sccToggle(${r.id})">${r.active?'停用':'启用'}</button>
            <button class="btn btn-outline btn-sm" onclick="sccDelete(${r.id})">删除</button>
          </span>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">${chips}</div>
        ${cats.length?`<div style="font-size:10px;color:var(--text-3);margin-top:5px">课程类别范围：${sccEsc(cats.join('、'))}</div>`:''}
        ${sccEdit&&sccEdit.id===r.id?sccFormHtml():''}
      </div>`;
    });
    h+='</div>';
  }
  body.innerHTML=h;
}
function sccFormHtml(){
  const e=sccEdit, isNew=e.id==null;
  const permChips=RESOURCE_PERM_DEFS.map(([c,l])=>`<div class="filter-chip${e.perms.includes(c)?' active':''}" onclick="sccTogglePerm('${c}')" style="padding:3px 10px;font-size:11px">${sccEsc(l)}</div>`).join('');
  const catChips=SCC_LEAD_SCOPES.map(c=>`<div class="filter-chip${e.cats.includes(c)?' active':''}" onclick="sccToggleCat('${c}')" style="padding:3px 10px;font-size:11px">${sccEsc(c)}</div>`).join('');
  const inp='padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;box-sizing:border-box;width:100%';
  return `<div style="margin-top:10px;padding:10px;background:var(--bg);border:1px solid var(--border-light);border-radius:4px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:10px">
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:2px">显示名</div><input id="scc_label" style="${inp}" value="${sccEsc(e.label)}" placeholder="如 教务助理"></div>
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:2px">角色标识</div><input id="scc_role" style="${inp}" value="${sccEsc(e.role)}" placeholder="如 assistant"></div>
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:2px">口令（链接里的 k，${isNew?'留空自动生成':'不能修改'}）</div><input id="scc_code" style="${inp}" value="${sccEsc(e.code)}" ${isNew?'':'readonly'} placeholder="留空自动"></div>
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:2px">排序（小的在前）</div><input id="scc_sort" type="number" style="${inp}" value="${sccEsc(e.sort)}"></div>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">功能权限（点选）</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${permChips}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">课程类别范围（不选 = 不限，可管全部；选了则只能管这几类）</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${catChips}</div>
    <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="sccSave()">保存</button><button class="btn btn-outline btn-sm" onclick="sccCancel()">取消</button></div>
  </div>`;
}
function sccReadForm(){
  if(!sccEdit) return;
  const v=id=>{ const el=document.getElementById(id); return el?el.value:null; };
  const l=v('scc_label'), r=v('scc_role'), c=v('scc_code'), s=v('scc_sort');
  if(l!==null) sccEdit.label=l; if(r!==null) sccEdit.role=r; if(c!==null) sccEdit.code=c; if(s!==null) sccEdit.sort=s;
}
function sccOpenEdit(id){
  if(id==null) sccEdit={id:null,code:'',label:'',role:'',sort:100,perms:['timetable'],cats:[]};
  else{
    const r=sccRows.find(x=>x.id===id); if(!r) return;
    sccEdit={id:r.id,code:r.code,label:r.label||'',role:r.role||'',sort:r.sort==null?100:r.sort,perms:sccSplit(r.perms),cats:sccSplit(r.lead_cats)};
  }
  sccRender();
}
function sccCancel(){ sccEdit=null; sccRender(); }
function sccTogglePerm(c){ sccReadForm(); const a=sccEdit.perms,i=a.indexOf(c); if(i>=0) a.splice(i,1); else a.push(c); sccRender(); }
function sccToggleCat(c){ sccReadForm(); const a=sccEdit.cats,i=a.indexOf(c); if(i>=0) a.splice(i,1); else a.push(c); sccRender(); }
async function sccSave(){
  sccReadForm(); const e=sccEdit; if(!e) return;
  const label=e.label.trim(); let role=e.role.trim();
  if(!label){ alert('请填显示名'); return; }
  if(!role) role=label;
  const sort=parseInt(e.sort,10); const row={label,role,sort:isNaN(sort)?100:sort,perms:e.perms.join(','),lead_cats:e.cats.join(',')};
  try{
    if(e.id==null){
      let code=e.code.trim(); if(!code) code=(/^[a-z0-9_-]+$/i.test(role)?role:'r')+'-'+Math.random().toString(36).slice(2,8);
      if(sccRows.some(r=>r.code===code)){ alert('这个口令已经存在，请换一个'); return; }
      await sb('/rest/v1/sched_access_codes','POST',{...row,code,active:true});
    }else{
      await sb('/rest/v1/sched_access_codes?id=eq.'+e.id,'PATCH',row);
    }
    sccEdit=null; await sccMount(sccBody());
  }catch(err){ alert('保存失败：'+err.message); }
}
async function sccToggle(id){
  const r=sccRows.find(x=>x.id===id); if(!r) return;
  if(r.active && !confirm(`停用「${r.label||r.role}」？用这个口令的链接会立即打不开。`)) return;
  try{ await sb('/rest/v1/sched_access_codes?id=eq.'+id,'PATCH',{active:!r.active}); await sccMount(sccBody()); }
  catch(err){ alert('操作失败：'+err.message); }
}
async function sccDelete(id){
  const r=sccRows.find(x=>x.id===id); if(!r) return;
  if(!confirm(`确定删除「${r.label||r.role}」？\n\n删除后无法恢复，用它的链接会永远打不开。只想暂时不用的话请点「停用」。`)) return;
  if(!confirm('再确认一次：真的删除这个口令吗？')) return;
  try{ await sb('/rest/v1/sched_access_codes?id=eq.'+id,'DELETE'); await sccMount(sccBody()); }
  catch(err){ alert('删除失败：'+err.message); }
}
function sccCopy(id){
  const r=sccRows.find(x=>x.id===id); if(!r) return;
  const url=SCC_LINK_BASE+encodeURIComponent(r.code);
  navigator.clipboard?.writeText(url).then(()=>alert('链接已复制：\n'+url)).catch(()=>prompt('复制此链接：',url));
}
