const WORKSPACE_TABS = [
  ['build', 'Build'],
  ['magic', 'Magic'],
  ['equipment', 'Equipment'],
  ['manage', 'Manage'],
  ['sheet', 'Sheet'],
];

function WorkspaceIcon({ name }) {
  if (name === 'build') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m14.7 6.3 3-3 3 3-3 3m-2-1-9.9 9.9-2 2-2-2 2-2 9.9-9.9" />
        <path d="m13.3 4.9 5.8 5.8" />
      </svg>
    );
  }
  if (name === 'magic') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m4 20 11-11 2 2L6 22 4 20Z" />
        <path d="M14 4V1m0 6v3m-3-6H8m6 0h3m3 9v-2m0 6v-2m-3 0h-2m7 0h-2" />
      </svg>
    );
  }
  if (name === 'equipment') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2 4 5v6c0 5.2 3.4 9.5 8 11 4.6-1.5 8-5.8 8-11V5l-8-3Z" />
        <path d="M12 6v12m-5-7h10" />
      </svg>
    );
  }
  if (name === 'manage') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.5-3.2 2.4-5 5.5-5 2 0 3.5.7 4.5 2" />
        <path d="M17 13v6m-3-3h6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 2h9l3 3v17H6V2Z" />
      <path d="M15 2v4h4M9 11h6m-6 4h6m-6 4h4" />
    </svg>
  );
}

export function DesktopWorkspaceNavigation({ activeTab, onSelect }) {
  return (
    <nav className="fcb-secondary-tabs" aria-label="Character workspace">
      {WORKSPACE_TABS.map(([key, label]) => (
        <button
          key={key}
          data-testid={`section-${key}`}
          aria-current={activeTab === key ? 'page' : undefined}
          className={`fcb-tab ${activeTab === key ? 'is-active' : ''}`}
          onClick={() => onSelect(key)}
          type="button"
        >
          {label.toUpperCase()}
        </button>
      ))}
    </nav>
  );
}

export function MobileWorkspaceNavigation({ activeTab, onSelect }) {
  return (
    <nav
      className="fcb-mobile-workspace-nav"
      aria-label="Character workspace"
    >
      {WORKSPACE_TABS.map(([key, label]) => (
        <button
          key={key}
          data-testid={`section-${key}`}
          aria-current={activeTab === key ? 'page' : undefined}
          className={activeTab === key ? 'is-active' : ''}
          onClick={() => onSelect(key)}
          type="button"
        >
          <WorkspaceIcon name={key} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
