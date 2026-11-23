import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Recency / anti-repeat tuning. Overridable via config.recency.
const DEFAULT_RECENCY = {
  gameStrength: 0.9,    // how hard to push away from a just-picked spot (0-1)
  gameRadius: 15,       // neighborhood (in movies) the game-pick penalty spans
  gameDecay: 0.5,       // per-shuffle decay of the game-pick penalty
  watchStrength: 0.6,   // how hard to push away from a recently-watched spot
  watchRadius: 18,      // neighborhood the watch penalty spans
  watchWindowDays: 30,  // how far back watch history still influences picks
  maxAge: 5,            // drop recency records once older than this many shuffles
  weightFloor: 0.05,    // a spot's weight can never drop below this (never impossible)
  smallLibThreshold: 50,// libraries smaller than this skip the watch-history bias (e.g. "new")
  historyTtlMs: 5 * 60 * 1000, // re-fetch Plex watch history at most this often
  historyLimit: 80,     // how many recent history entries to consider
};

// --- Config ---

function loadConfig() {
  const configPath = join(__dirname, 'config.json');
  if (!existsSync(configPath)) {
    console.error('Missing config.json — copy config.example.json and fill in your values.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

const config = loadConfig();
const { plexUrl, plexToken, libraries, port = 3000 } = config;
const RECENCY = { ...DEFAULT_RECENCY, ...(config.recency || {}) };

// --- In-memory data ---

const plexLibraries = new Map();  // sectionId -> { name, movies: [{ title, posterUrl }] }

// Recency state (in-memory; resets on restart, matching the app's stateless design).
const recentLibPicks = new Map(); // sectionId -> [{ index, age }]
let watchHistory = { fetchedAt: 0, bySection: new Map() }; // sectionId -> Map<normalizedTitle, viewedAt(sec)>

// --- Helpers ---

function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// --- Title sort key ---

// Some franchises share a long common prefix -- e.g. every Harry Potter film is
// "Harry Potter and the ...", so they all sort together under "Ha". When the
// neighbor-selection algorithm lands there, the whole 6-movie row is the same
// series. Stripping the franchise prefix sorts each film by its distinctive part
// instead (Chamber of Secrets -> C, Goblet of Fire -> G, Prisoner of Azkaban -> P),
// scattering them across the library for a more varied shuffle. The full title is
// still what gets displayed -- this only affects sort/clustering order.
const SORT_PREFIXES = [
  /^harry potter and the /i,
  // House of Mouse is mostly franchises; without these a pick fills the row with one series.
  /^star wars:\s*(episode [ivx]+\s*-\s*)?/i,
  /^spider-man:?\s*/i,
  /^x-men:?\s*/i,
  /^captain america:\s*/i,
  /^pirates of the caribbean:\s*/i,
  /^toy story\s*/i,
  /^avengers:\s*/i,
  /^(the )?guardians of the galaxy:?\s*/i,
  /^indiana jones and the\s*/i,
  /^thor:\s*/i,
  /^ant-man( and the wasp)?:?\s*/i,
  /^iron man\s*/i,
  /^cars\s*/i,
  /^deadpool\s*/i,
  /^tron:\s*/i,
  /^black panther:\s*/i,
  /^(the )?muppets?\s*/i,
  /^doctor strange\s*/i,
  /^monsters,?\s*/i,
  /^finding\s*/i,
  /^frozen\s*/i,
  /^moana\s*/i,
  /^zootopia\s*/i,
];

// A bare sequel number left after stripping ("Toy Story 3" -> "3") would pile every
// franchise's sequels together at the top of the library, so spell it out instead.
const SEQUEL_WORDS = { '2': 'two', 'ii': 'two', '3': 'three', '4': 'four', '5': 'five' };

function sortKey(title) {
  for (const prefix of SORT_PREFIXES) {
    if (!prefix.test(title)) continue;
    const rest = title.replace(prefix, '').trim();
    if (!rest) return title; // the franchise's first film keeps its own title
    return SEQUEL_WORDS[rest.toLowerCase()] || rest;
  }
  return title;
}

// --- Plex API ---

// Posters go to the browser as /api/poster?thumb=<plex thumb path>; the server fetches them
// from Plex with the token in a header, so the Plex token never reaches a client.
const THUMB_RE = /^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/;
function posterPath(thumb) {
  return thumb && THUMB_RE.test(thumb) ? `/api/poster?thumb=${encodeURIComponent(thumb)}` : null;
}

async function fetchPlexLibrary(sectionId, name) {
  const url = `${plexUrl}/library/sections/${sectionId}/all?X-Plex-Token=${plexToken}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Plex returned ${res.status}`);
    const data = await res.json();
    const container = data.MediaContainer;
    const metadata = container.Metadata || [];
    const movies = metadata
      .filter(m => m.type === 'movie')
      .map(m => ({
        title: m.title,
        posterUrl: posterPath(m.thumb)
      }))
      .sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title), undefined, { sensitivity: 'base' }));
    plexLibraries.set(sectionId, { name, movies });
    console.log(`Loaded ${movies.length} movies from Plex library "${name}" (section ${sectionId})`);
  } catch (err) {
    console.error(`Failed to load Plex library "${name}" (section ${sectionId}):`, err.message);
    plexLibraries.set(sectionId, { name, movies: [] });
  }
}

