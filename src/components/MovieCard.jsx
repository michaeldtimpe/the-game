import { useState, useEffect } from 'react';

export default function MovieCard({ title, posterUrl, isSelected }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    // Add listener binding here
  }, []);

  return (
    <div className="movie-card">
      <div className="poster-wrapper">
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={title}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="poster-fallback">
            <span>{title}</span>
          </div>
        )}
      </div>
      <p className={`movie-title${isSelected ? ' movie-title-selected' : ''}`}>{title}</p>
    </div>
  );
}