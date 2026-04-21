import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FOOTBALL_DATA_KEY  = Deno.env.get('FOOTBALL_DATA_KEY')!;
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Maps football-data.org team names → app team names
const TEAM_MAP: Record<string, string> = {
  'Arsenal FC':                    'Arsenal',
  'Aston Villa FC':                'Aston Villa',
  'AFC Bournemouth':               'Bournemouth',
  'Brentford FC':                  'Brentford',
  'Brighton & Hove Albion FC':     'Brighton',
  'Chelsea FC':                    'Chelsea',
  'Crystal Palace FC':             'Crystal Palace',
  'Everton FC':                    'Everton',
  'Fulham FC':                     'Fulham',
  'Ipswich Town FC':               'Ipswich',
  'Leicester City FC':             'Leicester City',
  'Liverpool FC':                  'Liverpool',
  'Manchester City FC':            'Manchester City',
  'Manchester United FC':          'Manchester United',
  'Newcastle United FC':           'Newcastle United',
  'Nottingham Forest FC':          'Nottingham Forest',
  'Southampton FC':                'Southampton',
  'Tottenham Hotspur FC':          'Tottenham Hotspur',
  'West Ham United FC':            'West Ham United',
  'Wolverhampton Wanderers FC':    'Wolverhampton',
};

const TEAM_EMOJI: Record<string, string> = {
  'Arsenal':            '🔴',
  'Aston Villa':        '🟣',
  'Bournemouth':        '⚫',
  'Brentford':          '🔴',
  'Brighton':           '🔵',
  'Chelsea':            '🔵',
  'Crystal Palace':     '🔴',
  'Everton':            '🔵',
  'Fulham':             '⚪',
  'Ipswich':            '🔵',
  'Leicester City':     '🔵',
  'Liverpool':          '🔴',
  'Manchester City':    '🩵',
  'Manchester United':  '🔴',
  'Newcastle United':   '⚫',
  'Nottingham Forest':  '🔴',
  'Southampton':        '⚪',
  'Tottenham Hotspur':  '⚪',
  'West Ham United':    '🟣',
  'Wolverhampton':      '🟡',
};

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const res = await fetch(
    'https://api.football-data.org/v4/competitions/PL/matches',
    { headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } }
  );

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `football-data.org returned ${res.status}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { matches = [] } = await res.json();

  const fixtures = matches.map((m: any) => {
    const home = TEAM_MAP[m.homeTeam.name] ?? m.homeTeam.shortName ?? m.homeTeam.name;
    const away = TEAM_MAP[m.awayTeam.name] ?? m.awayTeam.shortName ?? m.awayTeam.name;

    let status = 'upcoming';
    if (m.status === 'FINISHED')                        status = 'complete';
    else if (m.status === 'IN_PLAY' || m.status === 'PAUSED') status = 'live';

    let score = '– v –';
    if (m.score?.fullTime?.home != null)
      score = `${m.score.fullTime.home} - ${m.score.fullTime.away}`;

    return {
      id:          m.id,
      matchweek:   m.matchday,
      home,
      away,
      home_emoji:  TEAM_EMOJI[home]  ?? '',
      away_emoji:  TEAM_EMOJI[away]  ?? '',
      kickoff:     m.utcDate,
      status,
      score,
      updated_at:  new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from('RTR Fixtures')
    .upsert(fixtures, { onConflict: 'id' });

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, synced: fixtures.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
