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

1. Load `config.json` (Plex URL/token, TMDB key, library definitions)
2. Read studio `.txt` files from `studio-lists/` into memory arrays
3. Fetch all movies from each configured Plex library section via the Plex API
4. Sort each library alphabetically by a **sort key** that strips known franchise prefixes (see Franchise De-clustering)
5. Start Express on the configured port
6. Schedule a background re-scan of all Plex libraries every 24 hours

### In-Memory Data

```
plexLibraries: Map<sectionId, { name, movies: [{ title, posterUrl }] }>
studioLists:   { disney: [titles], marvel: [titles], pixar: [titles], lucasarts: [titles] }
tmdbCache:     Map<title, posterUrl>
```

Total memory footprint is minimal -- roughly 1,300 movies across all sources, each stored as a title string and a URL.

### Core Algorithm: Neighbor Selection

The key algorithm simulates browsing a Plex shelf:

1. Pick a random index in the alphabetically sorted library
2. Pick a random position (0-5) for where the selected movie sits in the visible group
3. Calculate the start index so the selected movie lands at that position
4. Clamp to array bounds
5. Return the 6-movie slice and the selected index

This means the user sees a realistic alphabetical cluster of movies, and the actual pick blends in at a random position.

### Franchise De-clustering

The neighbor algorithm relies on alphabetical order, which has a failure mode: a series whose entries all share a long prefix collapses into a single alphabetical cluster. Every "Harry Potter and the ..." film sorts under "Ha", so any pick that lands there returns a row of nothing but Harry Potter.

To avoid this, libraries are sorted by `sortKey(title)` rather than the raw title. `sortKey` strips a known franchise prefix (matched against the `SORT_PREFIXES` regex list in `server.js`) so each film sorts by its distinctive part -- *Chamber of Secrets* under C, *Goblet of Fire* under G, *Prisoner of Azkaban* under P -- spreading the series across the library. Only sort/cluster order is affected; the full title is still stored and displayed on the card. Adding another franchise is a one-line addition to `SORT_PREFIXES`.

### API Endpoints

**`GET /api/shuffle`** -- The primary endpoint. For each library, runs the neighbor selection algorithm. For each studio, picks a random title and fetches its poster from TMDB (with in-memory caching). Returns a single JSON payload with all results.

**`GET /api/refresh`** -- Re-fetches all Plex libraries on demand. Useful after adding new movies to Plex without restarting the container. The same re-scan also runs automatically every 24 hours via a `setInterval` started after the server boots.

### TMDB Caching

Studio pick posters are cached in a `Map<title, posterUrl>`. Once a title's poster is fetched, it's never fetched again for the lifetime of the process. With only 4 TMDB calls per shuffle and ~180 total studio titles, the cache fills quickly and most shuffles hit zero TMDB API calls.

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

On first load, a centered "The Game" title animates in (scale + fade, 1.2s), holds for ~4.2 seconds, then fades out over 0.8s (5 seconds total). The shuffle API call fires simultaneously so data is ready when the splash ends.

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