async function scanAllPlexLibraries() {
  await Promise.all(libraries.map(lib => fetchPlexLibrary(lib.sectionId, lib.name)));
}

// Recently-watched bias (Feature #4): pull Plex watch history so we can steer
// picks away from sections we were just in. Cached for RECENCY.historyTtlMs so a
// movie night stays current without re-fetching on every shuffle.
async function refreshWatchHistory() {
  const now = Date.now();
  if (now - watchHistory.fetchedAt < RECENCY.historyTtlMs) return;
  try {
    const url = `${plexUrl}/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Token=${plexToken}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Plex history returned ${res.status}`);
    const data = await res.json();
    const entries = (data.MediaContainer?.Metadata || []).slice(0, RECENCY.historyLimit);
    const bySection = new Map();
    for (const e of entries) {
      const sid = Number(e.librarySectionID); // Plex may return this as a string
      if (!Number.isFinite(sid) || !e.title || !e.viewedAt) continue;
      if (!bySection.has(sid)) bySection.set(sid, new Map());
      const m = bySection.get(sid);
      const key = normalizeTitle(e.title);
      if (!m.has(key) || e.viewedAt > m.get(key)) m.set(key, e.viewedAt); // keep most recent view
    }
    watchHistory = { fetchedAt: now, bySection };
  } catch (err) {
    console.error('Plex history fetch failed:', err.message);
    watchHistory.fetchedAt = now; // back off; don't hammer on failure
  }
}

// --- Recency-weighted selection (Features #3 & #4) ---

// Reduce weights in a neighborhood around `center` with a linear (triangular) falloff.
function applyPenalty(weights, center, strength, radius) {
  if (radius <= 0) {
    weights[center] *= (1 - strength);
    return;
  }
  const lo = Math.max(0, Math.floor(center - radius));
  const hi = Math.min(weights.length - 1, Math.ceil(center + radius));
  for (let i = lo; i <= hi; i++) {
    const falloff = Math.max(0, 1 - Math.abs(i - center) / radius);
    weights[i] *= (1 - strength * falloff);
  }
}

