// ══════════════════════════════════
// teacher-plan.js — 进度规划（营业用）
// 咨询学生考学规划生成器，可打印保存 PDF；依赖 teacher-students.js 的 tsaEsc
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════

// ══════════════════════════════════
// 进度规划（营业用，需 progress_plan 权限）
// 填写咨询学生的基本信息 → 生成考学规划（月份节点表 + 倒计时总结），可打印保存 PDF
// 不落库，纯生成工具
// ══════════════════════════════════
let ppLast = null;

// 与学生端备考规划同一套节点定义（相对考试月E偏移；ms2 为次年路线）
const PP_ROWS = [
  { key:'senmon', icon:'📖', label:'专业知识学习', dl:0, dlName:'考试', special:true },
  { key:'japanese', icon:'🈴', label:'日语', dl:-1, dlName:'成绩送分最晚',
    ms:{ '-2':'EJU 考试', '-1':'JLPT 考试・成绩送分', '0':'日语成绩确定' },
    ms2:{ '-9':'EJU 考试', '-8':'JLPT 考试（按冬季）', '-7':'日语成绩确定' }, dl2:-7, dlName2:'成绩确定最晚（按冬季要求）' },
  { key:'english', icon:'🔤', label:'英语', dl:-1, dlName:'成绩送分最晚',
    ms:{ '-3':'托福考试', '-2':'托业考试', '-1':'英语送分' },
    ms2:{ '-9':'托福考试', '-8':'托业考试（按冬季）', '-7':'英语成绩确定' }, dl2:-7, dlName2:'成绩确定最晚（按冬季要求）' },
  { key:'plan', icon:'📄', label:'研究计划书', dl:-3, dlName:'草稿完成最晚',
    ms:{ '-4':'问题意识・先行研究', '-3':'完成草稿（最晚）', '-2':'zemi 发表・针对教授修改', '-1':'针对出愿学校修改' },
    ms2:{ '-10':'问题意识・先行研究', '-8':'完成草稿（最晚12月）', '-6':'反复修改・zemi 发表', '-1':'针对出愿学校修改' }, dl2:-8, dlName2:'草稿完成最晚（提前至12月）' },
  { key:'school', icon:'🏫', label:'择校・联系教授', dl:-2, dlName:'锁定教授最晚',
    ms:{ '-4':'完成初版出愿 list', '-3':'锁定教授', '-2':'针对教授修改计划书' },
    ms2:{ '-7':'完成初版出愿 list', '-3':'锁定教授', '-2':'针对教授修改计划书' }, dl2:-3 },
  { key:'apply', icon:'📮', label:'出愿相关', dl:-1, dlName:'出愿',
    ms:{ '-4':'准备相关证明', '-3':'联系教授', '-2':'参加说明会', '-1':'出愿' }, red:['-1'] },
  { key:'kakomon', icon:'✏️', label:'过去问备考', dl:0, dlName:'面试稿完成最晚',
    ms:{ '-3':'阅读教授论文', '-2':'笔试练习开始', '-1':'过去问刷题', '0':'面试稿・面试训练' } },
  { key:'exam', icon:'🎓', label:'大学院考试', dl:0, dlName:'考试',
    ms:{ '0':'考试期间', '1':'等待结果', '2':'合格发表' }, red:['0'] },
];
const PP_ROUTES = {
  '夏季出愿': { key:'summer', label:'夏季考试路线（7月出愿・8月考试）', examMonth:8 },
  '冬季出愿': { key:'winter', label:'冬季考试路线（12月出愿・次年1月考试）', examMonth:1 },
  '次年出愿': { key:'next_summer', label:'次年夏季路线（先打基础・次年7月出愿8月考试）', examMonth:8, skipOne:true },
};

