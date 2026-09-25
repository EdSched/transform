// ══════════════════════════════════
// teacher-pack.js — 宣传资料整合（营业用）
// 把各营业工具里已经做好的内容（出愿学校名单 / 学科介绍 / 进度规划 / 讲师卡片 / VIP方案）
// 收集到一个「资料包」里，排好顺序后一次性生成一份完整的 PDF（打印窗口另存为 PDF），
// 或下载成可直接发给客户的网页版 .html。
// 各工具页面的「➕ 加入宣传资料」按钮调用 pkAdd() 放入当下内容的快照；学科介绍也可在本页直接添加。
// 资料包存在本浏览器 localStorage（按老师区分），刷新页面不丢；不落库。
// 依赖：shared/constants.js、shared/supabase.js、teacher.js、teacher-promo.js（须在其后加载）
// ══════════════════════════════════
let pkItems = [];        // [{ id, type, title, html, wide, include, addedAt, student }]
let pkCover = null;      // { title, student, consultant, message }
let pkPreviewOpen = false;

const PK_TYPES = {
  major:     { label: '学科介绍', color: '#5a3e28', bg: '#f5ede3' },
  admission: { label: '出愿学校', color: '#2c4a7c', bg: '#e8f0fb' },
  plan:      { label: '进度规划', color: '#2d5a3d', bg: '#e4f0e8' },
  lecturers: { label: '讲师介绍', color: '#6a4a7a', bg: '#efe4f4' },
  vip:       { label: 'VIP方案', color: '#a03a2e', bg: '#f8e4dc' },
};
const PK_MAJOR_PARTS = [
  ['major_intro', '专业介绍'],
  ['lecturer', '讲师介绍'],
  ['course', '课程介绍'],
  ['schedule', '当期课程表'],
];

function pkEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function pkPerm() { return (typeof teacherData !== 'undefined' && teacherData && teacherData.permissions) || {}; }
function pkConsultantName() {
  const pub = String((teacherData && teacherData.notes) || '').trim();
  return pub || (typeof teacherName !== 'undefined' ? teacherName : '');
}

// ── 本地保存（per-teacher；读写失败时只保留在内存）──
function pkStoreKey() { return 'teacherPromoPack:v1:' + ((teacherData && teacherData.id) || teacherName || 'anon'); }
function pkLoad() {
  if (pkCover) return;
  pkCover = { title: '日本大学院升学 · 咨询资料', student: '', consultant: '', message: '' };
  try {
    const raw = localStorage.getItem(pkStoreKey());
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.items)) pkItems = d.items;
      if (d.cover) pkCover = Object.assign(pkCover, d.cover);
    }
  } catch (e) { /* 隐私模式等读不到时从空资料包开始 */ }
}
function pkSave() {
  try { localStorage.setItem(pkStoreKey(), JSON.stringify({ items: pkItems, cover: pkCover })); }
  catch (e) { pkToast('⚠ 浏览器存储空间不足，资料只保留到关闭页面为止（可删掉较大的出愿名单后再试）'); }
}

// ── 对外入口：各工具页面调用 ──
function pkAdd(item) {
  pkLoad();
  const it = Object.assign({ wide: false, include: true }, item, {
    id: 'pk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    addedAt: new Date().toISOString(),
  });
  pkItems.push(it);
  if (it.student && !pkCover.student) pkCover.student = it.student;
  pkSave();
  pkUpdateTabBadge();
  pkToast(`已加入宣传资料：${it.title}（共 ${pkItems.length} 项）`, true);
  if (typeof curTab !== 'undefined' && curTab === 'promopack') pkRender();
}

