// ══════════════════════════════════
// promo.js — 宣传管理（admin）
// 按专业维护三类宣传内容：专业介绍 / 讲师介绍 / 课程介绍
// 表 promo_content：id, major, section(major_intro|lecturer|course), title, body, sort_order, created_at
// 课程介绍的标题与课程安排中的课程名一致时，老师端可自动关联当期课程安排
// 依赖：shared/constants.js、shared/supabase.js、admin.js（须在其后加载）
// ══════════════════════════════════
let promoMajor = 'shakai';
let promoSection = 'major_intro';
let promoList = [];
let promoEditingId = null; // null=不在编辑 | 'new'=新增 | id=编辑该条

const PROMO_SECTIONS = [
  ['major_intro', '📖 专业介绍', '概要 / 独特视角 / 优势 / 重点方向 / 研究课题例 / 重点研究科…每条一个小节'],
  ['lecturer', '👤 讲师介绍', '每位讲师一条：标题填「姓名＋头衔」（如 徐老师　一桥大学社会学研究科　博士），正文填介绍'],
  ['course', '📚 课程介绍', '每门课一条：标题需与课程安排中的课程名完全一致，老师端才能自动关联当期开课信息'],
];

async function renderPromoAdminPage(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';
  promoLoad();
}

async function promoLoad() {
  try {
    promoList = await sb(`/rest/v1/promo_content?major=eq.${promoMajor}&select=*&order=sort_order.asc,created_at.asc`);
  } catch (e) {
    const mc = document.getElementById('mainContent');
    if (mc) mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`;
    return;
  }
  promoRenderShell();
}

// 外壳：专业/板块 chips（含选中高亮）+ 内容容器；切换专业重新拉数据，切换板块只重绘
function promoRenderShell() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  mc.innerHTML = `
  <div class="page-header">
    <div class="section-title">宣传管理</div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
    <span style="font-size:10px;color:var(--text-3)">专业：</span>
    ${['shakai','shinpan','fukushi','keiei','keizai'].map(m => `<div class="filter-chip ${promoMajor===m?'active':''}" onclick="promoMajor='${m}';promoEditingId=null;promoLoad()" style="padding:3px 10px;font-size:11px">${majorLabel(m)}</div>`).join('')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">板块：</span>
    ${PROMO_SECTIONS.map(([k,l]) => `<div class="filter-chip ${promoSection===k?'active':''}" onclick="promoSection='${k}';promoEditingId=null;promoRenderShell()" style="padding:3px 10px;font-size:11px">${l}</div>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">对外分享链接（无需登录，仅显示「公开」状态的内容）：</span>
    <code id="promo_share_link" style="font-size:10px;color:var(--text-2);background:var(--bg);padding:2px 8px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${location.origin}${location.pathname.replace(/\/admin\/.*$/,'/promo/')}?major=${promoMajor}</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('promo_share_link').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制',2000)})" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">📋 复制</button>
  </div>
  <div id="promo_body"></div>`;
  promoRender();
}

function promoEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function promoRender() {
  const box = document.getElementById('promo_body');
  if (!box) return;
  const sec = PROMO_SECTIONS.find(([k]) => k === promoSection);
  const list = promoList.filter(p => p.section === promoSection);
  const editing = promoEditingId ? (promoEditingId === 'new' ? {} : list.find(p => p.id === promoEditingId) || {}) : null;

  const inp = 'width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const formHtml = editing !== null ? `
  <div style="border:1px solid var(--accent);border-radius:4px;padding:14px;margin-bottom:12px;background:var(--bg)">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">${promoEditingId==='new'?'＋ 新增':'✏ 编辑'}${sec[1]}条目</div>
    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:8px">
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">标题${promoSection==='course'?'（须与课程安排中的课程名一致）':''}</label>
        <input id="pm_title" value="${promoEsc(editing.title)}" style="${inp}"></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">排序</label>
        <input id="pm_sort" type="number" value="${editing.sort_order || 0}" style="${inp}"></div>
    </div>
    <div style="font-size:9px;color:var(--text-3);background:var(--surface);border:1px dashed var(--border);border-radius:2px;padding:6px 10px;margin-bottom:6px;line-height:1.9">
      📐 排版语法（对外宣传页会自动渲染成正式排版）：<br>
      <code>## 小标题</code>　·　<code>**粗体**</code>　·　<code>- 无序列表</code>　·　<code>1. 有序列表</code>　·　表格每行 <code>|学校名|研究科|英语|</code>（首行为表头）　·　空行分段
    </div>
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">正文</label>
    <textarea id="pm_body" rows="10" style="width:100%;font-size:12px;line-height:1.8;padding:9px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical">${promoEsc(editing.body)}</textarea>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="promoSave()">保存</button>
      <button class="btn btn-outline btn-sm" onclick="promoEditingId=null;promoRender()">取消</button>
    </div>
  </div>` : '';

  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="font-size:12px;font-weight:600">${majorLabel(promoMajor)} · ${sec[1]}（${list.length}条）</div>
    <span style="font-size:10px;color:var(--text-3)">${sec[2]}</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="promoEditingId='new';promoRender()">＋ 新增条目</button>
  </div>
  ${formHtml}
  ${list.length ? list.map(p => `
  <div style="border:1px solid var(--border-light);border-radius:3px;padding:10px 14px;margin-bottom:6px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:12px;font-weight:600">${promoEsc(p.title) || '（无标题）'}</span>
      <span style="font-size:9px;color:var(--text-3)">排序 ${p.sort_order || 0}</span>
      <span onclick="promoTogglePub('${p.id}')" style="cursor:pointer;user-select:none;font-size:9px;border-radius:2px;padding:1px 8px;${p.published===false?'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)':'background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok)'}">${p.published===false?'🔒 隐藏中 · 点击公开':'🌐 公开中 · 点击隐藏'}</span>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="promoEditingId='${p.id}';promoRender()">✏ 编辑</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="promoDelete('${p.id}')">删除</button>
    </div>
    <div style="font-size:11px;color:var(--text-2);margin-top:6px;line-height:1.8;white-space:pre-wrap;max-height:120px;overflow:hidden;text-overflow:ellipsis">${promoEsc((p.body || '').slice(0, 300))}${(p.body || '').length > 300 ? '…' : ''}</div>
  </div>`).join('') : '<div class="empty" style="padding:30px">该板块暂无内容，点击「＋ 新增条目」开始录入</div>'}`;
}

async function promoSave() {
  const title = (document.getElementById('pm_title') || {}).value.trim();
  const body = (document.getElementById('pm_body') || {}).value;
  const sort_order = parseInt((document.getElementById('pm_sort') || {}).value) || 0;
  if (!title && !body.trim()) { alert('请填写标题或正文'); return; }
  try {
    if (promoEditingId === 'new') {
      const row = {
        id: `pm-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        major: promoMajor, section: promoSection, title, body, sort_order,
      };
      await sb('/rest/v1/promo_content', 'POST', row);
      promoList.push(row);
    } else {
      await sb(`/rest/v1/promo_content?id=eq.${promoEditingId}`, 'PATCH', { title, body, sort_order });
      const idx = promoList.findIndex(p => p.id === promoEditingId);
      if (idx >= 0) Object.assign(promoList[idx], { title, body, sort_order });
    }
    promoList.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    promoEditingId = null;
    promoRender();
  } catch (e) { alert('保存失败：' + e.message); }
}

async function promoDelete(id) {
  if (!confirm('删除这条宣传内容？')) return;
  try {
    await sb(`/rest/v1/promo_content?id=eq.${id}`, 'DELETE');
    promoList = promoList.filter(p => p.id !== id);
    promoRender();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 公开/隐藏切换（隐藏的内容不出现在对外分享页）
async function promoTogglePub(id) {
  const item = promoList.find(p => p.id === id);
  if (!item) return;
  const next = item.published === false;
  try {
    await sb(`/rest/v1/promo_content?id=eq.${id}`, 'PATCH', { published: next });
    item.published = next;
    promoRender();
  } catch (e) { alert('切换失败：' + e.message); }
}
