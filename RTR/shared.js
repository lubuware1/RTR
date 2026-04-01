// ════════════════════════════════════════════════════════
//  RefRater — shared.js
//  Shared data, state, and helper functions
//  Used by: matches.html, referees.html, login.html
// ════════════════════════════════════════════════════════

// ── FOOTBALL-DATA.ORG API ────────────────────────────────
// Disabled for World Cup format — no live API used.
const FOOTBALL_DATA_KEY = '';
const FD_API_BASE = 'https://api.football-data.org/v4';

// No live API for World Cup format — always uses static match data.
async function loadFromFootballData() { return false; }

// ── GOOGLE SHEETS CONFIG ─────────────────────────────────
// To connect live data:
// 1. Upload refrater_database.xlsx to Google Sheets
// 2. File > Share > Publish to Web > choose sheet > CSV > copy URL
// 3. Paste URLs below
const SHEETS_REFS_URL    = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCN0t8slUy1uRhOiQMy80if6U9QjN8z5NnWT5A0QpzFh9ERkIchDxOu3TjOGt9EeDqk1rvFGchFyTY/pub?gid=1387412017&single=true&output=csv';  // ← FA Cup Test referees
const SHEETS_MATCHES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCN0t8slUy1uRhOiQMy80if6U9QjN8z5NnWT5A0QpzFh9ERkIchDxOu3TjOGt9EeDqk1rvFGchFyTY/pub?gid=1689456721&single=true&output=csv';  // ← FA Cup Test fixtures

// ── PREVIEW MODE ─────────────────────────────────────────
// Set to true to skip login and use a guest account for easy previewing.
// Set to false when you're ready to go live with real logins.
const PREVIEW_MODE = false;

// ── SUPABASE ──────────────────────────────────────────────
const SUPABASE_URL = 'https://sxufittkehlktlfvicom.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dWZpdHRrZWhsa3RsZnZpY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTEwNDIsImV4cCI6MjA5MDM2NzA0Mn0.aItkjIGsik_v_T6n167bdwE23ncvvWgwJ4IveT5MFyU';
const _USER_KEY = 'rr_user';

let _sb = null;
function getSB() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sb;
}

async function checkAuth() {
  if (PREVIEW_MODE) return true;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) { localStorage.removeItem(_USER_KEY); return false; }
  const { data: profile, error: profileError } = await getSB().from('RTR Profiles').select('username,team').eq('id', session.user.id).single();
  console.log('[RTR] profile fetch:', profile, 'error:', profileError);
  localStorage.setItem(_USER_KEY, JSON.stringify({
    id: session.user.id, email: session.user.email,
    username: profile?.username || 'User', team: profile?.team || null
  }));
  return true;
}

async function loadRatings() {
  if (PREVIEW_MODE) return;
  const { data: votes } = await getSB().from('RTR Votes').select('ref_id,overall,is_fan_vote');
  if (!votes || !votes.length) return;
  REFS.forEach(r => { r.neutralRating=0; r.neutralVotes=0; r.fanRating=0; r.fanVotes=0; });
  const sums = {};
  votes.forEach(v => {
    if (!sums[v.ref_id]) sums[v.ref_id] = { nSum:0, nCount:0, fSum:0, fCount:0 };
    if (v.is_fan_vote) { sums[v.ref_id].fSum += v.overall; sums[v.ref_id].fCount++; }
    else               { sums[v.ref_id].nSum += v.overall; sums[v.ref_id].nCount++; }
  });
  REFS.forEach(r => {
    const s = sums[r.id]; if (!s) return;
    if (s.nCount) { r.neutralRating = Math.round(s.nSum/s.nCount*10)/10; r.neutralVotes = s.nCount; }
    if (s.fCount) { r.fanRating     = Math.round(s.fSum/s.fCount*10)/10; r.fanVotes     = s.fCount; }
  });
}

async function loadUserVotes(userId) {
  if (PREVIEW_MODE) return new Set();
  const { data } = await getSB().from('RTR Votes').select('match_id').eq('user_id', userId);
  return new Set((data || []).map(v => v.match_id));
}

