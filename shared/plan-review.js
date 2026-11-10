// 计划书批复弹窗（老师端 / 管理端共用）：查看先行研究・计划书全文、给文献打关键词写评语、整体批注、按版本上传批复（版本列表）、导出先行研究 CSV；
// 学部学生的志望理由书写整体评语。署名用 riyuReviewerName()：老师端 = 老师名，管理端 = 「管理员」。
// 数据来源：老师端读 teacherProgressData（原样不变）；管理端每次打开都重新读这个学生的草稿和志望校（保证和老师端看到的一样）。
// 依赖：shared/supabase.js（sb / sbUpload）、shared/doc-versions.js（版本列表・批复）、shared/riyu.js（riyuReviewerName / planRvHistory / planRvStaffHtml / renderRiyuView）、shared/constants.js（isGakubuStudent）
const prvEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const prvIsTeacherSide = () => typeof teacherProgressData !== 'undefined';

// ══ 计划书内容渲染（供考学进度卡片与批注弹窗使用） ══
// 草稿字段标签（经济/经营/社会人文三套模板字段的并集）
const T_DRAFT_LABELS = {
  theme:'研究テーマ', field:'志望分野', data_source:'データ出処', data_type:'データ種類',
  prior_lit:'先行文献', hypothesis:'仮説', difference:'先行研究との違い',
  var_y:'被説明変数Y', var_x:'説明変数X', var_ctrl:'コントロール変数',
  model:'モデル', model_other:'その他', regression:'回帰式',
  background:'一、研究背景', prior:'二、先行研究', purpose:'三、研究目的',
  method:'四、研究方法', significance:'五、研究意義',
};
// 先行研究字段标签（两套整理格式的并集）
const T_REF_LABELS = {
  keyword:'キーワード', title:'題目/テーマ', author:'著者', year:'年', journal:'刊行物',
  data:'研究対象/データ', method:'研究方法', summary:'概要', awareness:'問題意識',
  conclusion:'結論', citation:'引用', evaluation:'評価', note:'備考',
};

function tDraftRefs(draft) { try { return draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list) : []; } catch (e) { return []; } }
function tDraftFields(draft) { try { return draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {}; } catch (e) { return {}; } }
function tFieldVal(v) { return Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v)); }

// 卡片内摘要：先行研究条数 + 前几个已填字段
function tDraftSummaryHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  const lines = [`<div style="font-size:11px;color:var(--text-2)">📚 先行研究：${refs.length ? `已整理 ${refs.length} 条` : '未整理'}</div>`];
  filled.slice(0, 3).forEach(([k, v]) => {
    const t = tFieldVal(v).replace(/\n/g, ' ');
    lines.push(`<div style="font-size:11px;color:var(--text-2)">${T_DRAFT_LABELS[k] || k}：${prvEsc(t.length > 26 ? t.slice(0, 26) + '…' : t)}</div>`);
  });
  if (!filled.length) {
    if (draft.research_question) lines.push(`<div style="font-size:11px;color:var(--text-2)">问题：${prvEsc(draft.research_question.slice(0, 40))}…</div>`);
    if (draft.methodology) lines.push(`<div style="font-size:11px;color:var(--text-2)">方法：${prvEsc(draft.methodology.slice(0, 30))}…</div>`);
  }
  if (filled.length > 3) lines.push(`<div style="font-size:10px;color:var(--text-3)">…共 ${filled.length} 项已填，点击下方查看全文</div>`);
  return lines.join('');
}

