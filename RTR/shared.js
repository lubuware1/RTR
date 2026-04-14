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
  // Force team selection only if profile loaded and team is explicitly missing
  if (profile && !profile.team) {
    window.location.href = 'login.html?onboard=1';
    return true; // prevent calling page from also redirecting to login.html
  }
  // Award profile_setup badge if team is set
  if (profile?.team) checkProfileBadge(session.user.id).catch(() => {});
  return true;
}

async function loadRatings(matchIds) {
  if (PREVIEW_MODE) return;
  if (matchIds && matchIds.length === 0) { REFS.forEach(r => { r.neutralRating=0; r.neutralVotes=0; r.fanRating=0; r.fanVotes=0; }); return; }
  let query = getSB().from('RTR Votes').select('ref_id,overall,is_fan_vote,match_id');
  if (matchIds?.length) query = query.in('match_id', matchIds);
  const { data: votes } = await query;
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

async function loadUserVotes(userId, matchIds) {
  if (PREVIEW_MODE) return new Set();
  if (matchIds && matchIds.length === 0) return new Set();
  let query = getSB().from('RTR Votes').select('match_id').eq('user_id', userId);
  if (matchIds?.length) query = query.in('match_id', matchIds);
  const { data } = await query;
  return new Set((data || []).map(v => v.match_id));
}

async function saveVoteToDB(voteData) {
  if (PREVIEW_MODE) return true;
  await getSB().from('RTR Votes').delete().eq('user_id', voteData.user_id).eq('match_id', voteData.match_id);
  const { error } = await getSB().from('RTR Votes').insert(voteData);
  if (error) console.error('[RTR] saveVoteToDB error:', error);
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

async function loadMySeasonWildcards(currentMatchweek) {
  // Returns wildcards with left counts reduced by usage in all previous GWs
  const defaults = { yc: { left: 1, active: false, matchId: null }, rc: { left: 1, active: false, matchId: null }, var: { left: 2, active: false, matchId: null } };
  if (PREVIEW_MODE) return defaults;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) return defaults;
  const { data: allPicks } = await getSB().from('RTR Fantasy Picks')
    .select('matchweek, wildcards')
    .eq('user_id', session.user.id)
    .lt('matchweek', currentMatchweek);
  if (!allPicks?.length) return defaults;
  // Count how many times each wildcard was used in previous GWs
  const used = { yc: 0, rc: 0, var: 0 };
  allPicks.forEach(p => {
    if (!p.wildcards) return;
    ['yc', 'rc', 'var'].forEach(k => {
      if (p.wildcards[k]?.active) used[k]++;
    });
  });
  return {
    yc:  { left: Math.max(0, defaults.yc.left  - used.yc),  active: false, matchId: null },
    rc:  { left: Math.max(0, defaults.rc.left  - used.rc),  active: false, matchId: null },
    var: { left: Math.max(0, defaults.var.left - used.var), active: false, matchId: null },
  };
}

// ── MATCH STATS (admin overrides) ─────────────────────────
async function loadMatchStats() {
  if (PREVIEW_MODE) return [];
  const { data } = await getSB().from('RTR Match Stats').select('*');
  return data || [];
}

async function saveMatchStat(stat) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Match Stats').upsert(stat, { onConflict: 'match_id' });
  if (error) console.error('[RTR] saveMatchStat error:', error);
  return !error;
}

async function saveGWConfig(gw, deadline) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Config').upsert({ id: 1, gw, deadline }, { onConflict: 'id' });
  if (error) console.error('[RTR] saveGWConfig error:', error);
  return !error;
}

async function saveManualBonus(refId, matchweek, pts, label) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Manual Bonuses').insert({ ref_id: refId, matchweek, pts, label });
  if (error) console.error('[RTR] saveManualBonus error:', error);
  return !error;
}

async function deleteManualBonus(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Manual Bonuses').delete().eq('id', id);
  if (error) console.error('[RTR] deleteManualBonus error:', error);
  return !error;
}

