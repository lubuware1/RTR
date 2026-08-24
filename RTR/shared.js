// ════════════════════════════════════════════════════════
//  RefRater — shared.js
//  Shared data, state, and helper functions
//  Used by: matches.html, referees.html, login.html
// ════════════════════════════════════════════════════════

// ── FOOTBALL-DATA.ORG API ────────────────────────────────
// Disabled for World Cup format — no live API used.
const FOOTBALL_DATA_KEY = '15b079ce9d02424994eae82a3e5f4a31';
const FD_API_BASE = 'https://api.football-data.org/v4';

// Fetch PL matches for a given matchday.
// On Netlify, routes through the serverless proxy to avoid CORS.
// Falls back to direct API call for localhost dev.
async function loadFromFootballData(matchday, comp = 'PL', season = '2025') {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const url = isLocal
    ? `/api/fd-matches?matchday=${matchday}&season=${season}&comp=${comp}`
    : `/.netlify/functions/fd-matches?matchday=${matchday}&season=${season}&comp=${comp}`;
  const opts = {};
  try {
    const res = await fetch(url, opts);
    if (!res.ok) { console.warn('[RTR] FD API error:', res.status); return null; }
    const json = await res.json();
    return json.matches || null;
  } catch(e) {
    console.warn('[RTR] football-data.org fetch failed:', e);
    return null;
  }
}

// Normalise team name for fuzzy matching (strips FC/AFC suffixes)
function _normTeam(n) {
  return (n || '').toLowerCase().replace(/\s+(f\.?c\.?|a\.?f\.?c\.?)$/,'').trim();
}

const FD_STATUS = { FINISHED:'complete', IN_PLAY:'live', PAUSED:'live', HALF_TIME:'live', TIMED:'upcoming', SCHEDULED:'upcoming', SUSPENDED:'upcoming', POSTPONED:'upcoming', CANCELLED:'upcoming' };

// Build MATCHES directly from API data — no name-matching needed.
function buildMatchesFromFD(fdMatches) {
  console.log('[RTR] buildMatchesFromFD called with', fdMatches.length, 'matches');
  MATCHES = fdMatches.map(fm => {
    const ft = fm.score?.fullTime;
    const hasScore = ft?.home != null && ft?.away != null && (fm.status === 'FINISHED' || fm.status === 'IN_PLAY' || fm.status === 'PAUSED' || fm.status === 'HALF_TIME');
    const apiRefName = (fm.referees?.find(r => r.type === 'REFEREE')?.name || '').toLowerCase();
    const ref = apiRefName ? REFS.find(r =>
      r.name.toLowerCase() === apiRefName ||
      apiRefName.includes(r.name.split(' ').pop().toLowerCase())
    ) : null;
    return {
      id:        fm.id,
      matchweek: fm.matchday,
      home:      fm.homeTeam?.shortName || fm.homeTeam?.name || '',
      away:      fm.awayTeam?.shortName || fm.awayTeam?.name || '',
      hE: '', aE: '',
      kickoff:   fm.utcDate  || null,
      status:    FD_STATUS[fm.status] || 'upcoming',
      score:     hasScore ? `${ft.home}-${ft.away}` : '–',
      refId:     ref?.id || null,
      homeCrest: fm.homeTeam?.crest || null,
      awayCrest: fm.awayTeam?.crest || null,
      yc: 0, rc: 0, pen: 0, var: 0,
      perfectGame: false, incorrectVarPen: 0, incorrectVarRed: 0,
      highlightVideoId: null, varVideoId: null,
    };
  });
}

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
const _USER_KEY    = 'rr_user';
const _AVATAR_KEY  = 'rr_avatar_badge';
const _THEME_KEY   = 'rr_theme';

// Apply theme immediately before any rendering to prevent flash
(function(){ document.documentElement.setAttribute('data-theme', localStorage.getItem(_THEME_KEY) || 'light'); })();

let _sb = null;
function getSB() {
  if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sb;
}

async function checkAuth() {
  if (PREVIEW_MODE) return true;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) { localStorage.removeItem(_USER_KEY); return false; }
  const { data: profile, error: profileError } = await getSB().from('RTR Profiles').select('username,team,avatar_badge,is_admin').eq('id', session.user.id).single();
  console.log('[RTR] profile fetch:', profile, 'error:', profileError);
  localStorage.setItem(_USER_KEY, JSON.stringify({
    id: session.user.id, email: session.user.email,
    username: profile?.username || 'User', team: profile?.team || null,
    is_admin: profile?.is_admin || false
  }));
  // Sync avatar badge from DB to localStorage (so it persists across devices)
  if (profile?.avatar_badge) localStorage.setItem(_AVATAR_KEY, profile.avatar_badge);
  // Force team selection only if profile loaded and team is explicitly missing
  if (profile && !profile.team) {
    window.location.href = 'login.html?onboard=1';
    return true; // prevent calling page from also redirecting to login.html
  }
  // Award profile_setup badge if team is set
  if (profile?.team) checkProfileBadge(session.user.id).catch(() => {});
  // Award Founder badge to users who signed up on or before 2026-04-18
  checkFounderBadge(session.user.id, session.user.created_at).catch(() => {});
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

// ── PROFANITY FILTER ─────────────────────────────────────
const _badWords = [
  'fuck','fucking','fucker','fucks','f\\*ck',
  'shit','shitting','shitter','shits','sh\\*t',
  'cunt','cunts',
  'bitch','bitches','bitching',
  'bastard','bastards',
  'asshole','assholes','arsehole','arseholes',
  'cock','cocks','cockhead',
  'dick','dicks','dickhead',
  'piss','pissed','pisser',
  'twat','twats',
  'wanker','wankers','wank',
  'bollocks','bollock',
  'prick','pricks',
  'slut','sluts',
  'whore','whores',
  'nigger','niggers','nigga',
  'faggot','faggots',
  'retard','retards',
];
const _profanityRe = new RegExp(`(${_badWords.join('|')})`, 'gi');
// Finds profanity via a leetspeak-normalized copy (so "$hit" / "@$$hole"
// still get caught), but censors those spans in the ORIGINAL text rather
// than returning the normalized copy — every substitution below is exactly
// one character for one character, so positions line up between the two
// strings. This is what keeps a literal "@" (e.g. an @mention) intact
// instead of silently becoming "a" everywhere in the text.
function cleanText(text) {
  if (!text) return text;
  const normalized = text
    .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o').replace(/[5$]/g, 's').replace(/[+]/g, 't');
  let result = text;
  const re = new RegExp(_profanityRe.source, 'gi');
  let match;
  while ((match = re.exec(normalized))) {
    const start = match.index, len = match[0].length;
    result = result.slice(0, start) + '*'.repeat(len) + result.slice(start + len);
  }
  return result;
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
  const season = await getCurrentSeason();
  const { error } = await getSB().from('RTR Fantasy Picks').upsert({
    user_id: session.user.id, matchweek, ref_id: refId,
    wildcards: wc, updated_at: new Date().toISOString(), season,
  }, { onConflict: 'user_id,matchweek,season' });
  return !error;
}

async function loadMyFantasyPick(matchweek) {
  if (PREVIEW_MODE) return null;
  const { data: { session } } = await getSB().auth.getSession();
  if (!session) return null;
  const season = await getCurrentSeason();
  const { data } = await getSB().from('RTR Fantasy Picks')
    .select('ref_id, wildcards')
    .eq('user_id', session.user.id).eq('matchweek', matchweek).eq('season', season)
    .maybeSingle();
  return data;
}

async function loadMySeasonWildcards(currentMatchweek) {
  // Each GW users get a fresh wildcard — just return clean defaults
  return { yc: { active: false, matchId: null }, rc: { active: false, matchId: null }, var: { active: false, matchId: null } };
}

// ── MATCH STATS (admin overrides) ─────────────────────────
async function loadMatchStats() {
  if (PREVIEW_MODE) return [];
  const { data } = await getSB().from('RTR Match Stats').select('*');
  return data || [];
}

async function saveMatchStat(stat) {
  if (PREVIEW_MODE) return { ok: true, error: null };
  const { error } = await getSB().from('RTR Match Stats').upsert(stat, { onConflict: 'match_id' });
  if (error) console.error('[RTR] saveMatchStat error:', error);
  return { ok: !error, error };
}

async function saveGWConfig(gw, deadline, comp, season) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Config').upsert({ id: 1, gw, deadline, comp, season }, { onConflict: 'id' });
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
  const season = await getCurrentSeason();
  const { data } = await getSB().from('RTR Manual Bonuses').select('ref_id, pts, label').eq('season', season);
  if (!data?.length) return {};
  return data.reduce((acc, row) => {
    if (!acc[row.ref_id]) acc[row.ref_id] = [];
    acc[row.ref_id].push({ pts: row.pts, label: row.label });
    return acc;
  }, {});
}

async function loadManualBonuses(matchweek) {
  if (PREVIEW_MODE) return {};
  const season = await getCurrentSeason();
  const { data } = await getSB().from('RTR Manual Bonuses')
    .select('ref_id, pts, label')
    .eq('matchweek', matchweek).eq('season', season);
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
  const season = await getCurrentSeason();
  const { data: picks } = await getSB().from('RTR Fantasy Picks').select('user_id, ref_id, matchweek, wildcards, gw_pts').eq('season', season);
  if (!picks?.length) return [];
  const { data: profiles } = await getSB().from('RTR Profiles')
    .select('id, username, team, avatar_badge').in('id', picks.map(p => p.user_id));
  const pm = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  return picks.map(p => ({ ...p, profile: pm[p.user_id] || null }));
}

async function saveGWPointsBatch(results) {
  // results: [{ user_id, matchweek, gw_pts }]
  // Uses individual updates so only gw_pts is written — existing pick/wildcards are untouched.
  if (PREVIEW_MODE || !results.length) return true;
  const sb = getSB();
  const season = await getCurrentSeason();
  const updates = results.map(r =>
    sb.from('RTR Fantasy Picks')
      .update({ gw_pts: r.gw_pts })
      .eq('user_id', r.user_id)
      .eq('matchweek', r.matchweek)
      .eq('season', season)
  );
  const settled = await Promise.all(updates);
  const failed = settled.filter(r => r.error);
  if (failed.length) console.error('[RTR] saveGWPointsBatch errors:', failed.map(r => r.error));
  return failed.length === 0;
}

async function saveManualBonus(matchweek, refId, pts, label) {
  if (PREVIEW_MODE) return true;
  const season = await getCurrentSeason();
  const { error } = await getSB().from('RTR Manual Bonuses').insert({
    matchweek, ref_id: refId, pts, label, season,
  });
  return !error;
}

async function deleteManualBonus(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Manual Bonuses').delete().eq('id', id);
  return !error;
}

async function loadGWConfig() {
  if (PREVIEW_MODE) return { gw: 38, comp: 'PL', season: '2025', deadline: new Date(Date.now() + 86400000).toISOString(), deadlinePassed: false, status: 'upcoming' };
  const { data } = await getSB().from('RTR Config').select('gw,deadline,status,comp,season').eq('id', 1).single();
  if (!data) return null;
  return {
    gw: data.gw,
    comp: data.comp || 'PL',
    season: data.season || '2025',
    deadline: data.deadline,
    deadlinePassed: new Date() > new Date(data.deadline),
    status: data.status || 'upcoming'
  };
}

// Current voting/forum season, read once from RTR Config and cached — this is
// what new votes, incidents, and forum posts get stamped with (see
// season-archiving-setup.sql for the tables this applies to).
let _currentSeasonCache = null;
async function getCurrentSeason() {
  if (_currentSeasonCache) return _currentSeasonCache;
  const cfg = await loadGWConfig();
  _currentSeasonCache = cfg?.season || '2026';
  return _currentSeasonCache;
}