// 弹窗内全文：先行研究逐条 + 草稿字段逐项 + 旧字段兼容
function tDraftFullHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  let h = '';
  if (refs.length) {
    h += `<div style="font-weight:600;margin-bottom:4px">📚 先行研究（${refs.length}条）</div>`;
    h += refs.map((r, i) => {
      const parts = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${prvEsc(v)}`).join('　');
      return `<div style="margin-bottom:5px;padding-bottom:5px;border-bottom:1px dashed var(--border)">${i + 1}. ${parts}</div>`;
    }).join('');
  }
  if (filled.length) {
    h += `<div style="font-weight:600;margin:8px 0 4px">📄 计划书草稿</div>`;
    h += filled.map(([k, v]) => `<div style="margin-bottom:5px"><span style="color:var(--text-3)">${T_DRAFT_LABELS[k] || k}：</span>${prvEsc(tFieldVal(v)).replace(/\n/g, '<br>')}</div>`).join('');
  }
  if (draft.research_question) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">问题意识：</span>${prvEsc(draft.research_question)}</div>`;
  if (draft.methodology) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">研究方法：</span>${prvEsc(draft.methodology)}</div>`;
  if (draft.draft_notes) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">进展说明：</span>${prvEsc(draft.draft_notes)}</div>`;
  return h || '<div style="color:var(--text-3)">暂无填写内容</div>';
}


// ══ 老师侧：计划书 / 先行研究 查看・评估 ══
// 老师标注存 student_plan_drafts.teacher_ref_notes（与学生自填的 prior_research_list 分离，互不覆盖）
const T_REF_TAG_LIB = [
  ['重要度', ['核心文献', '重要参考', '一般参考']],
  ['研究方法', ['量的研究', '质的研究', '理论研究', '个案研究', '比较研究']],
  ['阅读建议', ['需精读', '可略读', '仅看结论', '需补充同类文献']],
];
let tdcName = '', tdcStudentId = null, tdcDraft = null, tdcNotes = {}, tdcTab = 'refs', tdcPlans = [], tdcVersions = [], tdcFocus = null;

function tRefKey(r, i) { return String((r && (r.title || r.keyword)) || '').trim() || ('#' + i); }
function tParseNotes(draft) {
  const v = draft && draft.teacher_ref_notes;
  if (!v) return {};
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return {}; }
}
function tdcNoteOf(key) { return tdcNotes[key] || (tdcNotes[key] = { tags: [], comment: '', rating: '' }); }

// 取这个学生的档案：老师端读 teacherProgressData 缓存；管理端读 cachedStudents
function prvStudentOf(sid) {
  const pool = prvIsTeacherSide() ? (teacherProgressData.students || []) : (typeof cachedStudents !== 'undefined' ? cachedStudents : []);
  return (pool || []).find(x => x.id === sid) || null;
}
async function openTeacherDraftComment(studentId, studentName, opts) {
  try { await docScopeLoad([studentId]); } catch (e) {}
  if (!docCanView(studentId)) { alert(DOC_SCOPE_HINT); return; }   // 数据库本来也读不到；这里给个明确提示
  let draft, plans, versions = [];
  const q = encodeURIComponent(studentId);
  if (prvIsTeacherSide()) {
    draft = teacherProgressData.draftsMap?.[studentId];
    plans = (teacherProgressData.plansMap || {})[studentId] || [];
    // 进度数据没加载到这个学生（比如从面谈卡片点进来）：直接读库
    if (!draft) {
      try { draft = (await sb(`/rest/v1/student_plan_drafts?student_id=eq.${q}&select=*&order=updated_at.desc&limit=1`, 'GET', null, { cache: 'no-store' }))[0]; } catch (e) {}
    }
  } else {
    // 管理端：每次都重新读，和老师端看到的一样；读到的同时放回卡片缓存
    try {
      const [ds, ps] = await Promise.all([
        sb(`/rest/v1/student_plan_drafts?student_id=eq.${q}&select=*&order=updated_at.desc&limit=1`, 'GET', null, { cache: 'no-store' }),
        sb(`/rest/v1/student_school_plans?student_id=eq.${q}&select=*&order=level.asc`, 'GET', null, { cache: 'no-store' }).catch(() => []),
      ]);
      draft = (ds || [])[0]; plans = ps || [];
    } catch (e) { alert('读取失败：' + e.message); return; }
  }
  try { versions = await docvLoad(studentId, 'plan'); } catch (e) { versions = []; }
  if (!draft) { alert('这个学生还没有填写计划书'); return; }
  tdcPlans = plans;
  tdcStudentId = studentId; tdcDraft = draft; tdcNotes = tParseNotes(draft); tdcTab = 'refs';
  tdcVersions = versions; tdcFocus = (opts && opts.versionId) || null;
  DOCV.onChange = () => { tdcVersions = Object.values(DOCV.rows).filter(r => r.student_id === String(tdcStudentId) && r.doc_type === 'plan').sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))); tdcRender(tdcName); if (typeof sbmChanged === 'function') sbmChanged(); prvAdminRefresh(tdcStudentId); };
  const existing = document.getElementById('teacherDraftCommentModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'teacherDraftCommentModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div id="tdcBody" style="background:var(--surface);border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto"></div>';
  document.body.appendChild(modal);
  tdcName = studentName;
  tdcRender(studentName);
  if (tdcFocus) setTimeout(() => { const e = document.getElementById('docv_row_' + tdcFocus); if (e) e.scrollIntoView({ block: 'center' }); }, 50);
}

