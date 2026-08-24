// Scheduled function (see ../../netlify.toml) — runs every 2 minutes and
// pulls live/finished match data straight from football-data.org for the
// active gameweek. Does three things:
//   1. Writes aggregate yellow/red/penalty counts into RTR Match Stats — the
//      same table matches.html already overlays onto match cards, so
//      cards/pens show up there with no admin action needed.
//   2. Creates a real voteable RTR Incidents row for each card/penalty that
//      doesn't already have one — same shape as an admin manually clicking
//      "+ Add Decision", just automatic. Re-runs are safe: each event is
//      matched against existing incidents (by match, type, minute,
//      description) before inserting, so nothing gets duplicated.
//   3. Flips RTR Fixtures.status to 'complete' (with the final score) the
//      moment football-data.org reports FINISHED. Referee rankings
//      (referees.html, admin.html) only count matches with
//      status === 'complete' on RTR Fixtures — without this step that flip
//      only ever happened via admin manually clicking "Sync Active
//      Matchweek", so finished matches sat stuck as "upcoming" forever and
//      never contributed to a referee's stats.
//
// Once a match's RTR Fixtures row is already 'complete' it's skipped
// entirely on later runs — no more football-data calls for it. Combined
// with only detail-fetching live/freshly-finished matches, this stays well
// inside football-data.org's free-tier rate limit (10 calls/min): 1 call
// for the fixture list + 1 per match that still needs work this run.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (Netlify env var, server-side only —
// bypasses RLS, since this runs unattended with no admin session to log
// in as). Get it from Supabase Dashboard → Settings → API → service_role.

const SUPABASE_URL = 'https://sxufittkehlktlfvicom.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_API_KEY = '15b079ce9d02424994eae82a3e5f4a31';
const FD_BASE = 'https://api.football-data.org/v4';
const CARD_MAP = { YELLOW: 'YELLOW_CARD', YELLOW_RED: 'YELLOW_RED_CARD', RED: 'RED_CARD' };

// football-data.org status -> RTR Fixtures/Match Stats status, matching
// FD_STATUS in shared.js/admin.html/matches.html — keep in sync with those.
const FD_STATUS = {
  FINISHED: 'complete', IN_PLAY: 'live', PAUSED: 'live', HALF_TIME: 'live',
  TIMED: 'upcoming', SCHEDULED: 'upcoming', SUSPENDED: 'upcoming',
  POSTPONED: 'upcoming', CANCELLED: 'upcoming',
};

// type -> weight, matching INCIDENT_TYPES in shared.js
const INCIDENT_WEIGHTS = { 'Yellow Card': 2.0, 'Red Card': 3.0, 'Penalty Given': 2.5 };

async function fdFetch(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: { 'X-Auth-Token': FD_API_KEY } });
  if (!res.ok) throw new Error(`football-data.org ${path} -> ${res.status}`);
  return res.json();
}

function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// Inserts an RTR Incidents row for this event if one doesn't already exist
// (matched on match_id + type + minute + description). Returns 'created',
// 'exists', or 'failed'.
async function ensureIncident(matchId, season, type, minute, description, existingIncidents) {
  const dup = existingIncidents.some(inc =>
    inc.type === type && inc.minute === minute && inc.description === description
  );
  if (dup) return 'exists';

  const weight = INCIDENT_WEIGHTS[type] ?? 1.5;
  const res = await supabaseFetch('/RTR%20Incidents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ match_id: matchId, type, minute, description, weight, season }),
  });
  if (!res.ok) return 'failed';
  const [created] = await res.json();
  if (created) existingIncidents.push(created); // guard against dupes within the same run too
  return 'created';
}