async function saveVoteToDB(voteData) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Votes').upsert(voteData, { onConflict: 'user_id,match_id' });
  return !error;
}

// ── FANTASY PICK PERSISTENCE ──────────────────────────────
async function saveFantasyPick(matchweek, refId, wc) {
  if (PREVIEW_MODE) return true;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) return false;
  const { error } = await getSB().from('RTR Fantasy Picks').upsert({
    user_id: session.user.id, matchweek, ref_id: refId,
    wildcards: wc, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,matchweek' });
  return !error;
}

async function loadMyFantasyPick(matchweek) {
  if (PREVIEW_MODE) return null;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) return null;
  const { data } = await getSB().from('RTR Fantasy Picks')
    .select('ref_id, wildcards')
    .eq('user_id', session.user.id).eq('matchweek', matchweek)
    .maybeSingle();
  return data;
}

async function loadManualBonuses(matchweek) {
  if (PREVIEW_MODE) return {};
  const { data } = await getSB().from('RTR Manual Bonuses')
    .select('ref_id, pts, label')
    .eq('matchweek', matchweek);
  if (!data?.length) return {};
  // Group by ref_id: { refId: [{pts, label}, ...] }
  return data.reduce((acc, row) => {
    if (!acc[row.ref_id]) acc[row.ref_id] = [];
    acc[row.ref_id].push({ pts: row.pts, label: row.label });
    return acc;
  }, {});
}

async function saveManualBonus(matchweek, refId, pts, label) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Manual Bonuses').insert({
    matchweek, ref_id: refId, pts, label,
  });
  return !error;
}

async function deleteManualBonus(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Manual Bonuses').delete().eq('id', id);
  return !error;
}

async function loadFantasyLeaderboard(matchweek) {
  if (PREVIEW_MODE) return [];
  const { data: picks } = await getSB().from('RTR Fantasy Picks')
    .select('user_id, ref_id, wildcards').eq('matchweek', matchweek);
  if (!picks?.length) return [];
  const { data: profiles } = await getSB().from('RTR Profiles')
    .select('id, username, team').in('id', picks.map(p => p.user_id));
  const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  return picks.map(p => ({ ...p, profile: pm[p.user_id] || null }));
}

const PREVIEW_USER = {
  username: 'Preview User',
  email: 'preview@refrater.com',
  team: 'England',
  isPreview: true
};