function renderProgressPlanTool(mc) {
  // 加宽主容器：月份节点表最宽约1120px（次年路线16列），1400px 可完整展示
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.style.maxWidth = '1400px';
  const inp = 'width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld = (label, ctrl) => `<div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label>${ctrl}</div>`;
  mc.innerHTML = `
  <div class="page-header"><div class="section-title">📅 进度规划生成</div></div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:14px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">填写咨询学生的基本信息，一键生成考学规划（计划书・择校等默认未开始，从当下开始规划）</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:12px">
      ${fld('学生姓名（可不填）', `<input id="pp_name" placeholder="咨询学生姓名" style="${inp}">`)}
      ${fld('专业（可不填）', `<select id="pp_major" style="${inp}"><option value="">— 选择 —</option>${Object.entries(MAJORS).filter(([k])=>k!=='shakai_group').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>`)}
      ${fld('报名时间', `<input id="pp_signup" placeholder="26年7月" style="${inp}">`)}
      ${fld('期待入学时间', `<input id="pp_enroll" placeholder="27年4月" style="${inp}">`)}
      ${fld('出愿时期', `<select id="pp_period" style="${inp}">${Object.keys(PP_ROUTES).map(k=>`<option value="${k}">${k}</option>`).join('')}</select>`)}
      ${fld('日语现状', `<select id="pp_jp" style="${inp}">${PROGRESS_OPTIONS.japanese.map(o=>`<option ${o==='备考中'?'selected':''}>${o}</option>`).join('')}</select>`)}
      ${fld('英语现状', `<select id="pp_en" style="${inp}">${PROGRESS_OPTIONS.english.map(o=>`<option ${o==='备考中'?'selected':''}>${o}</option>`).join('')}</select>`)}
    </div>
    <button onclick="ppGenerate()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 20px;cursor:pointer;font-family:inherit">生成规划</button>
    <button id="pp_print_btn" onclick="ppOpenPrint()" style="display:none;font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:8px 16px;cursor:pointer;font-family:inherit;margin-left:8px">🖨 打印 / 保存 PDF</button>
  </div>
  <div id="pp_out"></div>`;
}

function ppBuild() {
  const g = id => (document.getElementById(id) || {}).value || '';
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const period = g('pp_period') || '夏季出愿';
  const route = PP_ROUTES[period];
  let examIdx = now.getFullYear() * 12 + (route.examMonth - 1);
  while (examIdx < nowIdx) examIdx += 12;
  if (route.skipOne) examIdx += 12;
  const startIdx = nowIdx;
  const endIdx = examIdx + 2; // 到合格发表
  const jp = g('pp_jp'), en = g('pp_en');
  const dn = (k, v) => typeof PROGRESS_DONE !== 'undefined' && (PROGRESS_DONE[k] || []).includes(v);
  const useAlt = !!route.skipOne;
  const ymStr = i => `${Math.floor(i/12)}年${i%12+1}月`;

  const rows = PP_ROWS.map(r0 => {
    const r = Object.assign({}, r0, useAlt ? { ms: r0.ms2 || r0.ms, dl: (r0.dl2 != null ? r0.dl2 : r0.dl), dlName: r0.dlName2 || r0.dlName } : {});
    let cur = '未开始', status = 'todo', dlIdx = examIdx + r.dl;
    if (r.key === 'japanese') { cur = jp || '未填写'; status = dn('japanese', jp) ? 'done' : 'active'; }
    if (r.key === 'english') { cur = en || '未填写'; status = (dn('english', en) || /完成/.test(en)) ? 'done' : 'active'; } // TOEIC完成/TOEFL完成等均视为已完成
    if (r.key === 'senmon') { cur = '从本月开始'; status = 'active'; }
    if (r.key === 'exam') cur = '—';
    const left = dlIdx - nowIdx;
    let vt, vc;
    if (status === 'done') { vt = '✓ 已完成'; vc = '#2a9e6a'; }
    else if (left > 1)   { vt = `距${r.dlName}（${ymStr(dlIdx)}）还剩 ${left} 个月`; vc = '#6b5c4e'; }
    else if (left === 1) { vt = `⚠ 距${r.dlName}仅剩 1 个月`; vc = '#b8860b'; }
    else if (left === 0) { vt = `⚠ ${r.dlName}就在本月`; vc = '#b03a2e'; }
    else                 { vt = `✗ 已超${r.dlName} ${-left} 个月`; vc = '#b03a2e'; }
    return Object.assign({}, r, { dlIdx, left, status, cur, vt, vc });
  });

  return {
    name: g('pp_name').trim(), major: g('pp_major'), signup: g('pp_signup').trim(), enroll: g('pp_enroll').trim(),
    period, routeLabel: route.label, nowIdx, startIdx, endIdx, examIdx, rows, ymStr,
    jp, en, genDate: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,
  };
}

// 规划正文 HTML（内联十六进制配色，预览与打印窗口共用）
function ppPlanHtml(P) {
  const months = []; for (let i = P.startIdx; i <= P.endIdx; i++) months.push(i);
  const headCells = months.map(i => {
    const y = Math.floor(i/12), m = i%12+1, isNow = i === P.nowIdx;
    const yearMark = (i === P.startIdx || m === 1) ? `<div style="font-size:8px;color:#a8998a">'${String(y).slice(2)}</div>` : '<div style="font-size:8px">&nbsp;</div>';
    return `<th style="padding:4px 3px;text-align:center;font-weight:${isNow?'700':'600'};color:${isNow?'#8a5a2b':'#6b5c4e'};border-bottom:1px solid #e5ddd0;border-left:1px solid #efe8dc;${isNow?'background:#f5ead9':''}">${yearMark}${m}月${isNow?'<div style="font-size:8px">本月</div>':''}</th>`;
  }).join('');
  const bodyRows = P.rows.map(r => {
    const cells = months.map(i => {
      const isNow = i === P.nowIdx;
      let text = '', isRed = false;
      if (r.special) {
        if (i === P.nowIdx) text = '专业课学习开始';
        else if (i === P.examIdx - 1) text = '持续至考前';
      } else {
        const off = String(i - P.examIdx);
        text = (r.ms || {})[off] || '';
        isRed = text && (r.red || []).includes(off);
      }
      const cell = text
        ? (isRed
          ? `<div style="margin:3px 2px;padding:4px 3px;border-radius:2px;background:#b03a2e;color:#fff;font-weight:700;font-size:9px;text-align:center;line-height:1.4">${text}</div>`
          : `<div style="margin:3px 2px;padding:4px 3px;border-radius:2px;background:#faf6ef;border:1px solid #e5ddd0;font-size:9px;text-align:center;line-height:1.4;color:#3a2f26">${text}</div>`)
        : '';
      return `<td style="padding:0;vertical-align:middle;border-bottom:1px solid #efe8dc;border-left:1px solid #efe8dc;${isNow?'background:#f9f1e3':''}">${cell}</td>`;
    }).join('');
    return `<tr>
      <td style="padding:6px 8px;white-space:nowrap;border-bottom:1px solid #efe8dc">
        <div style="font-size:11px;color:#3a2f26;font-weight:600">${r.icon} ${r.label}</div>
        <div style="font-size:9px;color:${r.vc};margin-top:1px">${r.vt}</div>
        <div style="font-size:9px;color:#6b5c4e;margin-top:1px">现状：${tsaEsc(r.cur)}</div>
      </td>${cells}</tr>`;
  }).join('');
  const bmRows = P.rows.filter(r => !r.special).map(r => `<tr>
    <td style="padding:5px 8px;white-space:nowrap;font-size:10px;border-bottom:1px solid #efe8dc">${r.icon} ${r.label}</td>
    <td style="padding:5px 8px;white-space:nowrap;font-size:10px;color:#6b5c4e;border-bottom:1px solid #efe8dc">${r.dlName} · ${P.ymStr(r.dlIdx)}</td>
    <td style="padding:5px 8px;font-size:10px;border-bottom:1px solid #efe8dc">${tsaEsc(r.cur)}</td>
    <td style="padding:5px 8px;font-size:10px;color:${r.vc};border-bottom:1px solid #efe8dc">${r.vt}</td>
  </tr>`).join('');
  const info = [
    P.name ? `学生：${tsaEsc(P.name)}` : '',
    P.major ? `专业：${MAJORS[P.major]||P.major}` : '',
    P.signup ? `报名时间：${tsaEsc(P.signup)}` : '',
    P.enroll ? `期待入学：${tsaEsc(P.enroll)}` : '',
    `出愿时期：${P.period}`,
    `生成日期：${P.genDate}`,
  ].filter(Boolean).join('　·　');
  return `<div style="background:#fff;border:1px solid #e5ddd0;border-radius:4px;padding:16px;color:#3a2f26">
    <div style="font-size:15px;font-weight:700;margin-bottom:4px">📅 考学进度规划　<span style="font-size:11px;font-weight:400;color:#6b5c4e">${P.routeLabel}</span></div>
    <div style="font-size:11px;color:#6b5c4e;margin-bottom:12px">${info}</div>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;min-width:${160 + (P.endIdx-P.startIdx+1) * 60}px;font-size:10px">
        <thead><tr><th style="padding:4px 8px;text-align:left;font-weight:600;color:#6b5c4e;border-bottom:1px solid #e5ddd0;min-width:150px">项目</th>${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div style="font-size:11px;font-weight:700;margin:14px 0 6px">节点对标与倒计时</div>
    <div style="border:1px solid #e5ddd0;border-radius:3px;overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;min-width:520px">
        <thead><tr style="background:#faf6ef">${['项目','最晚节点','现状','判定'].map(h=>`<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:600;color:#a8998a;border-bottom:1px solid #e5ddd0">${h}</th>`).join('')}</tr></thead>
        <tbody>${bmRows}</tbody>
      </table>
    </div>
    <div style="font-size:9px;color:#6b5c4e;margin-top:8px">节点按所选出愿时期自动排布（夏季：5月草稿・7月出愿・8月考试；冬季：10月草稿・12月出愿・1月考试；次年夏季：语言按冬季要求、12月完成草稿、次年7月出愿8月考试）。专业知识学习从本月开始持续至考前。红底为关键节点。—— 唯新教育</div>
  </div>`;
}

function ppGenerate() {
  ppLast = ppBuild();
  const out = document.getElementById('pp_out');
  if (out) out.innerHTML = ppPlanHtml(ppLast);
  const btn = document.getElementById('pp_print_btn');
  if (btn) btn.style.display = 'inline-block';
}

function ppOpenPrint() {
  if (!ppLast) return;
  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
  const title = `考学进度规划${ppLast.name ? '_' + ppLast.name : ''}_${ppLast.genDate}`;
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family:'Noto Serif SC','Hiragino Sans GB','Microsoft YaHei',serif; background:#faf7f2; margin:0; padding:20px; }
  @media print { .noprint { display:none!important } body { background:#fff; padding:0 } }
</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:10px">
  <button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button>
</div>
${ppPlanHtml(ppLast)}
</body></html>`);
  w.document.close();
}