function weightedRandom(weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// Age all recency records by one shuffle and drop the fully-decayed ones.
function ageRecency() {
  for (const [sid, picks] of recentLibPicks) {
    recentLibPicks.set(sid, picks
      .map(p => ({ ...p, age: p.age + 1 }))
      .filter(p => p.age <= RECENCY.maxAge));
  }
}

function recordLibPick(sectionId, index) {
  const picks = recentLibPicks.get(sectionId) || [];
  picks.push({ index, age: 0 });
  recentLibPicks.set(sectionId, picks);
}

// Pick a movie and its 5 alphabetical neighbors, biased away from spots we
// recently showed (#3) and sections recently watched in Plex (#4).
function selectWithNeighborsWeighted(sortedMovies, sectionId, count = 6) {
  const len = sortedMovies.length;
  if (len === 0) return { movies: [], selectedIndex: -1 };
  if (len <= count) {
    const idx = Math.floor(Math.random() * len);
    return { movies: sortedMovies, selectedIndex: idx };
  }

  const weights = new Array(len).fill(1);

  // #3 anti-repeat: push away from recently shown spots in this library.
  const picks = recentLibPicks.get(sectionId) || [];
  const gameRadius = Math.min(RECENCY.gameRadius, Math.floor(len / 3));
  for (const p of picks) {
    const strength = RECENCY.gameStrength * Math.pow(RECENCY.gameDecay, p.age);
    applyPenalty(weights, p.index, strength, gameRadius);
  }

  // #4 recently-watched: push away from sections watched in Plex (big libs only).
  if (len >= RECENCY.smallLibThreshold) {
    const watched = watchHistory.bySection.get(Number(sectionId));
    if (watched && watched.size > 0) {
      const nowSec = Date.now() / 1000;
      const windowSec = RECENCY.watchWindowDays * 86400;
      for (let i = 0; i < len; i++) {
        const viewedAt = watched.get(normalizeTitle(sortedMovies[i].title));
        if (viewedAt == null) continue;
        const ageSec = nowSec - viewedAt;
        if (ageSec < 0 || ageSec > windowSec) continue;
        const recencyWeight = 1 - ageSec / windowSec; // 1 just now -> 0 at window edge
        applyPenalty(weights, i, RECENCY.watchStrength * recencyWeight, RECENCY.watchRadius);
      }
    }
  }

  for (let i = 0; i < len; i++) {
    if (weights[i] < RECENCY.weightFloor) weights[i] = RECENCY.weightFloor;
  }

  const pickedIndex = weightedRandom(weights);
  const positionInGroup = Math.floor(Math.random() * count);

  let startIndex = pickedIndex - positionInGroup;
  if (startIndex < 0) startIndex = 0;
  if (startIndex + count > len) startIndex = len - count;

  recordLibPick(sectionId, pickedIndex);

  return {
    movies: sortedMovies.slice(startIndex, startIndex + count),
    selectedIndex: pickedIndex - startIndex,
  };
}

// --- API endpoints ---

app.get('/api/shuffle', async (req, res) => {
  ageRecency();
  await refreshWatchHistory();

  const libraryResults = [];
  for (const lib of libraries) {
    const data = plexLibraries.get(lib.sectionId);
    if (!data || data.movies.length === 0) {
      libraryResults.push({ name: lib.name, movies: [] });
      continue;
    }
    const { movies, selectedIndex } = selectWithNeighborsWeighted(data.movies, lib.sectionId, 6);
    libraryResults.push({ name: data.name, movies, selectedIndex });
  }

  res.json({ libraries: libraryResults });
});

app.get('/api/poster', async (req, res) => {
  const thumb = String(req.query.thumb || '');
  if (!THUMB_RE.test(thumb)) return res.status(400).json({ error: 'bad thumb' });
  try {
    const r = await fetch(`${plexUrl}${thumb}`, { headers: { 'X-Plex-Token': plexToken } });
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error('Poster fetch failed:', err.message);
    res.status(502).end();
  }
});

app.get('/api/refresh', async (req, res) => {
  await scanAllPlexLibraries();
  const counts = {};
  for (const lib of libraries) {
    const data = plexLibraries.get(lib.sectionId);
    counts[data?.name || lib.name] = data?.movies.length || 0;
  }
  res.json({ ok: true, counts });
});

// Unknown API path -> JSON 404 (so it doesn't fall through to the SPA catch-all).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint' });
});

// --- Production: serve built frontend ---

const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// --- Start ---

async function start() {
  console.log('Scanning Plex libraries...');
  await scanAllPlexLibraries();

  app.listen(port, () => {
    console.log(`The Game server running on http://localhost:${port}`);
  });

  // Refresh Plex libraries every 24 hours.
  setInterval(async () => {
    console.log('Auto-refreshing Plex libraries...');
    await scanAllPlexLibraries();
    console.log('Auto-refresh complete.');
  }, 24 * 60 * 60 * 1000);
}

start();
