# The Game

A movie randomizer web app that picks films from your Plex libraries, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- **House of Mouse** row: six picks from the Plex "mouse movies" section (Disney, Pixar, Star Wars and the rest of the mouse films), weighted like any other library row
- Displays everything in a dark-themed poster grid with movie artwork

The randomization is **recency-weighted**: it steers away from spots it just showed you, and away from sections you recently watched in Plex, so repeats are rarer (see Recency Weighting).

The randomly chosen movie in each library row is highlighted with a white title.

**Franchise de-clustering:** libraries are browsed in alphabetical order, so a long shared prefix would otherwise bunch a whole series together -- every "Harry Potter and the ..." film sorts under "Ha", so a pick there fills the entire row with Harry Potter. The shuffle instead sorts such titles by their distinctive part (*Chamber of Secrets*, *Goblet of Fire*, *Prisoner of Azkaban* ...), scattering them across the library for a more varied row. The full title is still shown on each card. To de-cluster another series, add its prefix to `SORT_PREFIXES` in `server.js`.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy and configure
cp config.example.json config.json
# Edit config.json with your Plex URL, token, and library section IDs

# Run in dev mode (backend + Vite hot reload)
npm run dev
# Open http://localhost:5173
```

### Production

```bash
npm run build
npm start
# Open http://localhost:3000
```

### Docker (Synology Compatible)

```bash
# Place config.json next to docker-compose.yml
docker-compose up -d --build
# Open http://YOUR_NAS_IP:3000
```

On Synology, you can also import via Container Manager by pointing a new project at this folder.

For deploying/operating the live instance (on a Synology NAS), see [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "plexUrl": "http://YOUR_PLEX_IP:32400",
  "plexToken": "YOUR_PLEX_TOKEN",
  "libraries": [
    { "name": "New", "sectionId": 1 },
    { "name": "Fang", "sectionId": 2 },
    { "name": "Floof", "sectionId": 3 }
  ],
  "port": 3000
}
```

**Finding your values:**

- **Plex Token**: In Plex Web, open any media > Get Info > View XML. The `X-Plex-Token` is in the URL.
- **Library Section IDs**: Visit `http://YOUR_PLEX:32400/library/sections?X-Plex-Token=TOKEN` -- the `key` attribute on each `<Directory>` is the section ID.

## Recency Weighting

Instead of pure uniform random, each pick is weighted to reduce repeats; weights decay back to normal over subsequent shuffles:

- **Anti-repeat (all libraries):** spots shown in recent shuffles are temporarily down-weighted, so you don't keep landing in the same place.
- **Recently-watched bias (big libraries only):** the server reads your Plex watch history and steers picks away from the alphabetical sections of titles you watched recently. Skipped for small libraries (e.g. `New`).

No pick is ever made impossible (there's a weight floor). All strengths/radii/decay are tunable under `recency` in config; sane defaults live in `server.js`.

## Features

- 5-second splash animation on first load, with a "Legends Never Die" tagline and an animated gold glow/light-sweep flourish (shows only on first load/reload, not on Play Again)
- Play Again button to reshuffle without reloading
- Mobile/desktop view toggle
- Movie posters from Plex, proxied through the server (`/api/poster`) so the token stays server-side
- Responsive layout with dark Plex-inspired theme
- Recency-weighted randomization to reduce repeats (see Recency Weighting)
- Plex libraries auto-refresh every 24 hours; manual refresh via `/api/refresh`
- Franchise de-clustering so a single series doesn't fill a whole row (see above)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/shuffle` | Returns recency-weighted randomized selections for all libraries |
| `GET /api/refresh` | Re-scans Plex libraries and returns updated per-library counts (`counts`) |

## Previous Versions

The `previous-versions/` directory contains the v1 and v2 Python CLI implementations that used weighted randomization and history tracking. The current version (v3) is a complete rewrite with no database or history -- pure random each time.
