# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts curated lists
- Displays everything in a dark-themed poster grid with movie artwork

The randomly chosen movie in each library row is highlighted with a white title. Studio picks show posters fetched from TMDB.

## How it Works

The randomization happens on the server side in `server.js`. There are two distinct mechanisms:

### Plex Library Picks

Each Plex library's movies are fetched via the Plex API and sorted alphabetically by title (`server.js`, line 65). The `selectWithNeighbors` function (`server.js`, lines 103–122) then performs the following:

1. Picks a random index across the full sorted list using `Math.random()`.
2. Picks a random "position within the group" (0–5) to determine where the selected movie appears in the displayed row of 6.
3. Calculates a start index so the picked movie lands at that position, clamping to the list boundaries.
4. Returns the 6-movie slice and the index of the picked movie within it.

This mimics the experience of scrolling to a random spot on a Plex shelf — you see the picked film alongside its alphabetical neighbors.

### Studio Picks

Curated studio lists (Disney, Marvel, Pixar, Lucasarts) are loaded from text files in the `studio-lists/` directory at startup (`loadStudioLists`, `server.js`, lines 31–47). Each pick is a single random selection using `titles[Math.floor(Math.random() * titles.length)]` (`server.js`, line 141).

### Frontend

The React app in `src/App.jsx` calls `GET /api/shuffle` on mount and whenever the user clicks **Play** (via the `shuffle` function, `src/App.jsx`, lines 26–39). The returned data is rendered as poster rows using the `selectedIndex` to highlight the chosen film.

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