// ── STATIC DATA ───────────────────────────────────────────
const WC_TEAMS = [
  {name:"Argentina",    emoji:"🇦🇷"},{name:"Algeria",       emoji:"🇩🇿"},{name:"Australia",    emoji:"🇦🇺"},
  {name:"Austria",      emoji:"🇦🇹"},{name:"Belgium",       emoji:"🇧🇪"},{name:"Brazil",       emoji:"🇧🇷"},
  {name:"Cabo Verde",   emoji:"🇨🇻"},{name:"Canada",        emoji:"🇨🇦"},{name:"Colombia",     emoji:"🇨🇴"},
  {name:"Croatia",      emoji:"🇭🇷"},{name:"Curaçao",       emoji:"🇨🇼"},{name:"Côte d'Ivoire",emoji:"🇨🇮"},
  {name:"Ecuador",      emoji:"🇪🇨"},{name:"Egypt",         emoji:"🇪🇬"},{name:"England",      emoji:"🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
  {name:"France",       emoji:"🇫🇷"},{name:"Germany",       emoji:"🇩🇪"},{name:"Ghana",        emoji:"🇬🇭"},
  {name:"Haiti",        emoji:"🇭🇹"},{name:"Iran",          emoji:"🇮🇷"},{name:"Japan",        emoji:"🇯🇵"},
  {name:"Jordan",       emoji:"🇯🇴"},{name:"Mexico",        emoji:"🇲🇽"},{name:"Morocco",      emoji:"🇲🇦"},
  {name:"Netherlands",  emoji:"🇳🇱"},{name:"New Zealand",   emoji:"🇳🇿"},{name:"Norway",       emoji:"🇳🇴"},
  {name:"Panama",       emoji:"🇵🇦"},{name:"Paraguay",      emoji:"🇵🇾"},{name:"Portugal",     emoji:"🇵🇹"},
  {name:"Qatar",        emoji:"🇶🇦"},{name:"Saudi Arabia",  emoji:"🇸🇦"},{name:"Scotland",     emoji:"🏴󠁧󠁢󠁳󠁣󠁴󠁿"},
  {name:"Senegal",      emoji:"🇸🇳"},{name:"South Africa",  emoji:"🇿🇦"},{name:"South Korea",  emoji:"🇰🇷"},
  {name:"Spain",        emoji:"🇪🇸"},{name:"Switzerland",   emoji:"🇨🇭"},{name:"Tunisia",      emoji:"🇹🇳"},
  {name:"United States",emoji:"🇺🇸"},{name:"Uruguay",       emoji:"🇺🇾"},{name:"Uzbekistan",   emoji:"🇺🇿"},
];
// Keep alias so any page still referencing PL_TEAMS doesn't break
const PL_TEAMS = WC_TEAMS;

let REFS = [
  {id:1,  name:"Szymon Marciniak",      initials:"SM", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Polish",    age:43, fifaListed:"Yes", notes:"Refereed 2022 World Cup Final"},
  {id:2,  name:"Daniele Orsato",        initials:"DO", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Italian",   age:49, fifaListed:"Yes", notes:"Experienced UEFA Champions League ref"},
  {id:3,  name:"Anthony Taylor",        initials:"AT", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"English",   age:45, fifaListed:"Yes", notes:"Premier League and UEFA ref"},
  {id:4,  name:"Facundo Tello",         initials:"FT", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Argentine", age:38, fifaListed:"Yes", notes:"CONMEBOL top referee"},
  {id:5,  name:"Fernando Rapallini",    initials:"FR", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Argentine", age:44, fifaListed:"Yes", notes:"2022 World Cup referee"},
  {id:6,  name:"Felix Zwayer",          initials:"FZ", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"German",    age:43, fifaListed:"Yes", notes:"Bundesliga top referee"},
  {id:7,  name:"Ismail Elfath",         initials:"IE", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"American",  age:41, fifaListed:"Yes", notes:"MLS and CONCACAF top referee"},
  {id:8,  name:"Abdulrahman Al-Jassim", initials:"AJ", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Qatari",    age:38, fifaListed:"Yes", notes:"2022 World Cup host nation ref"},
  {id:9,  name:"Slavko Vinčić",         initials:"SV", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Slovenian", age:43, fifaListed:"Yes", notes:"UEFA Europa League referee"},
  {id:10, name:"Bakary Gassama",        initials:"BG", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Gambian",   age:44, fifaListed:"Yes", notes:"CAF top referee"},
  {id:11, name:"Mustapha Ghorbal",      initials:"MG", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Algerian",  age:42, fifaListed:"Yes", notes:"CAF and FIFA referee"},
  {id:12, name:"Ivan Barton",           initials:"IB", games:0, neutralRating:0, neutralVotes:0, fanRating:0, fanVotes:0, nationality:"Salvadoran",age:38, fifaListed:"Yes", notes:"CONCACAF FIFA referee"},
];

// 2026 FIFA World Cup — Group Stage Matchday 1
// Note: UEFA/Intercontinental playoff winners TBD (determined March 2026)
// Match data is loaded exclusively from Google Sheets (SHEETS_MATCHES_URL above).
// Do not add hardcoded matches here — edit the Google Sheet instead.
let MATCHES = [];

const INCIDENTS = [
  "Correct penalty","Wrong penalty","Missed red card","Harsh red card",
  "Good advantage","Poor card mgmt","Excellent control","VAR right",
  "VAR wrong","Offside error","Foul not given","Time wasting ok"
];

const RATING_DESCS = ["","Terrible","Poor","Below average","Average","Decent","Good","Very good","Excellent","Outstanding","Flawless ⭐"];

// ── MATCH STATUS SYNC ─────────────────────────────────────
// Auto-sets each match's status from its kickoff time.
// upcoming  = kickoff is in the future
// live      = kickoff was < 105 min ago (90 min match + 15 min buffer)
// complete  = kickoff was >= 105 min ago
// Matches without a kickoff field keep their hardcoded status.
function syncMatchStatuses() {
  const now = Date.now();
  const MATCH_DURATION_MS = 105 * 60 * 1000;
  MATCHES.forEach(m => {
    if (!m.kickoff) return;
    const ko = new Date(m.kickoff).getTime();
    if (now < ko) {
      m.status = 'upcoming';
    } else if (now < ko + MATCH_DURATION_MS) {
      m.status = 'live';
    } else {
      m.status = 'complete';
    }
  });
}

// ── SESSION HELPERS ───────────────────────────────────────
function getCurrentUser() {
  if (PREVIEW_MODE) return PREVIEW_USER;
  const s = localStorage.getItem(_USER_KEY);
  return s ? JSON.parse(s) : null;
}
async function clearCurrentUser() {
  localStorage.removeItem(_USER_KEY);
  if (!PREVIEW_MODE) await getSB().auth.signOut();
}
function isLoggedIn() { return PREVIEW_MODE || !!getCurrentUser(); }

// ── FLAG IMAGE HELPER ─────────────────────────────────────
function flagImg(emoji, size) {
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0))
    .filter(cp => cp !== 0xFE0F)
    .map(cp => cp.toString(16))
    .join('-');
  const s = size || 22;
  return `<img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codepoints}.svg" width="${s}" height="${s}" style="vertical-align:middle" alt="${emoji}">`;
}

// ── DATA HELPERS ──────────────────────────────────────────
const gRef   = id => REFS.find(r => r.id === +id);
const gMatch = id => MATCHES.find(m => m.id === +id);

function isFanMatch(m, user) {
  return user?.team && (m.home === user.team || m.away === user.team);
}
function isBiasedVote(mid, user) {
  const m = gMatch(mid);
  return user?.team && (m.home === user.team || m.away === user.team);
}

// ── GOOGLE SHEETS LOADER ──────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => {
      const v = vals[i] || '';
      obj[h] = (!isNaN(v) && v !== '') ? +v : v;
    });
    return obj;
  });
}

async function loadFromSheets() {
  if (!SHEETS_REFS_URL && !SHEETS_MATCHES_URL) {
    console.warn('[RTR] No Sheets URLs configured');
    return false;
  }
  try {
    console.log('[RTR] Fetching from Google Sheets...');
    const [refsRes, matchRes] = await Promise.all([
      SHEETS_REFS_URL    ? fetch(SHEETS_REFS_URL)    : Promise.resolve(null),
      SHEETS_MATCHES_URL ? fetch(SHEETS_MATCHES_URL) : Promise.resolve(null),
    ]);

    if (refsRes) {
      console.log('[RTR] Refs response status:', refsRes.status, refsRes.ok ? 'OK' : 'FAILED');
      if (refsRes.ok) {
        const parsed = parseCSV(await refsRes.text());
        console.log('[RTR] Refs parsed:', parsed.length, 'rows');
        if (parsed.length) REFS = parsed.map(r => ({
          ...r,
          neutralRating: +r.neutralRating || 0, neutralVotes: +r.neutralVotes || 0,
          fanRating:     +r.fanRating     || 0, fanVotes:     +r.fanVotes     || 0,
        }));
      }
    }

    if (matchRes) {
      console.log('[RTR] Matches response status:', matchRes.status, matchRes.ok ? 'OK' : 'FAILED');
      if (matchRes.ok) {
        const text = await matchRes.text();
        console.log('[RTR] Matches raw CSV (first 200 chars):', text.slice(0, 200));
        const parsed = parseCSV(text);
        console.log('[RTR] Matches parsed:', parsed.length, 'rows', parsed[0] || '(empty)');
        if (parsed.length) MATCHES = parsed.map(m => ({
          ...m,
          hE: m.homeEmoji || '⚽', aE: m.awayEmoji || '⚽',
          yc: +m.yellowCards || 0, rc: +m.redCards || 0,
          pen: +m.penaltiesGiven || 0, var: +m.varDecisions || 0,
          perfectGame:     m.perfectGame === 'yes',
          incorrectVarPen: +m.incorrectVarPen || 0,
          incorrectVarRed: +m.incorrectVarRed || 0,
        }));
      }
    }

    console.log('[RTR] Sheets load complete. MATCHES:', MATCHES.length, 'REFS:', REFS.length);
    return true;
  } catch (e) {
    console.error('[RTR] Sheets load failed:', e);
    return false;
  }
}

// ── SHARED CSS VARIABLES (injected into each page) ────────
const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap');
  :root{--bg:#0a0c10;--surface:#12151c;--surface2:#1a1e28;--border:#242836;--accent2:#f5a623;--red:#ff4757;--yellow:#ffd32a;--green:#37ecba;--text:#e8eaf0;--muted:#6b7280;--pl-purple:#37003c;--pl-green:#00ff85;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--bg);color:var(--text);font-family:'Barlow',sans-serif;min-height:100vh;}
  /* Header */
  header{background:linear-gradient(135deg,#37003c 0%,#1a0020 60%,#0a0c10 100%);border-bottom:2px solid var(--pl-green);padding:0 24px;position:sticky;top:0;z-index:100;box-shadow:0 4px 32px rgba(0,255,133,.12);}
  .header-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:60px;}
  .logo{display:flex;align-items:center;gap:10px;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:1.6rem;text-decoration:none;color:var(--text);}
  .logo-badge{background:var(--pl-green);color:var(--pl-purple);width:34px;height:34px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;}
  .logo span{color:var(--pl-green);}
  .header-right{display:flex;align-items:center;gap:12px;}
  nav{display:flex;gap:6px;}
  nav a{background:none;border:1px solid transparent;color:var(--muted);font-family:'Barlow Condensed',sans-serif;font-size:.9rem;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding:6px 14px;border-radius:4px;cursor:pointer;transition:all .18s;text-decoration:none;display:inline-block;}
  nav a.active,nav a:hover{background:rgba(0,255,133,.1);border-color:var(--pl-green);color:var(--pl-green);}
  .user-chip{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:5px 12px 5px 7px;cursor:pointer;transition:border-color .15s;font-size:.82rem;position:relative;}
  .user-chip:hover{border-color:rgba(0,255,133,.4);}
  .uc-avatar{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--pl-purple),#8b008b);border:1.5px solid var(--pl-green);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:var(--pl-green);flex-shrink:0;}
  .uc-name{font-weight:600;color:var(--text);}
  .user-dropdown{position:absolute;top:calc(100% + 8px);right:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:200px;z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.4);display:none;overflow:hidden;}
  .user-dropdown.open{display:block;}
  .dd-head{padding:14px 16px;border-bottom:1px solid var(--border);background:var(--surface2);}
  .dd-name{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:1rem;}
  .dd-team{font-size:.75rem;color:var(--muted);margin-top:2px;}
  .dd-item{padding:11px 16px;font-size:.85rem;color:var(--muted);cursor:pointer;transition:background .12s;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);}
  .dd-item:last-child{border-bottom:none;}
  .dd-item:hover{background:var(--surface2);color:var(--text);}
  .dd-item.danger:hover{color:var(--red);}
  /* Preview mode badge */
  .preview-badge{background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.4);color:var(--accent2);font-family:'Barlow Condensed',sans-serif;font-size:.7rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 9px;border-radius:4px;}
  /* Toast */
  .toast{position:fixed;bottom:24px;right:24px;background:var(--pl-green);color:var(--pl-purple);font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:.9rem;padding:12px 20px;border-radius:8px;box-shadow:0 8px 32px rgba(0,255,133,.3);transform:translateY(60px);opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:1000;}
  .toast.show{transform:translateY(0);opacity:1;}
  /* Shared section title */
  .section-title{font-family:'Barlow Condensed',sans-serif;font-size:.75rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
`;
