import { useState, useEffect } from 'react';
import MovieCard from './components/MovieCard';
import ShuffleButton from './components/ShuffleButton';

const LIBRARY_EMOJIS = {
  'New': '🍿',
  'Fang': '🐺',
  'Floof': '🐶',
};

const STUDIO_EMOJIS = {
  'Disney': '🐭',
  'Marvel': '🦸',
  'Pixar': '🚀',
  'Lucasarts': '⭐',
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
    return () => clearTimeout(splashTimer);
  }, []);

  const handleKeyDown = (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      event.preventDefault();
    }
  };

  if (showSplash) {
    return (
      <div className={`splash ${splashFading ? 'splash-fade' : ''}`}>\n        <h1 className="splash-title">The Game</h1>
      </div>
    );
  }

  return (
    <div className={`app fade-in${mobileView ? ' mobile' : ''}`} onKeyDown={handleKeyDown}>
      <header>
        <h1 className="app-title">The Game</h1>
        <div className="header-buttons">
          <button
            className="view-toggle-btn"
            onClick={() => setMobileView(!mobileView)}
            title={mobileView ? 'Desktop view' : 'Mobile view'}
          >
            {mobileView ? '🖥️' : '📱'}
          </button>
          <ShuffleButton onClick={shuffle} loading={loading} hasData={!!data} />
        </div>
      </header>

      {error && <div className="error-banner">Failed to load: {error}</div>}

      {data && (
        <main>
          {data.libraries.map((lib) => (
            <section key={lib.name} className="library-section">
              <h2>{LIBRARY_EMOJIS[lib.name] || ''} {lib.name}</h2>
              {lib.movies.length === 0 ? (
                <p className="empty-msg">No movies available</p>
              ) : (
                <div className="movie-row library-row">
                  {lib.movies.map((movie, i) => (
                    <MovieCard
                      key={`${lib.name}-${i}`}
                      title={movie.title}
                      posterUrl={movie.posterUrl}
                      isSelected={i === lib.selectedIndex}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          <div className="studio-picks">
            {data.studioPicks.map((pick) => (
              <section key={pick.studio} className="studio-section">
                <h2>{STUDIO_EMOJIS[pick.studio] || ''} {pick.studio}</h2>
                <MovieCard
                  title={pick.title || 'Unknown'}
                  posterUrl={pick.posterUrl}
                />
              </section>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
