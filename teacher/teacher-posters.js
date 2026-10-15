// 老师端「合格海报」：只读已发布的海报。筛选 / 大图 / 批量查看 / 批量下载都在 shared/pass-posters.js（和合格实绩管理端共用）。
// 数据：pass_posters（web_url 不为空）。不取 src_url（未遮盖的原图，老师端不该看到，数据库里也只有管理员能读）。
function renderTeacherPosters(mc) {
  const t = (typeof teacherData !== 'undefined' && teacherData) || {};
  return ppsMount(mc, {
    mode: 'teacher', keep: true,
    cls: { header: 'page-header', title: 'section-title', search: 'search-bar', btn: 'btn btn-outline btn-sm', empty: 'empty', loading: 'loading' },
    chipFold,
    majorName: k => (typeof MAJORS !== 'undefined' && MAJORS[k]) || k || '未设专业',
    defaultDomains: typeof salesScopeDomains === 'function' ? salesScopeDomains(t) : [],
    loadRows: () => sbAll('/rest/v1/pass_posters?web_url=not.is.null&select=id,result_kind,result_id,univ,dept,spec,major,domain,pass_year,pass_month,fields,web_url,thumb_url&order=pass_year.desc,pass_month.desc'),
  });
}
