# Architecture

## Overview

The Game is a single-page web application with a Node.js backend and React frontend. All movie data is held in memory -- there is no database. The backend talks to two external APIs (Plex and TMDB) and serves both the API and the built frontend from a single Express process.

```
Browser <---> Express (server.js, port 3000)
                |         |
                |         +--> Serves built React app (dist/)
                |
                +--> Plex API (movie titles + poster URLs)
                +--> TMDB API (studio pick poster URLs)
                +--> Studio text files (curated title lists)
```

## Backend: `server.js`

A single Express file with no external dependencies beyond Express itself.

### Startup Sequence

1. Load `config.json` (Plex URL/token, TMDB key, library definitions, optional `region`/`studioCompanies`/`recency`)
2. Read studio `.txt` files from `studio-lists/` into memory arrays
3. Fetch all movies from each configured Plex library section via the Plex API
4. Sort each library alphabetically by a **sort key** that strips known franchise prefixes (see Franchise De-clustering)
5. Build the **streamable studio pools** from curated lists + TMDB auto-discovery (see Studio Pools)
6. Start Express on the configured port
7. Schedule a background re-scan of all Plex libraries and a studio-pool rebuild every 24 hours

### In-Memory Data

```
plexLibraries:     Map<sectionId, { name, movies: [{ title, posterUrl }] }>
studioLists:       { disney: [titles], ... }            // curated base, from .txt
studioStreamable:  { disney: [{ title, posterUrl }], ... } // vetted: released + streamable
tmdbResolveCache:  Map<normalizedTitle, { id, releaseDate, posterPath } | null>
tmdbProviderCache: Map<tmdbId, boolean>                 // cleared on each pool rebuild
recentLibPicks:    Map<sectionId, [{ index, age }]>     // anti-repeat state
recentStudioPicks: { disney: [{ title, age }], ... }    // anti-repeat state
watchHistory:      { fetchedAt, bySection: Map<sectionId, Map<title, viewedAt>> }
```

Total memory footprint is minimal -- roughly 1,300 movies across all sources, each stored as a title string and a URL. Recency state (`recentLibPicks`, `recentStudioPicks`, `watchHistory`) is in-memory only and resets on restart.

### Core Algorithm: Neighbor Selection

The key algorithm simulates browsing a Plex shelf:

1. Build a weight array over the sorted library (see Recency Weighting), then pick an index via weighted random
2. Pick a random position (0-5) for where the selected movie sits in the visible group
3. Calculate the start index so the selected movie lands at that position
4. Clamp to array bounds
5. Return the 6-movie slice and the selected index

This means the user sees a realistic alphabetical cluster of movies, and the actual pick blends in at a random position.

### Recency Weighting

`selectWithNeighborsWeighted` replaces the old uniform index pick with a weighted one. Every shuffle, `ageRecency()` first ages all recency records and drops fully-decayed ones, then each library builds a weight array (default 1.0 per index) and applies penalties via `applyPenalty(weights, center, strength, radius)` (linear/triangular falloff), with a `weightFloor` so nothing is ever impossible:

