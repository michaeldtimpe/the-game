# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts curated lists
- Displays everything in a dark-themed poster grid with movie artwork

The randomly chosen movie in each library row is highlighted with a white title. Studio picks show posters fetched from TMDB.

## How it works

The randomization logic lives in two places:

### Frontend (`src/App.jsx`)

The `shuffle()` function (line 26) is the entry point. It is called once on mount via the `useEffect` hook (line 41) and again whenever the user clicks the **Play** button. It fetches `/api/shuffle` and stores the result in the `data` state, which drives the poster grid rendering.

### Backend (`server.js`)

The `/api/shuffle` endpoint (line 126) performs two independent randomization tasks:

1. **Plex library picks** — For each configured library, the `selectWithNeighbors()` function (line 103) is called with the alphabetically sorted movie list. It:
   - Picks a random index (`pickedIndex`) from the full sorted list.
   - Picks a random position within a group of 6 (`positionInGroup`).
   - Slices a window of 6 movies so that the picked movie appears at the chosen position, clamped to the list boundaries.
   - Returns the 6-movie window and the index of the picked movie within that window (`selectedIndex`).

2. **Studio picks** — For each studio list file (e.g. `studio-lists/disney.txt`), a random title is chosen with `Math.random()` (line 141), and its poster is fetched from the TMDB API via `getTmdbPoster()` (line 80), which caches results in `tmdbCache` to avoid repeated API calls.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy and configure
cp config.example.json config.json
# Edit config.json with your Plex URL, token, TMDB key, and library section IDs

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

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "plexUrl": "http://192.168.1.247:32400",
  "plexToken": "YOUR_PLEX_TOKEN",
  "plexLibraries": "YOUR_TMDB_API_KEY",
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
- **TMDB API Key**: Free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
- **Library Section IDs**: Visit `http://YOUR_PLEX:32400/library/sections?X-Plex-Token=TOKEN` -- the `key` attribute on each `<Directory>` is the section ID.

## Studio Lists

The `studio-lists/` folder contains curated text files (one movie title per line):

| File | Titles |
|------|--------|
| disney.txt | 74 |
| marvel.txt | 50 |
| pixar.txt | 27 |
| lucasarts.txt | 24 |

Edit these files to add or remove titles. Changes take effect on next server restart.

## Features

- 5-second splash animation on first load
- Play Again button to reshuffle without reloading
- Mobile/desktop view toggle
- Movie posters from Plex (local) and TMDB (studio picks)
- Responsive layout with dark Plex-inspired theme
- TMDB poster caching to avoid rate limits
- Library refresh endpoint (`/api/refresh`) for when new movies are added

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/shuffle` | Returns randomized selections for all libraries and studio picks |
| `GET /api/refresh` | Re-scans Plex libraries and returns updated movie counts |

## Previous Versions

The `previous-versions/` directory contains the v1 and v2 Python CLI implementations that used weighted randomization and history tracking. The current version (v3) is a complete rewrite with no database or history -- pure random each time.
