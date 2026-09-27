// ══════════════════════════════════
// riyu.js — 志望理由书（新版，学部 gakubu_riyu / 大学院 grad_riyu 共用）
// 写作指导：writing_guides 表（admin 考学进度 →「📁 出愿材料准备」→「✍ 文书指导」维护）
// 提交记录：riyu_submissions 表（学生按志望校逐校撰写 → 提交 → 老师下载 Word / 上传批复版）
// 学生端撰写组件在 student/study.js；本文件放三端共用的：指导读取、状态、统计、老师/管理端的逐校列表与操作
// 依赖：shared/supabase.js、shared/constants.js（riyuKeyOf）
// ══════════════════════════════════

const RIYU_KIND_LABEL = { gakubu_riyu: '学部', grad_riyu: '大学院' };

// 表里还没有指导内容时的兜底（与 PR 里 SQL 的初始内容相同；以 admin 里保存的为准）
const RIYU_GUIDE_SEED = {
  title: '志望理由书',
  intro: '按志望校逐校撰写：每一所学校写一份。建议先写「专业理由即契机」「学校理由」「学习计划」「毕业后计划」，最后再写「总结」。写完点「📤 提交给老师」，老师修改后会把批复版本发回这里。',
  sections: [
    { key: 'summary', title: '总结', subtitle: '放在最后写。一句话版本即可：【将来，为了＊＊＊，所以决定报名贵校的＊＊＊。】', tips: [] },
    { key: 'motive', title: '专业理由即契机', subtitle: '【因为什么样的事情，而决定报名这个专业。】', tips: [
      '一定要和自己有关系，不要仅仅是看到新闻、看到电影等',
      '一定要逻辑完善，也就是解释清楚：为了实现这个目的，为什么要报名这个专业',
      '如果完全没有思绪，有两个作弊方法：1. 看学校的教授，看他们的研究方法 2. 看这个专业的毕业方向',
    ] },
    { key: 'school', title: '学校理由', subtitle: '【因为什么样的理由，而决定报名这个学校。】', tips: [
      '要围绕契机和自己的未来方向，去选择学校理由',
      '一定要仔细看官网（随手记录所有觉得重要的内容，先不要做筛选）',
      '能写的大概内容【学校理念、课程设置、zemi 教授、交换留学、特色项目、实践重视等等】',
    ] },
    { key: 'study', title: '学习计划', subtitle: '【进入大学之后，整体的学习规划。】', tips: [
      '最简单的写法：大一学什么，大二学什么，大三学什么',
      '注意不要犯的尝试错误：1. 课程的名字以及年限，尤其是 zemi 2. 实习不是毕业后做的事情',
      '尽量不要去写设施相关的理由',
    ] },
    { key: 'career', title: '毕业后计划', subtitle: '【大学毕业之后，未来具体的规划。】', tips: [
      '一定要具体，让人看到清晰的画像，可以理解为这个是对面教授对你的最核心的认知',
      '大学院并不算很好的毕业后计划，大学院之后最好还有后续的计划',
    ] },
  ],
};

function riyuEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// 简单排版：**粗体**、- 列表、换行（指导说明用）
function riyuMd(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = '', list = [];
  const inl = s => riyuEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const flush = () => { if (list.length) { out += `<ul style="margin:2px 0 6px 1.3em">${list.map(x => `<li>${inl(x)}</li>`).join('')}</ul>`; list = []; } };
  lines.forEach(l => {
    const t = l.trim();
    if (/^[-・]\s?/.test(t)) { list.push(t.replace(/^[-・]\s?/, '')); return; }
    flush();
    out += t ? `<div>${inl(t)}</div>` : '<div style="height:6px"></div>';
  });
  flush();
  return out;
}