exports.handler = async () => {
  if (!SERVICE_KEY) {
    return { statusCode: 500, body: 'SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  try {
    const cfgRes = await supabaseFetch('/RTR%20Config?select=gw,comp,season&id=eq.1');
    const [cfg] = await cfgRes.json();
    if (!cfg?.gw) return { statusCode: 200, body: 'No active GW config' };

    const comp = cfg.comp || 'PL';
    const season = String(cfg.season || '');
    const list = await fdFetch(`/competitions/${comp}/matches?matchday=${cfg.gw}&season=${cfg.season}`);
    const allMatches = list.matches || [];
    if (!allMatches.length) return { statusCode: 200, body: `No matches in GW${cfg.gw}` };

    // Skip matches already marked complete in RTR Fixtures — nothing left to sync.
    const ids = allMatches.map(m => m.id).join(',');
    const fixturesRes = await supabaseFetch(`/RTR%20Fixtures?select=id,status&id=in.(${ids})`);
    const fixturesStatus = {};
    (fixturesRes.ok ? await fixturesRes.json() : []).forEach(f => { fixturesStatus[f.id] = f.status; });

    let synced = 0;
    let incidentsCreated = 0;
    let fixturesUpdated = 0;
    const errors = [];

    for (const m of allMatches) {
      if (fixturesStatus[m.id] === 'complete') continue;

      const mappedStatus = FD_STATUS[m.status] || 'upcoming';
      const ft = m.score?.fullTime;
      const hasScore = ft?.home != null && ft?.away != null;
      const score = hasScore ? `${ft.home} - ${ft.away}` : '0-0';

      const fixtureRes = await supabaseFetch('/RTR%20Fixtures?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: m.id, status: mappedStatus, score, updated_at: new Date().toISOString() }),
      });
      if (fixtureRes.ok) fixturesUpdated++;
      else errors.push(`match ${m.id} fixture: ${fixtureRes.status}`);

      // Only spend a football-data call on matches that are live or just
      // finished — nothing new to fetch for a still-upcoming fixture.
      if (mappedStatus !== 'live' && mappedStatus !== 'complete') continue;

      try {
        const detail = await fdFetch(`/matches/${m.id}`);
        const bookings = (detail.bookings || []).map(b => ({ ...b, card: CARD_MAP[b.card] || b.card }));
        const goals = detail.goals || [];
        const yellow_cards = bookings.filter(b => b.card === 'YELLOW_CARD').length;
        const red_cards = bookings.filter(b => b.card === 'RED_CARD' || b.card === 'YELLOW_RED_CARD').length;
        const penalties_given = goals.filter(g => g.type === 'PENALTY').length;

        const upsertRes = await supabaseFetch('/RTR%20Match%20Stats?on_conflict=match_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ match_id: m.id, comp, status: mappedStatus, yellow_cards, red_cards, penalties_given }),
        });
        if (upsertRes.ok) synced++;
        else errors.push(`match ${m.id} stats: ${upsertRes.status}`);

        // Fetch existing incidents once per match, then check each card/pen against them.
        const existingRes = await supabaseFetch(`/RTR%20Incidents?select=id,type,minute,description&match_id=eq.${m.id}`);
        const existingIncidents = existingRes.ok ? await existingRes.json() : [];

        for (const b of bookings) {
          const type = b.card === 'YELLOW_CARD' ? 'Yellow Card' : 'Red Card';
          const description = `${b.player?.name || 'Unknown player'} (${b.team?.name || 'Unknown team'})`;
          const result = await ensureIncident(m.id, season, type, b.minute, description, existingIncidents);
          if (result === 'created') incidentsCreated++;
          else if (result === 'failed') errors.push(`match ${m.id} incident (${type} ${b.minute}'): insert failed`);
        }

        for (const g of goals.filter(g => g.type === 'PENALTY')) {
          const description = `${g.scorer?.name || 'Unknown player'} (${g.team?.name || 'Unknown team'}) penalty`;
          const result = await ensureIncident(m.id, season, 'Penalty Given', g.minute, description, existingIncidents);
          if (result === 'created') incidentsCreated++;
          else if (result === 'failed') errors.push(`match ${m.id} incident (Penalty ${g.minute}'): insert failed`);
        }
      } catch (e) {
        errors.push(`match ${m.id}: ${e.message}`);
      }
    }

    return {
      statusCode: 200,
      body: `GW${cfg.gw}: ${fixturesUpdated} fixtures updated, ${synced} match stats synced, ${incidentsCreated} new incidents${errors.length ? ' — errors: ' + errors.join('; ') : ''}`,
    };
  } catch (err) {
    return { statusCode: 502, body: `sync-live-incidents error: ${err.message}` };
  }
};
