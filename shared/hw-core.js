// ══════════════════════════════════════════════════════════════
// hw-core.js — 通用「布置作业」编辑器（结构化 homework_questions v2）
// 复用大课作业的题型/级别/参考资料逻辑，但保存目标可插拔：
//   HWC.openEditor({ title, subtitle, questions, note, storageDir, onSave })
//   onSave(payload, note) —— payload = {version:2, levels, refs} 或 null（清空）
// 全部命名空间化到 window.HWC，避免与 courses.js / study.js 的 hw* 全局冲突。
// 依赖：sbUpload(bucket,path,file)（shared/supabase.js，全站已加载）
// ══════════════════════════════════════════════════════════════
(function () {
  const HW_TYPES = [
    ['choice', '选择题', '设定题数，学生逐题填答案（题目见附件PDF）'],
    ['calc', '计算题', '设定大题数，学生按大题拍照上传（可多张）'],
    ['term', '名词解释', '设定问数，学生逐问作答或拍照'],
    ['essay', '论述题', '设定题数，学生逐题作答，可多张照片'],
    ['free', '自由题', '直接写题干，学生作答'],
  ];
  const HW_LEVELS = [['', '不分级别'], ['上', '上级'], ['中', '中级'], ['下', '下级']];

  const S = {           // 编辑器状态（同一时刻只开一个）
    data: null,         // { levels:[{key,blocks:[]}], refs:[], note:'' }
    level: 0,
    storageDir: 'hw',
    onSave: null,
    title: '',
    subtitle: '',
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function normalize(questions, note) {
    const q = questions;
    if (q && !Array.isArray(q) && q.version === 2) {
      return { levels: q.levels || [{ key: '', blocks: [] }], refs: q.refs || [], note: note || '' };
    }
    if (Array.isArray(q) && q.length) {
      return { levels: [{ key: '', blocks: [{ type: 'free', title: '作业', items: q.map(x => ({ num: x.num, text: x.text })) }] }], refs: [], note: note || '' };
    }
    return { levels: [{ key: '', blocks: [] }], refs: [], note: note || '' };
  }

  function openEditor(opts) {
    opts = opts || {};
    S.data = normalize(opts.questions, opts.note);
    S.level = 0;
    S.storageDir = opts.storageDir || 'hw';
    S.onSave = opts.onSave || null;
    S.title = opts.title || '布置作业';
    S.subtitle = opts.subtitle || '';
    let modal = document.getElementById('hwcEditorModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'hwcEditorModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = '<div id="hwcEditorBody" style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto"></div>';
    document.body.appendChild(modal);
    render();
  }
  function close() { const m = document.getElementById('hwcEditorModal'); if (m) m.remove(); }

  function curLevel() { return S.data.levels[S.level] || (S.data.levels[S.level] = { key: '', blocks: [] }); }

  function render() {
    const box = document.getElementById('hwcEditorBody');
    if (!box) return;
    const D = S.data;
    const inp = 'width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border,#ddd);border-radius:2px;background:var(--bg,#faf9f7);font-family:inherit';
    const lv = D.levels[S.level] || { key: '', blocks: [] };
    box.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:3px">📝 ${esc(S.title)}</div>
      <div style="font-size:10px;color:var(--text-3,#999);margin-bottom:10px">${esc(S.subtitle)}　·　保存后学生端才会出现该次作业</div>

      <label style="font-size:9px;color:var(--text-3,#999);display:block;margin-bottom:2px">作业说明（可选）</label>
      <textarea id="hwc_note" rows="2" placeholder="例：请于下次课前提交，手写题按题号顺序拍照上传" style="${inp};line-height:1.8;resize:vertical;margin-bottom:10px">${esc(D.note || '')}</textarea>

      <div style="border:1px solid var(--border-light,#eee);border-radius:3px;padding:8px 10px;margin-bottom:10px">
        <div style="font-size:10px;color:var(--text-3,#999);margin-bottom:4px">📚 参考资料 / 阅读材料（与题目分开，学生可下载）</div>
        <div id="hwc_refs_list" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:5px">${refsHtml()}</div>
        <label style="font-size:10px;color:var(--accent,#5a3e28);cursor:pointer;border:1px solid var(--border,#ddd);border-radius:2px;padding:3px 10px">＋ 上传参考资料
          <input type="file" accept=".pdf,.doc,.docx,image/*" multiple style="display:none" onchange="HWC._uploadRef(this)"></label>
      </div>

      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-3,#999)">作业级别：</span>
        ${D.levels.map((L, i) => `<div onclick="HWC._setLevel(${i})" class="filter-chip ${i === S.level ? 'active' : ''}" style="padding:3px 10px;font-size:10px;cursor:pointer;border:1px solid ${i === S.level ? 'var(--accent,#5a3e28)' : 'var(--border,#ddd)'};border-radius:2px;background:${i === S.level ? 'var(--accent,#5a3e28)' : 'transparent'};color:${i === S.level ? '#fff' : 'inherit'}">${HW_LEVELS.find(x => x[0] === L.key)?.[1] || L.key || '不分级别'}${(L.blocks || []).length ? ` (${L.blocks.length})` : ''}</div>`).join('')}
        ${D.levels.length < 3 ? `<select onchange="HWC._addLevel(this.value);this.value=''" style="font-size:10px;padding:2px 6px;border:1px solid var(--border,#ddd);border-radius:2px;background:var(--bg,#faf9f7);font-family:inherit">
          <option value="">＋ 添加级别</option>
          ${HW_LEVELS.filter(([k]) => k && !D.levels.some(L => L.key === k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>` : ''}
        ${D.levels.length > 1 ? `<span onclick="HWC._delLevel(${S.level})" style="font-size:10px;color:var(--danger,#c0392b);cursor:pointer">删除当前级别</span>` : ''}
      </div>

      <div style="border:1px solid var(--border,#ddd);border-radius:3px;padding:10px;background:var(--bg,#faf9f7);margin-bottom:10px">
        <div id="hwc_blocks">${(lv.blocks || []).map((b, bi) => blockHtml(b, bi)).join('') || '<div style="font-size:10px;color:var(--text-3,#999);padding:8px 0">尚未添加题型，请在下方选择</div>'}</div>
        <select onchange="HWC._addBlock(this.value);this.value=''" style="font-size:11px;padding:5px 8px;border:1px solid var(--border,#ddd);border-radius:2px;background:var(--surface,#fff);font-family:inherit;margin-top:6px">
          <option value="">＋ 添加题型区块</option>
          ${HW_TYPES.map(([k, l, d]) => `<option value="${k}">${l} — ${d}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="HWC._close()" style="font-size:12px;background:none;border:1px solid var(--border,#ddd);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
        <button onclick="HWC._save()" style="font-size:12px;background:var(--accent,#5a3e28);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存作业</button>
      </div>`;
  }

  function refsHtml() {
    const refs = S.data.refs || [];
    return refs.length ? refs.map((r, i) => `<span style="font-size:10px;background:var(--surface,#fff);border:1px solid var(--border-light,#eee);border-radius:2px;padding:2px 8px">📎 ${esc(r.name || '资料')}<span onclick="HWC._delRef(${i})" style="color:var(--danger,#c0392b);cursor:pointer;margin-left:6px">✕</span></span>`).join('') : '<span style="font-size:10px;color:var(--text-3,#999)">尚未上传</span>';
  }

  function blockHtml(b, bi) {
    const inp = 'font-size:11px;padding:4px 7px;border:1px solid var(--border,#ddd);border-radius:2px;background:var(--surface,#fff);font-family:inherit';
    const T = HW_TYPES.find(t => t[0] === b.type) || ['', '题目', ''];
    let cfg = '';
    if (b.type === 'choice') {
      cfg = `<label style="font-size:10px;color:var(--text-3,#999)">题数 <input type="number" min="1" value="${b.count || 10}" onchange="HWC._setBlock(${bi},'count',parseInt(this.value)||1)" style="${inp};width:60px"></label>`;
    } else if (b.type === 'calc') {
      cfg = `<div style="font-size:10px;color:var(--text-3,#999)">
        <label>大题数 <input type="number" min="1" value="${b.count || (b.questions || []).length || 3}" onchange="HWC._setBlock(${bi},'count',parseInt(this.value)||1);HWC._setBlock(${bi},'questions',null)" style="${inp};width:60px"></label>
        <span style="margin-left:8px">学生端每道大题可上传多张图（按顺序）</span>
      </div>`;
    } else if (b.type === 'term' || b.type === 'essay') {
      const unit = b.type === 'term' ? '问' : '题';
      cfg = `<div style="font-size:10px;color:var(--text-3,#999)">
        题目内容（每${unit}一行，以「1. 」开头；直接粘贴即可）
        <textarea onchange="HWC._setItems(${bi},this.value)" rows="5" placeholder="1. 请解释「社会资本」这一概念&#10;2. 请解释「文化再生产」" style="${inp};width:100%;line-height:1.8;margin-top:3px;resize:vertical">${(b.items || []).map(x => `${x.num}. ${x.text}`).join('\n').replace(/</g, '&lt;')}</textarea>
        <div style="display:flex;gap:12px;align-items:center;margin-top:5px;flex-wrap:wrap">
          <label>选做数 <input type="number" min="0" value="${b.pick || 0}" onchange="HWC._setBlock(${bi},'pick',parseInt(this.value)||0)" style="${inp};width:56px"></label>
          <span>0＝全部作答；填 2 即「任选 2 ${unit}作答」</span>
        </div>
        ${(b.items || []).length ? '' : `<div style="margin-top:3px">也可只设数量不写题干：<label>${unit}数 <input type="number" min="1" value="${b.count || 3}" onchange="HWC._setBlock(${bi},'count',parseInt(this.value)||1)" style="${inp};width:56px"></label></div>`}
      </div>`;
    } else if (b.type === 'free') {
      cfg = `<div style="font-size:10px;color:var(--text-3,#999)">题目（每题一行，以「1. 」开头）
        <textarea onchange="HWC._setFree(${bi},this.value)" rows="4" placeholder="1. 请说明…&#10;2. 请分析…" style="${inp};width:100%;line-height:1.8;margin-top:3px;resize:vertical">${(b.items || []).map(x => `${x.num}. ${x.text}`).join('\n').replace(/</g, '&lt;')}</textarea>
        <label style="display:block;margin-top:5px">作答方式
          <select onchange="HWC._setBlock(${bi},'answerMode',this.value)" style="${inp};margin-left:4px">
            <option value="whole" ${(b.answerMode || 'whole') === 'whole' ? 'selected' : ''}>整块统一作答（小问同属一个大题，只需一处上传/作答）</option>
            <option value="each" ${b.answerMode === 'each' ? 'selected' : ''}>每题分别作答（每题独立作答与上传）</option>
          </select>
        </label></div>`;
    }
    return `<div style="border:1px solid var(--border-light,#eee);border-radius:3px;padding:9px 10px;margin-bottom:6px;background:var(--surface,#fff)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:600">### ${bi + 1}　${T[1]}</span>
        <input value="${(b.title || '').replace(/"/g, '&quot;')}" placeholder="区块标题（可选，如 ERE过去问 第3章）" onchange="HWC._setBlock(${bi},'title',this.value)" style="${inp};flex:1;min-width:140px">
        <span onclick="HWC._delBlock(${bi})" style="font-size:10px;color:var(--danger,#c0392b);cursor:pointer">删除</span>
      </div>
      ${cfg}
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <label style="font-size:10px;color:var(--accent,#5a3e28);cursor:pointer;border:1px solid var(--border,#ddd);border-radius:2px;padding:2px 9px">📎 ${b.file ? '更换题目文件' : '上传题目 PDF / 图片'}
          <input type="file" accept=".pdf,image/*,.doc,.docx" style="display:none" onchange="HWC._uploadBlockFile(${bi},this)"></label>
        <span style="font-size:10px;color:var(--text-3,#999)">${b.file ? `已上传：${esc(b.file.name || '文件')}` : '（选择题/计算题建议上传题目PDF）'}</span>
      </div>
    </div>`;
  }

  // —— 状态操作 ——
  function setLevel(i) { S.level = i; render(); }
  function addLevel(k) { if (!k) return; S.data.levels.push({ key: k, blocks: [] }); S.level = S.data.levels.length - 1; render(); }
  function delLevel(i) { if (S.data.levels.length <= 1) return; if (!confirm('删除该级别及其题目？')) return; S.data.levels.splice(i, 1); S.level = 0; render(); }
  function addBlock(t) { if (!t) return; const b = { type: t, title: '' }; if (t === 'choice') b.count = 10; if (t === 'term' || t === 'essay') b.count = 3; if (t === 'calc') b.count = 3; if (t === 'free') { b.items = []; b.answerMode = 'whole'; } curLevel().blocks.push(b); render(); }
  function delBlock(i) { curLevel().blocks.splice(i, 1); render(); }
  function setBlock(i, k, v) { curLevel().blocks[i][k] = v; }
  function setItems(i, raw) {
    const out = [];
    String(raw || '').replace(/\r/g, '').split('\n').forEach(line => {
      const t = line.trim(); if (!t) return;
      const m = t.match(/^(\d+)[.、)]\s*(.*)$/);
      if (m) out.push({ num: parseInt(m[1]), text: m[2].trim() });
      else if (out.length) out[out.length - 1].text += '\n' + t;
      else out.push({ num: 1, text: t });
    });
    const items = out.filter(x => x.text).map((x, ix) => ({ num: ix + 1, text: x.text }));
    const b = curLevel().blocks[i];
    b.items = items;
    if (items.length) b.count = items.length;
  }
  function setFree(i, raw) {
    const out = [];
    String(raw || '').replace(/\r/g, '').split('\n').forEach(line => {
      const t = line.trim(); if (!t) return;
      const m = t.match(/^(\d+)[.、)]\s*(.*)$/);
      if (m) out.push({ num: parseInt(m[1]), text: m[2].trim() });
      else if (out.length) out[out.length - 1].text += '\n' + t;
      else out.push({ num: 1, text: t });
    });
    curLevel().blocks[i].items = out.filter(x => x.text).map((x, ix) => ({ num: ix + 1, text: x.text }));
  }
  async function uploadRef(input) {
    const files = [...(input.files || [])];
    if (!files.length) return;
    try {
      for (const f of files) {
        const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
        const url = await sbUpload('homework', `refs/${S.storageDir}-${Date.now()}.${ext}`, f);
        (S.data.refs = S.data.refs || []).push({ url, name: f.name });
      }
      render();
    } catch (e) { alert('上传失败：' + e.message); }
    input.value = '';
  }
  function delRef(i) { S.data.refs.splice(i, 1); render(); }
  async function uploadBlockFile(bi, input) {
    const f = input.files[0];
    if (!f) return;
    try {
      const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
      const url = await sbUpload('homework', `q/${S.storageDir}-${Date.now()}.${ext}`, f);
      curLevel().blocks[bi].file = { url, name: f.name };
      render();
    } catch (e) { alert('上传失败：' + e.message); }
    input.value = '';
  }
  async function save() {
    const note = ((document.getElementById('hwc_note') || {}).value || '').trim();
    const levels = S.data.levels.filter(L => (L.blocks || []).length);
    const payload = levels.length ? { version: 2, levels, refs: S.data.refs || [] } : null;
    try {
      if (S.onSave) await S.onSave(payload, note || null);
      close();
    } catch (e) { alert('保存失败：' + e.message); }
  }

  window.HWC = {
    openEditor, normalize,
    _close: close, _save: save, _setLevel: setLevel, _addLevel: addLevel, _delLevel: delLevel,
    _addBlock: addBlock, _delBlock: delBlock, _setBlock: setBlock, _setItems: setItems, _setFree: setFree,
    _uploadRef: uploadRef, _delRef: delRef, _uploadBlockFile: uploadBlockFile,
  };
})();
