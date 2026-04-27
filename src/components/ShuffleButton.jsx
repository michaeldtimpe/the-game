export default function ShuffleButton({ onClick, loading, hasData }) {
  return (
    <button className="shuffle-btn" onClick={onClick} disabled={loading}>
      {loading ? 'Shuffling...' : hasData ? 'Play Again' : 'Play'}
    </button>
  );
}
