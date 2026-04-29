import { useState, useEffect } from 'react';
import MovieCard from './components/MovieCard';
import ShuffleButton from './components/ShuffleButton';

const LIBRARY_EMOJIS = {
  'New': '\uD83C\uDF7F',
  'Fang': '\uD83D\uDC3A',
  'Floof': '\uD83D\uDC36',
};

const STUDIO_EMOJIS = {
  'Disney': '\uD83D\uDC2D',
  'Marvel': '\uD83E\uDDB8',
  'Pixar': '\uD83D\uDE80',
  'Lucasarts': '\u2B50',
};

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [mobileView, setMobileView] = useState(false);

  async function shuffle() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/shuffle');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    shuffle();
    const splashTimer = setTimeout(() => {
      setSplashFading(true);
      setTimeout(() => setShowSplash(false), 800);
    }, 4200); // 4.2s hold + 0.8s fade = 5s total

    const handleKeyPress = (event) => {
      if (event.key === 'r' && !document.activeElement.isContentEditable && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        shuffle();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      clearTimeout(splashTimer);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  if (showSplash) {
    return (
      <div className={`splash ${splashFading ? 'splash-fade' : ''}`}>\n        <h1 className="splash-title">The Game</h1>\n      </div>\n    );\n  }\n\n  return (
    <div className={`app fade-in${mobileView ? ' mobile' : ''}`}>\n      <header>\n        <h1 className="app-title">The Game</h1>\n        <div className="header-buttons">\n          <button\n            className="view-toggle-btn"\n            onClick={() => setMobileView(!mobileView)}\n            title={mobileView ? 'Desktop view' : 'Mobile view'}\n          >\n            {mobileView ? '\uD83D\uDDA5\uFE0F' : '\uD83D\uDCF1'}\n          </button>\n          <ShuffleButton onClick={shuffle} loading={loading} hasData={!!data} />\n        </div>\n      </header>\n\n      {error && <div className="error-banner">Failed to load: {error}</div>}\n\n      {data && (\n        <main>\n          {data.libraries.map((lib) => (\n            <section key={lib.name} className="library-section">\n              <h2>{LIBRARY_EMOJIS[lib.name] || ''} {lib.name}</h2>\n              {lib.movies.length === 0 ? (\n                <p className="empty-msg">No movies available</p>\n              ) : (\n                <div className="movie-row library-row">\n                  {lib.movies.map((movie, i) => (\n                    <MovieCard\n                      key={\`${lib.name}-${i}\`}\n                      title={movie.title}\n                      posterUrl={movie.posterUrl}\n                      isSelected={i === lib.selectedIndex}\n                    />\n                  ))}\n                </div>\n              )}\n            </section>\n          ))}\n\n          <div className="studio-picks">\n            {data.studioPicks.map((pick) => (\n              <section key={pick.studio} className="studio-section">\n                <h2>{STUDIO_EMOJIS[pick.studio] || ''} {pick.studio}</h2>\n                <MovieCard\n                  title={pick.title || 'Unknown'}\n                  posterUrl={pick.posterUrl}\n                />\n              </section>\n            ))}\n          </div>\n        </main>\n      )}\n    </div>\n  );\n}\n