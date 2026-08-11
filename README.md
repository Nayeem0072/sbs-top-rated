# SBS Top Rated

A small static frontend showing the **top 100 movies** and **top 100 TV shows** on
[SBS On Demand](https://www.sbs.com.au/ondemand/), ranked by **IMDb rating**.

## How it works

Rather than rate SBS's entire catalog (thousands of titles), a build-time script
(`scripts/fetch-data.mjs`) asks **TMDB's Discover API** which titles are on SBS On Demand
in Australia — TMDB's watch-provider data is JustWatch-sourced and can be returned
pre-sorted by rating. That gives a short candidate list. The script then resolves each
candidate's IMDb id via TMDB and fetches the real IMDb rating from **OMDb**, re-sorts by
IMDb rating, and writes the top 20 of each type to `src/data.json`. The Vite/React frontend
renders that JSON — no API keys ever reach the browser.

Total API usage per run: ~60 TMDB + ~120 OMDb calls — well within free tiers.

## Setup

You need two free API credentials:

- **TMDB API read access token** — https://www.themoviedb.org/settings/api (the long
  "API Read Access Token", starts with `eyJ...`).
- **OMDb API key** — https://www.omdbapi.com/apikey.aspx (same key the movie-rate-plugin uses).

```sh
cp .env.example .env      # then fill in TMDB_TOKEN and OMDB_KEY
npm install
```

## Usage

```sh
npm run fetch   # refresh src/data.json from TMDB + OMDb
npm run dev     # start the dev server
npm run build   # production build to dist/
```

Re-run `npm run fetch` whenever you want to refresh the rankings.

## Tuning

Edit the constants at the top of `scripts/fetch-data.mjs`:

- `PAGES` — how many 20-title discover pages to shortlist per type.
- `MOVIE_MIN_VOTES` / `TV_MIN_VOTES` — minimum TMDB vote count, to exclude obscure titles
  with a lone perfect score.
- `TOP_N` — how many to keep per list.

## Deploying to Vercel

The site is fully static — `npm run fetch` runs **locally** and bakes the results into
`src/data.json`, which is committed and bundled at build time. So **no API keys are needed on
Vercel** and the deployed site makes no runtime API calls. `vercel.json` pins the Vite framework
preset, build command, and output dir.

Option A — Vercel CLI (no GitHub needed):

```sh
npm i -g vercel
vercel          # first run links/creates the project
vercel --prod   # deploy to production
```

Option B — Git integration: push this repo to GitHub, then "Import Project" in the Vercel
dashboard. It auto-detects the settings from `vercel.json`.

To refresh the rankings: run `npm run fetch` locally, commit the updated `src/data.json`, and
redeploy (`vercel --prod`, or push if using git integration).

## Notes

- **OMDb daily limit:** the free OMDb tier allows ~1,000 lookups/day. A full top-100 run uses a
  few hundred; if you hit the cap mid-run the script caches what succeeded (`.cache/omdb.json`,
  7-day TTL) and **keeps your existing `data.json` rather than overwriting it with partial data**.
  Re-run after the quota resets to fill the rest, or use a paid OMDb key ($1/mo, 100k/day).
- TMDB's SBS catalog (via JustWatch) is generally accurate for AU but may slightly lag
  SBS's live catalog.
- The provider IDs for SBS On Demand are resolved at runtime from TMDB's watch-providers
  endpoint (they can differ for movies vs TV), and logged when you run `npm run fetch`.
