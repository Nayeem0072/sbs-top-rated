// Builds src/data.json: the top 20 IMDb-rated movies and TV shows on SBS On Demand.
//
// Strategy (avoids rating SBS's entire catalog):
//   1. Ask TMDB which titles are on SBS On Demand in AU, pre-sorted by rating
//      (TMDB watch-provider data is JustWatch-sourced). This yields a short
//      candidate list without us rating every listing.
//   2. Resolve each candidate's IMDb id via TMDB, then fetch the *real* IMDb
//      rating from OMDb (same source the movie-rate-plugin uses).
//   3. Re-sort by IMDb rating and keep the top 20 per type.
//
// Total API calls: ~60 TMDB + ~120 OMDb — well within free tiers.

import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const OMDB_KEY = process.env.OMDB_KEY;

if (!TMDB_TOKEN || !OMDB_KEY) {
  console.error(
    "Missing credentials. Copy .env.example to .env and set TMDB_TOKEN and OMDB_KEY."
  );
  process.exit(1);
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const OMDB_BASE = "https://www.omdbapi.com/";
const IMG_BASE = "https://image.tmdb.org/t/p/w185";
const WATCH_REGION = "AU";
const PROVIDER_NAME = /sbs on demand/i;

// How many discover pages (20 titles/page) to shortlist per type, and the
// minimum TMDB vote count to exclude obscure titles with a lone 10/10 vote.
const PAGES = 12;
const MOVIE_MIN_VOTES = 50;
const TV_MIN_VOTES = 20;
const TOP_N = 100;
const CONCURRENCY = 5;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // reuse OMDb results for 7 days

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "src", "data.json");
const CACHE_FILE = join(__dirname, "..", ".cache", "omdb.json");

// --- HTTP helpers -----------------------------------------------------------

