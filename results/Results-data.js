// ─── results-data.js ─────────────────────────────────────────────────────────
// Shared between results/index.html and results/admin.html
// Supabase table: admission_results
//   id          uuid primary key default gen_random_uuid()
//   univ        text not null
//   dept        text
//   spec        text
//   student     text
//   subject     text   -- shakai / fukushi / shinpan / keizai / keiei / kyoiku / other
//   era         text   -- 'hist' (2022-2024) or 'new' (2025-2026)
//   jlpt        text   -- e.g. 'N1', 'N2', 'N1-145'
//   jlpt_score  integer  -- numeric part if present, else null
//   eng_type    text   -- 'TOEIC','TOEFL','IELTS','EJU','—'
//   eng_score   integer  -- numeric score, else null
//   note        text
//   created_at  timestamptz default now()
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://vwntezfvqbrkeovnseku.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cUnCkti5qv1_G4N6Ho5tpw_9pr7pSas';

// ── Constants ────────────────────────────────────────────────────────────────
const SUBJECTS = [
  { id: 'shakai',  label: '社会学',   labelJa: '社会学'   },
  { id: 'fukushi', label: '社会福祉', labelJa: '社会福祉' },
  { id: 'shinpan', label: '新聞伝播', labelJa: '新聞・メディア' },
  { id: 'keizai',  label: '経済学',   labelJa: '経済学'   },
  { id: 'keiei',   label: '経営学',   labelJa: '経営学'   },
  { id: 'kyoiku',  label: '教育学',   labelJa: '教育学'   },
  { id: 'other',   label: 'その他',   labelJa: 'その他'   },
];

const SUBJ_COLOR = {
  shakai:  { bg: '#ddeaf8', fg: '#1a3a6a' },
  fukushi: { bg: '#ddf0e8', fg: '#1a4a30' },
  shinpan: { bg: '#ece4f8', fg: '#3a2a7a' },
  keizai:  { bg: '#faecd8', fg: '#5a3010' },
  keiei:   { bg: '#f8e8e0', fg: '#6a2820' },
  kyoiku:  { bg: '#e8f4e4', fg: '#1a4818' },
  other:   { bg: '#eeecea', fg: '#3a3830' },
};

const TIERS = {
  1: { label: 'T1', name: '旧帝・一橋・東科大 ＋ 早慶上智' },
  2: { label: 'T2', name: 'G-MARCH・関関同立 ＋ 地方国公立' },
  3: { label: 'T3', name: '日駒東専 ＋ 重点女子大・地方私立' },
};

const T1_UNIVS = ['东京大学','京都大学','大阪大学','名古屋大学','九州大学','东北大学','北海道大学',
  '一桥大学','一橋大学','东京科学大学','东京工业大学','東京科学大学','東京工業大学',
  '早稻田大学','早稲田大学','庆应义塾大学','慶應義塾大学','上智大学',
  '御茶水女子大学','筑波大学'];
const T2_UNIVS = ['法政大学','明治大学','青山学院大学','立教大学','中央大学','学习院大学','学習院大学',
  '关西大学','関西大学','关西学院大学','関西学院大学','同志社大学','立命馆大学','立命館大学',
  '横滨国立大学','横浜国立大学','横滨市立大学','横浜市立大学','神户大学','神戸大学',
  '埼玉大学','千叶大学','千葉大学','东京都立大学','東京都立大学','金沢大学','金泽大学',
  '广岛大学','広島大学','弘前大学','爱知县立大学','愛知県立大学','大阪公立大学',
  '静冈县立大学','静岡県立大学','东京外国语大学','東京外国語大学','神奈川大学'];

function tierOf(univ) {
  const u = univ.replace(/\s/g, '');
  if (T1_UNIVS.some(x => u.includes(x.replace(/\s/g, '')))) return 1;
  if (T2_UNIVS.some(x => u.includes(x.replace(/\s/g, '')))) return 2;
  return 3;
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...opts.headers,
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAllResults() {
  return sbFetch('admission_results?select=*&order=created_at.desc');
}

async function insertResult(row) {
  return sbFetch('admission_results', { method: 'POST', body: row });
}

async function insertBatch(rows) {
  return sbFetch('admission_results', { method: 'POST', body: rows, prefer: 'return=representation' });
}

async function deleteResult(id) {
  return sbFetch(`admission_results?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal', headers: {} });
}

async function updateResult(id, row) {
  return sbFetch(`admission_results?id=eq.${id}`, { method: 'PATCH', body: row });
}

// ── Parse helpers ────────────────────────────────────────────────────────────
// Parse jlpt string like 'N1-145' → { jlpt: 'N1', jlpt_score: 145 }
function parseJlpt(raw) {
  if (!raw || raw === '—' || raw === '无' || raw === '——') return { jlpt: null, jlpt_score: null };
  const m = raw.match(/^(N[12])\D*(\d+)?/i);
  if (!m) return { jlpt: raw.trim(), jlpt_score: null };
  return { jlpt: m[1].toUpperCase(), jlpt_score: m[2] ? parseInt(m[2]) : null };
}

// Parse eng string like 'TOEIC-820', 'TOEFL-90', 'IELTS-7.0'
function parseEng(raw) {
  if (!raw || raw === '—' || raw === '无' || raw === '——') return { eng_type: null, eng_score: null };
  const upper = raw.toUpperCase();
  let type = null, score = null;
  if (upper.includes('TOEIC')) type = 'TOEIC';
  else if (upper.includes('TOEFL')) type = 'TOEFL';
  else if (upper.includes('IELTS')) type = 'IELTS';
  else if (upper.includes('EJU')) type = 'EJU';
  else return { eng_type: raw.trim(), eng_score: null };
  const m = raw.match(/[\d.]+/);
  score = m ? parseFloat(m[0]) : null;
  return { eng_type: type, eng_score: score ? Math.round(score) : null };
}
