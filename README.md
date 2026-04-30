# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts curated lists
- Displays everything in a dark‑themed poster grid with movie artwork

## How it works

The randomization logic lives in **`src/App.jsx`**. When the component mounts it calls the backend endpoint `/api/shuffle` (see `shuffle()` function). The server returns a JSON payload containing:

```json
{
  "libraries": [
    { "name": "New", "movies": [...], "selectedIndex": 0 },
    { "name": "Fang", "movies": [...], "selectedIndex": 0 },
    { "name": "Floof", "movies": [...], "selectedIndex": 0 }
  ],
  "studioPicks": [
    { "studio": "Disney", "title": "Movie A", "posterUrl": "..." },
    { "studio": "Marvel", "title": "Movie B", "posterUrl": "..." },
    { "studio": "Pixar", "title": "Movie C", "posterUrl": "..." },
    { "studio": "Lucasarts", "title": "Movie D", "posterUrl": "..." }
  ]
}
```

The component maps over `data.libraries` and `data.studioPicks`, rendering a `MovieCard` for each entry. The `selectedIndex` field (default `0`) determines which movie in each library is highlighted as the "currently playing" film, mimicking the Plex shelf view. The studio picks are displayed in a separate section with studio‑emoji icons.

Thus, the app’s core algorithm is a simple fetch‑and‑render cycle that provides a fresh random selection on every shuffle.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Copy and configure
cp config. example.json config.json
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
docker-compose up -d --build
# Open http://YOUR_NAS_IP:3000
```

---
*File modified:* `README.md`