async function tmdb(path, params = {}) {
  const usp = new URLSearchParams(params);
  const url = `${TMDB_BASE}${path}?${usp.toString()}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`TMDB ${resp.status} for ${path}: ${await resp.text()}`);
  }
  return resp.json();
}

async function omdb(params) {
  const usp = new URLSearchParams({ apikey: OMDB_KEY, ...params });
  const resp = await fetch(`${OMDB_BASE}?${usp.toString()}`);
  return resp.json();
}

// --- OMDb rating cache ------------------------------------------------------
// OMDb's free tier is 1,000 lookups/day. We cache results on disk (keyed by
// IMDb id, 7-day TTL) so repeated runs and redeploys don't re-spend quota, and
// so partial progress survives a quota exhaustion.

let cache = {};
let quotaHit = false;

async function loadCache() {
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    cache = {};
  }
}

async function saveCache() {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
}

// Return { rating, votes, actors, director, genre } for an IMDb id, or null if
// unavailable. Serves from cache when fresh; otherwise calls OMDb (unless the
// daily quota has already been hit this run).
async function omdbRating(imdbID) {
  const now = Date.now();
  const hit = cache[imdbID];
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit;
  if (quotaHit) return null;

  const o = await omdb({ i: imdbID });
  if (o && o.Response === "False" && /request limit reached/i.test(o.Error || "")) {
    quotaHit = true;
    return null;
  }
  const rating = o.imdbRating && o.imdbRating !== "N/A" ? parseFloat(o.imdbRating) : null;
  if (rating == null || Number.isNaN(rating)) return null;
  const votesRaw = o.imdbVotes && o.imdbVotes !== "N/A" ? parseInt(o.imdbVotes.replace(/,/g, ""), 10) : null;
  const entry = {
    rating,
    votes: Number.isNaN(votesRaw) ? null : votesRaw,
    actors: o.Actors && o.Actors !== "N/A" ? o.Actors : null,
    director: o.Director && o.Director !== "N/A" ? o.Director : null,
    genre: o.Genre && o.Genre !== "N/A" ? o.Genre : null,
    ts: now,
  };
  cache[imdbID] = entry;
  return entry;
}

// Run async `fn` over `items` with bounded concurrency, preserving order.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- SBS provider resolution ------------------------------------------------

async function resolveProviderId(kind) {
  const data = await tmdb(`/watch/providers/${kind}`, { watch_region: WATCH_REGION });
  const match = (data.results || []).find((p) => PROVIDER_NAME.test(p.provider_name || ""));
  if (!match) {
    throw new Error(
      `Could not find an SBS On Demand ${kind} provider for region ${WATCH_REGION}.`
    );
  }
  console.log(`  SBS On Demand ${kind} provider_id = ${match.provider_id} (${match.provider_name})`);
  return match.provider_id;
}

// --- Discover + rate --------------------------------------------------------

async function discover(kind, providerId, minVotes) {
  const candidates = [];
  for (let page = 1; page <= PAGES; page++) {
    const data = await tmdb(`/discover/${kind}`, {
      watch_region: WATCH_REGION,
      with_watch_providers: providerId,
      sort_by: "vote_average.desc",
      "vote_count.gte": minVotes,
      include_adult: "false",
      page,
    });
    for (const r of data.results || []) candidates.push(r);
    if (page >= (data.total_pages || 1)) break;
  }
  return candidates;
}

// Fetch TMDB details + credits for one title in a single call, returning the
// IMDb id plus the extra card fields (genres, cast, director/creators).
async function detailsFor(kind, tmdbId) {
  if (kind === "movie") {
    const d = await tmdb(`/movie/${tmdbId}`, { append_to_response: "credits" });
    return {
      imdbID: d.imdb_id || null,
      genres: (d.genres || []).map((g) => g.name).slice(0, 3),
      cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
      directors: (d.credits?.crew || [])
        .filter((c) => c.job === "Director")
        .map((c) => c.name)
        .slice(0, 2),
      creators: [],
    };
  }
  const d = await tmdb(`/tv/${tmdbId}`, { append_to_response: "credits,external_ids" });
  return {
    imdbID: d.external_ids?.imdb_id || null,
    genres: (d.genres || []).map((g) => g.name).slice(0, 3),
    cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
    directors: [],
    creators: (d.created_by || []).map((c) => c.name).slice(0, 3),
  };
}

// Split an OMDb comma list ("A, B, C") into a clean array, ignoring "N/A".
function omdbList(value, limit) {
  if (!value || value === "N/A") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function buildList(kind, providerId, minVotes) {
  const isMovie = kind === "movie";
  const label = isMovie ? "movies" : "TV shows";
  console.log(`\nDiscovering top-rated ${label} on SBS On Demand...`);
  const candidates = await discover(kind, providerId, minVotes);
  console.log(`  ${candidates.length} candidates from TMDB; resolving IMDb ratings...`);

  const rated = await mapPool(candidates, CONCURRENCY, async (c) => {
    const tmdbId = c.id;
    const title = isMovie ? c.title : c.name;
    const dateStr = isMovie ? c.release_date : c.first_air_date;
    const year = dateStr ? dateStr.slice(0, 4) : null;
    try {
      const details = await detailsFor(kind, tmdbId);
      const { imdbID } = details;
      if (!imdbID) return null;
      const o = await omdbRating(imdbID);
      if (!o || o.rating == null) return null;
      // Prefer TMDB's structured credits; fall back to OMDb's comma lists.
      const cast = details.cast.length ? details.cast : omdbList(o.actors, 4);
      const directors = details.directors.length
        ? details.directors
        : isMovie
          ? omdbList(o.director, 2)
          : [];
      const genres = details.genres.length ? details.genres : omdbList(o.genre, 3);
      return {
        title,
        year,
        imdbRating: o.rating,
        imdbVotes: o.votes,
        genres,
        cast,
        directors,
        creators: details.creators,
        imdbID,
        tmdbId,
        posterUrl: c.poster_path ? `${IMG_BASE}${c.poster_path}` : null,
        imdbUrl: `https://www.imdb.com/title/${imdbID}/`,
        sbsSearchUrl: `https://www.sbs.com.au/ondemand/search/${encodeURIComponent(title || "")}`,
      };
    } catch (err) {
      console.warn(`  ! skipped "${title}" (${tmdbId}): ${err.message}`);
      return null;
    }
  });

  const ranked = rated
    .filter(Boolean)
    .sort((a, b) => b.imdbRating - a.imdbRating)
    .slice(0, TOP_N)
    .map((item, i) => ({ rank: i + 1, ...item }));

  console.log(`  Kept top ${ranked.length} ${label}.`);
  return ranked;
}

// --- Main -------------------------------------------------------------------

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return { movies: [], tv: [] };
  }
}

async function main() {
  await loadCache();

  console.log("Resolving SBS On Demand provider IDs (region AU)...");
  const [movieProvider, tvProvider] = await Promise.all([
    resolveProviderId("movie"),
    resolveProviderId("tv"),
  ]);

  const [movies, tv] = await Promise.all([
    buildList("movie", movieProvider, MOVIE_MIN_VOTES),
    buildList("tv", tvProvider, TV_MIN_VOTES),
  ]);

  await saveCache();

  // If OMDb's daily quota ran out mid-run, this run is partial. Don't clobber a
  // previously-good data.json with fewer results — keep whichever list is fuller.
  if (quotaHit) {
    const existing = await readExisting();
    const keptMovies = movies.length >= (existing.movies?.length || 0) ? movies : existing.movies;
    const keptTv = tv.length >= (existing.tv?.length || 0) ? tv : existing.tv;
    console.warn(
      "\n⚠ OMDb daily request limit reached — results are partial. " +
        "Cached what succeeded; re-run `npm run fetch` after the quota resets (or use a paid OMDb key) to fill the rest."
    );
    if (keptMovies !== movies || keptTv !== tv) {
      console.warn(
        `  Kept the existing fuller data.json (${keptMovies.length} movies, ${keptTv.length} TV) instead of overwriting with the partial run.`
      );
      return;
    }
  }

  const payload = { generatedAt: new Date().toISOString(), movies, tv };
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote ${OUT_FILE} (${movies.length} movies, ${tv.length} TV shows).`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