// ── HOMEPAGE CONTENT (index.html articles/cards) ───────────
// Used by index.html (to display) and admin.html (to edit).
// Falls back to these defaults until an admin saves real content.
const HOME_CONTENT_DEFAULTS = {
  hero: {
    visible: true,
    tagText: 'Live Now',
    headline: `Arsenal 2‑1 Chelsea: Oliver waves away second‑half penalty shout`,
    dek: `Community reaction splits down the middle after a VAR check inside the box goes uncorrected. Cast your rating before full time.`,
    metaMinute: `76'`, metaRef: `Michael Oliver`, metaVenue: `Emirates Stadium`,
    link: 'matches.html', articleId: null,
    media: { type: 'css', variant: 'pitch' }
  },
  rail: [
    { visible: true, tagColor: 'red',   tagText: 'Flashpoint', headline: `Two reds in four minutes at Molineux — was Attwell right both times?`, sub: `1.2k ratings so far`, link: 'matches.html', articleId: null, media: { type: 'css', variant: 'card-red' } },
    { visible: true, tagColor: 'gold',  tagText: 'Ratings',     headline: `This week's top‑scored referee: fans and neutrals finally agree`, sub: `Community leaderboard`, link: 'referees.html', articleId: null, media: { type: 'css', variant: 'card-yellow' } },
    { visible: true, tagColor: 'green', tagText: 'Matches',     headline: `Every Saturday 3pm kick‑off and who's the man in the middle`, sub: `Full fixture list`, subIsGwSub: true, link: 'matches.html', articleId: null, media: { type: 'css', variant: 'stadium' } }
  ],
  news: [
    { visible: true, tag: 'incident', tagText: 'VAR Review',    headline: `Simon Hooper overturns his own call after four‑minute pitchside review`, dek: `A breakdown of the angle that changed the on‑field decision at St James' Park.`, metaLeft: 'GW14',    metaRight: '842 votes',   link: 'matches.html',  articleId: null, media: { type: 'css', variant: 'var' } },
    { visible: true, tag: 'match',    tagText: 'Match Report',  headline: `Three penalty shouts, one booking: how Craig Pawson handled Villa Park`, dek: `Neutral raters gave a 7.8 average — fans of the home side disagreed sharply.`, metaLeft: 'GW13', metaRight: '1.1k votes', link: 'matches.html',  articleId: null, media: { type: 'css', variant: 'pitch' } },
    { visible: true, tag: 'forum',    tagText: 'Fan Voices',    headline: `"He got both big calls right" — the thread defending Sunday's officiating`, dek: `Top comments from the Forum after a week of heated GW13 debate.`, metaLeft: 'Forum', metaRight: '236 replies', link: 'forum.html',   articleId: null, media: { type: 'css', variant: 'crowd' } },
    { visible: true, tag: 'rating',   tagText: 'Referee Focus', headline: `Referee Focus: Anthony Taylor's advantage‑play is quietly the league's best`, dek: `A season‑long look at why raters keep marking him above the neutral average.`, metaLeft: 'Feature', metaRight: '512 votes', link: 'referees.html', articleId: null, media: { type: 'css', variant: 'locker' } },
    { visible: true, tag: 'incident', tagText: 'Flashpoint',    headline: `Second yellow inside 60 seconds of the restart — the full incident timeline`, dek: `Every angle of the Molineux flashpoint, minute by minute.`, metaLeft: 'GW14', metaRight: '2.3k votes', link: 'matches.html',  articleId: null, media: { type: 'css', variant: 'pitch' } },
    { visible: true, tag: 'fantasy',  tagText: 'PVBB',          headline: `PVBB Gameweek 14: the differential referee picks climbing the ranks`, dek: `Low‑ownership officials who could swing your fantasy table this week.`, metaLeft: 'Fantasy', metaRight: 'New', link: 'fantasy.html',  articleId: null, media: { type: 'css', variant: 'var' } }
  ],
  leaderboard: [
    { rank: 1, top: true,  name: 'Michael Oliver', games: '34 games', neutral: '8.4', fan: '7.9' },
    { rank: 2, top: true,  name: 'Anthony Taylor', games: '31 games', neutral: '8.2', fan: '7.6' },
    { rank: 3, top: true,  name: 'Paul Tierney',   games: '29 games', neutral: '8.0', fan: '7.8' },
    { rank: 4, top: false, name: 'Craig Pawson',   games: '27 games', neutral: '7.7', fan: '7.2' },
    { rank: 5, top: false, name: 'Simon Hooper',   games: '25 games', neutral: '7.3', fan: '6.4' }
  ],
  fixtures: [
    { status: `76'`, live: true, home: 'Arsenal',   homeScore: '2', away: 'Chelsea',  awayScore: '1', ref: 'M. Oliver' },
    { status: 'FT',               home: 'Everton',   homeScore: '0', away: 'Man City', awayScore: '3', ref: 'A. Taylor' },
    { status: 'FT',               home: 'Wolves',    homeScore: '1', away: 'Brighton', awayScore: '1', ref: 'S. Attwell' },
    { status: 'Sat 15:00',        home: 'Newcastle', homeScore: '–', away: 'Spurs',    awayScore: '–', ref: 'C. Pawson' },
    { status: 'Sun 14:00',        home: 'Liverpool', homeScore: '–', away: 'Man Utd',  awayScore: '–', ref: 'P. Tierney' },
    { status: 'Sun 16:30',        home: 'Villa',      homeScore: '–', away: 'West Ham', awayScore: '–', ref: 'D. Coote' }
  ],
  pvbb: {
    headline: 'Your GW14 pick',
    sub: 'Score points when your chosen referee out‑rates the community average.',
    avatarInitials: 'MO', pickName: 'Michael Oliver', pickPts: 'Projected +12 pts', link: 'fantasy.html'
  },
  highlights: [
    { visible: true, tag: 'Key Moment', title: 'The penalty shout, every angle', link: 'matches.html', articleId: null, media: { type: 'css', variant: 'fill-1' } },
    { visible: true, tag: 'Forum Clip',  title: 'Fans react courtside',           link: 'forum.html',   articleId: null, media: { type: 'css', variant: 'fill-2' } },
    { visible: true, tag: 'VAR',         title: 'Pitchside monitor review',       link: 'matches.html', articleId: null, media: { type: 'css', variant: 'fill-3' } },
    { visible: true, tag: 'Card Watch',  title: 'Second yellow breakdown',        link: 'matches.html', articleId: null, media: { type: 'css', variant: 'fill-4' } }
  ]
};

async function loadHomeContent() {
  if (PREVIEW_MODE) return null;
  const { data, error } = await getSB().from('RTR Home Content').select('content').eq('id', 1).single();
  if (error || !data) return null;
  return data.content || null;
}

async function saveHomeContent(content) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Home Content').upsert({ id: 1, content }, { onConflict: 'id' });
  if (error) console.error('[RTR] saveHomeContent error:', error);
  return !error;
}

// ── ARTICLES (full "click a headline, read the story" pages) ──
async function loadArticles() {
  if (PREVIEW_MODE) return [];
  const { data, error } = await getSB().from('RTR Articles').select('*').order('published_at', { ascending: false });
  if (error) { console.error('[RTR] loadArticles error:', error); return []; }
  return data || [];
}

async function loadArticle(id) {
  if (PREVIEW_MODE) return null;
  const { data, error } = await getSB().from('RTR Articles').select('*').eq('id', id).single();
  if (error) { console.error('[RTR] loadArticle error:', error); return null; }
  return data;
}

async function saveArticle(article) {
  if (PREVIEW_MODE) return true;
  const row = { ...article, updated_at: new Date().toISOString() };
  const { data, error } = await getSB().from('RTR Articles').upsert(row).select().single();
  if (error) { console.error('[RTR] saveArticle error:', error); return null; }
  return data;
}

