const MAX_VISIBLE_PATHS = 100;

export default function MatchingPathsDisclosure({ paths = [] }) {
  const visiblePaths = paths.slice(0, MAX_VISIBLE_PATHS);
  const remaining = paths.length - visiblePaths.length;

  return (
    <details className="fcb-matching-paths">
      <summary>
        Review {paths.length.toLocaleString()} matching filenames
      </summary>
      <div className="fcb-matching-paths-list">
        <ul>
          {visiblePaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
        {remaining > 0 && (
          <p>
            {remaining.toLocaleString()} more matching filenames not shown.
          </p>
        )}
      </div>
    </details>
  );
}
