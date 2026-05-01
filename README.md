# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts curated lists
- Displays everything in a dark-themed poster grid with movie artwork

The randomly chosen movie in each library row is highlighted with a white title. Studio picks show posters fetched from TMDB.

## How it Works

The randomization logic lives in `server.js`. On startup, the server loads two kinds of data sources:

1. **Plex libraries** — each configured library is scanned via the Plex API, and its movies are sorted alphabetically by title.
2. **Studio lists** — curated text files in `studio-lists/` (one title per line) for Disney, Marvel, Pixar, and Lucasarts.

When the frontend calls `GET /api/shuffle`, two things happen:

### Plex library picks

The `selectWithNeighbors()` function in `server.js` (line 103) is called for each library. It:

1. Sorts all movies in the library alphabetically (done during the Plex scan at line 65).
2. Picks a random index (`pickedIndex`) from the full sorted list.
3. Picks a random position within a group of 6 (`positionInGroup`).
4. Computes a start index so the picked movie appears somewhere in a 6-movie window, clamped to the list boundaries.
5. Returns the 6-movie slice and the index of the picked movie within that slice.

This emulates the Plex shelf experience: you land on one movie, but see its alphabetical neighbors.

### Studio picks

Each studio list is read from its text file (e.g. `studio-lists/disney.txt`). A random title is chosen with `Math.random()` (line 141), and its poster is fetched from the TMDB API via `getTmdbPoster()` (line 80), with results cached in memory.

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