function pkToast(msg, withLink) {
  document.getElementById('pkToast')?.remove();
  const el = document.createElement('div');
  el.id = 'pkToast';
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#3a2e24;color:#fff;font-size:12px;padding:10px 16px;border-radius:4px;z-index:10000;box-shadow:0 4px 14px rgba(0,0,0,.2);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px)';
  el.innerHTML = `<span>${pkEsc(msg)}</span>${withLink && curTab !== 'promopack' ? `<a onclick="document.getElementById('pkToast')?.remove();switchTab('promopack')" style="color:#f5d9a8;cursor:pointer;white-space:nowrap;text-decoration:underline">去整合 →</a>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function pkUpdateTabBadge() {
  const btn = document.querySelector(`.tab-btn[onclick="switchTab('promopack')"]`);
  if (btn) btn.textContent = '📦 宣传资料整合' + (pkItems.length ? ` (${pkItems.length})` : '');
}

// 宣传相关页：把当前专业（全部板块）加入
function pkAddMajorFromPromo() {
  if (!prData) return;
  const parts = PK_MAJOR_PARTS.map(p => p[0]);
  const html = pkMajorHtml(prMajor, prData, parts);
  if (!html) { alert('该专业暂无宣传内容'); return; }
  pkAdd({ type: 'major', title: `${MAJORS[prMajor] || prMajor} 学科介绍`, html });
}

// 本页：选专业 + 板块后直接添加
async function pkAddMajor() {
  const major = (document.getElementById('pk_major') || {}).value;
  const parts = PK_MAJOR_PARTS.map(p => p[0]).filter(k => (document.getElementById('pk_part_' + k) || {}).checked);
  if (!major) return;
  if (!parts.length) { alert('请至少勾选一个板块'); return; }
  const btn = document.getElementById('pk_major_btn');
  if (btn) { btn.disabled = true; btn.textContent = '读取中…'; }
  try {
    const data = await prFetchMajor(major);
    const html = pkMajorHtml(major, data, parts);
    if (!html) { alert('该专业所选板块暂无内容（admin 可在「宣传管理」中录入）'); return; }
    const partLabel = parts.length === PK_MAJOR_PARTS.length ? '' : '（' + parts.map(k => PK_MAJOR_PARTS.find(p => p[0] === k)[1]).join('・') + '）';
    pkAdd({ type: 'major', title: `${MAJORS[major] || major} 学科介绍${partLabel}`, html });
  } catch (e) { alert('读取失败：' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '➕ 添加学科介绍'; } }
}

// ══════════════════════════════════
// 各类型内容的资料版 HTML（样式类定义在 pkDocHtml 的 <style> 中）
// ══════════════════════════════════
function pkMajorHtml(major, data, parts) {
  const list = (data && data.list || []).filter(p => p.published !== false);
  const intro = list.filter(p => p.section === 'major_intro');
  const lects = list.filter(p => p.section === 'lecturer');
  const crs = list.filter(p => p.section === 'course');
  const hasSched = ((data && data.sessions) || []).length > 0;
  let h = '';
  const sub = t => `<div class="pk-sub">${t}</div>`;

  if (parts.includes('major_intro') && intro.length) {
    h += sub('专业介绍') + intro.map(p => `<div class="pk-block"><h3>${pkEsc(p.title)}</h3><div class="pk-rich">${prMd(p.body)}</div></div>`).join('');
  }
  if (parts.includes('lecturer') && lects.length) {
    h += sub('讲师介绍') + `<div class="pk-cards">${lects.map(p => {
      const t = String(p.title || '').trim();
      const m = t.match(/^(\S+)[\s　]+(.+)$/);
      return `<div class="pk-card"><div class="pk-name">${pkEsc(m ? m[1] : t)}</div>${m ? `<div class="pk-cred">${pkEsc(m[2])}</div>` : ''}<div class="pk-rich">${prMd(p.body)}</div></div>`;
    }).join('')}</div>`;
  }
  if (parts.includes('course') && crs.length) {
    const dvLabel = v => v === '线下＋线上' ? '线上线下同步' : (v || '');
    h += sub('课程介绍') + `<div class="pk-cards">${crs.map(p => {
      const name = String(p.title || '').trim();
      const c = (prCourses || []).find(x => (x.name || '').trim() === name);
      return `<div class="pk-card">
        <div class="pk-name">${pkEsc(name)}${c && c.teacher ? `<span class="pk-tch">担当：${pkEsc(prPubTeacher(c.teacher))}</span>` : ''}</div>
        <div class="pk-rich">${prMd(p.body)}</div>
        ${c ? `<div class="pk-sched"><b>当期开课</b>　${pkEsc(c.period || '')} · ${pkEsc(c.weekdays || '')} ${pkEsc(c.time_range || '')} · 共${c.total_sessions || '-'}回 · ${pkEsc(dvLabel(c.delivery))}${c.campus ? ' · ' + pkEsc(c.campus) : ''}</div>`
            : `<div class="pk-sched closed">本期暂未开设，开课安排请咨询顾问老师</div>`}
      </div>`;
    }).join('')}</div>`;
  }
  if (parts.includes('schedule') && hasSched) {
    h += sub('当期课程表') + prScheduleHtml(data, true);
  }
  return h;
}

function pkAdmissionHtml(rows, opts) {
  const { filterLine, showMajor, majorMap } = opts || {};
  const lc = v => v === '必須' ? '#1a56a0' : v === '任意' ? '#b45309' : '#888';
  const head = [...(showMajor ? ['专业'] : []), '大学名', '設置', '研究科', '専攻', 'コース', '出願類型', '資格審査', '出願期間', '筆記試験', '口述試験', '合格発表', '英語', '日語'];
  return `<div class="pk-filter">筛选条件：${pkEsc(filterLine || '全部')}　·　共 ${rows.length} 条</div>
  <table class="pk-adb">
    <thead><tr>${head.map(t => `<th>${t}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(s => `<tr>
      ${showMajor ? `<td>${pkEsc((majorMap && majorMap[s.major]) || s.major)}</td>` : ''}
      <td class="b">${pkEsc(s.university)}</td><td class="c">${pkEsc(s.type)}</td><td>${pkEsc(s.faculty)}</td><td>${pkEsc(s.department)}</td><td>${pkEsc(s.course)}</td>
      <td>${pkEsc(s.admission_type)}</td><td>${pkEsc(s.doc_review_period)}</td><td>${pkEsc(s.application_period)}</td>
      <td>${pkEsc(s.written_exam)}</td><td>${pkEsc(s.oral_exam)}</td><td>${pkEsc(s.result_date)}</td>
      <td class="c" style="color:${lc(s.english_required)}">${pkEsc(s.english_required || '-')}</td>
      <td class="c" style="color:${lc(s.japanese_required)}">${pkEsc(s.japanese_required || '-')}</td>
    </tr>`).join('')}</tbody>
  </table>
  <div class="pk-note">・上旬约为1日～10日，中旬约为11日～20日，下旬约为21日～月末。出愿信息每年均有变化，本表仅供参考，请以各校当年度官方募集要项为准。<br>・各校对语言考试类型及分数要求不同，部分学校另有内部要求。如有疑问请联系唯新教育老师确认。</div>`;
}

// o: { groups:[{label,color:{bg,color},items:[{name,content,homework,hours}]}], sessions, hours, subjectHours }
function pkVipHtml(o) {
  let rows = '', num = 1;
  (o.groups || []).forEach(g => {
    g.items.forEach((it, i) => {
      rows += '<tr>'
        + (i === 0 ? `<td rowspan="${g.items.length}" class="grp" style="background:${g.color.bg};color:${g.color.color}">${pkEsc(g.label)}</td>` : '')
        + `<td class="n">${num++}</td><td class="nm">${pkEsc(it.name)}</td><td>${pkEsc(it.content)}</td><td>${pkEsc(it.homework)}</td>`
        + `<td class="h">${it.hours > 0 ? it.hours + 'H' : '—'}</td></tr>`;
    });
  });
  return `<div class="pk-stats"><span><b>${o.sessions}</b> 回</span><span><b>${o.hours}</b> 课时</span>${o.subjectHours > 0 ? `<span>其中专业知识 <b>${o.subjectHours}</b> 课时</span>` : ''}</div>
  <table class="pk-vip"><thead><tr><th></th><th>#</th><th>课程名称</th><th>内容说明</th><th>课后作业</th><th>课时</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ══════════════════════════════════
// 整合页面
// ══════════════════════════════════
function renderPromoPack(mc) {
  pkLoad();
  if (!pkCover.consultant) pkCover.consultant = pkConsultantName();
  pkRender(mc);
}

function pkRender(mc) {
  mc = mc || document.getElementById('mainContent');
  if (!mc) return;
  const p = pkPerm();
  const inp = 'width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld = (label, ctrl, span) => `<div${span ? ' style="grid-column:1/-1"' : ''}><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label>${ctrl}</div>`;
  const box = 'background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:14px';
  const h2 = t => `<div style="font-size:12px;font-weight:600;margin-bottom:10px">${t}</div>`;
  const linkBtn = (tab, label) => `<button onclick="switchTab('${tab}')" style="font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:5px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">${label}</button>`;
  const incl = pkItems.filter(x => x.include);

  const sources = [];
  if (p.admission_query) sources.push(linkBtn('admissiondb', '🏫 出願数据库 → 筛选后加入'));
  if (p.progress_plan) sources.push(linkBtn('progressplan', '📅 进度规划 → 生成后加入'));
  if (p.lect_info) sources.push(linkBtn('lectinfo', '👤 讲师信息 → 展示卡片加入'));
  if (p.vip_sales) sources.push(linkBtn('vipsales', '🗂 VIP规划 → 方案加入'));
  if (p.promo) sources.push(linkBtn('promo', '📣 宣传相关 → 专业介绍加入'));

  const majorKeys = ['shakai','shinpan','fukushi','keiei','keizai'].filter(k => MAJORS[k]);

  mc.innerHTML = `
  <div class="page-header"><div class="section-title">📦 宣传资料整合</div></div>
  <div style="font-size:11px;color:var(--text-3);margin-bottom:12px;line-height:1.8">
    在各工具里做好的内容点「➕ 加入宣传资料」就会收进这里；排好顺序、勾选要用的部分，即可一次性生成一份带封面和目录的完整 PDF，或下载网页版发给客户。资料只保存在本浏览器中。
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start">
    <div>
      <div style="${box}">
        ${h2('① 封面信息')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${fld('资料标题', `<input id="pk_c_title" value="${pkEsc(pkCover.title)}" oninput="pkSetCover('title',this.value)" style="${inp}">`, true)}
          ${fld('学生姓名（可不填）', `<input id="pk_c_student" value="${pkEsc(pkCover.student)}" oninput="pkSetCover('student',this.value)" placeholder="咨询学生姓名" style="${inp}">`)}
          ${fld('顾问老师', `<input id="pk_c_consultant" value="${pkEsc(pkCover.consultant)}" oninput="pkSetCover('consultant',this.value)" style="${inp}">`)}
          ${fld('封面寄语（可不填）', `<textarea id="pk_c_message" rows="2" oninput="pkSetCover('message',this.value)" placeholder="例：根据面谈内容为你整理了以下资料，有任何问题欢迎随时联系。" style="${inp};resize:vertical;line-height:1.7">${pkEsc(pkCover.message)}</textarea>`, true)}
        </div>
      </div>

      <div style="${box}">
        ${h2('② 添加内容')}
        ${p.promo ? `<div style="border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:600;margin-bottom:8px">📖 学科介绍（直接添加）</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            <select id="pk_major" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit">
              ${majorKeys.map(k => `<option value="${k}" ${k === (typeof prMajor !== 'undefined' ? prMajor : '') ? 'selected' : ''}>${MAJORS[k]}</option>`).join('')}
            </select>
            ${PK_MAJOR_PARTS.map(([k, l]) => `<label style="font-size:11px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap"><input type="checkbox" id="pk_part_${k}" checked style="accent-color:var(--accent)">${l}</label>`).join('')}
          </div>
          <button id="pk_major_btn" onclick="pkAddMajor()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit">➕ 添加学科介绍</button>
        </div>` : ''}
        ${sources.length ? `<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">其他内容请到对应工具里操作后点「➕ 加入宣传资料」：</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${sources.join('')}</div>` : ''}
      </div>
    </div>

    <div style="${box}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-size:12px;font-weight:600">③ 资料内容与顺序</div>
        <span style="font-size:10px;color:var(--text-3)">已选 ${incl.length} / ${pkItems.length} 项</span>
        ${pkItems.length ? `<button onclick="pkClear()" style="margin-left:auto;font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 10px;cursor:pointer;font-family:inherit;color:var(--text-3)">清空</button>` : ''}
      </div>
      ${pkItems.length ? pkItems.map((it, i) => {
        const t = PK_TYPES[it.type] || { label: it.type, color: '#5a5650', bg: '#eee' };
        const d = new Date(it.addedAt || Date.now());
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-light);border-radius:3px;margin-bottom:6px;background:${it.include ? 'var(--surface)' : 'var(--bg)'};${it.include ? '' : 'opacity:.6'}">
          <input type="checkbox" ${it.include ? 'checked' : ''} onchange="pkToggle('${it.id}')" style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0" title="是否放进本次生成的资料">
          <span style="font-size:10px;color:var(--text-3);width:16px;text-align:right;flex-shrink:0">${i + 1}</span>
          <span style="font-size:9px;background:${t.bg};color:${t.color};border-radius:2px;padding:1px 6px;white-space:nowrap;flex-shrink:0">${t.label}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${pkEsc(it.title)}">${pkEsc(it.title)}</div>
            <div style="font-size:9px;color:var(--text-3)">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 加入${it.wide ? ' · 横版页面' : ''}</div>
          </div>
          <div style="display:flex;gap:2px;flex-shrink:0">
            ${[['↑', `pkMove('${it.id}',-1)`, '上移', i === 0], ['↓', `pkMove('${it.id}',1)`, '下移', i === pkItems.length - 1], ['✎', `pkRename('${it.id}')`, '改标题'], ['👁', `pkPreviewOne('${it.id}')`, '单独预览'], ['✕', `pkRemove('${it.id}')`, '删除']]
              .map(([s, fn, tip, dis]) => `<button onclick="${fn}" title="${tip}" ${dis ? 'disabled' : ''} style="font-size:11px;width:24px;height:24px;background:none;border:1px solid var(--border);border-radius:2px;cursor:${dis ? 'default' : 'pointer'};color:${dis ? 'var(--border)' : 'var(--text-2)'};font-family:inherit">${s}</button>`).join('')}
          </div>
        </div>`;
      }).join('') : `<div style="text-align:center;padding:36px 16px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">还没有内容<br><span style="font-size:10px">从左侧添加学科介绍，或到各工具里点「➕ 加入宣传资料」</span></div>`}

      <div style="border-top:1px solid var(--border-light);margin-top:12px;padding-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="pkOpenDoc(true)" ${incl.length ? '' : 'disabled'} style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 18px;cursor:${incl.length ? 'pointer' : 'not-allowed'};font-family:inherit;opacity:${incl.length ? 1 : .5}">🖨 生成完整 PDF</button>
        <button onclick="pkOpenDoc(false)" ${incl.length ? '' : 'disabled'} style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:8px 14px;cursor:${incl.length ? 'pointer' : 'not-allowed'};font-family:inherit">🌐 打开网页版</button>
        <button onclick="pkDownload()" ${incl.length ? '' : 'disabled'} style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:8px 14px;cursor:${incl.length ? 'pointer' : 'not-allowed'};font-family:inherit">⬇ 下载网页版 (.html)</button>
      </div>
      <div style="font-size:10px;color:var(--text-3);margin-top:8px;line-height:1.7">生成 PDF：在打印对话框的「目标打印机」选「另存为 PDF」，并勾选「背景图形」以保留配色。网页版 .html 可直接发给客户用浏览器打开。</div>
    </div>
  </div>`;
  pkUpdateTabBadge();
}

function pkSetCover(k, v) { pkCover[k] = v; pkSave(); }
function pkFind(id) { return pkItems.find(x => x.id === id); }
function pkToggle(id) { const it = pkFind(id); if (it) { it.include = !it.include; pkSave(); pkRender(); } }
function pkMove(id, d) {
  const i = pkItems.findIndex(x => x.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= pkItems.length) return;
  [pkItems[i], pkItems[j]] = [pkItems[j], pkItems[i]];
  pkSave(); pkRender();
}
function pkRename(id) {
  const it = pkFind(id); if (!it) return;
  const t = prompt('资料中显示的标题：', it.title);
  if (t == null || !t.trim()) return;
  it.title = t.trim(); pkSave(); pkRender();
}
function pkRemove(id) {
  const it = pkFind(id); if (!it) return;
  if (!confirm(`从资料中删除「${it.title}」？`)) return;
  pkItems = pkItems.filter(x => x.id !== id); pkSave(); pkRender();
}
function pkClear() {
  if (!confirm('清空资料包里的全部内容？')) return;
  pkItems = []; pkSave(); pkRender();
}
function pkPreviewOne(id) {
  const it = pkFind(id); if (!it) return;
  pkWriteWindow(pkDocHtml([it], { cover: false, autoPrint: false }));
}

// ══════════════════════════════════
// 生成整份资料（封面 + 目录 + 各章节；每章另起一页，出愿名单/进度规划为横版页）
// ══════════════════════════════════
function pkDocTitle() {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${pkCover.title || '宣传资料'}${pkCover.student ? '_' + pkCover.student : ''}_${ds}`;
}

function pkDocHtml(items, opts) {
  const o = Object.assign({ cover: true, autoPrint: false }, opts);
  const d = new Date();
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  const num = i => String(i + 1).padStart(2, '0');
  const cover = !o.cover ? '' : `<section class="pk-page pk-cover">
    <div class="pk-kicker">TRANSFORM EDUCATION · 唯新教育</div>
    <h1>${pkEsc(pkCover.title || '宣传资料')}</h1>
    ${pkCover.student ? `<div class="pk-for">为 <b>${pkEsc(pkCover.student)}</b> 同学整理</div>` : ''}
    ${pkCover.message ? `<div class="pk-msg">${pkEsc(pkCover.message).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="pk-toc">
      <div class="pk-toc-h">CONTENTS · 目录</div>
      ${items.map((it, i) => `<div class="pk-toc-row"><span class="n">${num(i)}</span><span class="t">${pkEsc(it.title)}</span><span class="k">${(PK_TYPES[it.type] || {}).label || ''}</span></div>`).join('')}
    </div>
    <div class="pk-meta">${pkCover.consultant ? `顾问老师：${pkEsc(pkCover.consultant)}　·　` : ''}${dateStr}</div>
  </section>`;
  // 结尾语放进最后一章，避免打印时单独占一页
  const endLine = '<div class="pk-end">具体开课与报名事宜请咨询顾问老师 · © 唯新教育 TRANSFORM EDUCATION</div>';
  const secs = items.map((it, i) => `<section class="pk-page${it.wide ? ' wide' : ''}">
    <div class="pk-head"><span class="n">${num(i)}</span><h2>${pkEsc(it.title)}</h2><span class="brand">唯新教育</span></div>
    ${it.html}${i === items.length - 1 ? endLine : ''}
  </section>`).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pkEsc(pkDocTitle())}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root { --bg:#f7f5f0; --surface:#fff; --border:#e2ded6; --border-light:#ede9e2; --text:#1a1814; --text-1:#1a1814; --text-2:#5a5650; --text-3:#9a9590; --accent:#5a3e28; --accent-light:#f5ede3; --warn:#8a6a1b; --ok:#2a9e6a; --ok-bg:#e4f0e8; }
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:'Noto Serif SC','Hiragino Sans GB','Microsoft YaHei',serif; color:var(--text); background:#e9e5dd; font-size:12px; line-height:1.8; }
.toolbar { position:sticky; top:0; z-index:5; background:#3a2e24; color:#f7f5f0; padding:10px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px; }
.toolbar button { font-family:inherit; font-size:12px; padding:6px 16px; border:none; border-radius:3px; background:#f7f5f0; color:#3a2e24; cursor:pointer; }
.toolbar .tip { font-size:10px; opacity:.75; }
.pk-page { background:#fff; width:100%; max-width:210mm; margin:16px auto; padding:14mm 13mm; box-shadow:0 2px 10px rgba(0,0,0,.08); }
.pk-page.wide { max-width:297mm; }
@page { size:A4; margin:12mm 11mm; }
@page wide { size:A4 landscape; margin:10mm; }
@media print {
  body { background:#fff; }
  .toolbar { display:none !important; }
  .pk-page { margin:0; padding:0; box-shadow:none; max-width:none; break-after:page; }
  .pk-page:last-child { break-after:auto; }
  .pk-page.wide { page:wide; }
}
@media (max-width:640px) { .pk-page { padding:18px 16px; margin:0 0 10px; } .pk-cards { grid-template-columns:1fr !important; } }
/* 封面 */
.pk-cover { min-height:250mm; display:flex; flex-direction:column; }
.pk-kicker { font-size:10px; letter-spacing:.3em; color:var(--accent); margin-top:30mm; }
.pk-cover h1 { font-size:30px; font-weight:700; letter-spacing:.04em; margin:12px 0 8px; padding-bottom:16px; border-bottom:2px solid var(--accent); }
.pk-for { font-size:15px; color:var(--text-2); margin-top:6px; }
.pk-msg { font-size:12.5px; color:var(--text-2); background:var(--bg); border-left:3px solid var(--accent); padding:12px 16px; margin-top:18px; line-height:2; }
.pk-toc { margin-top:28px; }
.pk-toc-h { font-size:10px; letter-spacing:.2em; color:var(--text-3); margin-bottom:8px; }
.pk-toc-row { display:flex; align-items:baseline; gap:12px; padding:9px 0; border-bottom:1px dashed var(--border); font-size:13.5px; }
.pk-toc-row .n { font-family:'DM Mono',monospace; font-size:11px; color:var(--accent); width:22px; }
.pk-toc-row .t { flex:1; }
.pk-toc-row .k { font-size:10px; color:var(--text-3); }
.pk-meta { margin-top:auto; padding-top:20px; font-size:11px; color:var(--text-3); text-align:right; }
/* 章节头 */
.pk-head { display:flex; align-items:baseline; gap:10px; border-bottom:2px solid var(--accent); padding-bottom:8px; margin-bottom:16px; }
.pk-head .n { font-family:'DM Mono',monospace; font-size:12px; color:var(--accent); letter-spacing:.1em; }
.pk-head h2 { font-size:18px; font-weight:700; flex:1; }
.pk-head .brand { font-size:9px; color:var(--text-3); letter-spacing:.15em; }
.pk-sub { font-size:14px; font-weight:700; color:var(--accent); margin:18px 0 10px; padding-left:10px; border-left:3px solid var(--accent); }
.pk-sub:first-of-type { margin-top:0; }
/* 学科介绍 */
.pk-block { border:1px solid var(--border-light); border-radius:5px; padding:14px 18px; margin-bottom:10px; break-inside:avoid; }
.pk-block h3 { font-size:14px; font-weight:600; margin-bottom:8px; }
.pk-rich { font-size:12px; color:var(--text-2); line-height:1.9; }
.pk-cards { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.pk-card { border:1px solid var(--border-light); border-radius:5px; padding:12px 16px; break-inside:avoid; }
.pk-name { font-size:14px; font-weight:600; margin-bottom:2px; }
.pk-tch { font-size:10px; font-weight:400; color:var(--text-3); margin-left:8px; }
.pk-cred { font-size:10px; color:var(--accent); margin-bottom:6px; }
.pk-sched { margin-top:8px; font-size:10.5px; background:var(--ok-bg); border-radius:3px; padding:5px 10px; color:var(--text-1); }
.pk-sched.closed { background:#f8f0d8; color:var(--warn); }
/* 出愿名单 */
.pk-filter { font-size:10.5px; color:#2c4a7c; background:#eef3fb; border-radius:3px; padding:4px 10px; display:inline-block; margin-bottom:8px; }
table.pk-adb { border-collapse:collapse; width:100%; font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif; }
.pk-adb th { background:#2c4a7c; color:#fff; font-size:9px; font-weight:700; text-align:left; padding:5px 4px; border:1px solid #1e3560; white-space:nowrap; }
.pk-adb td { font-size:9.5px; padding:4px; border:1px solid #ddd; vertical-align:top; line-height:1.45; word-break:break-all; }
.pk-adb tr:nth-child(even) td { background:#f4f7fb; }
.pk-adb thead { display:table-header-group; }
.pk-adb tr { break-inside:avoid; }
.pk-adb .b { font-weight:700; } .pk-adb .c { text-align:center; font-weight:700; }
.pk-note { margin-top:10px; font-size:9.5px; color:#666; line-height:1.8; }
/* VIP */
.pk-stats { display:flex; gap:22px; align-items:baseline; background:var(--bg); border:1px solid var(--border); border-radius:3px; padding:8px 14px; margin-bottom:12px; font-size:11px; color:var(--text-2); }
.pk-stats b { font-family:'DM Mono',monospace; font-size:18px; font-weight:500; color:var(--text-1); }
table.pk-vip { width:100%; border-collapse:collapse; font-size:10px; }
.pk-vip thead tr { background:#1a1814; color:#f7f5f0; }
.pk-vip th { padding:6px 8px; text-align:left; font-weight:500; font-size:9px; }
.pk-vip td { padding:5px 8px; border-bottom:1px solid #ede9e2; vertical-align:top; line-height:1.5; color:var(--text-2); }
.pk-vip tr { break-inside:avoid; }
.pk-vip .grp { font-size:9px; font-weight:500; text-align:center; writing-mode:vertical-rl; width:26px; vertical-align:middle; }
.pk-vip .n { width:22px; text-align:center; color:var(--text-3); }
.pk-vip .nm { width:22%; font-weight:500; color:var(--text-1); }
.pk-vip .h { width:44px; text-align:center; font-weight:500; color:var(--text-1); }
.pk-page tr { break-inside:avoid; }
.pk-end { text-align:center; font-size:10px; color:var(--text-3); margin-top:24px; padding-top:10px; border-top:1px solid var(--border-light); }
</style></head><body>
<div class="toolbar">
  <button onclick="window.print()">🖨 打印 / 保存为 PDF</button>
  <span class="tip">打印对话框中「目标打印机」选择「另存为 PDF」，并勾选「背景图形」</span>
</div>
${cover}${secs}
${o.autoPrint ? `<script>window.onload=function(){var go=function(){setTimeout(function(){window.print()},400)};if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go)}else{setTimeout(go,1200)}}<\/script>` : ''}
</body></html>`;
}

function pkWriteWindow(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
  w.document.write(html);
  w.document.close();
}

function pkOpenDoc(autoPrint) {
  const items = pkItems.filter(x => x.include);
  if (!items.length) { alert('请先勾选要放入资料的内容'); return; }
  pkWriteWindow(pkDocHtml(items, { autoPrint }));
}

function pkDownload() {
  const items = pkItems.filter(x => x.include);
  if (!items.length) { alert('请先勾选要放入资料的内容'); return; }
  const blob = new Blob([pkDocHtml(items, { autoPrint: false })], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pkDocTitle().replace(/[\\/:*?"<>|\s]+/g, '_') + '.html';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
