// ════════════════════════════════════════════════════════
//  RefRater — shared.js
//  Shared data, state, and helper functions
//  Used by: matches.html, referees.html, login.html
// ════════════════════════════════════════════════════════

// ── FOOTBALL-DATA.ORG API ────────────────────────────────
// Free API key: https://www.football-data.org/client/register
// Gives live PL fixtures, scores, referee assignments, and cards.
const FOOTBALL_DATA_KEY = '15b079ce9d02424994eae82a3e5f4a31'; // ← Paste your free API key here
const FD_API_BASE = 'https://api.football-data.org/v4';

// Maps the API's full team names to our short names + emojis
const TEAM_LOOKUP = {
  'Arsenal FC':                 { short:'Arsenal',        emoji:'🔴' },
  'Aston Villa FC':             { short:'Aston Villa',    emoji:'🟣' },
  'AFC Bournemouth':            { short:'Bournemouth',    emoji:'🍒' },
  'Brentford FC':               { short:'Brentford',      emoji:'🔴' },
  'Brighton & Hove Albion FC':  { short:'Brighton',       emoji:'🔵' },
  'Chelsea FC':                 { short:'Chelsea',        emoji:'🔵' },
  'Crystal Palace FC':          { short:'Crystal Palace', emoji:'🦅' },
  'Everton FC':                 { short:'Everton',        emoji:'🔵' },
  'Fulham FC':                  { short:'Fulham',         emoji:'⚪' },
  'Ipswich Town FC':            { short:'Ipswich',        emoji:'🔵' },
  'Leicester City FC':          { short:'Leicester',      emoji:'🦊' },
  'Liverpool FC':               { short:'Liverpool',      emoji:'🔴' },
  'Manchester City FC':         { short:'Man City',       emoji:'🔵' },
  'Manchester United FC':       { short:'Man Utd',        emoji:'🔴' },
  'Newcastle United FC':        { short:'Newcastle',      emoji:'⚫' },
  'Nottingham Forest FC':       { short:'Nottm Forest',   emoji:'🌲' },
  'Southampton FC':             { short:'Southampton',    emoji:'⚪' },
  'Tottenham Hotspur FC':       { short:'Tottenham',      emoji:'⚪' },
  'West Ham United FC':         { short:'West Ham',       emoji:'🔵' },
  'Wolverhampton Wanderers FC': { short:'Wolves',         emoji:'🟡' },
};

let CURRENT_GW = null; // set when live data loads