// ── 写作指导 ──
const riyuGuideCache = {};
function riyuNormGuide(row) {
  const g = Object.assign({ title: '', intro: '', sections: [] }, row || {});
  let secs = g.sections;
  if (typeof secs === 'string') { try { secs = JSON.parse(secs); } catch (e) { secs = []; } }
  g.sections = (Array.isArray(secs) ? secs : []).filter(s => s && s.key).map(s => ({
    key: String(s.key), title: s.title || '', subtitle: s.subtitle || '',
    tips: Array.isArray(s.tips) ? s.tips.filter(t => String(t || '').trim()) : [],
  }));
  return g;
}
async function riyuLoadGuide(kind, force) {
  if (!force && riyuGuideCache[kind]) return riyuGuideCache[kind];
  let row = null;
  try { row = (await sb(`/rest/v1/writing_guides?kind=eq.${encodeURIComponent(kind)}&select=*`) || [])[0] || null; }
  catch (e) { row = null; }
  const g = riyuNormGuide(row || Object.assign({ kind }, JSON.parse(JSON.stringify(RIYU_GUIDE_SEED))));
  g.kind = kind; g._fromDb = !!row;
  riyuGuideCache[kind] = g;
  return g;
}

// ── 状态 / 统计 ──
function riyuStatusInfo(status) {
  if (status === 'submitted') return { t: '已提交 · 待老师批复', c: '#b8860b', bg: '#fdf6e3' };
  if (status === 'reviewed') return { t: '已批复', c: '#2a7a4a', bg: '#e4f0e8' };
  if (status === 'draft') return { t: '草稿', c: '#6a6560', bg: '#f0ede8' };
  return { t: '未开始', c: '#9a9590', bg: '#f7f5f0' };
}
function riyuSecs(sub) {
  let v = sub && sub.sections;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } }
  return v && typeof v === 'object' ? v : {};
}
function riyuHistory(sub) {
  let v = sub && sub.history;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } }
  return Array.isArray(v) ? v : [];
}
// 每所志望校对应的提交记录（按 riyuKeyOf 匹配）
function riyuSubOf(plan, subs, kind) {
  const k = riyuKeyOf(plan);
  return (subs || []).find(x => x.school_key === k && (!kind || x.kind === kind)) || null;
}
// {total, submitted, reviewed}：已提交=待批复+已批复
function riyuCounts(plans, subs, kind) {
  const list = plans || [];
  let submitted = 0, reviewed = 0;
  list.forEach(p => {
    const s = riyuSubOf(p, subs, kind);
    if (!s) return;
    if (s.status === 'submitted' || s.status === 'reviewed') submitted++;
    if (s.status === 'reviewed') reviewed++;
  });
  return { total: list.length, submitted, reviewed };
}
function riyuCountText(c) {
  if (!c.total) return '请先选志望校';
  if (!c.submitted) return `未提交（共 ${c.total} 校）`;
  return `已提交 ${c.submitted} / ${c.total} 校，已批复 ${c.reviewed} 校`;
}
function riyuFmtTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16); } catch (e) { return String(ts).slice(0, 16); }
}

// ══════════════════════════════════
// 老师端 / 管理端：逐校列表 + 查看 / 下载 Word / 上传批复版
// ══════════════════════════════════
// 当前页面登记的数据（按钮用 id 找回学生、学校、提交记录）
const RIYU_STAFF = { subs: {}, students: {}, plans: {}, onChange: null };
function riyuReviewerName() { return (typeof teacherName !== 'undefined' && teacherName) ? teacherName : '管理员'; }

