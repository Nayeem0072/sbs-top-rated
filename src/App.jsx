import { useState } from "react";
import data from "./data.json";
import CookieConsent from "./CookieConsent.jsx";

function formatGenerated(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function formatVotes(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function Row({ item }) {
  const votes = formatVotes(item.imdbVotes);
  const credits = item.directors?.length
    ? { label: item.directors.length > 1 ? "Directors" : "Director", names: item.directors }
    : item.creators?.length
      ? { label: item.creators.length > 1 ? "Creators" : "Creator", names: item.creators }
      : null;
  return (
    <li className="row">
      <span className="rank">{item.rank}</span>
      <div className="body">
        <div className="title-line">
          <a className="title" href={item.imdbUrl} target="_blank" rel="noreferrer">
            {item.title}
          </a>
          {item.year && <span className="year"> ({item.year})</span>}
        </div>
        <div className="rating-line">
          <span className="rating">★ {item.imdbRating.toFixed(1)}</span>
          {votes && <span className="votes">{votes} ratings</span>}
          {item.genres?.length > 0 && (
            <span className="genres">
              {item.genres.slice(0, 3).map((g) => (
                <span key={g} className="chip">
                  {g}
                </span>
              ))}
            </span>
          )}
        </div>
        <dl className="details">
          {credits && (
            <div className="detail">
              <dt>{credits.label}</dt>
              <dd>{credits.names.join(", ")}</dd>
            </div>
          )}
          {item.cast?.length > 0 && (
            <div className="detail">
              <dt>Cast</dt>
              <dd>{item.cast.join(", ")}</dd>
            </div>
          )}
        </dl>
        <a className="sbs-link" href={item.sbsSearchUrl} target="_blank" rel="noreferrer">
          Find on SBS →
        </a>
      </div>
      {item.posterUrl ? (
        <img className="poster" src={item.posterUrl} alt="" loading="lazy" />
      ) : (
        <span className="poster poster--empty" />
      )}
    </li>
  );
}

function List({ id, heading, items, active }) {
  return (
    <section
      id={`panel-${id}`}
      className={`list${active ? "" : " list--inactive"}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
    >
      <h2>{heading}</h2>
      {items.length === 0 ? (
        <p className="empty">
          No data yet. Run <code>npm run fetch</code> to populate this list.
        </p>
      ) : (
        <ol className="rows">
          {items.map((item) => (
            <Row key={item.imdbID} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

const TABS = [
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV Shows" },
];

export default function App() {
  const generated = formatGenerated(data.generatedAt);
  // Both lists stay mounted; on narrow screens CSS shows only the active one so
  // you can jump straight to TV without scrolling past every movie.
  const [tab, setTab] = useState("movies");

  function selectTab(id) {
    if (id === tab) return;
    setTab(id);
    // Both panels share the page flow, so keep the scroll position from
    // carrying over into the middle of the list you just switched to.
    window.scrollTo({ top: 0 });
  }
  return (
    <main className="app">
      <header className="header">
        <h1>Top Rated on SBS On Demand</h1>
        <p className="sub">
          Ranked by IMDb rating.
          {generated ? ` Updated ${generated}.` : " Not yet generated."}
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label="Category">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`tab-${id}`}
            className={`tab${tab === id ? " tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => selectTab(id)}
          >
            {label}
            <span className="tab-count">{data[id].length}</span>
          </button>
        ))}
      </div>
      <div className="columns">
        <List
          id="movies"
          heading={`Top ${data.movies.length} Movies`}
          items={data.movies}
          active={tab === "movies"}
        />
        <List
          id="tv"
          heading={`Top ${data.tv.length} TV Shows`}
          items={data.tv}
          active={tab === "tv"}
        />
      </div>
      <footer className="footer">
        <p>Ratings from IMDb via OMDb · catalogue and credits via TMDB.</p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p className="privacy">
          <strong>Privacy:</strong> this site uses Google Analytics to measure visitor traffic
          (page views, approximate location, device and referral source). Analytics cookies are
          set <em>only</em> if you click Accept — decline and nothing is tracked. Your choice is
          stored locally in your browser; clear your site data to be asked again.
        </p>
      </footer>
      <CookieConsent />
    </main>
  );
}
