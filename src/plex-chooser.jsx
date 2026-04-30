import React, { useEffect, useRef } from 'react';

export default function PlexChooser({ onRandomize }) {
  const inputRef = useRef(null);

  const handleKeyDown = (e) => {
    // Only act on 'r' key when focused on an input field
    if (e.key === 'r' && inputRef.current && inputRef.current === e.target) {
      e.preventDefault();
      onRandomize();
    }
  };

  return (
    <div>
      <input
        type="text"
        ref={inputRef}
        placeholder="Search movies..."
        onKeyDown={handleKeyDown}
        // Existing attributes can be kept here
      />
    </div>
  );
}