// student：学生对象；plans：志望校；subs：该生的提交记录；kind；onChange：批复后回调（重绘）
function riyuStaffListHtml(student, plans, subs, kind, onChange) {
  if (!student) return '';
  RIYU_STAFF.students[student.id] = student;
  if (onChange) RIYU_STAFF.onChange = onChange;
  const list = (plans || []).slice().sort((a, b) => (a.level || 2) - (b.level || 2));
  if (!list.length) return '<div style="font-size:11px;color:var(--text-3,#999)">尚无志望校，学生添加志望校后即可逐校撰写</div>';
  const btn = 'font-size:10px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);padding:2px 8px;cursor:pointer;font-family:inherit;white-space:nowrap';
  return list.map(p => {
    const sub = riyuSubOf(p, subs, kind);
    const pk = student.id + '|' + riyuKeyOf(p);
    RIYU_STAFF.plans[pk] = p;
    if (sub) RIYU_STAFF.subs[sub.id] = sub;
    const st = riyuStatusInfo(sub && sub.status);
    const title = [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ') || '（未命名学校）';
    const has = sub && Object.values(riyuSecs(sub)).some(v => String(v || '').trim());
    return `<div style="border:1px solid var(--border-light,#ede9e2);border-radius:5px;padding:8px 10px;margin-bottom:6px;background:var(--surface,#fff)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600">${riyuEsc(title)}</span>
        <span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${st.bg};color:${st.c}">${st.t}</span>
        ${sub && sub.submitted_at ? `<span style="font-size:10px;color:var(--text-3,#999)">提交 ${riyuEsc(riyuFmtTime(sub.submitted_at))}</span>` : ''}
        <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap">
          ${has ? `<button onclick="event.stopPropagation();riyuStaffView('${riyuEsc(sub.id)}')" style="${btn}">👁 查看</button>
          <button onclick="event.stopPropagation();riyuStaffWord('${riyuEsc(sub.id)}')" style="${btn}">⬇ 下载 Word</button>
          <button onclick="event.stopPropagation();riyuStaffUpload('${riyuEsc(sub.id)}')" style="${btn};border-color:var(--accent,#b8953a);color:var(--accent,#b8953a)">⬆ 上传批复版</button>` : '<span style="font-size:10px;color:var(--text-3,#999)">学生尚未撰写</span>'}
        </span>
      </div>
      <div style="font-size:10px;color:var(--text-2,#5a5650);margin-top:3px">要求：${p.plan_requirement ? riyuEsc(p.plan_requirement) : '<span style="color:var(--text-3,#999)">暂未填写要求</span>'}</div>
      ${sub && sub.status === 'reviewed' && sub.reviewed_file_url ? `<div style="font-size:10px;color:#2a7a4a;margin-top:3px">批复版：<a href="${riyuEsc(sub.reviewed_file_url)}" target="_blank" style="color:#2a7a4a">${riyuEsc(sub.reviewed_file_name || '下载')}</a> · ${riyuEsc(riyuFmtTime(sub.reviewed_at))} · ${riyuEsc(sub.reviewed_by || '')}</div>` : ''}
    </div>`;
  }).join('');
}

async function riyuStaffView(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const g = await riyuLoadGuide(sub.kind);
  const secs = riyuSecs(sub);
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  const order = g.sections.map(s => s.key);
  Object.keys(secs).forEach(k => { if (!order.includes(k)) order.push(k); });
  document.getElementById('riyuViewModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'riyuViewModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:720px;width:100%">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <div style="font-size:14px;font-weight:600;flex:1">志望理由书 — ${riyuEsc(stu.name || '')}</div>
      <button onclick="document.getElementById('riyuViewModal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3,#999)">×</button>
    </div>
    <div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:10px">${riyuEsc([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · '))}${sub.requirement ? ' · 要求：' + riyuEsc(sub.requirement) : ''}${sub.submitted_at ? ' · 提交 ' + riyuEsc(riyuFmtTime(sub.submitted_at)) : ''}</div>
    ${order.map(k => {
      const s = g.sections.find(x => x.key === k) || { title: k };
      const txt = String(secs[k] || '').trim();
      return `<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;margin-bottom:3px">${riyuEsc(s.title)}</div>
        <div style="font-size:12px;line-height:1.9;white-space:pre-wrap;color:var(--text-2,#5a5650);background:var(--bg,#f7f5f0);border-radius:3px;padding:8px 10px">${txt ? riyuEsc(txt) : '<span style="color:#bbb">（未填写）</span>'}</div></div>`;
    }).join('')}
  </div>`;
  document.body.appendChild(ov);
}

async function riyuStaffWord(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const g = await riyuLoadGuide(sub.kind);
  const secs = riyuSecs(sub);
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  const order = g.sections.map(s => s.key);
  Object.keys(secs).forEach(k => { if (!order.includes(k)) order.push(k); });
  const e = s => riyuEsc(s).replace(/\n/g, '<br>');
  const major = (typeof MAJORS !== 'undefined' && MAJORS[stu.major]) || stu.major || '';
  const body = `<h2 style="text-align:center;font-size:16pt">${e(g.title || '志望理由书')}</h2>
    <table style="border-collapse:collapse;font-size:11pt;margin-bottom:12pt">
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">学生</td><td>${e(stu.name || '')}${major ? '（' + e(major) + '）' : ''}</td></tr>
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">志望校</td><td>${e([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' '))}</td></tr>
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">要求</td><td>${e(sub.requirement || '—')}</td></tr>
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">提交时间</td><td>${e(riyuFmtTime(sub.submitted_at) || '—')}</td></tr>
    </table>
    ${order.map(k => {
      const s = g.sections.find(x => x.key === k) || { title: k };
      return `<h3 style="font-size:12pt;margin:12pt 0 4pt">${e(s.title)}</h3><p style="margin:0">${e(String(secs[k] || '').trim() || '（未填写）')}</p>`;
    }).join('')}`;
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>body{font-family:'Noto Serif SC','MS Mincho',serif;font-size:11pt;line-height:1.8}</style></head><body>${body}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `志望理由书_${stu.name || ''}_${sub.school_name || ''}_${ds}.doc`.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function riyuStaffUpload(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  document.getElementById('riyuUpModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'riyuUpModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit';
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:460px;width:100%">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">上传批复版</div>
    <div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:12px">${riyuEsc(stu.name || '')} · ${riyuEsc([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · '))}</div>
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复文件（Word / PDF）</label>
    <input type="file" id="riyuUpFile" accept=".doc,.docx,.pdf" style="${inp};margin-bottom:10px">
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复备注（可选，学生能看到）</label>
    <textarea id="riyuUpNote" rows="2" placeholder="例：第二段逻辑再加强，其余可以" style="${inp};resize:vertical;margin-bottom:12px"></textarea>
    <div id="riyuUpMsg" style="font-size:11px;color:var(--danger,#b03a2e);min-height:14px;margin-bottom:6px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('riyuUpModal').remove()" style="font-size:12px;padding:7px 14px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:none;cursor:pointer;font-family:inherit">取消</button>
      <button id="riyuUpBtn" onclick="riyuStaffUploadDo('${riyuEsc(subId)}')" style="font-size:12px;padding:7px 18px;border:none;border-radius:3px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">上传并批复</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
async function riyuStaffUploadDo(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const f = (document.getElementById('riyuUpFile') || {}).files?.[0];
  const msg = document.getElementById('riyuUpMsg');
  if (!f) { if (msg) msg.textContent = '请选择文件'; return; }
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  if (!['doc', 'docx', 'pdf'].includes(ext)) { if (msg) msg.textContent = '只能上传 Word（doc / docx）或 PDF'; return; }
  const note = ((document.getElementById('riyuUpNote') || {}).value || '').trim();
  const btn = document.getElementById('riyuUpBtn'); if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
  try {
    const path = `riyu/${String(sub.student_id).replace(/[^A-Za-z0-9_-]/g, '_')}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const url = await sbUpload('teacher-files', path, f);
    const now = new Date().toISOString();
    const by = riyuReviewerName();
    const history = riyuHistory(sub).concat([{ at: now, by, action: 'review', file_url: url, file_name: f.name, note }]);
    const patch = { status: 'reviewed', reviewed_file_url: url, reviewed_file_name: f.name, reviewed_at: now, reviewed_by: by, review_note: note || null, history, updated_at: now };
    await sb(`/rest/v1/riyu_submissions?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', patch);
    Object.assign(sub, patch);
    document.getElementById('riyuUpModal')?.remove();
    if (typeof RIYU_STAFF.onChange === 'function') RIYU_STAFF.onChange(sub);
    alert('已上传批复版，学生端这所学校会显示「已批复」和下载链接');
  } catch (e) {
    if (msg) msg.textContent = '上传失败：' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '上传并批复'; }
  }
}
