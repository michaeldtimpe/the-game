# The Game

A movie randomizer web app that picks films from your Plex libraries and curated studio collections, displaying them in a visual poster grid that emulates the Plex shelf browsing experience.

## What It Does

Each time you hit **Play**, The Game:

- Picks a random movie from each of your Plex libraries, then shows it alongside 5 alphabetical neighbors (6 total per library) -- just like scrolling to that spot in Plex
- Picks one random film each from Disney, Marvel, Pixar, and Lucasarts -- only titles **we own** in Plex (see Studio Lists)
- Displays everything in a dark-themed poster grid with movie artwork

The randomization is **recency-weighted**: it steers away from spots it just showed you, and away from sections you recently watched in Plex, so repeats are rarer (see Recency Weighting).

The randomly chosen movie in each library row is highlighted with a white title. Studio picks show the Plex poster of the copy we own (TMDB poster as a fallback).

**Franchise de-clustering:** libraries are browsed in alphabetical order, so a long shared prefix would otherwise bunch a whole series together -- every "Harry Potter and the ..." film sorts under "Ha", so a pick there fills the entire row with Harry Potter. The shuffle instead sorts such titles by their distinctive part (*Chamber of Secrets*, *Goblet of Fire*, *Prisoner of Azkaban* ...), scattering them across the library for a more varied row. The full title is still shown on each card. To de-cluster another series, add its prefix to `SORT_PREFIXES` in `server.js`.

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

For deploying/operating the live instance (on a Synology NAS), see [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "plexUrl": "http://192.168.100.47:32400",
  "plexToken": "YOUR_PLEX_TOKEN",
  "tmdbApiKey": "YOUR_TMDB_API_KEY",
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

The `studio-lists/` folder contains curated text files (one movie title per line) for Disney, Marvel, Pixar, and Lucasarts. For current per-file counts:

```bash
wc -l studio-lists/*.txt
```

These curated files are the **base**. On startup (and every 24h, and on `/api/refresh`) the server builds a vetted pool per studio:

1. **Studio catalogue:** curated titles are merged with the studio's films from TMDB by company ID (`studioCompanies` in config), newest first, up to 25 pages (500 titles) per company -- so new releases *and* the back catalogue count without editing the lists.
2. **Owned-only filter:** a title is kept only if it is **in our collection** -- the server indexes every Plex *movie* section (not just the rows shown, so e.g. a separate Disney section counts) and matches by normalized title, with the year required to agree within one when TMDB knows it. Unowned or unreleased titles never appear, even if they're in a list. Add a film to Plex and it joins the pool on the next refresh.

Posters are precomputed when the pool is built, so a shuffle makes no Plex or TMDB calls. Edit the curated files to add/remove base titles; changes take effect on next restart or `/api/refresh`.

> **Lucasarts** is a small list, so even with anti-repeat weighting it can repeat sooner than the others.

## Recency Weighting

Instead of pure uniform random, each pick is weighted to reduce repeats; weights decay back to normal over subsequent shuffles:

- **Anti-repeat (all libraries + studios):** spots/titles shown in recent shuffles are temporarily down-weighted, so you don't keep landing in the same place.
- **Recently-watched bias (big libraries only):** the server reads your Plex watch history and steers picks away from the alphabetical sections of titles you watched recently. Skipped for small libraries (e.g. `New`).

No pick is ever made impossible (there's a weight floor). All strengths/radii/decay are tunable under `recency` in config; sane defaults live in `server.js`.

## Features

- 5-second splash animation on first load, with a "Legends Never Die" tagline and an animated gold glow/light-sweep flourish (shows only on first load/reload, not on Play Again)
- Play Again button to reshuffle without reloading
- Mobile/desktop view toggle
- Movie posters from Plex (local) and TMDB (studio picks)
- Responsive layout with dark Plex-inspired theme
- Studio picks auto-stay-current and are filtered to titles we own in Plex
- Recency-weighted randomization to reduce repeats (see Recency Weighting)
- Plex libraries and studio pools auto-refresh every 24 hours; manual refresh via `/api/refresh`
- Franchise de-clustering so a single series doesn't fill a whole row (see above)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/shuffle` | Returns recency-weighted randomized selections for all libraries and studio picks |
| `GET /api/refresh` | Re-scans Plex libraries and the owned-movie index, rebuilds the studio pools, and returns updated counts (`counts` + `studioCounts`) |

## Previous Versions

The `previous-versions/` directory contains the v1 and v2 Python CLI implementations that used weighted randomization and history tracking. The current version (v3) is a complete rewrite with no database or history -- pure random each time.