async function loadAllManualBonuses() {
  if (PREVIEW_MODE) return {};
  const { data } = await getSB().from('RTR Manual Bonuses').select('ref_id, pts, label');
  if (!data?.length) return {};
  return data.reduce((acc, row) => {
    if (!acc[row.ref_id]) acc[row.ref_id] = [];
    acc[row.ref_id].push({ pts: row.pts, label: row.label });
    return acc;
  }, {});
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

async function loadAllFantasyPicks() {
  if (PREVIEW_MODE) return [];
  const { data: picks } = await getSB().from('RTR Fantasy Picks').select('user_id, ref_id, matchweek, wildcards');
  if (!picks?.length) return [];
  const { data: profiles } = await getSB().from('RTR Profiles')
    .select('id, username, team').in('id', picks.map(p => p.user_id));
  const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  return picks.map(p => ({ ...p, profile: pm[p.user_id] || null }));
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

async function loadGWConfig() {
  if (PREVIEW_MODE) return { gw: 2, deadline: new Date(Date.now() + 86400000).toISOString(), deadlinePassed: false, status: 'upcoming' };
  const { data } = await getSB().from('RTR Config').select('gw,deadline,status').eq('id', 1).single();
  if (!data) return null;
  return {
    gw: data.gw,
    deadline: data.deadline,
    deadlinePassed: new Date() > new Date(data.deadline),
    status: data.status || 'upcoming'
  };
}

// ── INCIDENTS ─────────────────────────────────────────────

const INCIDENT_TYPES = [
  { type: 'Red Card',        weight: 3.0 },
  { type: 'Penalty Given',   weight: 2.5 },
  { type: 'Goal Decision',   weight: 2.5 },
  { type: 'Yellow Card',     weight: 2.0 },
  { type: 'VAR Decision',    weight: 1.5 },
  { type: 'Offside Decision',weight: 1.5 },
  { type: 'Foul Not Given',  weight: 1.5 },
  { type: 'Other',           weight: 1.5 },
];

// Votes threshold config
const VOTE_MULTIPLIER = 1;   // votes use stored weight column — no additional multiplier needed
const MIN_VOTES = 10;        // effective votes needed before a decision affects the score

// Compute incident-driven score starting from 10.
// Returns null if no decisions have cleared the vote threshold yet.
// incidents: [{ id, weight }]
// votes: { [incidentId]: { correct: N, wrong: N } }
function calcIncidentScore(incidents, votes) {
  if (!incidents.length) return null;
  let score = 10.0;
  let anyQualified = false;
  incidents.forEach(inc => {
    const v = votes[inc.id];
    if (!v) return;
    const total = v.correct + v.wrong;
    if (total * VOTE_MULTIPLIER < MIN_VOTES) return; // below threshold — pending
    anyQualified = true;
    const penalty = inc.weight * (v.wrong / total);
    score -= penalty;
  });
  if (!anyQualified) return null;
  return Math.max(1.0, Math.round(score * 10) / 10);
}

async function loadIncidents(matchId) {
  if (PREVIEW_MODE) return [];
  const { data } = await getSB().from('RTR Incidents')
    .select('id, match_id, type, minute, description, weight')
    .eq('match_id', matchId)
    .order('minute', { ascending: true });
  return data || [];
}

// Returns { neutral: { incidentId: {correct,wrong} }, fan: { incidentId: {correct,wrong} } }
async function loadIncidentVotes(incidentIds) {
  if (!incidentIds.length) return { neutral: {}, fan: {} };
  if (PREVIEW_MODE) return { neutral: {}, fan: {} };
  const { data } = await getSB().from('RTR Incident Votes')
    .select('incident_id, vote, is_fan, weight')
    .in('incident_id', incidentIds);
  const neutral = {}, fan = {};
  incidentIds.forEach(id => {
    neutral[id] = { correct: 0, wrong: 0 };
    fan[id]     = { correct: 0, wrong: 0 };
  });
  (data || []).forEach(v => {
    const bucket = v.is_fan ? fan : neutral;
    if (!bucket[v.incident_id]) bucket[v.incident_id] = { correct: 0, wrong: 0 };
    bucket[v.incident_id][v.vote] += v.weight || 1;
  });
  return { neutral, fan };
}

async function loadMyIncidentVotes(userId, incidentIds) {
  if (!incidentIds.length || PREVIEW_MODE) return {};
  const { data } = await getSB().from('RTR Incident Votes')
    .select('incident_id, vote, created_at')
    .eq('user_id', userId)
    .in('incident_id', incidentIds);
  // { incidentId: { vote, created_at } }
  const map = {};
  (data || []).forEach(v => { map[v.incident_id] = { vote: v.vote, created_at: v.created_at }; });
  return map;
}

async function saveIncidentVote(incidentId, userId, vote, isFan) {
  if (PREVIEW_MODE) return true;
  const weight = 5; // each user counts as 5 votes
  const { error } = await getSB().from('RTR Incident Votes').insert({
    incident_id: incidentId, user_id: userId, vote, is_fan: !!isFan,
    weight, created_at: new Date().toISOString()
  });
  if (error) console.error('[RTR] saveIncidentVote error:', error);
  return !error;
}

async function saveIncident(matchId, type, minute, description) {
  if (PREVIEW_MODE) return null;
  const weight = INCIDENT_TYPES.find(t => t.type === type)?.weight ?? 0.5;
  const { data, error } = await getSB().from('RTR Incidents').insert({
    match_id: matchId, type, minute: minute !== null ? +minute : null, description: description || null, weight
  }).select().single();
  if (error) console.error('[RTR] saveIncident error:', error);
  return data || null;
}

// Populates ref.neutralRating, ref.fanRating, ref.neutralVotes, ref.fanVotes
// from the incident voting tables. Called on any page that shows ref scores.
async function loadIncidentRatings() {
  if (PREVIEW_MODE) return;
  const { data: incidents } = await getSB()
    .from('RTR Incidents').select('id, match_id, type, weight');
  if (!incidents?.length) return;

  const ids = incidents.map(i => i.id);
  const { data: votes } = await getSB()
    .from('RTR Incident Votes').select('incident_id, vote, is_fan, weight')
    .in('incident_id', ids);

  const byMatch = {};
  incidents.forEach(inc => {
    if (!byMatch[inc.match_id]) byMatch[inc.match_id] = [];
    byMatch[inc.match_id].push(inc);
  });

  const neutral = {}, fan = {};
  ids.forEach(id => { neutral[id] = { correct:0, wrong:0 }; fan[id] = { correct:0, wrong:0 }; });
  (votes||[]).forEach(v => {
    const b = v.is_fan ? fan : neutral;
    if (b[v.incident_id]) b[v.incident_id][v.vote] += v.weight || 1;
  });

  REFS.forEach(r => { r.neutralRating=null; r.neutralVotes=0; r.fanRating=null; r.fanVotes=0; });
  const refNeutral = {}, refFan = {};
  MATCHES.forEach(m => {
    const incs = byMatch[m.id];
    if (!incs) return;
    const ref = REFS.find(r => r.id === +m.refId);
    if (!ref) return;
    if (!refNeutral[ref.id]) refNeutral[ref.id] = [];
    if (!refFan[ref.id])     refFan[ref.id]     = [];
    incs.forEach(inc => {
      const nv = neutral[inc.id] || { correct:0, wrong:0 };
      const fv = fan[inc.id]     || { correct:0, wrong:0 };
      if (nv.correct + nv.wrong) refNeutral[ref.id].push({ ...inc, _v: nv });
      if (fv.correct + fv.wrong) refFan[ref.id].push({ ...inc, _v: fv });
    });
  });
  REFS.forEach(r => {
    if (refNeutral[r.id]?.length) {
      const vMap = Object.fromEntries(refNeutral[r.id].map(i => [i.id, i._v]));
      const ns = calcIncidentScore(refNeutral[r.id], vMap);
      if (ns !== null) r.neutralRating = ns;
      r.neutralVotes = refNeutral[r.id].reduce((s,i) => s + i._v.correct + i._v.wrong, 0);
    }
    if (refFan[r.id]?.length) {
      const vMap = Object.fromEntries(refFan[r.id].map(i => [i.id, i._v]));
      const fs = calcIncidentScore(refFan[r.id], vMap);
      if (fs !== null) r.fanRating = fs;
      r.fanVotes = refFan[r.id].reduce((s,i) => s + i._v.correct + i._v.wrong, 0);
    }
  });
}

async function saveDecisionFlag(matchId, matchMinute) {
  if (PREVIEW_MODE) return true;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) return false;
  const { error } = await getSB().from('RTR Decision Flags').insert({
    user_id: session.user.id,
    match_id: +matchId,
    match_minute: matchMinute !== null ? +matchMinute : null,
    created_at: new Date().toISOString(),
  });
  if (error) console.error('[RTR] saveDecisionFlag error:', error);
  return !error;
}

async function loadDecisionFlags(matchId) {
  if (PREVIEW_MODE) return [];
  const { data } = await getSB().from('RTR Decision Flags')
    .select('match_minute, created_at')
    .eq('match_id', matchId);
  return data || [];
}

async function deleteIncident(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Incidents').delete().eq('id', id);
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
  {name:"Arsenal",        emoji:"🔴"},{name:"Chelsea",        emoji:"🔵"},
  {name:"Leeds United",   emoji:"⚪"},{name:"Liverpool",      emoji:"🔴"},
  {name:"Manchester City",emoji:"🔵"},{name:"Port Vale",      emoji:"⚫"},
  {name:"Southampton",    emoji:"🔴"},{name:"West Ham",       emoji:"⚒️"},
];
// Keep alias so any page still referencing PL_TEAMS doesn't break
const PL_TEAMS = WC_TEAMS;

let REFS = [
  {id:1,  name:"Szymon Marciniak",      initials:"SM", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Polish",    age:43, fifaListed:"Yes", notes:"Refereed 2022 World Cup Final"},
  {id:2,  name:"Daniele Orsato",        initials:"DO", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Italian",   age:49, fifaListed:"Yes", notes:"Experienced UEFA Champions League ref"},
  {id:3,  name:"Anthony Taylor",        initials:"AT", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"English",   age:45, fifaListed:"Yes", notes:"Premier League and UEFA ref"},
  {id:4,  name:"Facundo Tello",         initials:"FT", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Argentine", age:38, fifaListed:"Yes", notes:"CONMEBOL top referee"},
  {id:5,  name:"Fernando Rapallini",    initials:"FR", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Argentine", age:44, fifaListed:"Yes", notes:"2022 World Cup referee"},
  {id:6,  name:"Felix Zwayer",          initials:"FZ", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"German",    age:43, fifaListed:"Yes", notes:"Bundesliga top referee"},
  {id:7,  name:"Ismail Elfath",         initials:"IE", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"American",  age:41, fifaListed:"Yes", notes:"MLS and CONCACAF top referee"},
  {id:8,  name:"Abdulrahman Al-Jassim", initials:"AJ", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Qatari",    age:38, fifaListed:"Yes", notes:"2022 World Cup host nation ref"},
  {id:9,  name:"Slavko Vinčić",         initials:"SV", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Slovenian", age:43, fifaListed:"Yes", notes:"UEFA Europa League referee"},
  {id:10, name:"Bakary Gassama",        initials:"BG", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Gambian",   age:44, fifaListed:"Yes", notes:"CAF top referee"},
  {id:11, name:"Mustapha Ghorbal",      initials:"MG", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Algerian",  age:42, fifaListed:"Yes", notes:"CAF and FIFA referee"},
  {id:12, name:"Ivan Barton",           initials:"IB", games:0, neutralRating:null, neutralVotes:0, fanRating:null, fanVotes:0, nationality:"Salvadoran",age:38, fifaListed:"Yes", notes:"CONCACAF FIFA referee"},
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
    if (m.status === 'complete') return;
    if (!m.kickoff) return;
    const ko = new Date(String(m.kickoff).replace(' ', 'T').replace(/Z$/, '')).getTime();
    if (isNaN(ko)) return;
    // If manually marked live in the sheet, only advance to complete — never revert to upcoming
    if (m.status === 'live') {
      if (now >= ko + MATCH_DURATION_MS) m.status = 'complete';
      return;
    }
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
const ADMIN_USERS = ['danawhiteware', 'jware89'];
function isAdmin(user) {
  const u = user || getCurrentUser();
  return !!u && ADMIN_USERS.includes(u.username?.toLowerCase());
}

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
          matchweek: +m.matchweek || 1,
          hE: m.homeEmoji || '⚽', aE: m.awayEmoji || '⚽',
          yc: +m.yellowCards || 0, rc: +m.redCards || 0,
          pen: +m.penaltiesGiven || 0, var: +m.varDecisions || 0,
          perfectGame:     m.perfectGame === 'yes',
          incorrectVarPen: +m.incorrectVarPen || 0,
          incorrectVarRed: +m.incorrectVarRed || 0,
        }));
      }
    }

    // Merge Supabase match stat overrides on top of sheet data
    const overrides = await loadMatchStats();
    if (overrides.length) {
      const overrideMap = Object.fromEntries(overrides.map(o => [+o.match_id, o]));
      MATCHES = MATCHES.map(m => {
        const o = overrideMap[+m.id];
        if (!o) return m;
        return {
          ...m,
          score:          o.score          ?? m.score,
          status:         o.status         ?? m.status,
          yc:             o.yellow_cards   ?? m.yc,
          rc:             o.red_cards      ?? m.rc,
          pen:            o.penalties_given ?? m.pen,
          var:            o.var_decisions  ?? m.var,
          perfectGame:    o.perfect_game   ?? m.perfectGame,
          incorrectVarPen: o.incorrect_var_pen ?? m.incorrectVarPen,
          incorrectVarRed: o.incorrect_var_red ?? m.incorrectVarRed,
        };
      });
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
  /* ── MOBILE NAV ─────────────────────────────────────────── */
  .hamburger{display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:6px;}
  .hamburger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;transition:all .2s;}
  .mobile-nav{display:none;position:fixed;top:60px;left:0;right:0;background:linear-gradient(135deg,#37003c 0%,#1a0020 100%);border-bottom:2px solid var(--pl-green);z-index:99;padding:12px 16px;flex-direction:column;gap:4px;}
  .mobile-nav a{color:var(--muted);font-family:'Barlow Condensed',sans-serif;font-size:1rem;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding:10px 14px;border-radius:6px;text-decoration:none;display:block;border:1px solid transparent;}
  .mobile-nav a.active,.mobile-nav a:hover{background:rgba(0,255,133,.1);border-color:var(--pl-green);color:var(--pl-green);}
  .mobile-nav.open{display:flex;}
  @media(max-width:768px){
    .hamburger{display:flex;}
    nav{display:none;}
    .uc-name{display:none;}
    .header-inner{padding:0;}
    header{padding:0 16px;}
  }
`;
(function(){const s=document.createElement('style');s.textContent=SHARED_CSS;document.head.appendChild(s);})();

// ── AVATAR BADGE ─────────────────────────────────────────
const _AVATAR_KEY = 'rr_avatar_badge';

function getAvatarBadge() {
  const s = localStorage.getItem(_AVATAR_KEY);
  return s ? JSON.parse(s) : null; // { key, icon }
}
function setAvatarBadge(data) {
  if (data) localStorage.setItem(_AVATAR_KEY, JSON.stringify(data));
  else localStorage.removeItem(_AVATAR_KEY);
}
// Call this wherever the user-chip avatar is initialised
function applyUserAvatar(el, user) {
  const badge = getAvatarBadge();
  if (badge) {
    el.textContent    = badge.icon;
    el.style.fontSize = '1.05rem';
    el.style.background = 'rgba(0,255,133,.08)';
  } else {
    el.textContent    = (user?.username || '?').slice(0, 2).toUpperCase();
    el.style.fontSize = '';
    el.style.background = '';
  }
}

// ── BADGE SYSTEM ──────────────────────────────────────────
const BADGE_DEFS = [
  // Voting
  { key: 'first_vote',    category: 'Voting',   icon: '🗳️', name: 'First Vote',     desc: 'Cast your first incident vote' },
  { key: 'hot_take',      category: 'Voting',   icon: '🔥', name: 'Hot Take',       desc: 'Vote on 10 different incidents' },
  { key: 'centurion',     category: 'Voting',   icon: '💯', name: 'Centurion',      desc: 'Vote on 100 incidents' },
  { key: 'voting_streak', category: 'Voting',   icon: '📈', name: 'On a Roll',      desc: 'Vote in 3 consecutive matchweeks' },
  // Fantasy
  { key: 'first_pick',    category: 'Fantasy',  icon: '⚽', name: 'First Pick',     desc: 'Make your first fantasy pick' },
  { key: 'wildcard_king', category: 'Fantasy',  icon: '🃏', name: 'Wildcard King',  desc: 'Use all your wildcards in a season' },
  { key: 'podium',        category: 'Fantasy',  icon: '🏆', name: 'Podium',         desc: 'Finish top 3 in a matchweek leaderboard' },
  { key: 'match_winner',  category: 'Fantasy',  icon: '🎯', name: 'Match Winner',   desc: 'Your picked ref scores 10+ points in a GW' },
  // Loyalty
  { key: 'profile_setup', category: 'Loyalty',  icon: '👤', name: 'All Kitted Out', desc: 'Set your favourite team on your profile' },
  { key: 'early_adopter', category: 'Loyalty',  icon: '🌟', name: 'Early Adopter',  desc: 'Among the first 50 users to join RefRater' },
  // Special
  { key: 'perfect_voter', category: 'Special',  icon: '🎖️', name: 'Perfect Eye',    desc: 'Vote correctly on all incidents in a match' },
];

async function awardBadge(userId, badgeKey) {
  if (PREVIEW_MODE || !userId) return false;
  // insert with unique constraint — silently ignore duplicate
  const { error } = await getSB().from('RTR Badges').insert({
    user_id: userId, badge_key: badgeKey, awarded_at: new Date().toISOString()
  });
  // error code 23505 = unique violation (already earned) — that's fine
  if (error && error.code !== '23505') console.warn('[RTR] awardBadge error:', error);
  return !error;
}

async function loadMyBadges(userId) {
  if (PREVIEW_MODE || !userId) return [];
  const { data } = await getSB().from('RTR Badges')
    .select('badge_key, awarded_at').eq('user_id', userId);
  return data || [];
}

// Called after any incident vote is saved
async function checkVotingBadges(userId) {
  if (PREVIEW_MODE || !userId) return;
  // Total vote count
  const { count } = await getSB().from('RTR Incident Votes')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (count >= 1)   await awardBadge(userId, 'first_vote');
  if (count >= 10)  await awardBadge(userId, 'hot_take');
  if (count >= 100) await awardBadge(userId, 'centurion');
  // Streak: 3 consecutive matchweeks with at least 1 vote
  const { data: votedGWs } = await getSB().from('RTR Incident Votes')
    .select('matchweek').eq('user_id', userId).not('matchweek', 'is', null);
  if (votedGWs?.length) {
    const gws = [...new Set(votedGWs.map(v => +v.matchweek))].sort((a, b) => a - b);
    let streak = 1, max = 1;
    for (let i = 1; i < gws.length; i++) {
      streak = gws[i] === gws[i - 1] + 1 ? streak + 1 : 1;
      if (streak > max) max = streak;
    }
    if (max >= 3) await awardBadge(userId, 'voting_streak');
  }
}

// Called after a fantasy pick is saved
async function checkFantasyBadges(userId, seasonWildcards) {
  if (PREVIEW_MODE || !userId) return;
  // First pick
  const { count } = await getSB().from('RTR Fantasy Picks')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (count >= 1) await awardBadge(userId, 'first_pick');
  // Wildcard king: all wildcards exhausted (left = 0 for yc, rc, var)
  if (seasonWildcards) {
    const { yc, rc, var: varWC } = seasonWildcards;
    if (yc.left === 0 && rc.left === 0 && varWC.left === 0) {
      await awardBadge(userId, 'wildcard_king');
    }
  }
}

// Called on profile setup / login when team is set
async function checkProfileBadge(userId) {
  if (PREVIEW_MODE || !userId) return;
  await awardBadge(userId, 'profile_setup');
}

// Called when fantasy leaderboard resolves to check top-3 finish
async function checkPodiumBadge(userId, _gw) {
  if (PREVIEW_MODE || !userId) return;
  // Load all picks for this GW and check if user is in top 3 by points
  // (Points calculation is done on the fantasy page — this is a helper
  //  that the fantasy page calls after computing scores)
  await awardBadge(userId, 'podium');
}

// Called when match-winner threshold is met (10+ pts, picked ref)
async function checkMatchWinnerBadge(userId) {
  if (PREVIEW_MODE || !userId) return;
  await awardBadge(userId, 'match_winner');
}
