import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const STUDIOS = ['disney', 'marvel', 'pixar', 'lucasarts'];

// TMDB company IDs used to auto-discover newer films per studio (hybrid freshness):
// Walt Disney Pictures + Walt Disney Animation Studios, Marvel Studios, Pixar, Lucasfilm.
const DEFAULT_STUDIO_COMPANIES = {
  disney: [2, 6125],
  marvel: [420],
  pixar: [3],
  lucasarts: [1],
};

// Quality gates for AUTO-DISCOVERED titles (curated titles are exempt — they're
// deliberate picks). Keep out making-of featurettes, shorts, and TV specials.
const MIN_DISCOVER_VOTES = 30;     // discover: skip obscure specials/featurettes
const MIN_DISCOVERED_RUNTIME = 40; // minutes; skip shorts/featurettes (when runtime known)

// Recency / anti-repeat tuning. Overridable via config.recency.
const DEFAULT_RECENCY = {
  gameStrength: 0.9,    // how hard to push away from a just-picked spot (0-1)
  gameRadius: 15,       // neighborhood (in movies) the game-pick penalty spans
  gameDecay: 0.5,       // per-shuffle decay of the game-pick penalty
  watchStrength: 0.6,   // how hard to push away from a recently-watched spot
  watchRadius: 18,      // neighborhood the watch penalty spans
  watchWindowDays: 30,  // how far back watch history still influences picks
  studioStrength: 0.85, // anti-repeat strength for studio picks
  studioDecay: 0.5,     // per-shuffle decay of the studio penalty
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
const { plexUrl, plexToken, tmdbApiKey, libraries, port = 3000 } = config;
const region = config.region || 'US';
const studioCompanies = config.studioCompanies || DEFAULT_STUDIO_COMPANIES;
const RECENCY = { ...DEFAULT_RECENCY, ...(config.recency || {}) };

// --- In-memory data ---

const plexLibraries = new Map();  // sectionId -> { name, movies: [{ title, posterUrl }] }
const studioLists = {};           // studio -> [curated title strings]
const studioStreamable = {};      // studio -> [{ title, posterUrl }] (released + streamable, vetted)
const tmdbResolveCache = new Map();  // normalizedTitle -> { id, title, releaseDate, posterPath } | null
const tmdbMetaCache = new Map();     // tmdb id -> { streamable, runtime, isDocumentary }; cleared on rebuild

// Recency state (in-memory; resets on restart, matching the app's stateless design).
const recentLibPicks = new Map(); // sectionId -> [{ index, age }]
const recentStudioPicks = {};     // studio -> [{ title (normalized), age }]
let watchHistory = { fetchedAt: 0, bySection: new Map() }; // sectionId -> Map<normalizedTitle, viewedAt(sec)>

// --- Helpers ---

function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isReleased(releaseDate) {
  return Boolean(releaseDate) && releaseDate <= todayStr();
}

// Run an async mapper over items with a bounded number in flight, to stay
// friendly to the TMDB API.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- Studio list loading ---

function loadStudioLists() {
  for (const studio of STUDIOS) {
    const filePath = join(__dirname, 'studio-lists', `${studio}.txt`);
    if (!existsSync(filePath)) {
      console.warn(`Missing studio list: ${filePath}`);
      studioLists[studio] = [];
      continue;
    }
    const lines = readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    studioLists[studio] = lines;
    console.log(`Loaded ${lines.length} curated titles for ${studio}`);
  }
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
];

function sortKey(title) {
  for (const prefix of SORT_PREFIXES) {
    if (prefix.test(title)) return title.replace(prefix, '');
  }
  return title;
}

// --- Plex API ---

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
        posterUrl: m.thumb ? `${plexUrl}${m.thumb}?X-Plex-Token=${plexToken}` : null
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

// --- TMDB API ---

async function tmdbDiscover(companyId, page) {
  try {
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${encodeURIComponent(tmdbApiKey)}` +
      `&with_companies=${companyId}&sort_by=primary_release_date.desc&include_adult=false` +
      `&without_genres=99&vote_count.gte=${MIN_DISCOVER_VOTES}` + // drop documentaries / making-of / obscure specials
      `&primary_release_date.lte=${todayStr()}&region=${region}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB discover returned ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(m => ({
      id: m.id,
      title: m.title,
      releaseDate: m.release_date || null,
      posterPath: m.poster_path || null,
    }));
  } catch (err) {
    console.error(`TMDB discover failed (company ${companyId}, page ${page}):`, err.message);
    return [];
  }
}

async function resolveTitle(title) {
  const key = normalizeTitle(title);
  if (tmdbResolveCache.has(key)) return tmdbResolveCache.get(key);
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdbApiKey)}&query=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB search returned ${res.status}`);
    const data = await res.json();
    const hit = (data.results || [])[0];
    const info = hit
      ? { id: hit.id, title: hit.title, releaseDate: hit.release_date || null, posterPath: hit.poster_path || null }
      : null;
    tmdbResolveCache.set(key, info);
    return info;
  } catch (err) {
    console.error(`TMDB search failed for "${title}":`, err.message);
    tmdbResolveCache.set(key, null);
    return null;
  }
}

// One call -> streaming availability ("flatrate" provider in our region), runtime,
// and whether it's a documentary. Used to gate the pool. Cached per id (cleared on rebuild).
async function getMovieMeta(id) {
  if (tmdbMetaCache.has(id)) return tmdbMetaCache.get(id);
  try {
    const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${encodeURIComponent(tmdbApiKey)}&append_to_response=watch/providers`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB movie returned ${res.status}`);
    const data = await res.json();
    const flatrate = data['watch/providers']?.results?.[region]?.flatrate || [];
    const meta = {
      streamable: flatrate.length > 0,
      runtime: data.runtime ?? null,
      isDocumentary: (data.genres || []).some(g => g.id === 99),
    };
    tmdbMetaCache.set(id, meta);
    return meta;
  } catch (err) {
    console.error(`TMDB movie lookup failed for id ${id}:`, err.message);
    const meta = { streamable: false, runtime: null, isDocumentary: false };
    tmdbMetaCache.set(id, meta);
    return meta;
  }
}

// --- Studio pools (Feature #1): curated base + auto-discovered new releases,
// filtered to titles that are released AND currently streamable, with posters
// precomputed so /api/shuffle makes no TMDB calls. ---

async function buildStudioPool(studio) {
  const curated = studioLists[studio] || [];
  const companies = studioCompanies[studio] || [];

  // Auto-discover newer releases from each company (first 2 pages, newest first).
  const discovered = [];
  for (const companyId of companies) {
    for (let page = 1; page <= 2; page++) {
      discovered.push(...await tmdbDiscover(companyId, page));
    }
  }
  // Seed the resolve cache with discovery data (id/date/poster already known).
  for (const d of discovered) {
    const key = normalizeTitle(d.title);
    if (!tmdbResolveCache.has(key)) tmdbResolveCache.set(key, d);
  }

  // Candidate titles = curated (display titles win) + discovered, de-duped.
  const curatedKeys = new Set(curated.map(normalizeTitle));
  const byKey = new Map();
  for (const t of curated) byKey.set(normalizeTitle(t), t);
  for (const d of discovered) {
    const key = normalizeTitle(d.title);
    if (!byKey.has(key)) byKey.set(key, d.title);
  }
  const candidateTitles = [...byKey.values()];

  // Resolve + filter, bounded concurrency. All must be released + streamable;
  // auto-discovered titles additionally must look like real features (runtime,
  // not a documentary) so making-of featurettes and shorts don't sneak in.
  const vetted = await mapLimit(candidateTitles, 6, async (title) => {
    const info = await resolveTitle(title);
    if (!info || !info.id) return null;
    if (!isReleased(info.releaseDate)) return null;
    const meta = await getMovieMeta(info.id);
    if (!meta.streamable) return null;
    const isCurated = curatedKeys.has(normalizeTitle(title));
    if (!isCurated) {
      if (meta.isDocumentary) return null;
      if (meta.runtime != null && meta.runtime < MIN_DISCOVERED_RUNTIME) return null;
    }
    return {
      title, // keep the display/curated title
      posterUrl: info.posterPath ? `https://image.tmdb.org/t/p/w342${info.posterPath}` : null,
    };
  });
  const pool = vetted.filter(Boolean);

  if (pool.length === 0) {
    // Safety net (e.g. TMDB outage): never leave a studio row blank.
    console.warn(`Studio "${studio}": streamable pool empty — falling back to curated titles`);
    studioStreamable[studio] = curated.map(t => ({ title: t, posterUrl: null }));
    return;
  }
  studioStreamable[studio] = pool;
  console.log(`Studio "${studio}": ${pool.length} streamable titles (from ${candidateTitles.length} candidates)`);
}

