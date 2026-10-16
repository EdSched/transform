// 合格数据的旧「在籍学科」(subject) ⇄ 本校专业 (majors.key) 对照：管理端、合格实绩公开页、收集页共用
// 用法：先 subjectMajorSetData(majors, groups) 告诉它专业清单，再调 subjectToMajor / majorToSubject
//   majors：[{key,label,domain,group_key}]；groups：[{key,label,domain}]
//
// 对照写法：names 按专业中文名匹配 majors（取第一个对得上的）；key 直接用专业 key；group 按分组名匹配 major_groups
//   对不上就当没有对应；note 写在管理端模板备注列
const RA_SUBJECT_MAJOR_MAP = {
  shakai: { key: 'shakai' }, fukushi: { key: 'fukushi' }, shinpan: { key: 'shinpan' }, keizai: { key: 'keizai' }, keiei: { key: 'keiei' },
  kyoiku: { names: ['教育学', '教育'], re: /教育学?$/ },
  hougaku: { names: ['法学'] }, seiji: { names: ['政治学', '政治学/国际关系', '政治学/国際関係', '国际关系'] },
  bungaku: { names: ['文学'] }, rekishi: { names: ['历史学', '歴史学', '历史'] }, hyosho: { names: ['表象文化'] },
  nihongo: { names: ['日本语教育', '日本語教育'] }, shinri: { names: ['心理学', '心理'] },
  other: {},
  rika_kikai: { names: ['机械工学'] }, rika_denki: { names: ['电子电气'] },
  rika_kagaku: { names: ['化学'], note: '材料方向的学生选「材料科学」' },
  rika_joho: { names: ['情报工学'] }, rika_kenchiku: { names: ['建筑工学'] },
  rika_bio: { group: '生命科学' }, rika_keiei: { names: ['经营工学'] },
  rika_other: { note: '材料科学、环境科学等，按学生实际专业选' },
};
let SMM_DATA = { majors: [], groups: [] };
function subjectMajorSetData(majors, groups) { SMM_DATA = { majors: majors || [], groups: groups || [] }; }
// → { key, label, isGroup, note }；没有对应时 key 为空
function subjectMajorInfo(subject, majors, groups) {
  const e = RA_SUBJECT_MAJOR_MAP[subject] || {};
  const out = { key: '', label: '', isGroup: false, note: e.note || '' };
  const ms = majors || [];
  if (e.key) { const m = ms.find(x => x.key === e.key); if (m) { out.key = m.key; out.label = m.label; } }
  if (!out.key && e.names) {
    let m = null;
    for (const n of e.names) { m = ms.find(x => (x.label || '').trim() === n); if (m) break; }
    if (!m && e.re) m = ms.find(x => e.re.test((x.label || '').trim()));
    if (m) { out.key = m.key; out.label = m.label; }
  }
  if (!out.key && e.group) {
    const g = (groups || []).find(x => (x.label || '').trim() === e.group);
    if (g) { out.key = g.key; out.label = g.label + '（全部）'; out.isGroup = true; }
  }
  if (!out.key && !out.note) out.note = '按学生实际专业选';
  return out;
}
// 旧学科 → 本校专业 key；对不上返回 ''
function subjectToMajor(subject) {
  if (!subject || !SMM_DATA.majors.length) return '';
  return subjectMajorInfo(subject, SMM_DATA.majors, SMM_DATA.groups).key;
}
// 本校专业 → 旧学科代码（收集页写 subject 用）；专业属于某个分组、而该分组对应某个旧学科时也算；对不上返回 ''
function majorToSubject(majorKey) {
  if (!majorKey) return '';
  const m = SMM_DATA.majors.find(x => x.key === majorKey);
  const subjects = Object.keys(RA_SUBJECT_MAJOR_MAP).filter(s => s !== 'other' && s !== 'rika_other');
  for (const s of subjects) {
    const k = subjectToMajor(s);
    if (k && (k === majorKey || (m && m.group_key && k === m.group_key))) return s;
  }
  return '';
}
// 一条合格记录的本校专业 key：有 our_major 用它；没有（旧数据）按旧学科对照；对不上返回 ''
function resultMajorKey(rec) {
  if (!rec) return '';
  return rec.our_major || subjectToMajor(rec.subject) || '';
}
