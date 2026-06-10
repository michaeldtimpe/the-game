import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

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

// --- In-memory data ---

const plexLibraries = new Map(); // sectionId -> { name, movies: [{ title, posterUrl }] }
const studioLists = {};          // key -> [title strings]
const tmdbCache = new Map();     // title -> posterUrl

// --- Studio list loading ---

function loadStudioLists() {
  const studios = ['disney', 'marvel', 'pixar', 'lucasarts'];
  for (const studio of studios) {
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
    console.log(`Loaded ${lines.length} titles for ${studio}`);
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

// --- TMDB API ---

async function getTmdbPoster(title) {
  if (tmdbCache.has(title)) return tmdbCache.get(title);

  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdbApiKey)}&query=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB returned ${res.status}`);
    const data = await res.json();
    let posterUrl = null;
    if (data.results && data.results.length > 0 && data.results[0].poster_path) {
      posterUrl = `https://image.tmdb.org/t/p/w342${data.results[0].poster_path}`;
    }
    tmdbCache.set(title, posterUrl);
    return posterUrl;
  } catch (err) {
    console.error(`TMDB lookup failed for "${title}":`, err.message);
    tmdbCache.set(title, null);
    return null;
  }
}

// --- Neighbor selection algorithm ---

function selectWithNeighbors(sortedMovies, count = 6) {
  const len = sortedMovies.length;
  if (len === 0) return { movies: [], selectedIndex: -1 };
  if (len <= count) {
    const idx = Math.floor(Math.random() * len);
    return { movies: sortedMovies, selectedIndex: idx };
  }

  const pickedIndex = Math.floor(Math.random() * len);
  const positionInGroup = Math.floor(Math.random() * count);

  let startIndex = pickedIndex - positionInGroup;
  if (startIndex < 0) startIndex = 0;
  if (startIndex + count > len) startIndex = len - count;

  return {
    movies: sortedMovies.slice(startIndex, startIndex + count),
    selectedIndex: pickedIndex - startIndex
  };
}

// --- API endpoints ---

app.get('/api/shuffle', async (req, res) => {
  const libraryResults = [];

  for (const lib of libraries) {
    const data = plexLibraries.get(lib.sectionId);
    if (!data || data.movies.length === 0) {
      libraryResults.push({ name: lib.name, movies: [] });
      continue;
    }
    const { movies, selectedIndex } = selectWithNeighbors(data.movies, 6);
    libraryResults.push({ name: data.name, movies, selectedIndex });
  }

  const studioPickPromises = Object.entries(studioLists).map(async ([studio, titles]) => {
    if (titles.length === 0) return { studio, title: null, posterUrl: null };
    const title = titles[Math.floor(Math.random() * titles.length)];
    const posterUrl = await getTmdbPoster(title);
    return {
      studio: studio.charAt(0).toUpperCase() + studio.slice(1),
      title,
      posterUrl
    };
  });

  const studioPicks = await Promise.all(studioPickPromises);

  res.json({ libraries: libraryResults, studioPicks });
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

  app.listen(port, () => {
    console.log(`The Game server running on http://localhost:${port}`);
  });

  // Refresh Plex libraries every 24 hours
  setInterval(async () => {
    console.log('Auto-refreshing Plex libraries...');
    await scanAllPlexLibraries();
    console.log('Auto-refresh complete.');
  }, 24 * 60 * 60 * 1000);
}

start();