- **Anti-repeat (#3):** `recentLibPicks[sectionId]` holds recently-picked indices; each applies `gameStrength * gameDecay^age` around its index (radius clamped to `len/3` so small libraries aren't wiped out). The just-made pick is recorded *after* selection, so it only biases *future* shuffles.
- **Recently-watched (#4):** for libraries at/above `smallLibThreshold`, `watchHistory` maps recently-watched titles (from Plex) to their indices; each applies `watchStrength * recencyWeight` (recencyWeight decays linearly to zero at `watchWindowDays`), steering away from sections recently watched. Skipped for small libraries (e.g. `New`).

`weightedRandom(weights)` does cumulative-sum selection. Studio picks use the same idea over the vetted pool (`recentStudioPicks`, `studioStrength`/`studioDecay`).

### Studio Pools

`buildStudioPool(studio)` produces `studioStreamable[studio]`, a pre-vetted list of `{ title, posterUrl }`:

1. **Base:** curated titles from `studio-lists/<studio>.txt`.
2. **Auto-discover:** newer films from each studio's TMDB company IDs (`/discover/movie?with_companies=...&primary_release_date.lte=today`), de-duped against the curated titles.
3. **Filter:** each candidate is resolved to a TMDB id (`tmdbResolveCache`) and kept only if **released** and **streamable** (non-empty regional `flatrate` provider, `tmdbProviderCache`).
4. **Fallback:** if a pool comes back empty (e.g. TMDB outage), it falls back to the raw curated titles so the row is never blank.

Because posters are baked into the pool, `/api/shuffle` makes **zero** TMDB calls. The pool is rebuilt at startup, every 24h, and on `/api/refresh`; `tmdbProviderCache` is cleared on each rebuild so streaming availability stays current. Lookups are concurrency-limited (`mapLimit`) to stay friendly to TMDB.

### Franchise De-clustering

The neighbor algorithm relies on alphabetical order, which has a failure mode: a series whose entries all share a long prefix collapses into a single alphabetical cluster. Every "Harry Potter and the ..." film sorts under "Ha", so any pick that lands there returns a row of nothing but Harry Potter.

To avoid this, libraries are sorted by `sortKey(title)` rather than the raw title. `sortKey` strips a known franchise prefix (matched against the `SORT_PREFIXES` regex list in `server.js`) so each film sorts by its distinctive part -- *Chamber of Secrets* under C, *Goblet of Fire* under G, *Prisoner of Azkaban* under P -- spreading the series across the library. Only sort/cluster order is affected; the full title is still stored and displayed on the card. Adding another franchise is a one-line addition to `SORT_PREFIXES`.

### API Endpoints

**`GET /api/shuffle`** -- The primary endpoint. Ages recency state and refreshes Plex watch history (cached ~5 min), then for each library runs the recency-weighted neighbor selection, and for each studio picks (weighted) from the pre-vetted pool. Makes no TMDB or per-pick external calls. Returns a single JSON payload with all results.

**`GET /api/refresh`** -- Re-fetches all Plex libraries **and rebuilds the studio pools** on demand. Returns `{ ok, counts, studioCounts }`. The same re-scan + rebuild also runs automatically every 24 hours via a `setInterval` started after the server boots.

### Watch History

`refreshWatchHistory()` pulls `/status/sessions/history/all` from Plex and indexes recently-watched titles by section (`watchHistory.bySection`). It's cached for `recency.historyTtlMs` (default 5 min) and refreshed lazily at shuffle time, so a movie night stays current without a fetch on every shuffle. This feeds the recently-watched bias (#4).

### TMDB Caching

Two caches back the studio pools: `tmdbResolveCache` (normalized title -> `{ id, releaseDate, posterPath }`, persists for the process lifetime since ids/dates are stable) and `tmdbProviderCache` (tmdb id -> streamable boolean, **cleared on each pool rebuild** so daily streaming changes propagate). Because pools are precomputed, individual shuffles make zero TMDB calls.

### Static File Serving

In production, the built React app (`dist/`) is served as static files from Express. The Vite dev server proxy (`/api -> localhost:3000`) handles this during development.

## Frontend: React + Vite

### Component Tree

```
App
 +-- ShuffleButton        -- Play / Play Again / Shuffling...
 +-- LibrarySection (x3)  -- One per Plex library
 |    +-- MovieCard (x6)  -- Poster + title, isSelected for white highlight
 +-- StudioPicks
      +-- StudioSection (x4)
           +-- MovieCard   -- Poster + title with studio header
```

### State

All state lives in `App.jsx`:

- `data` -- the shuffle response from the API
- `loading` -- fetch in progress
- `error` -- error message if fetch failed
- `showSplash` / `splashFading` -- splash screen lifecycle
- `mobileView` -- desktop/mobile layout toggle

There is no global state management. A single `fetch('/api/shuffle')` populates everything.

### Splash Animation

On first load, a centered "The Game" title animates in (scale + fade, 1.2s) with a one-pass golden light-sweep and a gentle glow pulse, and a "Legends Never Die" tagline expands in beneath it (delayed ~1.1s). It holds for ~4.2 seconds, then fades out over 0.8s (5 seconds total). The shuffle API call fires simultaneously so data is ready when the splash ends. The splash is mount-only, so **Play Again does not replay it** -- it only runs on first load/reload.

### Styling

All styles are in `App.css`. Key design decisions:

- **Dark theme** (#181818 background) matching Plex aesthetic
- **Inter font** via Google Fonts for the title and all text
- **Yellow (#e5a00d)** accent color for titles and buttons
- **White** for selected movie titles and section headers
- **Poster normalization**: all posters forced to 2:3 aspect ratio via `padding-bottom: 150%` with absolute positioning, preventing different source image sizes from breaking the grid
- **Grid layout**: 6-column grid for library rows, flexbox with `space-between` for 4 studio picks (aligning first/last cards with the library grid edges)
- **Mobile toggle**: adds `.mobile` class that constrains to 420px max-width and switches to 3-column library rows

## Docker

Multi-stage build for a small production image:

1. **Build stage**: `node:20-alpine`, installs all deps, runs `vite build`
2. **Production stage**: `node:20-alpine`, installs only production deps (Express), copies built frontend and server

The `docker-compose.yml` mounts `config.json`, `studio-lists/`, and `server.js` as read-only volumes, so backend/config/list changes apply with a `docker-compose restart` (no rebuild). Only frontend (`src/` -> `dist/`) changes require rebuilding the image. `server.js` is also `COPY`ed into the image as a fallback for running without the mount. Uses `network_mode: bridge` for Synology compatibility.

Preferring `restart` over `up -d --build` matters on Synology: a rebuild recreates the container with a new ID, which Container Manager can surface as a stale `<oldid>_the-game` entry until its package is restarted. A `restart` keeps the same container, avoiding that.

## Data Flow

```
1. User clicks "Play" or "Play Again"
2. Frontend: fetch('/api/shuffle')
3. Backend: for each library, selectWithNeighbors(sortedMovies, 6)
4. Backend: for each studio, random title + getTmdbPoster(title)
5. Backend: returns { libraries: [...], studioPicks: [...] }
6. Frontend: renders poster grid with data
```

## External Dependencies

### Runtime
- **express** -- HTTP server and static file serving

### Dev Only
- **vite** -- Build tool and dev server
- **@vitejs/plugin-react** -- React JSX transform
- **react / react-dom** -- UI framework
- **concurrently** -- Runs backend + Vite in parallel during dev

### External APIs
- **Plex API** -- Movie metadata and poster images (local network)
- **TMDB API** -- Poster images for studio picks (internet, free tier)
