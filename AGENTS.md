# Agents

Guidelines for AI agents (Claude Code, Copilot, etc.) working on this project.

## Project Context

The Game is a personal movie randomizer. It picks random movies from Plex libraries and curated studio lists, displaying them in a visual poster grid. There is no database, no user authentication, no multi-tenancy. Keep it simple.

## Tech Stack

- **Backend**: Node.js + Express, single file (`server.js`), ES modules
- **Frontend**: React 18 + Vite, no state management library
- **Styling**: Plain CSS in `src/App.css`, no CSS framework
- **Deployment**: Docker on Synology NAS

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express backend -- Plex API, TMDB API, shuffle logic, static serving |
| `src/App.jsx` | Main React component -- all state, layout, section rendering |
| `src/App.css` | All styles -- dark theme, grid layout, animations, mobile toggle |
| `src/components/MovieCard.jsx` | Reusable poster card with fallback and selected highlight |
| `src/components/ShuffleButton.jsx` | Play / Play Again button |
| `config.json` | Runtime config (gitignored) -- Plex URL/token, TMDB key, library IDs |
| `studio-lists/*.txt` | Curated movie title lists, one per line |

## Architecture Rules

- **No database**. All data is in memory, loaded from Plex API and text files on startup. Recency
  state (recent picks, Plex watch history) is in-memory only and resets on restart -- no persistence.
- **Recency-weighted, not pure-random**. Selection is weighted to reduce repeats and steer away from
  recently-watched sections (see `selectWithNeighborsWeighted` / `applyPenalty` in `server.js` and the
  Recency Weighting section in `ARCHITECTURE.md`). Keep a weight floor so nothing is ever impossible.
- **Single Express file**. Don't split `server.js` into modules unless it exceeds ~300 lines.
- **Single CSS file**. Don't introduce CSS modules, Tailwind, or styled-components.
- **No state management library**. All state lives in `App.jsx` via `useState`.

## Code Style

- ES module imports (`import`/`export`), not CommonJS
- Functional React components with hooks, no class components
- No TypeScript -- this is a small personal project
- Minimal dependencies -- don't add packages for things that can be done in a few lines
- Poster normalization uses `padding-bottom: 150%` trick for consistent 2:3 aspect ratio

## Common Tasks

### Adding a new Plex library
1. Find the section ID at `{plexUrl}/library/sections?X-Plex-Token={token}`
2. Add an entry to `config.json` under `libraries`
3. Add an emoji mapping in `LIBRARY_EMOJIS` in `App.jsx`

### Adding a new studio collection
1. Create `studio-lists/newstudio.txt` with one title per line (this is the curated *base*)
2. Add `'newstudio'` to the `STUDIOS` array near the top of `server.js`
3. Add its TMDB company ID(s) to `DEFAULT_STUDIO_COMPANIES` (and/or `studioCompanies` in config) so new
   releases auto-discover; omit it to use the curated list only
4. Add an emoji mapping in `STUDIO_EMOJIS` in `App.jsx`

### Updating studio lists
Edit the `.txt` files directly (curated base). One movie title per line. The server merges these with
TMDB-discovered new releases and filters to released + streamable titles, so a `.txt` title may not
appear if it isn't streamable. Restart the server, hit `/api/refresh`, or rebuild the container to apply.

### De-clustering a franchise
Series whose titles share a long prefix (e.g. "Harry Potter and the ...") sort into one
alphabetical cluster, so a shuffle pick there fills the whole row with that series. Add the
shared prefix as a regex to the `SORT_PREFIXES` array in `server.js` -- films then sort by
their distinctive part. Display titles are unaffected. `server.js` is bind-mounted, so
`docker-compose restart the-game` applies it (no rebuild).

### Refreshing Plex data without restart
Hit `GET /api/refresh` -- this re-scans all Plex libraries **and rebuilds the streamable studio
pools**, returning `{ ok, counts, studioCounts }`. The same refresh also runs automatically every
24 hours.

## Testing

There are no automated tests. To verify changes:

1. `npm run dev` -- starts backend + Vite
2. Open `http://localhost:5173`
3. Confirm splash animation plays (~5 seconds) with the "Legends Never Die" tagline + glow flourish
4. Confirm poster grid loads with 6 movies per library row
5. Confirm studio picks show with TMDB posters (all released + streamable)
6. Click "Play Again" -- new selections should appear, splash should NOT replay
7. Click the mobile toggle -- layout should narrow
8. `npx vite build` -- confirm production build succeeds

## Sensitive Values

- `config.json` contains Plex token and TMDB API key -- it is gitignored
- Never hardcode tokens in source files
- `config.example.json` has placeholder values for reference

## Docker

- Multi-stage build: build stage compiles frontend, production stage runs Express
- `config.json`, `studio-lists/`, and `server.js` are mounted as read-only volumes
- Synology Container Manager compatible (bridge network mode)
- **Backend (`server.js`), config, or studio-list change:** `docker-compose restart the-game` (no rebuild)
- **Frontend (`src/`) change:** `docker-compose up -d --build` (rebuilds `dist/`)
- Prefer `restart` -- `--build` recreates the container (new ID) and can leave a stale
  `<oldid>_the-game` entry in Synology Container Manager until its package is restarted