async function buildAllStudioPools() {
  tmdbMetaCache.clear(); // re-check streaming availability each rebuild (providers change)
  for (const studio of STUDIOS) {
    await buildStudioPool(studio);
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
  for (const studio of STUDIOS) {
    const picks = recentStudioPicks[studio] || [];
    recentStudioPicks[studio] = picks
      .map(p => ({ ...p, age: p.age + 1 }))
      .filter(p => p.age <= RECENCY.maxAge);
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

// Anti-repeat (#3) for studio picks over the vetted pool.
function pickStudio(studio) {
  const pool = studioStreamable[studio] || [];
  if (pool.length === 0) return null;

  const weights = pool.map(() => 1);
  const recent = recentStudioPicks[studio] || [];
  for (const r of recent) {
    const strength = RECENCY.studioStrength * Math.pow(RECENCY.studioDecay, r.age);
    for (let i = 0; i < pool.length; i++) {
      if (normalizeTitle(pool[i].title) === r.title) weights[i] *= (1 - strength);
    }
  }
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < RECENCY.weightFloor) weights[i] = RECENCY.weightFloor;
  }

  const chosen = pool[weightedRandom(weights)];
  recentStudioPicks[studio] = [...recent, { title: normalizeTitle(chosen.title), age: 0 }];
  return chosen;
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

  const studioPicks = STUDIOS.map(studio => {
    const chosen = pickStudio(studio);
    return {
      studio: studio.charAt(0).toUpperCase() + studio.slice(1),
      title: chosen?.title || null,
      posterUrl: chosen?.posterUrl || null,
    };
  });

  res.json({ libraries: libraryResults, studioPicks });
});

app.get('/api/refresh', async (req, res) => {
  await scanAllPlexLibraries();
  await buildAllStudioPools();
  const counts = {};
  for (const lib of libraries) {
    const data = plexLibraries.get(lib.sectionId);
    counts[data?.name || lib.name] = data?.movies.length || 0;
  }
  const studioCounts = {};
  for (const studio of STUDIOS) studioCounts[studio] = (studioStreamable[studio] || []).length;
  res.json({ ok: true, counts, studioCounts });
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
  console.log('Loading studio lists...');
  loadStudioLists();

  console.log('Scanning Plex libraries...');
  await scanAllPlexLibraries();

  console.log('Building studio pools...');
  await buildAllStudioPools();

  app.listen(port, () => {
    console.log(`The Game server running on http://localhost:${port}`);
  });

  // Refresh Plex libraries and studio pools every 24 hours.
  setInterval(async () => {
    console.log('Auto-refreshing Plex libraries and studio pools...');
    await scanAllPlexLibraries();
    await buildAllStudioPools();
    console.log('Auto-refresh complete.');
  }, 24 * 60 * 60 * 1000);
}

start();
