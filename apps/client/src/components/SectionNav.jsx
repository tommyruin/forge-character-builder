/**
 * Shared section navigation for workspace tabs: a sidebar on wide editor
 * panes that the container queries collapse into a horizontal pill strip.
 * All four workspace tabs render their sub-navigation through this component
 * so the layout stays identical between them.
 *
 * Items: { key, label, detail?, badge? } — `badge` renders inside the title
 * (status dots), `detail` is the smaller second line.
 */
export default function SectionNav({ ariaLabel, items, activeKey, onSelect, className }) {
  return (
    <nav
      className={className ? `fcb-left-nav ${className}` : 'fcb-left-nav'}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-label={item.ariaLabel}
          aria-current={activeKey === item.key ? 'page' : undefined}
          className={`fcb-nav-item${activeKey === item.key ? ' is-active' : ''}`}
          onClick={() => onSelect(item.key)}
        >
          <span className="fcb-nav-item-title">
            {item.label}
            {item.badge ?? null}
          </span>
          {item.detail != null && (
            <span className="fcb-nav-item-detail">{item.detail}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