function tdcRender(studentName) {
  const box = document.getElementById('tdcBody');
  if (!box) return;
  const draft = tdcDraft;
  // 学部：查看・评估志望理由书（逐校只读展示 + 整体评语）
  const _stu = prvStudentOf(tdcStudentId);
  const _plans = tdcPlans || [];
  if ((typeof isGakubuStudent === 'function') && isGakubuStudent(_stu)) {
    box.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 志望理由书　—　${prvEsc(studentName)}</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">按志望校逐校展示学生填写的志望理由书；整体评语会同步显示给学生</div>
      <div style="max-height:52vh;overflow-y:auto;margin-bottom:12px">${(typeof renderRiyuView === 'function') ? renderRiyuView(draft, _plans, tsaEsc) : ''}</div>
      <div class="form-group">
        <label class="form-label">整体评语（针对志望理由书）</label>
        <textarea id="tdc_comment" rows="3" placeholder="针对志望理由书内容的反馈和建议…">${prvEsc((draft && draft.teacher_comment) || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="saveTeacherDraftComment('${(draft && draft.id) || ''}','${tdcStudentId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存评语</button>
        <button onclick="document.getElementById('teacherDraftCommentModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
      </div>`;
    return;
  }
  const refs = tDraftRefs(draft);
  const tab = (id, label, n) => `<button onclick="tdcTab='${id}';tdcRender('${prvEsc(studentName)}')" style="font-size:12px;padding:6px 16px;border:none;border-bottom:2px solid ${tdcTab === id ? 'var(--accent)' : 'transparent'};background:none;cursor:pointer;font-family:inherit;color:${tdcTab === id ? 'var(--text)' : 'var(--text-3)'};font-weight:${tdcTab === id ? '600' : '400'}">${label}${n ? ` <span style="font-size:10px;color:var(--text-3)">${n}</span>` : ''}</button>`;

  const refsHtml = refs.length ? refs.map((r, i) => {
    const key = tRefKey(r, i);
    const n = tdcNotes[key] || { tags: [], comment: '', rating: '' };
    const info = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${prvEsc(v)}`).join('　');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 11px;margin-bottom:7px;background:var(--bg)">
      <div style="font-size:11px;line-height:1.9;margin-bottom:6px">${i + 1}. ${info}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:5px">
        ${T_REF_TAG_LIB.map(([grp, tags]) => `<span style="font-size:9px;color:var(--text-3)">${grp}</span>` + tags.map(t => `<span onclick="tdcToggleTag('${prvEsc(key)}','${prvEsc(t)}','${prvEsc(studentName)}')" style="cursor:pointer;font-size:10px;border:1px solid ${(n.tags || []).includes(t) ? 'var(--accent)' : 'var(--border)'};background:${(n.tags || []).includes(t) ? 'var(--accent)' : 'transparent'};color:${(n.tags || []).includes(t) ? '#fff' : 'var(--text-2)'};border-radius:2px;padding:1px 8px">${t}</span>`).join('')).join('')}
      </div>
      ${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).length ? `<div style="margin-bottom:5px">${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).map(t => `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:2px;padding:1px 8px;margin-right:4px">${prvEsc(t)}<span onclick="tdcToggleTag('${prvEsc(key)}','${prvEsc(t)}','${prvEsc(studentName)}')" style="cursor:pointer;margin-left:5px">✕</span></span>`).join('')}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="tdc_newtag_${i}" placeholder="自定义关键词" style="font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:130px">
        <button onclick="tdcAddTag('${prvEsc(key)}',${i},'${prvEsc(studentName)}')" style="font-size:10px;border:1px solid var(--border);background:none;border-radius:2px;padding:3px 9px;cursor:pointer;font-family:inherit">＋ 添加</button>
        <input value="${prvEsc(n.comment || '')}" onchange="tdcSetComment('${prvEsc(key)}',this.value)" placeholder="对该文献的评语（可选）" style="flex:1;min-width:160px;font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px 0">学生尚未整理先行研究</div>';

  box.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 计划书 · 先行研究　—　${prvEsc(studentName)}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">关键词与评语会同步显示给学生；学生自己的文献列表不会被覆盖</div>
    ${tdcVersions.length || !draft.draft_file_url
      ? (typeof docvStaffHtml === 'function' ? docvStaffHtml(tdcVersions, { focusId: tdcFocus, docType: 'plan' }) : '')
      : `<div style="margin-bottom:10px"><a href="${draft.draft_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">⬇ 下载完成稿</a>（还没有版本记录）</div>`}
    ${refs.length ? `<div style="margin-bottom:10px"><button onclick="tdcExportRefs('${prvEsc(studentName)}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 导出先行研究(CSV)</button></div>` : ''}
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px">
      ${tab('refs', '先行研究', refs.length)}
      ${tab('draft', '计划书全文')}
    </div>
    ${tdcTab === 'refs' ? refsHtml : `<div style="background:var(--bg);border-radius:3px;padding:12px;font-size:11px;color:var(--text-2);line-height:1.9;max-height:46vh;overflow-y:auto">${tDraftFullHtml(draft)}</div>`}
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">整体批注（针对计划书）</label>
      <textarea id="tdc_comment" rows="3" placeholder="针对计划书内容的反馈和建议…">${prvEsc(draft.teacher_comment || '')}</textarea>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="saveTeacherDraftComment('${draft.id}','${tdcStudentId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存批注与标注</button>
      <button onclick="document.getElementById('teacherDraftCommentModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
    </div>`;
}

function tdcToggleTag(key, tag, studentName) {
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  const i = n.tags.indexOf(tag);
  if (i >= 0) n.tags.splice(i, 1); else n.tags.push(tag);
  tdcRender(studentName);
}
function tdcAddTag(key, idx, studentName) {
  const el = document.getElementById('tdc_newtag_' + idx);
  const v = el ? el.value.trim() : '';
  if (!v) return;
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  if (!n.tags.includes(v)) n.tags.push(v);
  tdcRender(studentName);
}
function tdcSetComment(key, v) { tdcNoteOf(key).comment = v; }

// 先行研究导出 CSV（含老师标注），Excel 可直接打开
function tdcExportRefs(studentName) {
  const refs = tDraftRefs(tdcDraft);
  if (!refs.length) return;
  const cols = [...new Set(refs.flatMap(r => Object.keys(r)))];
  const head = [...cols.map(c => T_REF_LABELS[c] || c), '老师关键词', '老师评语'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = refs.map((r, i) => {
    const n = tdcNotes[tRefKey(r, i)] || {};
    return [...cols.map(c => r[c] || ''), (n.tags || []).join('、'), n.comment || ''].map(esc).join(',');
  });
  const csv = '\ufeff' + [head.map(esc).join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${studentName}_先行研究整理.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function saveTeacherDraftComment(draftId, studentId) {
  const comment = (document.getElementById('tdc_comment')?.value || '').trim();
  // 清掉空标注，避免存一堆空对象
  const notes = {};
  Object.entries(tdcNotes || {}).forEach(([k, v]) => {
    if (v && ((v.tags || []).length || (v.comment || '').trim() || (v.rating || '').trim())) notes[k] = v;
  });
  if (!comment && !Object.keys(notes).length) { alert('请填写批注内容，或为文献添加关键词/评语'); return; }
  try {
    const patch = {
      teacher_comment: comment, teacher_ref_notes: notes,
      teacher_comment_by: riyuReviewerName(),
      teacher_comment_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await sb(`/rest/v1/student_plan_drafts?id=eq.${draftId}`, 'PATCH', patch);
    if (prvIsTeacherSide()) {
      if (teacherProgressData.draftsMap?.[studentId]) Object.assign(teacherProgressData.draftsMap[studentId], patch);
    } else Object.assign(tdcDraft, patch);
    document.getElementById('teacherDraftCommentModal').remove();
    if (prvIsTeacherSide()) renderTeacherStudyProgress(document.getElementById('sm_content')||document.getElementById('mainContent'));
    else if (typeof sbmChanged === 'function' && document.getElementById('sbm_root')) sbmChanged();
    else prvAdminRefresh(studentId);
  } catch(e) { alert('保存失败：' + e.message); }
}

// 管理端：保存 / 上传后刷新背后的页面（学生提交列表 或 考学进度卡片）；老师端自己有刷新，不走这里
function prvAdminRefresh(sid) {
  if (prvIsTeacherSide()) return;
  if (document.getElementById('sbm_root')) return;   // 学生提交列表：sbmChanged 已处理
  if (typeof pgRefresh === 'function' && document.querySelector('.pgc-body')) pgRefresh(sid);
}