async function deleteArticle(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Articles').delete().eq('id', id);
  if (error) console.error('[RTR] deleteArticle error:', error);
  return !error;
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
const INCIDENT_DECAY = 0.75; // each additional incident carries 75% of the previous one's impact

// Compute incident-driven score starting from 10.
// Returns null if no decisions have cleared the vote threshold yet.
// The worst-voted decision is weighted at full strength; each subsequent one decays by INCIDENT_DECAY.
// incidents: [{ id, weight }]
// votes: { [incidentId]: { correct: N, wrong: N } }
function calcIncidentScore(incidents, votes) {
  if (!incidents.length) return null;

  // collect qualified incidents with their wrong ratio
  const qualified = [];
  incidents.forEach(inc => {
    const v = votes[inc.id];
    if (!v) return;
    const total = v.correct + v.wrong;
    if (total * VOTE_MULTIPLIER < MIN_VOTES) return;
    qualified.push({ inc, wrongRatio: v.wrong / total });
  });

  if (!qualified.length) return null;

  // worst decision first so it takes the full-weight hit
  qualified.sort((a, b) => b.wrongRatio - a.wrongRatio);

  let score = 10.0;
  let decay = 1.0;
  qualified.forEach(({ inc, wrongRatio }) => {
    score -= inc.weight * wrongRatio * decay;
    decay *= INCIDENT_DECAY;
  });

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
  const data = await fetchAllRows(() => getSB().from('RTR Incident Votes')
    .select('incident_id, vote, is_fan, weight')
    .in('incident_id', incidentIds));
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

// General rating categories (same list as GENERAL_INCIDENTS in matches.html)
const GENERAL_CATEGORIES = [
  { id: 'gen-player-mgmt',    weight: 1 },
  { id: 'gen-consistency',    weight: 1 },
  { id: 'gen-time-wasting',   weight: 1 },
  { id: 'gen-play-advantage', weight: 1 },
];

async function saveGeneralVote(matchId, category, userId, vote, isFan, weight = 5) {
  if (PREVIEW_MODE) return true;
  const season = await getCurrentSeason();
  const { error } = await getSB().from('RTR General Votes')
    .upsert(
      { match_id: matchId, category, user_id: userId, vote, is_fan: !!isFan, weight, season },
      { onConflict: 'match_id,category,user_id' }
    );
  if (error) console.error('[RTR] saveGeneralVote error:', error);
  return !error;
}

async function loadMyGeneralVotes(matchId, userId) {
  if (!userId || PREVIEW_MODE) return {};
  const { data } = await getSB().from('RTR General Votes')
    .select('category, vote')
    .eq('match_id', matchId)
    .eq('user_id', userId);
  const map = {};
  (data || []).forEach(v => { map[v.category] = v.vote; });
  return map;
}

// Returns { neutral: { category: { correct, wrong } }, fan: { category: { correct, wrong } } }
// bad→wrong, good/excellent→correct — same fan/neutral split as incident votes
async function loadGeneralVotesAggregate(matchId) {
  if (PREVIEW_MODE) return { neutral: {}, fan: {} };
  const { data } = await getSB().from('RTR General Votes')
    .select('category, vote, is_fan, weight')
    .eq('match_id', matchId);
  const result = { neutral: {}, fan: {} };
  (data || []).forEach(v => {
    const bucket = v.is_fan ? result.fan : result.neutral;
    if (!bucket[v.category]) bucket[v.category] = { correct: 0, wrong: 0 };
    if (v.vote === 'bad') bucket[v.category].wrong  += v.weight || 1;
    else                  bucket[v.category].correct += v.weight || 1;
  });
  return result;
}

// One vote per incident per user — admins are exempt and can cast repeated
// votes (useful for QA). For everyone else, a re-vote (including switching
// Correct↔Wrong) updates their existing row instead of inserting a new
// one. This is also enforced at the DB level (see
// supabase/one-vote-per-incident-setup.sql) since this check alone is
// bypassable via a direct API call — that trigger is the real backstop.
async function saveIncidentVote(incidentId, userId, vote, isFan, weight = 5, isAdminVote = false) {
  if (PREVIEW_MODE) return true;
  const season = await getCurrentSeason();
  if (!isAdminVote) {
    const { data: existing } = await getSB().from('RTR Incident Votes')
      .select('id').eq('incident_id', incidentId).eq('user_id', userId).limit(1).maybeSingle();
    if (existing) {
      const { error } = await getSB().from('RTR Incident Votes')
        .update({ vote, is_fan: !!isFan, weight, season, created_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) console.error('[RTR] saveIncidentVote update error:', error);
      return !error;
    }
  }
  const { error } = await getSB().from('RTR Incident Votes').insert({
    incident_id: incidentId, user_id: userId, vote, is_fan: !!isFan,
    weight, season, created_at: new Date().toISOString()
  });
  if (error) console.error('[RTR] saveIncidentVote error:', error);
  return !error;
}

async function saveIncident(matchId, type, minute, description) {
  if (PREVIEW_MODE) return null;
  const weight = INCIDENT_TYPES.find(t => t.type === type)?.weight ?? 0.5;
  const season = await getCurrentSeason();
  const { data, error } = await getSB().from('RTR Incidents').insert({
    match_id: matchId, type, minute: minute !== null ? +minute : null, description: description || null, weight, season
  }).select().single();
  if (error) console.error('[RTR] saveIncident error:', error);
  return data || null;
}

// Populates ref.neutralRating, ref.fanRating, ref.neutralVotes, ref.fanVotes
// from the incident voting tables. Called on any page that shows ref scores.
// matchIds: optional array of match IDs to scope scores to (e.g. current GW only).
// When omitted, scores accumulate across all matchweeks of the current season
// (used by referees page) — last season's votes stay in the tables but don't
// count towards live ratings once a new season is set in RTR Config.
// PostgREST caps any single response at 1000 rows by default. A query with
// no explicit range only ever sees the first 1000 rows the database happens
// to return — for a heavily-voted incident that can silently starve every
// other incident's votes out of the response with no error. This pages
// through .range() until a page comes back short, so it always fetches
// everything that actually matches, however many rows that is.
async function fetchAllRows(buildQuery) {
  const PAGE = 1000;
  let from = 0, all = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) { console.warn('[RTR] fetchAllRows error:', error); break; }
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function loadIncidentRatings(matchIds) {
  if (PREVIEW_MODE) return;
  const matchIdSet = matchIds ? new Set(matchIds.map(Number)) : null;
  const season = await getCurrentSeason();

  const [incidents, genVotes] = await Promise.all([
    fetchAllRows(() => getSB().from('RTR Incidents').select('id, match_id, type, weight').eq('season', season)),
    fetchAllRows(() => getSB().from('RTR General Votes').select('match_id, category, vote, is_fan, weight').eq('season', season)),
  ]);
  if (!incidents?.length && !genVotes?.length) return;

  const scopedIncidents = matchIdSet
    ? (incidents||[]).filter(i => matchIdSet.has(Number(i.match_id)))
    : (incidents||[]);

  const ids = scopedIncidents.map(i => i.id);
  const votes = ids.length
    ? await fetchAllRows(() => getSB().from('RTR Incident Votes').select('incident_id, vote, is_fan, weight').eq('season', season).in('incident_id', ids))
    : [];

  const byMatch = {};
  scopedIncidents.forEach(inc => {
    if (!byMatch[inc.match_id]) byMatch[inc.match_id] = [];
    byMatch[inc.match_id].push(inc);
  });

  const neutral = {}, fan = {};
  ids.forEach(id => { neutral[id] = { correct:0, wrong:0 }; fan[id] = { correct:0, wrong:0 }; });
  (votes||[]).forEach(v => {
    const b = v.is_fan ? fan : neutral;
    if (b[v.incident_id]) b[v.incident_id][v.vote] += v.weight || 1;
  });

  // Aggregate general votes per match per category, split by fan/neutral — bad→wrong, good/excellent→correct
  const genByMatch = {};
  (genVotes||[]).forEach(v => {
    const mid = Number(v.match_id);
    if (matchIdSet && !matchIdSet.has(mid)) return;
    if (!genByMatch[mid]) genByMatch[mid] = { neutral: {}, fan: {} };
    const bucket = v.is_fan ? genByMatch[mid].fan : genByMatch[mid].neutral;
    if (!bucket[v.category]) bucket[v.category] = { correct:0, wrong:0 };
    if (v.vote === 'bad') bucket[v.category].wrong  += v.weight || 1;
    else                  bucket[v.category].correct += v.weight || 1;
  });

  REFS.forEach(r => { r.neutralRating=null; r.neutralVotes=0; r.fanRating=null; r.fanVotes=0; });
  const refNeutral = {}, refFan = {};
  MATCHES.forEach(m => {
    if (matchIdSet && !matchIdSet.has(Number(m.id))) return;
    const ref = REFS.find(r => r.id === +m.refId);
    if (!ref) return;
    if (!refNeutral[ref.id]) refNeutral[ref.id] = [];
    if (!refFan[ref.id])     refFan[ref.id]     = [];

    // Specific incidents
    (byMatch[m.id]||[]).forEach(inc => {
      const nv = neutral[inc.id] || { correct:0, wrong:0 };
      const fv = fan[inc.id]     || { correct:0, wrong:0 };
      if (nv.correct + nv.wrong) refNeutral[ref.id].push({ ...inc, _v: nv });
      if (fv.correct + fv.wrong) refFan[ref.id].push({ ...inc, _v: fv });
    });

    // General rating categories — split into correct neutral/fan buckets
    const gen = genByMatch[m.id] || { neutral: {}, fan: {} };
    GENERAL_CATEGORIES.forEach(cat => {
      const synInc = { id: cat.id, match_id: m.id, type: cat.id, weight: cat.weight };
      const nv = gen.neutral[cat.id];
      const fv = gen.fan[cat.id];
      if (nv && nv.correct + nv.wrong > 0) refNeutral[ref.id].push({ ...synInc, _v: nv });
      if (fv && fv.correct + fv.wrong > 0) refFan[ref.id].push({ ...synInc, _v: fv });
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

// Find an existing "game" forum thread for a given match title, scoped to the
// current season — fixture names repeat every season (e.g. "Arsenal vs
// Chelsea"), so without this a new discussion could attach as a reply to
// last season's thread of the same name.
async function findMatchForumThread(matchTitle) {
  if (PREVIEW_MODE) return null;
  // Normalise separator — admin uses "vs", older match chat used "v"
  const normalised = matchTitle.replace(/ v /g, ' vs ');
  const season = await getCurrentSeason();
  const { data } = await getSB().from('RTR Forum')
    .select('id, subject, matchweek')
    .eq('category', 'game')
    .is('reply_to', null)
    .eq('subject', normalised)
    .eq('season', season)
    .limit(1)
    .maybeSingle();
  return data || null;
}

// Post a comment to a match's forum thread, creating the thread if it doesn't exist yet
async function postMatchComment(matchTitle, body, userId, username, matchweek) {
  if (PREVIEW_MODE || !userId) return null;
  const sb = getSB();
  const season = await getCurrentSeason();
  const normTitle = matchTitle.replace(/ v /g, ' vs ');
  let thread = await findMatchForumThread(normTitle);
  if (!thread) {
    const { data, error } = await sb.from('RTR Forum').insert({
      user_id: userId,
      username,
      category: 'game',
      subject: normTitle,
      body,
      reply_to: null,
      matchweek: matchweek || null,
      season,
      created_at: new Date().toISOString(),
    }).select('id').single();
    if (error) { console.error('[RTR] postMatchComment create thread error:', error); return null; }
    processMentions(body, data.id, { id: userId, username }).catch(() => {});
    return data;
  }
  // Thread exists — add as a reply
  const { data, error } = await sb.from('RTR Forum').insert({
    user_id: userId,
    username,
    category: 'game',
    subject: normTitle,
    body,
    reply_to: thread.id,
    matchweek: thread.matchweek || matchweek || null,
    season,
    created_at: new Date().toISOString(),
  }).select('id').single();
  if (error) { console.error('[RTR] postMatchComment reply error:', error); return null; }
  processMentions(body, thread.id, { id: userId, username }).catch(() => {});
  return data;
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
    .select('id, username, team, avatar_badge').in('id', picks.map(p => p.user_id));
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
  {name:"Arsenal",               emoji:"🔴"},
  {name:"Aston Villa",           emoji:"🟣"},
  {name:"Bournemouth",           emoji:"⚫"},
  {name:"Brentford",             emoji:"🔴"},
  {name:"Brighton",              emoji:"🔵"},
  {name:"Burnley",               emoji:"🟣"},
  {name:"Chelsea",               emoji:"🔵"},
  {name:"Crystal Palace",        emoji:"🔴"},
  {name:"Everton",               emoji:"🔵"},
  {name:"Fulham",                emoji:"⚪"},
  {name:"Leeds United",          emoji:"⚪"},
  {name:"Liverpool",             emoji:"🔴"},
  {name:"Manchester City",       emoji:"🩵"},
  {name:"Manchester United",     emoji:"🔴"},
  {name:"Newcastle United",      emoji:"⚫"},
  {name:"Nottingham Forest",     emoji:"🔴"},
  {name:"Sunderland",            emoji:"🔴"},
  {name:"Tottenham Hotspur",     emoji:"⚪"},
  {name:"West Ham United",       emoji:"🟣"},
  {name:"Wolverhampton",         emoji:"🟡"},
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
    const ko = new Date(String(m.kickoff).replace(' ', 'T')).getTime();
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
// Real enforcement is the is_admin column on RTR Profiles (checked by
// Postgres RLS via public.is_admin()) — this list is only a fallback for
// sessions cached in localStorage before that column existed.
const ADMIN_USERS = ['danawhiteware', 'jware89'];
function isAdmin(user) {
  const u = user || getCurrentUser();
  if (!u) return false;
  if (u.is_admin) return true;
  return ADMIN_USERS.includes(u.username?.toLowerCase());
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

// football-data.org's `shortName` (what fixtures' m.home/m.away are built
// from — see buildMatchesFromFD) doesn't always match the club's standard
// name used in the team picker (e.g. "Manchester United" vs "Man United").
// Only the 6 current PL clubs where they actually diverge need an entry —
// everything else already matches as-is.
const TEAM_API_ALIASES = {
  "Brighton & Hove Albion": "Brighton Hove",
  "Manchester City":        "Man City",
  "Manchester United":      "Man United",
  "Newcastle United":       "Newcastle",
  "Nottingham Forest":      "Nottingham",
  "Tottenham Hotspur":      "Tottenham",
};
function fixtureTeamName(team) {
  return TEAM_API_ALIASES[team] || team;
}

function isFanMatch(m, user) {
  if (!user?.team) return false;
  const t = fixtureTeamName(user.team);
  return m.home === t || m.away === t;
}
function isBiasedVote(mid, user) {
  const m = gMatch(mid);
  if (!user?.team) return false;
  const t = fixtureTeamName(user.team);
  return m.home === t || m.away === t;
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

function refAvatarHtml(ref, size = 28) {
  if (ref?.photo_url) {
    return `<img src="${ref.photo_url}" alt="${ref.initials||''}" style="width:100%;height:100%;object-fit:cover;object-position:top center;" onerror="this.outerHTML='${ref.initials||''}'">`;
  }
  return ref?.initials || '';
}

function mapRef(r) {
  return {
    id: r.id, name: r.name, initials: r.initials,
    nationality: r.nationality || '', age: r.age || 0,
    fifaListed: r.fifa_listed ? 'Yes' : 'No', notes: r.notes || '',
    games: r.overall_apps || 0, neutralRating: null, neutralVotes: 0, fanRating: null, fanVotes: 0,
    photo_url: r.photo_url || null, hero_photo_url: r.hero_photo_url || null, bio: r.bio || null,
    hero_photo_position: r.hero_photo_position || null,
    overall_apps: r.overall_apps || null, overall_fouls_pg: r.overall_fouls_pg || null,
    overall_fouls_tackles: r.overall_fouls_tackles || null, overall_pen_pg: r.overall_pen_pg || null,
    overall_yel_pg: r.overall_yel_pg || null, overall_yel: r.overall_yel || null,
    overall_red_pg: r.overall_red_pg || null, overall_red: r.overall_red || null,
    home_apps: r.home_apps || null, home_fouls_pg: r.home_fouls_pg || null,
    home_fouls_tackles: r.home_fouls_tackles || null, home_pen_pg: r.home_pen_pg || null,
    home_yel_pg: r.home_yel_pg || null, home_yel: r.home_yel || null,
    home_red_pg: r.home_red_pg || null, home_red: r.home_red || null,
    away_apps: r.away_apps || null, away_fouls_pg: r.away_fouls_pg || null,
    away_fouls_tackles: r.away_fouls_tackles || null, away_pen_pg: r.away_pen_pg || null,
    away_yel_pg: r.away_yel_pg || null, away_yel: r.away_yel || null,
    away_red_pg: r.away_red_pg || null, away_red: r.away_red || null,
  };
}

// Used by referees.html — loads all historical data from Supabase only (no API)
async function loadRefsPageData() {
  try {
    const { data: refs, error: refsErr } = await getSB().from('RTR Referees').select('*');
    console.log('[RTR] RTR Referees query → data:', refs?.length, 'error:', refsErr);
    if (refs?.length) { REFS = refs.map(mapRef); }
  } catch(e) { console.warn('[RTR] REFS load failed:', e); }

  await loadFixtures();

  try {
    const stats = await loadMatchStats();
    if (stats.length) {
      // Apply overlay to MATCHES for the entries that match Supabase fixture IDs
      const om = Object.fromEntries(stats.map(o => [+o.match_id, o]));
      MATCHES = MATCHES.map(m => {
        const o = om[+m.id]; if (!o) return m;
        return { ...m,
          score: o.score ?? m.score, status: o.status ?? m.status,
          yc: o.yellow_cards ?? m.yc, rc: o.red_cards ?? m.rc,
          pen: o.penalties_given ?? m.pen, var: o.var_decisions ?? m.var,
          homeYC: o.home_yc ?? m.homeYC ?? null, awayYC: o.away_yc ?? m.awayYC ?? null,
          homeRC: o.home_rc ?? m.homeRC ?? null, awayRC: o.away_rc ?? m.awayRC ?? null,
          homePen: o.home_pen ?? m.homePen ?? null, awayPen: o.away_pen ?? m.awayPen ?? null,
          perfectGame: o.perfect_game ?? m.perfectGame,
          incorrectVarPen: o.incorrect_var_pen ?? m.incorrectVarPen,
          incorrectVarRed: o.incorrect_var_red ?? m.incorrectVarRed,
          refId: o.ref_id ?? m.refId,
          highlightVideoId: o.highlight_video_id ?? m.highlightVideoId,
          varVideoId: o.var_video_id ?? m.varVideoId,
        };
      });
      // Build fixture → ref lookup from loaded fixtures
      const fixtureRefMap = {};
      MATCHES.forEach(m => { if (m.refId) fixtureRefMap[+m.id] = m.refId; });

      // Join: RTR Match Stats.match_id → RTR Fixtures.id → RTR Fixtures.ref_id
      const agg = {};
      const refMatchHistory = {};
      const fixtureMap = Object.fromEntries(MATCHES.map(m => [+m.id, m]));
      stats.forEach(s => {
        const refId = fixtureRefMap[+s.match_id];
        if (!refId) return;
        if (!agg[refId]) agg[refId] = { yc:0, rc:0, pen:0, var:0, games:0 };
        agg[refId].yc   += s.yellow_cards   || 0;
        agg[refId].rc   += s.red_cards       || 0;
        agg[refId].pen  += s.penalties_given || 0;
        agg[refId].var  += s.var_decisions   || 0;
        agg[refId].games++;
        if (!refMatchHistory[refId]) refMatchHistory[refId] = [];
        const fix = fixtureMap[+s.match_id];
        refMatchHistory[refId].push({
          matchweek: fix?.matchweek || 0,
          home: fix?.home || '', away: fix?.away || '',
          yc: s.yellow_cards || 0, rc: s.red_cards || 0, pen: s.penalties_given || 0,
        });
      });
      REFS.forEach(r => {
        const s = agg[r.id]; if (!s) return;
        if (!r.overall_apps) r.games = s.games;
        r._yc   = s.yc;
        r._rc   = s.rc;
        r._pen  = s.pen;
        r._var  = s.var;
        const history = refMatchHistory[r.id] || [];
        r._last3 = history.sort((a,b) => b.matchweek - a.matchweek).slice(0, 3);
      });
    }
  } catch(e) { console.warn('[RTR] Stats overlay failed:', e); }

  // Fetch one GW from API to build team crest map, then apply to all MATCHES
  try {
    const gwCfg = await loadGWConfig();
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const url = isLocal
      ? `/api/fd-matches?matchday=${gwCfg?.gw||38}&season=${gwCfg?.season||'2025'}&comp=${gwCfg?.comp||'PL'}`
      : `/.netlify/functions/fd-matches?matchday=${gwCfg?.gw||38}&season=${gwCfg?.season||'2025'}&comp=${gwCfg?.comp||'PL'}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const crestMap = {};
      (data.matches || []).forEach(m => {
        [m.homeTeam, m.awayTeam].forEach(t => {
          if (!t?.crest) return;
          if (t.shortName) crestMap[t.shortName] = t.crest;
          if (t.name)      crestMap[t.name]      = t.crest;
        });
      });
      MATCHES = MATCHES.map(m => ({
        ...m,
        homeCrest: crestMap[m.home] || m.homeCrest || null,
        awayCrest: crestMap[m.away] || m.awayCrest || null,
      }));
    }
  } catch(e) {}
}

async function loadFromSheets() {
  // 1. REFS from Supabase RTR Referees table (non-fatal)
  try {
    const { data: refs } = await getSB().from('RTR Referees').select('*');
    if (refs?.length) { REFS = refs.map(mapRef); }
  } catch(e) {
    console.warn('[RTR] Supabase REFS load failed (non-fatal):', e);
  }

  // 2. Current GW + fixtures from API, with Supabase stats overlay
  try {
    const gwCfg = await loadGWConfig();
    const gw = gwCfg?.gw;
    if (!gw) { console.warn('[RTR] No GW config'); return false; }

    // API is the primary fixture source
    const fdMatches = await loadFromFootballData(gw, gwCfg.comp, gwCfg.season);
    if (fdMatches?.length) {
      buildMatchesFromFD(fdMatches);
      console.log('[RTR] Fixtures loaded from API:', MATCHES.length, 'matches for GW', gw);
    } else {
      console.warn('[RTR] API returned no matches for', gwCfg.comp, gwCfg.season, 'GW', gw);
      MATCHES = [];
    }

    // 3. Overlay Supabase match stats: cards, VAR, video IDs, manual score/ref overrides
    const overrides = await loadMatchStats();
    if (overrides.length) {
      const overrideMap = Object.fromEntries(overrides.map(o => [+o.match_id, o]));
      MATCHES = MATCHES.map(m => {
        const o = overrideMap[+m.id];
        if (!o) return m;
        const derivedStatus = o.status ?? m.status;
        return {
          ...m,
          score:            derivedStatus === 'live' ? m.score : (o.score ?? m.score),
          status:           derivedStatus,
          yc:               o.yellow_cards       ?? m.yc,
          rc:               o.red_cards          ?? m.rc,
          pen:              o.penalties_given    ?? m.pen,
          var:              o.var_decisions      ?? m.var,
          homeYC:           o.home_yc            ?? m.homeYC  ?? null,
          awayYC:           o.away_yc            ?? m.awayYC  ?? null,
          homeRC:           o.home_rc            ?? m.homeRC  ?? null,
          awayRC:           o.away_rc            ?? m.awayRC  ?? null,
          homePen:          o.home_pen           ?? m.homePen ?? null,
          awayPen:          o.away_pen           ?? m.awayPen ?? null,
          perfectGame:      o.perfect_game       ?? m.perfectGame,
          incorrectVarPen:  o.incorrect_var_pen  ?? m.incorrectVarPen,
          incorrectVarRed:  o.incorrect_var_red  ?? m.incorrectVarRed,
          refId:            o.ref_id             ?? m.refId,
          highlightVideoId: o.highlight_video_id ?? m.highlightVideoId,
          varVideoId:       o.var_video_id       ?? m.varVideoId,
        };
      });
    }

    console.log('[RTR] Load complete. MATCHES:', MATCHES.length, 'REFS:', REFS.length);
    return true;
  } catch(e) {
    console.error('[RTR] Data load failed:', e);
    return false;
  }
}

// ── AUTO FIXTURES (from Supabase, populated by Edge Function) ─
async function loadFixtures() {
  try {
    const season = await getCurrentSeason();
    const { data } = await getSB().from('RTR Fixtures').select('*').eq('season', season);
    if (!data?.length) return;
    const existing = new Set(MATCHES.map(m => `${m.home}|${m.away}|${m.matchweek}`));
    data.forEach(f => {
      const key = `${f.home}|${f.away}|${f.matchweek}`;
      if (existing.has(key)) {
        // Already in Sheets — but merge ref_id if the fixture has one assigned
        if (f.ref_id) {
          const idx = MATCHES.findIndex(m =>
            m.home === f.home && m.away === f.away && +m.matchweek === +f.matchweek
          );
          if (idx !== -1 && !MATCHES[idx].refId) {
            MATCHES[idx] = { ...MATCHES[idx], refId: f.ref_id };
          }
        }
        return;
      }
      MATCHES.push({
        id:              f.id,
        matchweek:       +f.matchweek,
        home:            f.home,
        away:            f.away,
        hE:              f.home_emoji || '',
        aE:              f.away_emoji || '',
        kickoff:         f.kickoff,
        status:          f.status    || 'upcoming',
        score:           f.score     || '0-0',
        refId:           f.ref_id    || null,
        yc: 0, rc: 0, pen: 0, var: 0,
        perfectGame: false, incorrectVarPen: 0, incorrectVarRed: 0,
        highlightVideoId: null, varVideoId: null,
      });
      existing.add(key);
    });
    console.log('[RTR] Fixtures loaded from Supabase:', data.length, 'total MATCHES:', MATCHES.length);
  } catch (e) {
    console.warn('[RTR] loadFixtures failed:', e);
  }
}

// ── SHARED CSS VARIABLES (injected into each page) ────────
const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap');
  :root{--bg:#f6f0ff;--surface:#ffffff;--surface2:#ede6ff;--border:#cfc0ee;--accent2:#f5a623;--red:#e02d42;--yellow:#d4920a;--green:#009960;--text:#6a58a0;--muted:#6a58a0;--pl-purple:#37003c;--pl-green:#00cc70;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:var(--bg);color:var(--text);font-family:'Barlow',sans-serif;min-height:100vh;}
  /* Header */
  header{background:linear-gradient(135deg,#37003c 0%,#5a1070 60%,#3d0855 100%);border-bottom:2px solid var(--pl-green);padding:0 24px;position:sticky;top:0;z-index:100;box-shadow:0 4px 32px rgba(0,204,112,.2);overflow:visible;}
  header::after{content:'';position:absolute;left:0;right:0;bottom:-48px;height:48px;background:linear-gradient(to bottom,rgba(61,8,85,.55) 0%,rgba(61,8,85,.15) 50%,transparent 100%);pointer-events:none;z-index:99;}
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
  .mobile-nav{display:none;position:fixed;top:60px;left:0;right:0;background:linear-gradient(135deg,#37003c 0%,#1a0020 100%);border-bottom:2px solid var(--pl-green);z-index:300;padding:12px 16px;flex-direction:column;gap:4px;}
  .mobile-nav a{color:var(--muted);font-family:'Barlow Condensed',sans-serif;font-size:1rem;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding:10px 14px;border-radius:6px;text-decoration:none;display:block;border:1px solid transparent;}
  .mobile-nav a.active,.mobile-nav a:hover{background:rgba(0,255,133,.1);border-color:var(--pl-green);color:var(--pl-green);}
  .mobile-nav.open{display:flex;}
  .ll-bar{position:absolute;top:0;height:4px;width:36px;background:var(--pl-green);border-radius:0 0 3px 3px;box-shadow:0 0 14px rgba(0,204,112,.9),0 0 5px rgba(0,255,133,.6);z-index:3;pointer-events:none;transition:left .32s cubic-bezier(.4,0,.2,1);}
  .ll-beam{position:absolute;left:-38%;top:4px;width:176%;height:36px;clip-path:polygon(5% 100%,22% 0,78% 0,95% 100%);background:linear-gradient(180deg,rgba(0,204,112,.3) 0%,transparent 100%);pointer-events:none;}
  @media(max-width:768px){
    .hamburger{display:flex;}
    nav{display:none;}
    .uc-name{display:none;}
    .header-inner{padding:0;}
    header{padding:0 16px;}
  }
  /* ── DARK MODE ──────────────────────────────────────── */
  html[data-theme="dark"]{--bg:#0a0c10;--surface:#12151c;--surface2:#1a1e28;--border:rgba(255,255,255,.09);--red:#ff4757;--yellow:#ffd32a;--green:#37ecba;--text:#e8eaf0;--muted:#6b7280;--pl-green:#00ff85;--gold:#f5a623;}
  html[data-theme="dark"] header{background:linear-gradient(135deg,#37003c 0%,#1a0020 60%,#0a0c10 100%);box-shadow:0 4px 32px rgba(0,255,133,.12);}
  html[data-theme="dark"] header::after{background:linear-gradient(to bottom,rgba(0,0,0,.55) 0%,transparent 100%);}
  html[data-theme="dark"] .mobile-nav{background:linear-gradient(135deg,#37003c 0%,#1a0020 100%);}
  html[data-theme="dark"] .gw-banner{background:linear-gradient(90deg,rgba(55,0,60,.9),rgba(10,12,16,1)) !important;}
  html[data-theme="dark"] body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse 70% 50% at 20% 30%,rgba(55,0,60,.45) 0%,transparent 70%),radial-gradient(ellipse 60% 60% at 80% 70%,rgba(80,0,90,.3) 0%,transparent 65%) !important;}
  /* ── DIAGONAL LOGO WATERMARK ── */
  body::after{content:'';position:fixed;top:-50%;left:-50%;width:200%;height:200%;background-image:url(images/logos/RRLogo.svg);background-repeat:repeat;background-size:140px auto;transform:rotate(-28deg);opacity:0.045;pointer-events:none;z-index:-1;}
  html:not([data-theme="dark"]) body::after{filter:brightness(0.35);opacity:0.12;}
  html[data-theme="dark"] .match-card,
  html[data-theme="dark"] .rpc,
  html[data-theme="dark"] .rpc-stat-pill,
  html[data-theme="dark"] .post-card,
  html[data-theme="dark"] .ref-disc-card,
  html[data-theme="dark"] .reply-card,
  html[data-theme="dark"] .badge-card,
  html[data-theme="dark"] .leaderboard,
  html[data-theme="dark"] .section,
  html[data-theme="dark"] .forum-sidebar,
  html[data-theme="dark"] .compose-box,
  html[data-theme="dark"] .video-box,
  html[data-theme="dark"] .live-strip,
  html[data-theme="dark"] .rating-panel,
  html[data-theme="dark"] .score-box,
  html[data-theme="dark"] .pvs-box,
  html[data-theme="dark"] .inc-card,
  html[data-theme="dark"] .inc-score-tile,
  html[data-theme="dark"] .heatmap-stat,
  html[data-theme="dark"] .bonus-row,
  html[data-theme="dark"] .bias-gap-row,
  html[data-theme="dark"] .auth-box,
  html[data-theme="dark"] .onboard-box,
  html[data-theme="dark"] .user-dropdown,
  html[data-theme="dark"] .rcard,
  html[data-theme="dark"] .recent-match-row,
  html[data-theme="dark"] .sel-match-info,
  html[data-theme="dark"] .team-tile,
  html[data-theme="dark"] .ref-disc-card{
    backdrop-filter:blur(14px);
    -webkit-backdrop-filter:blur(14px);
    border-color:rgba(255,255,255,.09);
    box-shadow:0 4px 24px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.06);
  }

  /* ── BADGE UNLOCK ANIMATION ─────────────────────────────── */
  .bu-backdrop{
    position:fixed;inset:0;z-index:9999;
    display:flex;align-items:flex-end;justify-content:center;
    padding-bottom:48px;
    pointer-events:none;
    animation:buBgIn .35s ease forwards;
  }
  .bu-backdrop.bu-out{animation:buBgOut .45s ease forwards;}
  @keyframes buBgIn{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,.55)}}
  @keyframes buBgOut{from{background:rgba(0,0,0,.55)}to{background:rgba(0,0,0,0)}}

  .bu-outer{
    pointer-events:auto;
    animation:buSlideUp .55s cubic-bezier(.22,1,.36,1) forwards;
  }
  .bu-outer.bu-out{animation:buSlideDown .4s cubic-bezier(.55,0,.78,0) forwards;}
  @keyframes buSlideUp{from{opacity:0;transform:translateY(120px) scale(.88)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes buSlideDown{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(80px) scale(.9)}}

  .bu-card{
    background:linear-gradient(145deg,#1a0030 0%,#0d0f14 60%,#1a1e28 100%);
    border:1.5px solid rgba(0,255,133,.45);
    border-radius:20px;
    padding:24px 28px 28px;
    text-align:center;
    min-width:280px;max-width:340px;
    position:relative;
    box-shadow:0 0 60px rgba(0,255,133,.18),0 24px 60px rgba(0,0,0,.7);
    transform-style:preserve-3d;
    will-change:transform;
    overflow:hidden;
  }
  .bu-card::before{
    content:'';position:absolute;inset:0;
    background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(0,255,133,.15) 0%,transparent 70%);
    pointer-events:none;
  }
  .bu-new-label{
    font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:.72rem;
    letter-spacing:.18em;text-transform:uppercase;color:var(--pl-green);
    background:rgba(0,255,133,.1);border:1px solid rgba(0,255,133,.3);
    border-radius:20px;padding:3px 12px;display:inline-block;margin-bottom:14px;
    animation:buBlink 1.4s ease-in-out infinite;
  }
  @keyframes buBlink{0%,100%{opacity:1}50%{opacity:.5}}
  .bu-icon-wrap{
    width:200px;height:230px;
    clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);
    background:linear-gradient(135deg,rgba(55,0,60,.8),rgba(0,255,133,.12));
    display:flex;align-items:center;justify-content:center;
    margin:0 auto 16px;
    font-size:2.6rem;line-height:1;
    animation:buGlowPulse 2s ease-in-out infinite;
    position:relative;z-index:2;
  }
  .bu-icon-wrap img{width:78%;height:78%;border-radius:0;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);object-fit:cover;}
  @keyframes buGlowPulse{0%,100%{filter:drop-shadow(0 0 0px rgba(0,255,133,.4))}50%{filter:drop-shadow(0 0 12px rgba(0,255,133,.7))}}
  .bu-title{
    font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:1.55rem;
    text-transform:uppercase;letter-spacing:.5px;color:#fff;margin-bottom:6px;
  }
  .bu-desc{font-size:.82rem;color:rgba(255,255,255,.6);line-height:1.55;margin-bottom:20px;}
  .bu-dismiss{
    font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.8rem;
    letter-spacing:.12em;text-transform:uppercase;
    color:rgba(0,255,133,.5);background:none;border:none;cursor:pointer;padding:4px 0;
    transition:color .15s;
  }
  .bu-dismiss:hover{color:var(--pl-green);}
  .bu-smoke{
    position:absolute;bottom:0;left:50%;transform:translateX(-50%);
    pointer-events:none;z-index:1;
  }
  .bu-particle{
    position:absolute;bottom:0;
    border-radius:50%;
    background:radial-gradient(circle,rgba(0,255,133,.55) 0%,rgba(0,255,133,0) 70%);
    animation:buSmokePuff var(--dur) ease-out var(--delay) forwards;
    opacity:0;
    pointer-events:none;
  }
  @keyframes buSmokePuff{
    0%  {opacity:.7;transform:translateX(var(--dx)) translateY(0)   scale(.4);}
    60% {opacity:.35;transform:translateX(calc(var(--dx)*1.4)) translateY(var(--rise)) scale(1.1);}
    100%{opacity:0; transform:translateX(calc(var(--dx)*1.8)) translateY(calc(var(--rise)*1.6)) scale(1.4);}
  }

  /* ── AVATAR CARD POPUP ───────────────────────────────────── */
  .rr-av-tip{cursor:pointer;display:inline-flex;}
  .rr-av-popup{
    position:fixed;z-index:8000;
    background:linear-gradient(145deg,#1a0030 0%,#0d0f14 70%);
    border:1.5px solid rgba(0,255,133,.35);
    border-radius:14px;
    padding:16px 18px 14px;
    min-width:200px;max-width:260px;
    box-shadow:0 8px 40px rgba(0,0,0,.7),0 0 0 1px rgba(0,255,133,.08);
    animation:avPopIn .18s cubic-bezier(.22,1,.36,1);
    pointer-events:auto;
  }
  @keyframes avPopIn{from{opacity:0;transform:scale(.88) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
  .rr-av-popup-icon{
    width:52px;height:60px;
    clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);
    background:linear-gradient(135deg,rgba(55,0,60,.8),rgba(0,255,133,.1));
    display:flex;align-items:center;justify-content:center;
    font-size:1.7rem;margin:0 auto 10px;
  }
  .rr-av-popup-icon img{width:78%;height:78%;border-radius:0;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);object-fit:cover;}
  .rr-av-popup-user{font-size:.7rem;color:rgba(0,255,133,.6);font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.12em;text-transform:uppercase;text-align:center;margin-bottom:6px;}
  .rr-av-popup-name{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:1.1rem;text-transform:uppercase;letter-spacing:.3px;color:#fff;text-align:center;margin-bottom:4px;}
  .rr-av-popup-cat{font-size:.65rem;color:rgba(0,255,133,.5);font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-align:center;margin-bottom:8px;}
  .rr-av-popup-desc{font-size:.78rem;color:rgba(255,255,255,.55);line-height:1.5;text-align:center;border-top:1px solid rgba(255,255,255,.07);padding-top:8px;}
  .rr-av-popup-close{position:absolute;top:8px;right:10px;background:none;border:none;color:rgba(255,255,255,.25);font-size:.85rem;cursor:pointer;padding:2px 4px;line-height:1;}
  .rr-av-popup-close:hover{color:rgba(255,255,255,.6);}

  /* ── CARD REACTIONS (yellow/red) ───────────────────────── */
  .rtr-reactions{display:flex;gap:6px;margin-top:8px;}
  .rtr-react-btn{
    display:inline-flex;align-items:center;gap:5px;
    background:rgba(120,120,140,.1);border:1px solid rgba(120,120,140,.25);
    border-radius:14px;padding:3px 10px;
    font-family:'Barlow',sans-serif;font-size:.78rem;font-weight:600;
    color:inherit;cursor:pointer;transition:all .15s;line-height:1.4;
  }
  .rtr-react-btn:hover{background:rgba(120,120,140,.2);}
  .rtr-react-btn:disabled{opacity:.5;cursor:not-allowed;}
  .rtr-react-btn.active[data-react="yellow"]{background:rgba(255,211,42,.18);border-color:#ffd32a;}
  .rtr-react-btn.active[data-react="red"]{background:rgba(255,71,87,.18);border-color:#ff4757;}

  /* ── NOTIFICATION BELL ──────────────────────────────────── */
  .notif-bell{position:relative;cursor:pointer;font-size:1.05rem;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;transition:background .15s;flex-shrink:0;}
  .notif-bell:hover{background:rgba(255,255,255,.08);}
  .notif-badge{position:absolute;top:1px;right:1px;background:#ff4757;color:#fff;font-size:.6rem;font-weight:800;min-width:15px;height:15px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 3px;font-family:'Barlow Condensed',sans-serif;}
  .notif-dropdown{position:absolute;top:calc(100% + 10px);right:0;width:300px;max-height:380px;overflow-y:auto;background:#1a0f22;border:1px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 18px 40px rgba(0,0,0,.5);display:none;z-index:250;}
  .notif-dropdown.open{display:block;}
  .notif-header{padding:12px 14px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.5);border-bottom:1px solid rgba(255,255,255,.1);}
  .notif-item{display:block;padding:10px 14px;text-decoration:none;color:#fff;border-bottom:1px solid rgba(255,255,255,.07);transition:background .12s;}
  .notif-item:last-child{border-bottom:none;}
  .notif-item:hover{background:rgba(255,255,255,.05);}
  .notif-item.unread{background:rgba(0,255,133,.08);}
  .notif-text{font-size:.82rem;margin-bottom:2px;}
  .notif-excerpt{font-size:.72rem;color:rgba(255,255,255,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .notif-empty{padding:20px 14px;text-align:center;font-size:.82rem;color:rgba(255,255,255,.4);}
`;
(function(){const s=document.createElement('style');s.textContent=SHARED_CSS;document.head.appendChild(s);})();

// ── AVATAR BADGE ─────────────────────────────────────────
function getAvatarBadge() {
  const s = localStorage.getItem(_AVATAR_KEY);
  return s ? JSON.parse(s) : null; // { key, icon }
}
function setAvatarBadge(data) {
  if (data) localStorage.setItem(_AVATAR_KEY, JSON.stringify(data));
  else localStorage.removeItem(_AVATAR_KEY);
  // Persist to DB profile so other users can see it in leaderboards
  const user = getCurrentUser();
  if (user?.id) {
    getSB().from('RTR Profiles')
      .update({ avatar_badge: data ? JSON.stringify(data) : null })
      .eq('id', user.id)
      .then(() => {});
  }
}

// Render a mini circular avatar for use in leaderboard rows
const SHIELD_PATH = 'polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%)';
function shieldBorderHtml(imgSrc, size, badgeKey) {
  const def = (typeof BADGE_DEFS !== 'undefined') ? BADGE_DEFS.find(b => b.key === badgeKey) : null;
  const borderBg = def?.bronze
    ? 'linear-gradient(160deg,#e8a84b,#cd7f32,#8b4513)'
    : def?.gold
      ? 'linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00)'
      : 'linear-gradient(135deg,rgba(0,255,133,.8),rgba(0,180,90,.5))';
  const bdr = 2;
  const h = Math.round(size * 1.15);
  const outerW = size + bdr * 2, outerH = h + bdr * 2;
  return `<div style="width:${outerW}px;height:${outerH}px;clip-path:${SHIELD_PATH};background:${borderBg};display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;vertical-align:middle;">` +
    `<img src="${imgSrc}" style="width:${size}px;height:${h}px;clip-path:${SHIELD_PATH};object-fit:cover;display:block;" alt=""></div>`;
}

// Escapes user-controlled text (usernames, team names, etc.) before it's
// interpolated into an innerHTML template literal. Any field a user can set
// via their own profile — not just what the UI form allows, since RLS only
// restricts *which row* they can write, not *what's in it* — must go
// through this before being shown to anyone else.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── @MENTIONS / NOTIFICATIONS ──────────────────────────────
// Finds @username tokens (letters/digits/underscore/hyphen only — this is
// the mention syntax's own constraint, not a restriction on what a
// username can actually contain) in a post/reply body, resolves each to a
// real profile by exact case-insensitive username match, and creates a
// notification row for anyone found (skipping unknown names and self-
// mentions). Call this after a post/reply insert succeeds.
async function processMentions(body, postId, fromUser) {
  if (PREVIEW_MODE || !fromUser || !body) return;
  const names = [...new Set((body.match(/@([a-zA-Z0-9_-]{2,30})/g) || []).map(m => m.slice(1)))];
  if (!names.length) return;
  for (const name of names) {
    try {
      const { data: profile } = await getSB().from('RTR Profiles').select('id,username').ilike('username', name).maybeSingle();
      if (!profile || profile.id === fromUser.id) continue;
      await getSB().from('RTR Notifications').insert({
        user_id: profile.id,
        from_user_id: fromUser.id,
        from_username: fromUser.username || 'User',
        post_id: postId,
        excerpt: body.length > 140 ? body.slice(0, 140) + '…' : body,
      });
    } catch (e) { console.warn('[RTR] processMentions failed for', name, e); }
  }
}

async function loadMyNotifications() {
  if (PREVIEW_MODE) return [];
  const user = getCurrentUser();
  if (!user) return [];
  const { data, error } = await getSB().from('RTR Notifications')
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(30);
  if (error) { console.warn('[RTR] loadMyNotifications error:', error); return []; }
  return data || [];
}

async function markNotificationsRead(ids) {
  if (PREVIEW_MODE || !ids?.length) return;
  await getSB().from('RTR Notifications').update({ read: true }).in('id', ids);
}

// ── REACTIONS (yellow/red card) ────────────────────────────
async function loadReactionCounts(postIds) {
  if (!postIds?.length) return {};
  const { data } = await getSB().from('RTR Reactions').select('post_id,type').in('post_id', postIds);
  const counts = {};
  (data || []).forEach(r => {
    if (!counts[r.post_id]) counts[r.post_id] = { yellow: 0, red: 0 };
    counts[r.post_id][r.type] = (counts[r.post_id][r.type] || 0) + 1;
  });
  return counts;
}

async function loadMyReactions(postIds) {
  const user = getCurrentUser();
  if (!postIds?.length || !user) return {};
  const { data } = await getSB().from('RTR Reactions').select('post_id,type').eq('user_id', user.id).in('post_id', postIds);
  const mine = {};
  (data || []).forEach(r => { mine[r.post_id] = r.type; });
  return mine;
}

// Toggles a card reaction for the current user on a post: same type again
// removes it, a different type switches it, no existing reaction adds one.
// Returns the new state ('yellow' | 'red' | null).
async function toggleReaction(postId, type) {
  const user = getCurrentUser();
  if (PREVIEW_MODE || !user) return null;
  const { data: existing } = await getSB().from('RTR Reactions')
    .select('id,type').eq('post_id', postId).eq('user_id', user.id).maybeSingle();
  if (existing && existing.type === type) {
    await getSB().from('RTR Reactions').delete().eq('id', existing.id);
    return null;
  } else if (existing) {
    await getSB().from('RTR Reactions').update({ type }).eq('id', existing.id);
    return type;
  } else {
    await getSB().from('RTR Reactions').insert({ post_id: postId, user_id: user.id, type });
    return type;
  }
}

function reactionBarHtml(postId, counts, mine) {
  const c = counts[postId] || { yellow: 0, red: 0 };
  return `
    <div class="rtr-reactions" data-postid="${postId}">
      <button class="rtr-react-btn${mine === 'yellow' ? ' active' : ''}" data-react="yellow" data-postid="${postId}" title="Yellow card">🟨 <span>${c.yellow || 0}</span></button>
      <button class="rtr-react-btn${mine === 'red' ? ' active' : ''}" data-react="red" data-postid="${postId}" title="Red card">🟥 <span>${c.red || 0}</span></button>
    </div>`;
}

// Delegated click handler for reaction buttons — attach once per container
// (e.g. document.getElementById('postList')). rerenderFn is called after a
// successful toggle so the caller can redraw counts from fresh data.
function wireReactionButtons(container, rerenderFn) {
  if (!container || container.dataset.reactionsWired) return;
  container.dataset.reactionsWired = '1';
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.rtr-react-btn');
    if (!btn) return;
    e.stopPropagation();
    if (!getCurrentUser()) { window.location.href = 'login.html'; return; }
    btn.disabled = true;
    await toggleReaction(+btn.dataset.postid, btn.dataset.react);
    btn.disabled = false;
    if (rerenderFn) await rerenderFn();
  });
}

// ── NOTIFICATION BELL (injected into any page with a #userChip header) ──
function notificationBellHtml() {
  return `
    <div class="notif-bell" id="notifBell">
      🔔<span class="notif-badge" id="notifBadge" style="display:none">0</span>
      <div class="notif-dropdown" id="notifDropdown">
        <div class="notif-header">Notifications</div>
        <div class="notif-list" id="notifList"><div class="notif-empty">No notifications yet</div></div>
      </div>
    </div>`;
}

// Call once per page, after the logged-in user is known (i.e. right after
// your page's own header/auth init runs). No-op for guests or if already
// injected (e.g. a page that calls its header setup more than once).
async function initNotificationBell(currentUser) {
  if (PREVIEW_MODE || !currentUser) return;
  const chip = document.getElementById('userChip');
  if (!chip || document.getElementById('notifBell')) return;
  chip.insertAdjacentHTML('beforebegin', notificationBellHtml());

  const bell = document.getElementById('notifBell');
  const dropdown = document.getElementById('notifDropdown');
  const badge = document.getElementById('notifBadge');
  const list = document.getElementById('notifList');

  const notifs = await loadMyNotifications();
  const unread = notifs.filter(n => !n.read);
  if (unread.length) {
    badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
    badge.style.display = 'flex';
  }
  if (notifs.length) {
    list.innerHTML = notifs.map(n => `
      <a class="notif-item${n.read ? '' : ' unread'}" href="forum-thread.html?id=${n.post_id}">
        <div class="notif-text"><strong>${escapeHtml(n.from_username)}</strong> mentioned you</div>
        <div class="notif-excerpt">${escapeHtml(n.excerpt || '')}</div>
      </a>`).join('');
  }

  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open') && unread.length) {
      await markNotificationsRead(unread.map(n => n.id));
      badge.style.display = 'none';
      list.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
      unread.length = 0;
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifBell')) dropdown.classList.remove('open');
  });
}

function miniAvatarHtml(badge, username, size = 26) {
  const imgSrc = badge?.img || (badge?.icon && /\.(png|jpg|jpeg|svg|webp)$/i.test(badge.icon) ? badge.icon : null);
  const initials = (username || '?').slice(0, 2).toUpperCase();
  const base = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;`;

  let inner;
  if (imgSrc) {
    inner = shieldBorderHtml(imgSrc, size, badge?.key);
  } else if (badge?.icon) {
    const def2 = (typeof BADGE_DEFS !== 'undefined') ? BADGE_DEFS.find(b => b.key === badge?.key) : null;
    if (def2?.gold || def2?.bronze) {
      const borderBg = def2.gold ? 'linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00)' : 'linear-gradient(160deg,#e8a84b,#cd7f32,#8b4513)';
      const shieldH2 = Math.round(size * 1.15);
      inner = `<div style="width:${size}px;height:${shieldH2}px;clip-path:${SHIELD_PATH};background:${borderBg};display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;vertical-align:middle;font-size:${Math.round(size * .5)}px;">${badge.icon}</div>`;
    } else {
      inner = `<span style="${base}background:rgba(0,255,133,.08);font-size:${Math.round(size * .55)}px;">${badge.icon}</span>`;
    }
  } else {
    inner = `<span style="${base}background:linear-gradient(135deg,var(--pl-purple),#8b008b);color:var(--pl-green);font-size:${Math.round(size * .42)}px;font-weight:700;border:1.5px solid rgba(0,255,133,.2);">${initials}</span>`;
  }

  // Wrap in clickable span only if there's a badge to show info for
  if (badge?.key) {
    return `<span class="rr-av-tip" data-badge-key="${badge.key}" data-username="${username || ''}" style="display:inline-flex;">${inner}</span>`;
  }
  return inner;
}
// Call this wherever the user-chip avatar is initialised
function applyUserAvatar(el, user) {
  const badge = getAvatarBadge();
  if (badge) {
    const imgSrc = badge.img || (badge.icon && /\.(png|jpg|jpeg|svg|webp)$/i.test(badge.icon) ? badge.icon : null);
    if (imgSrc) {
      const def = (typeof BADGE_DEFS !== 'undefined') ? BADGE_DEFS.find(b => b.key === badge?.key) : null;
      const borderBg = def?.bronze
        ? 'linear-gradient(160deg,#e8a84b,#cd7f32,#8b4513)'
        : def?.gold
          ? 'linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00)'
          : 'linear-gradient(135deg,rgba(0,255,133,.8),rgba(0,180,90,.5))';
      const chipW = 26, chipH = 30;
      const imgW = chipW - 4, imgH = chipH - 4;
      el.innerHTML = `<img src="${imgSrc}" style="width:${imgW}px;height:${imgH}px;clip-path:${SHIELD_PATH};object-fit:cover;display:block;" alt="">`;
      el.style.background   = borderBg;
      el.style.clipPath     = SHIELD_PATH;
      el.style.borderRadius = '0';
      el.style.border       = 'none';
      el.style.width        = `${chipW}px`;
      el.style.height       = `${chipH}px`;
      el.style.display      = 'flex';
      el.style.alignItems   = 'center';
      el.style.justifyContent = 'center';
      el.style.fontSize     = '';
      el.style.padding      = '0';
    } else {
      el.innerHTML        = '';
      el.textContent      = badge.icon;
      el.style.fontSize   = '1.05rem';
      el.style.background = 'rgba(0,255,133,.08)';
    }
  } else {
    el.innerHTML        = '';
    el.textContent      = (user?.username || '?').slice(0, 2).toUpperCase();
    el.style.fontSize   = '';
    el.style.background = '';
    el.style.padding    = '';
  }
}

// ── AVATAR CARD POPUP ─────────────────────────────────────
(function() {
  let popup = null;

  function closePopup() {
    if (popup) { popup.remove(); popup = null; }
  }

  function openPopup(badgeKey, username, anchorEl) {
    closePopup();
    // BADGE_DEFS may not be defined yet at call time — look it up lazily
    const def = (typeof BADGE_DEFS !== 'undefined') && BADGE_DEFS.find(b => b.key === badgeKey);
    if (!def) return;

    const isImg = def.img || (def.icon && /\.(png|jpg|jpeg|svg|webp)$/i.test(def.icon));
    const iconSrc = def.img || def.icon;
    const shieldBg = def.bronze ? 'linear-gradient(160deg,#e8a84b,#cd7f32,#8b4513)' : def.gold ? 'linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00)' : null;
    const iconHtml = isImg
      ? (shieldBg
        ? `<div style="width:54px;height:62px;position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 3px 8px ${def.gold ? 'rgba(255,215,0,.6)' : 'rgba(205,127,50,.6)'});flex-shrink:0;">
             <div style="position:absolute;inset:0;background:${shieldBg};clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);"></div>
             <img src="${iconSrc}" alt="${def.name}" style="position:relative;z-index:1;width:76%;height:76%;object-fit:cover;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);">
           </div>`
        : `<img src="${iconSrc}" alt="${def.name}" style="width:100%;height:100%;object-fit:cover;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);">`)
      : `<span>${iconSrc || '🏅'}</span>`;

    const finalIconHtml = def.key === 'founder' ? platinumWingsHtml(iconHtml, 54, 62) : iconHtml;

    popup = document.createElement('div');
    popup.className = 'rr-av-popup';
    popup.innerHTML = `
      <button class="rr-av-popup-close">✕</button>
      <div class="rr-av-popup-icon">${finalIconHtml}</div>
      ${username ? `<div class="rr-av-popup-user">${username}</div>` : ''}
      <div class="rr-av-popup-name">${def.name}</div>
      <div class="rr-av-popup-cat">${def.category}</div>
      <div class="rr-av-popup-desc">${def.desc}</div>`;
    document.body.appendChild(popup);

    // Position near the anchor element, keeping it on screen
    const rect = anchorEl.getBoundingClientRect();
    const pw = popup.offsetWidth || 220;
    const ph = popup.offsetHeight || 160;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top  = rect.bottom + 8;
    if (left + pw > window.innerWidth - 8)  left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8)  top = rect.top - ph - 8;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';

    popup.querySelector('.rr-av-popup-close').addEventListener('click', e => {
      e.stopPropagation(); closePopup();
    });
  }

  document.addEventListener('click', e => {
    const tip = e.target.closest('.rr-av-tip');
    if (tip) {
      e.stopPropagation();
      openPopup(tip.dataset.badgeKey, tip.dataset.username, tip);
      return;
    }
    if (popup && !popup.contains(e.target)) closePopup();
  });
})();

// ── CLASSIC DECISION (homepage fan poll) ───────────────────
async function loadFeaturedClassicDecision() {
  if (PREVIEW_MODE) return null;
  const { data, error } = await getSB().from('RTR Classic Decisions').select('*').eq('featured', true).limit(1).maybeSingle();
  if (error) { console.warn('[RTR] loadFeaturedClassicDecision error:', error); return null; }
  return data;
}

async function loadClassicDecisionVotes(decisionId) {
  if (PREVIEW_MODE) return { correct: 0, wrong: 0 };
  const { data } = await getSB().from('RTR Classic Decision Votes').select('vote').eq('decision_id', decisionId);
  const counts = { correct: 0, wrong: 0 };
  (data || []).forEach(v => { if (counts[v.vote] != null) counts[v.vote]++; });
  return counts;
}

async function loadMyClassicDecisionVote(decisionId, userId) {
  if (PREVIEW_MODE || !userId) return null;
  const { data } = await getSB().from('RTR Classic Decision Votes').select('vote').eq('decision_id', decisionId).eq('user_id', userId).maybeSingle();
  return data?.vote || null;
}

async function voteClassicDecision(decisionId, userId, vote) {
  if (PREVIEW_MODE || !userId) return false;
  const { error } = await getSB().from('RTR Classic Decision Votes')
    .upsert({ decision_id: decisionId, user_id: userId, vote }, { onConflict: 'decision_id,user_id' });
  if (error) { console.warn('[RTR] voteClassicDecision error:', error); return false; }
  return true;
}

// ── Classic Decision admin CRUD ─────────────────────────────
async function loadAllClassicDecisions() {
  if (PREVIEW_MODE) return [];
  const { data, error } = await getSB().from('RTR Classic Decisions').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[RTR] loadAllClassicDecisions error:', error); return []; }
  return data || [];
}

// Only one decision can be featured at a time — unfeature every other row
// first so the app never has to reconcile more than one "current" poll.
async function saveClassicDecision(decision) {
  if (PREVIEW_MODE) return true;
  if (decision.featured) {
    await getSB().from('RTR Classic Decisions').update({ featured: false }).neq('id', decision.id ?? -1);
  }
  const { data, error } = await getSB().from('RTR Classic Decisions').upsert(decision).select().single();
  if (error) { console.error('[RTR] saveClassicDecision error:', error); return null; }
  return data;
}

async function deleteClassicDecision(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Classic Decisions').delete().eq('id', id);
  if (error) console.error('[RTR] deleteClassicDecision error:', error);
  return !error;
}

// ── Social post drafts (auto-generated from RTR Incidents — see
// supabase/social-post-drafts-setup.sql for the trigger that creates
// them) ──────────────────────────────────────────────────────────
async function loadSocialPostDrafts(status = 'pending') {
  if (PREVIEW_MODE) return [];
  const { data, error } = await getSB().from('RTR Social Post Drafts')
    .select('*').eq('status', status).order('created_at', { ascending: false });
  if (error) { console.error('[RTR] loadSocialPostDrafts error:', error); return []; }
  return data || [];
}

async function discardSocialPostDraft(id) {
  if (PREVIEW_MODE) return true;
  const { error } = await getSB().from('RTR Social Post Drafts').update({ status: 'discarded' }).eq('id', id);
  if (error) console.error('[RTR] discardSocialPostDraft error:', error);
  return !error;
}

// Posts the (possibly hand-edited) text to X via the post-to-x function,
// then marks the draft posted. Returns { ok, error }.
async function postSocialPostDraft(id, text) {
  if (PREVIEW_MODE) return { ok: true };
  try {
    const res = await fetch('/.netlify/functions/post-to-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: id, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    const { error } = await getSB().from('RTR Social Post Drafts')
      .update({ status: 'posted', post_text: text, posted_at: new Date().toISOString() }).eq('id', id);
    if (error) console.error('[RTR] postSocialPostDraft status-update error:', error);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
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
  { key: 'first_pick',    category: 'Fantasy',  icon: '🎯', name: 'First Pick',     desc: 'Make your first fantasy pick' },
  { key: 'wildcard_king', category: 'Fantasy',  icon: '🃏', name: 'Wildcard King',  desc: 'Use all your wildcards in a season' },
  { key: 'podium',        category: 'Fantasy',  icon: '🏆', name: 'Podium',         desc: 'Finish top 3 in a matchweek leaderboard' },
  { key: 'match_winner',  category: 'Fantasy',  icon: '🎯', name: 'Match Winner',   desc: 'Your picked ref scores 10+ points in a GW' },
  // Fantasy - Wildcards
  { key: 'wc_red_card',      category: 'Fantasy - Wildcards', img: 'images/badges/redcardbadge.png',       name: 'Red Card Wildcard',        desc: 'Use the Red Card wildcard and correctly predict a game with a red card' },
  { key: 'wc_yellow_card',   category: 'Fantasy - Wildcards', img: 'images/badges/yellowcardbadge.png',    name: 'Yellow Card Wildcard',     desc: 'Use the Yellow Card wildcard and correctly predict a game with 4+ yellow cards' },
  { key: 'wc_var_replay',    category: 'Fantasy - Wildcards', img: 'images/badges/consultingvarbadge.png', name: 'VAR Replay Wildcard',      desc: 'Pick a game — if the ref has a penalty or red card overturned by VAR, earn +2 pts' },
  // Fantasy - Wildcard Mastery (bronze — 10 correct uses)
  { key: 'wc_red_card_x10',  category: 'Fantasy - Wildcards', img: 'images/badges/redcardbadge.png',       name: 'Red Card Master',          desc: 'Correctly fire the Red Card wildcard 10 times',    bronze: true },
  { key: 'wc_yellow_card_x10',category:'Fantasy - Wildcards', img: 'images/badges/yellowcardbadge.png',    name: 'Yellow Card Master',       desc: 'Correctly fire the Yellow Card wildcard 10 times', bronze: true },
  { key: 'wc_var_replay_x10',category: 'Fantasy - Wildcards', img: 'images/badges/consultingvarbadge.png', name: 'VAR Replay Master',        desc: 'Correctly fire the VAR Replay wildcard 10 times',  bronze: true },
  // Loyalty
  { key: 'founder',       category: 'Loyalty',  img: 'images/logos/RRlogo192.png', name: 'Founder', desc: 'A founding member of RefRater', gold: true },
  { key: 'profile_setup', category: 'Loyalty',  icon: '👤', name: 'All Kitted Out', desc: 'Set your favourite team on your profile' },
  { key: 'early_adopter', category: 'Loyalty',  img: 'images/badges/RefYellow-removebg-preview.png', name: 'Early Adopter',  desc: 'Among the first 50 users to join RefRater', silver: true },
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
  const isNew = !error;
  if (isNew) {
    const def = BADGE_DEFS.find(b => b.key === badgeKey);
    if (def) showBadgeUnlock(def);
  }
  return isNew;
}

// Wraps a shield HTML string with platinum wings — used for Founder badge
function platinumWingsHtml(innerHtml, shieldW, shieldH) {
  const wingW = Math.round(shieldW * 0.42);
  const wingH = Math.round(shieldH * 0.82);
  const platGrad = 'linear-gradient(160deg,#f8f8f8,#c0c0c0,#e8e8e8,#808080,#d0d0d0)';
  const lClip = 'polygon(100% 15%,28% 0%,0% 18%,14% 42%,0% 62%,28% 86%,100% 78%,70% 50%)';
  const rClip = 'polygon(0% 15%,72% 0%,100% 18%,86% 42%,100% 62%,72% 86%,0% 78%,30% 50%)';
  return `<div style="display:flex;align-items:center;justify-content:center;">` +
    `<div style="width:${wingW}px;height:${wingH}px;background:${platGrad};clip-path:${lClip};margin-right:-5px;filter:drop-shadow(-1px 0 5px rgba(210,210,210,.7));flex-shrink:0;"></div>` +
    innerHtml +
    `<div style="width:${wingW}px;height:${wingH}px;background:${platGrad};clip-path:${rClip};margin-left:-5px;filter:drop-shadow(1px 0 5px rgba(210,210,210,.7));flex-shrink:0;"></div>` +
    `</div>`;
}

function showBadgeUnlock(def) {
  // icon: image path or emoji
  const isImg = def.img || (def.icon && /\.(png|jpg|jpeg|svg|webp)$/i.test(def.icon));
  const iconSrc = def.img || def.icon;
  const shieldBg = def.bronze
    ? 'linear-gradient(160deg,#e8a84b,#cd7f32,#8b4513)'
    : def.gold
      ? 'linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00)'
      : null;
  const shadowColor = def.gold ? 'rgba(255,215,0,.7)' : 'rgba(205,127,50,.7)';
  const iconHtml = isImg
    ? (shieldBg
      ? `<div style="width:200px;height:230px;position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 4px 12px ${shadowColor});">
           <div style="position:absolute;inset:0;background:${shieldBg};clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);"></div>
           <img src="${iconSrc}" alt="${def.name}" style="position:relative;z-index:1;width:76%;height:76%;object-fit:cover;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);">
         </div>`
      : `<img src="${iconSrc}" alt="${def.name}" style="width:78%;height:78%;object-fit:cover;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);">`)
    : def.gold
      ? `<div style="width:200px;height:230px;clip-path:polygon(50% 0%,100% 20%,100% 68%,50% 100%,0% 68%,0% 20%);background:linear-gradient(160deg,#FFE44D,#DAA520,#9A6B00);display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 4px 12px rgba(255,215,0,.7));font-size:5rem;">${def.icon || '🏅'}</div>`
      : `<span style="font-size:4rem;">${def.icon || '🏅'}</span>`;

  const finalIconHtml = def.key === 'founder' ? platinumWingsHtml(iconHtml, 200, 230) : iconHtml;

  const backdrop = document.createElement('div');
  backdrop.className = 'bu-backdrop';
  backdrop.innerHTML = `
    <div class="bu-outer">
      <div class="bu-card" id="buCard">
        <div class="bu-smoke" id="buSmoke"></div>
        <div class="bu-new-label">New Card Unlocked</div>
        <div class="bu-icon-wrap">${finalIconHtml}</div>
        <div class="bu-title">${def.name}</div>
        <div class="bu-desc">${def.desc}</div>
        <button class="bu-dismiss" id="buDismiss">Tap to dismiss</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  // ── smoke particles ──────────────────────────────────────
  const smokeEl = backdrop.querySelector('#buSmoke');
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'bu-particle';
    const size  = 28 + Math.random() * 48;           // 28–76 px
    const dx    = (Math.random() - .5) * 120;        // ±60 px horizontal drift
    const rise  = -(60 + Math.random() * 100);       // 60–160 px upward
    const dur   = (.8 + Math.random() * .9).toFixed(2) + 's';
    const delay = (Math.random() * .5).toFixed(2)    + 's';
    p.style.cssText = `width:${size}px;height:${size}px;--dx:${dx}px;--rise:${rise}px;--dur:${dur};--delay:${delay};left:50%;margin-left:${-size/2}px;`;
    smokeEl.appendChild(p);
  }

  // ── 3D tilt ──────────────────────────────────────────────
  const card = backdrop.querySelector('#buCard');
  let rafId = null;
  let targetRX = 0, targetRY = 0, currentRX = 0, currentRY = 0;

  function applyTilt() {
    currentRX += (targetRX - currentRX) * .12;
    currentRY += (targetRY - currentRY) * .12;
    card.style.transform = `perspective(700px) rotateX(${currentRX}deg) rotateY(${currentRY}deg)`;
    rafId = requestAnimationFrame(applyTilt);
  }
  rafId = requestAnimationFrame(applyTilt);

  function onPointerMove(e) {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const px = (e.touches ? e.touches[0].clientX : e.clientX);
    const py = (e.touches ? e.touches[0].clientY : e.clientY);
    targetRY =  ((px - cx) / (rect.width  / 2)) * 12;
    targetRX = -((py - cy) / (rect.height / 2)) * 10;
  }
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('touchmove', onPointerMove, { passive: true });

  // ── dismiss ──────────────────────────────────────────────
  function dismiss() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('touchmove', onPointerMove);
    backdrop.classList.add('bu-out');
    backdrop.querySelector('.bu-outer').classList.add('bu-out');
    setTimeout(() => backdrop.remove(), 500);
  }

  backdrop.querySelector('#buDismiss').addEventListener('click', dismiss);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) dismiss(); });
  // auto-dismiss after 7 s
  setTimeout(dismiss, 7000);
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

// Awarded to founding members — users whose account was created on or before 2026-04-18
async function checkFounderBadge(userId, createdAt) {
  if (PREVIEW_MODE || !userId || !createdAt) return;
  const signUpDate = new Date(createdAt);
  const cutoff = new Date('2026-04-18T23:59:59.999Z');
  if (signUpDate <= cutoff) await awardBadge(userId, 'founder');
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

// Called at end of GW to check wildcard prediction badges
// wildcards = user's wildcard object for that GW, matches = MATCHES array
async function checkWildcardBadges(userId, wc, matches) {
  if (PREVIEW_MODE || !userId || !wc) return;
  if (wc.rc?.active && wc.rc.matchId) {
    const m = matches.find(x => x.id === wc.rc.matchId);
    if (m && (m.rc || 0) > 0) await awardBadge(userId, 'wc_red_card');
  }
  if (wc.yc?.active && wc.yc.matchId) {
    const m = matches.find(x => x.id === wc.yc.matchId);
    if (m && (m.yc || 0) >= 4) await awardBadge(userId, 'wc_yellow_card');
  }
  if (wc.var?.active && wc.var.matchId) {
    const m = matches.find(x => x.id === wc.var.matchId);
    if (m && ((m.incorrectVarPen || 0) > 0 || (m.incorrectVarRed || 0) > 0)) await awardBadge(userId, 'wc_var_replay');
  }
}

// Check wildcard mastery badges (10 correct uses each) — call after GW finalisation
async function checkWildcardMasteryBadges(userId, matches) {
  if (PREVIEW_MODE || !userId || !matches?.length) return;
  const { data: picks } = await getSB().from('RTR Fantasy Picks')
    .select('wildcards').eq('user_id', userId);
  if (!picks?.length) return;

  let rcCorrect = 0, ycCorrect = 0, varCorrect = 0;
  picks.forEach(p => {
    const wc = p.wildcards || {};
    if (wc.rc?.active && wc.rc.matchId) {
      const m = matches.find(x => x.id === wc.rc.matchId);
      if (m && (m.rc || 0) > 0) rcCorrect++;
    }
    if (wc.yc?.active && wc.yc.matchId) {
      const m = matches.find(x => x.id === wc.yc.matchId);
      if (m && (m.yc || 0) >= 4) ycCorrect++;
    }
    if (wc.var?.active && wc.var.matchId) {
      const m = matches.find(x => x.id === wc.var.matchId);
      if (m && m.perfectGame) varCorrect++;
    }
  });

  if (rcCorrect  >= 10) await awardBadge(userId, 'wc_red_card_x10');
  if (ycCorrect  >= 10) await awardBadge(userId, 'wc_yellow_card_x10');
  if (varCorrect >= 10) await awardBadge(userId, 'wc_var_replay_x10');
}

// ── THEME TOGGLE ──────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(_THEME_KEY, next);
  _refreshThemeBtn();
}
function _refreshThemeBtn() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const btn = document.getElementById('ddThemeToggle');
  if (btn) btn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
}
document.addEventListener('DOMContentLoaded', () => {
  // ── LIMELIGHT NAV ────────────────────────────────────────
  (function(){
    const nav = document.querySelector('header nav');
    if (!nav) return;
    const bar = document.createElement('div');
    bar.className = 'll-bar';
    bar.style.left = '-999px';
    const beam = document.createElement('div');
    beam.className = 'll-beam';
    bar.appendChild(beam);
    nav.appendChild(bar);
    function moveBar(el) {
      bar.style.left = (el.offsetLeft + el.offsetWidth / 2 - bar.offsetWidth / 2) + 'px';
    }
    const active = nav.querySelector('a.active');
    if (active) setTimeout(() => moveBar(active), 60);
    nav.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('mouseenter', function() { moveBar(a); });
    });
    nav.addEventListener('mouseleave', function() {
      const activeEl = nav.querySelector('a.active');
      if (activeEl) moveBar(activeEl);
    });
  })();

  const dropdown = document.getElementById('userDropdown');
  if (dropdown && !document.getElementById('ddThemeToggle')) {
    const btn = document.createElement('div');
    btn.className = 'dd-item';
    btn.id = 'ddThemeToggle';
    btn.addEventListener('click', e => { e.stopPropagation(); toggleTheme(); });
    const head = dropdown.querySelector('.dd-head');
    if (head) head.after(btn); else dropdown.prepend(btn);
    _refreshThemeBtn();

    // Inject Admin button for admin users
    if (isAdmin()) {
      const adminBtn = document.createElement('div');
      adminBtn.className = 'dd-item';
      adminBtn.id = 'ddAdminLink';
      adminBtn.innerHTML = '⚙️ Admin Panel';
      adminBtn.style.color = 'var(--pl-green)';
      adminBtn.style.fontWeight = '600';
      adminBtn.addEventListener('click', () => { window.location.href = 'admin.html'; });
      btn.after(adminBtn);
    }
  }
});
