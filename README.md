# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts curated lists
- Displays everything in a dark-themed poster grid with movie artwork

The randomly chosen movie in each library row is highlighted with a white title. Studio picks show posters fetched from TMDB.

## How it Works

The randomization logic lives in `server.js`. When the frontend calls `GET /api/shuffle`, two parallel processes run:

### Plex library picks

Each Plex library's movies are sorted alphabetically by title (see `fetchPlexLibrary` in `server.js`). The `selectWithNeighbors` function then:

1. Picks a random movie index from the full sorted list.
2. Picks a random "slot" (0–5) within a group of 6.
3. Calculates a window start index so the picked movie appears at that slot, clamped to the list boundaries.
4. Returns the 6-movie window and the index of the selected movie within it.

This mimics the Plex shelf experience: you land on a random film, and the 5 neighbors around it are shown as if you had scrolled to that position.

### Studio picks

Curated lists from `studio-lists/` (e.g. `disney.txt`, `marvel.txt`) are loaded into memory at startup. For each studio, a title is chosen with `Math.floor(Math.random() * titles.length)` and its poster is fetched from the TMDB API (with caching).

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
