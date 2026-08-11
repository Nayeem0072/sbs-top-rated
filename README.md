# SBS Top Rated

A small static frontend showing the **top 100 movies** and **top 100 TV shows** on
[SBS On Demand](https://www.sbs.com.au/ondemand/), ranked by **IMDb rating**.

**Live:** https://sbs-top-rated.vercel.app

## How it works

Rather than rate SBS's entire catalog (thousands of titles), a build-time script
(`scripts/fetch-data.mjs`) asks **TMDB's Discover API** which titles are on SBS On Demand
in Australia — TMDB's watch-provider data is JustWatch-sourced and can be returned
pre-sorted by rating. That gives a short candidate list. The script then resolves each
candidate's IMDb id via TMDB and fetches the real IMDb rating from **OMDb**, re-sorts by
IMDb rating, and writes the top 100 of each type to `src/data.json`. The Vite/React frontend
renders that JSON — no API keys ever reach the browser.

A full top-100 refresh makes a few hundred TMDB calls plus one OMDb lookup per candidate
(cached for 7 days in `.cache/omdb.json`, so repeat runs spend far less). Both stay within the
free tiers, though OMDb's free 1,000/day cap is the practical limit — see Notes.

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

Day-to-day the data refreshes itself in the cloud (see **Automated refresh** below) — you don't
need to run the fetch locally. These commands are for local development and one-off manual refreshes:

```sh
npm run fetch   # refresh src/data.json from TMDB + OMDb (needs .env)
npm run dev     # start the dev server
npm run build   # production build to dist/
```

## Tuning

Edit the constants at the top of `scripts/fetch-data.mjs`:

- `PAGES` — how many 20-title discover pages to shortlist per type.
- `MOVIE_MIN_VOTES` / `TV_MIN_VOTES` — minimum TMDB vote count, to exclude obscure titles
  with a lone perfect score.
- `TOP_N` — how many to keep per list.

## Automated refresh (GitHub Actions)

The rankings refresh themselves once a day — no local step required. The workflow lives at
[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) and does this:

1. **Schedule** — runs daily at `15:00 UTC` (~1am AEST); also triggerable by hand via the
   **Actions** tab (`workflow_dispatch`) or the CLI.
2. **Fetch** — runs `npm run fetch` using the `TMDB_TOKEN` and `OMDB_KEY` repository secrets.
3. **Cache** — the OMDb cache (`.cache/`) is persisted between runs via `actions/cache`, so each
   day only spends quota on new/changed titles.
4. **Commit** — if `src/data.json` changed, it commits and pushes (`[skip ci]`). If nothing
   changed (or the OMDb quota was hit), it makes no commit and leaves the existing data intact.
5. **Deploy** — the push triggers Vercel's Git integration, which redeploys the site automatically.

### One-time setup

Already configured for this repo, but to reproduce from scratch:

```sh
# 1. Store the two API credentials as repo secrets (reads them from your local .env)
grep '^TMDB_TOKEN=' .env | cut -d= -f2- | gh secret set TMDB_TOKEN
grep '^OMDB_KEY='  .env | cut -d= -f2- | gh secret set OMDB_KEY

# 2. Connect Vercel to the GitHub repo so pushes auto-deploy
vercel git connect
```

> Note: pushing the workflow file requires a `gh` token with the `workflow` scope
> (`gh auth refresh -h github.com -s workflow`).

### Trigger a refresh manually

```sh
gh workflow run refresh.yml           # start a run
gh run watch $(gh run list --workflow=refresh.yml -L1 --json databaseId -q '.[0].databaseId')
```

## Deploying to Vercel

The site is fully static — the fetch runs ahead of time (locally or in CI) and bakes results into
`src/data.json`, which is committed and bundled at build time. So **no API keys are needed on
Vercel** and the deployed site makes no runtime API calls. `vercel.json` pins the Vite framework
preset, build command, and output dir.

This project is already deployed at https://sbs-top-rated.vercel.app and connected to the GitHub
repo, so **every push (including the daily refresh commit) auto-deploys**. For a manual deploy:

```sh
npm i -g vercel
vercel --prod
```

## Privacy

The site uses **Google Analytics 4** (`G-3T4X6ZQ31E`) to measure visitor traffic — page views,
approximate location, device/browser, and referral source. It is **consent-gated**:

- On first visit a cookie banner is shown and **no analytics script loads** — zero cookies set.
- Analytics loads only after the visitor clicks **Accept**. Clicking **Decline** means nothing is
  ever loaded or tracked.
- The choice is stored in `localStorage` (`cookie-consent`), so returning visitors aren't asked
  again; clearing site data resets it.

The gtag snippet is injected at runtime by `src/CookieConsent.jsx` / `src/analytics.js` — it is
deliberately **not** hard-coded in `index.html`, so tracking cannot fire before consent. The
Measurement ID is not a secret (it's visible client-side regardless), so it lives in the bundle.
A short privacy note and TMDB attribution appear in the site footer.

## Notes

- **OMDb daily limit:** the free OMDb tier allows ~1,000 lookups/day. A full top-100 run uses a
  few hundred; if you hit the cap mid-run the script caches what succeeded (`.cache/omdb.json`,
  7-day TTL) and **keeps your existing `data.json` rather than overwriting it with partial data**.
  Re-run after the quota resets to fill the rest, or use a paid OMDb key ($1/mo, 100k/day).
- TMDB's SBS catalog (via JustWatch) is generally accurate for AU but may slightly lag
  SBS's live catalog.
- The provider IDs for SBS On Demand are resolved at runtime from TMDB's watch-providers
  endpoint (they can differ for movies vs TV), and logged when you run `npm run fetch`.
