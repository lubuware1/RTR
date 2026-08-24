// Scheduled function (see ../../netlify.toml) — runs every 2 minutes and
// pulls live yellow/red card and penalty counts straight from
// football-data.org into RTR Match Stats for whichever matches are
// currently in play, so match cards update the same way the live score
// already does, with no admin action needed.
//
// Only scans matches with status IN_PLAY/PAUSED/HALF_TIME each run — not
// the whole gameweek — to stay well inside football-data.org's free-tier
// rate limit (10 calls/min): 1 call for the fixture list + 1 per live
// match. Finished-match syncing is still the existing manual "Sync
// Incidents for Active GW" button in admin.html — this doesn't replace it.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (Netlify env var, server-side only —
// bypasses RLS, since this runs unattended with no admin session to log
// in as). Get it from Supabase Dashboard → Settings → API → service_role.

const SUPABASE_URL = 'https://sxufittkehlktlfvicom.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_API_KEY = '15b079ce9d02424994eae82a3e5f4a31';
const FD_BASE = 'https://api.football-data.org/v4';
const LIVE_STATUSES = ['IN_PLAY', 'PAUSED', 'HALF_TIME'];
const CARD_MAP = { YELLOW: 'YELLOW_CARD', YELLOW_RED: 'YELLOW_RED_CARD', RED: 'RED_CARD' };

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

exports.handler = async () => {
  if (!SERVICE_KEY) {
    return { statusCode: 500, body: 'SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  try {
    const cfgRes = await supabaseFetch('/RTR%20Config?select=gw,comp,season&id=eq.1');
    const [cfg] = await cfgRes.json();
    if (!cfg?.gw) return { statusCode: 200, body: 'No active GW config' };

    const comp = cfg.comp || 'PL';
    const list = await fdFetch(`/competitions/${comp}/matches?matchday=${cfg.gw}&season=${cfg.season}`);
    const liveMatches = (list.matches || []).filter(m => LIVE_STATUSES.includes(m.status));

    if (!liveMatches.length) {
      return { statusCode: 200, body: `No live matches in GW${cfg.gw}` };
    }

    let synced = 0;
    const errors = [];
    for (const m of liveMatches) {
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
          body: JSON.stringify({ match_id: m.id, comp, yellow_cards, red_cards, penalties_given }),
        });
        if (upsertRes.ok) synced++;
        else errors.push(`match ${m.id}: ${upsertRes.status}`);
      } catch (e) {
        errors.push(`match ${m.id}: ${e.message}`);
      }
    }

    return {
      statusCode: 200,
      body: `Synced ${synced}/${liveMatches.length} live matches for GW${cfg.gw}${errors.length ? ' — errors: ' + errors.join('; ') : ''}`,
    };
  } catch (err) {
    return { statusCode: 502, body: `sync-live-incidents error: ${err.message}` };
  }
};