async function loadFromFootballData() {
  if (!FOOTBALL_DATA_KEY) return false;

  const hdrs = { 'X-Auth-Token': FOOTBALL_DATA_KEY };
  const base = FD_API_BASE;

  try {
    // 1. Get current matchday number
    const compRes = await fetch(`${base}/competitions/PL`, { headers: hdrs });
    if (!compRes.ok) throw new Error(`HTTP ${compRes.status}`);
    const comp = await compRes.json();
    const gw = comp.currentSeason.currentMatchday;
    CURRENT_GW = gw;

    // 2. Fetch all matches for this gameweek
    const mRes = await fetch(`${base}/competitions/PL/matches?matchday=${gw}`, { headers: hdrs });
    if (!mRes.ok) throw new Error(`HTTP ${mRes.status}`);
    const mData = await mRes.json();

    // 3. Fetch match details (cards + penalties) for finished matches
    //    Free tier allows 10 req/min — a typical GW has 10 matches so one-shot is fine
    const finished = mData.matches.filter(m => m.status === 'FINISHED' || m.status === 'AWARDED');
    const detailResults = await Promise.all(
      finished.map(m =>
        fetch(`${base}/matches/${m.id}`, { headers: hdrs })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );
    const detailMap = new Map();
    finished.forEach((m, i) => { if (detailResults[i]) detailMap.set(m.id, detailResults[i]); });

    // 4. Build the new MATCHES array and fill in any unknown refs
    const newMatches = [];
    let matchId = 1;

    for (const m of mData.matches) {
      const home = TEAM_LOOKUP[m.homeTeam.name] || { short: m.homeTeam.shortName || m.homeTeam.name, emoji: '⚽' };
      const away = TEAM_LOOKUP[m.awayTeam.name] || { short: m.awayTeam.shortName || m.awayTeam.name, emoji: '⚽' };

      // Status
      let status;
      if      (m.status === 'FINISHED' || m.status === 'AWARDED') status = 'recent';
      else if (m.status === 'IN_PLAY'  || m.status === 'PAUSED')  status = 'live';
      else                                                          status = 'upcoming';

      // Score
      const hs = m.score?.fullTime?.home, as_ = m.score?.fullTime?.away;
      const score = (status !== 'upcoming' && hs != null) ? `${hs}–${as_}` : '–';

      // Cards and penalties from match detail
      const d   = detailMap.get(m.id);
      const yc  = d?.bookings?.filter(b => b.card === 'YELLOW').length ?? 0;
      const rc  = d?.bookings?.filter(b => b.card === 'RED' || b.card === 'YELLOW_RED').length ?? 0;
      const pen = d?.goals?.filter(g => g.type === 'PENALTY').length ?? 0;

      // Referee — skip matches where no ref has been assigned yet
      const apiRef = m.referees?.find(r => r.type === 'REFEREE') || m.referees?.[0];
      if (!apiRef) continue;

      // Try to match to our existing REFS by full name, then by surname
      let ref = REFS.find(r => r.name.toLowerCase() === apiRef.name.toLowerCase());
      if (!ref) ref = REFS.find(r => apiRef.name.toLowerCase().endsWith(r.name.split(' ').pop().toLowerCase()));
      if (!ref) {
        // Brand-new referee — add them with blank ratings
        ref = {
          id: Math.max(...REFS.map(r => r.id)) + 1,
          name: apiRef.name,
          initials: apiRef.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
          games: 0, neutralRating: 0, neutralVotes: 0, fanRating: 0, fanVotes: 0,
          nationality: apiRef.nationality || 'English', age: 0, fifaListed: 'Yes', notes: '',
        };
        REFS.push(ref);
      }

      newMatches.push({
        id: matchId++,
        home: home.short, hE: home.emoji,
        away: away.short, aE: away.emoji,
        score, status, refId: ref.id,
        yc, rc, pen,
        var: 0,        // VAR correct/incorrect is editorial — enter manually
        apiMatchId: m.id, matchday: gw,
        kickoff: m.utcDate,
      });
    }

    if (newMatches.length) MATCHES = newMatches;
    return { gw, count: newMatches.length };

  } catch (e) {
    console.warn('football-data.org load failed, using fallback data:', e.message);
    return false;
  }
}

// ── GOOGLE SHEETS CONFIG ─────────────────────────────────
// To connect live data:
// 1. Upload refrater_database.xlsx to Google Sheets
// 2. File > Share > Publish to Web > choose sheet > CSV > copy URL
// 3. Paste URLs below
const SHEETS_REFS_URL    = '';  // ← Paste Referees sheet CSV URL
const SHEETS_MATCHES_URL = '';  // ← Paste Matches sheet CSV URL

// ── PREVIEW MODE ─────────────────────────────────────────
// Set to true to skip login and use a guest account for easy previewing.
// Set to false when you're ready to go live with real logins.
const PREVIEW_MODE = true;

const PREVIEW_USER = {
  username: 'Preview User',
  email: 'preview@refrater.com',
  team: 'Arsenal',
  isPreview: true
};

// ── STATIC DATA ───────────────────────────────────────────
const PL_TEAMS = [
  {name:"Arsenal",emoji:"🔴"},{name:"Aston Villa",emoji:"🟣"},{name:"Bournemouth",emoji:"🍒"},
  {name:"Brentford",emoji:"🔴"},{name:"Brighton",emoji:"🔵"},{name:"Chelsea",emoji:"🔵"},
  {name:"Crystal Palace",emoji:"🦅"},{name:"Everton",emoji:"🔵"},{name:"Fulham",emoji:"⚪"},
  {name:"Ipswich",emoji:"🔵"},{name:"Leicester",emoji:"🦊"},{name:"Liverpool",emoji:"🔴"},
  {name:"Man City",emoji:"🔵"},{name:"Man Utd",emoji:"🔴"},{name:"Newcastle",emoji:"⚫"},
  {name:"Nottm Forest",emoji:"🌲"},{name:"Southampton",emoji:"⚪"},{name:"Tottenham",emoji:"⚪"},
  {name:"West Ham",emoji:"🔵"},{name:"Wolves",emoji:"🟡"},
];

let REFS = [
  {id:1,name:"Michael Oliver", initials:"MO",games:18,neutralRating:7.4,neutralVotes:89,fanRating:5.8,fanVotes:53,nationality:"English",age:39,fifaListed:"Yes",notes:"PL's most experienced ref"},
  {id:2,name:"Anthony Taylor", initials:"AT",games:21,neutralRating:6.1,neutralVotes:71,fanRating:4.9,fanVotes:60,nationality:"English",age:45,fifaListed:"Yes",notes:"Frequently controversial"},
  {id:3,name:"Simon Hooper",   initials:"SH",games:15,neutralRating:6.8,neutralVotes:55,fanRating:6.2,fanVotes:32,nationality:"English",age:42,fifaListed:"Yes",notes:""},
  {id:4,name:"Craig Pawson",   initials:"CP",games:19,neutralRating:7.2,neutralVotes:44,fanRating:5.5,fanVotes:19,nationality:"English",age:44,fifaListed:"Yes",notes:""},
  {id:5,name:"Andy Madley",    initials:"AM",games:16,neutralRating:7.0,neutralVotes:21,fanRating:6.8,fanVotes:10,nationality:"English",age:38,fifaListed:"Yes",notes:""},
  {id:6,name:"Stuart Attwell", initials:"SA",games:17,neutralRating:5.8,neutralVotes:13,fanRating:4.2,fanVotes:6, nationality:"English",age:40,fifaListed:"Yes",notes:"VAR specialist background"},
  {id:7,name:"Jarred Gillett", initials:"JG",games:14,neutralRating:7.6,neutralVotes:0, fanRating:0,  fanVotes:0, nationality:"Australian",age:39,fifaListed:"Yes",notes:"Only overseas PL ref"},
  {id:8,name:"John Brooks",    initials:"JB",games:12,neutralRating:6.4,neutralVotes:0, fanRating:0,  fanVotes:0, nationality:"English",age:41,fifaListed:"Yes",notes:""},
];

let MATCHES = [
  {id:1,home:"Arsenal",       hE:"🔴",away:"Liverpool",    aE:"🔴",score:"2–1",status:"recent",  refId:1,yc:4,rc:0,pen:1,var:2},
  {id:2,home:"Man City",      hE:"🔵",away:"Chelsea",      aE:"🔵",score:"1–1",status:"recent",  refId:2,yc:3,rc:1,pen:0,var:3},
  {id:3,home:"Tottenham",     hE:"⚪",away:"Man Utd",      aE:"🔴",score:"0–2",status:"recent",  refId:3,yc:5,rc:0,pen:0,var:1},
  {id:4,home:"Newcastle",     hE:"⚫",away:"Aston Villa",  aE:"🟣",score:"3–0",status:"recent",  refId:4,yc:2,rc:0,pen:1,var:0},
  {id:5,home:"Brighton",      hE:"🔵",away:"West Ham",     aE:"🔵",score:"1–0",status:"live",    refId:5,yc:2,rc:0,pen:0,var:1},
  {id:6,home:"Wolves",        hE:"🟡",away:"Fulham",       aE:"⚪",score:"0–0",status:"live",    refId:6,yc:3,rc:0,pen:1,var:2},
  {id:7,home:"Everton",       hE:"🔵",away:"Brentford",    aE:"🔴",score:"–",  status:"upcoming",refId:7,yc:0,rc:0,pen:0,var:0},
  {id:8,home:"Crystal Palace",hE:"🦅",away:"Bournemouth",  aE:"🍒",score:"–",  status:"upcoming",refId:8,yc:0,rc:0,pen:0,var:0},
];

const INCIDENTS = [
  "Correct penalty","Wrong penalty","Missed red card","Harsh red card",
  "Good advantage","Poor card mgmt","Excellent control","VAR right",
  "VAR wrong","Offside error","Foul not given","Time wasting ok"
];

const RATING_DESCS = ["","Terrible","Poor","Below average","Average","Decent","Good","Very good","Excellent","Outstanding","Flawless ⭐"];

// ── SESSION HELPERS ───────────────────────────────────────
function getUsers()    { return JSON.parse(sessionStorage.getItem('rr_users') || '{}'); }
function saveUsers(u)  { sessionStorage.setItem('rr_users', JSON.stringify(u)); }
function getCurrentUser() {
  if (PREVIEW_MODE) return PREVIEW_USER;
  return JSON.parse(sessionStorage.getItem('rr_currentUser') || 'null');
}
function saveCurrentUser(u) { sessionStorage.setItem('rr_currentUser', JSON.stringify(u)); }
function clearCurrentUser() { sessionStorage.removeItem('rr_currentUser'); }
function isLoggedIn() { return PREVIEW_MODE || !!getCurrentUser(); }

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
  if (!SHEETS_REFS_URL && !SHEETS_MATCHES_URL) return false;
  try {
    const [refsRes, matchRes] = await Promise.all([
      SHEETS_REFS_URL    ? fetch(SHEETS_REFS_URL)    : Promise.resolve(null),
      SHEETS_MATCHES_URL ? fetch(SHEETS_MATCHES_URL) : Promise.resolve(null),
    ]);
    if (refsRes && refsRes.ok) {
      const parsed = parseCSV(await refsRes.text());
      if (parsed.length) REFS = parsed.map(r => ({
        ...r,
        neutralRating: +r.neutralRating || 0, neutralVotes: +r.neutralVotes || 0,
        fanRating:     +r.fanRating     || 0, fanVotes:     +r.fanVotes     || 0,
      }));
    }
    if (matchRes && matchRes.ok) {
      const parsed = parseCSV(await matchRes.text());
      if (parsed.length) MATCHES = parsed.map(m => ({
        ...m,
        hE: m.homeEmoji || '⚽', aE: m.awayEmoji || '⚽',
        yc: +m.yellowCards || 0, rc: +m.redCards || 0,
        pen: +m.penaltiesGiven || 0, var: +m.varDecisions || 0,
      }));
    }
    return true;
  } catch (e) {
    console.warn('Sheets load failed, using fallback data', e);
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
