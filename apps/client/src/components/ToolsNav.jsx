import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

function ToolsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="fcb-tools-nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
    </svg>
  );
}

function ExternalMark() {
  return (
    <svg
      aria-hidden="true"
      className="fcb-tools-nav-external"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

// The links in the open panel, in reading order. The current entry is not a
// link, so focus skips it.
const linksIn = (root) => [...(root?.querySelectorAll('a.fcb-tools-nav-entry') ?? [])];

function ToolEntry({ tool, external }) {
  const ToolIcon = tool.Icon;
  const name = tool.title ?? tool.label;
  const content = (
    <>
      <span className="fcb-tools-nav-entry-icon" aria-hidden="true">
        {ToolIcon ? <ToolIcon size={16} /> : null}
      </span>
      <span className="fcb-tools-nav-entry-label">{tool.label}</span>
      {external && !tool.current ? <ExternalMark /> : null}
    </>
  );

  // The entry that is this builder: shown as the current page, not a link.
  if (tool.current) {
    return (
      <li>
        <span
          aria-current="page"
          className="fcb-topbar-menu-item fcb-tools-nav-entry is-current"
          title={name}
        >
          {content}
        </span>
      </li>
    );
  }

  return (
    <li>
      <a
        className="fcb-topbar-menu-item fcb-tools-nav-entry"
        href={tool.href}
        title={external ? `${name} (opens its own page)` : name}
      >
        {content}
      </a>
    </li>
  );
}

/**
 * The host's own navigation (`shell.links.tools`), offered from one "Tools"
 * button in the top bar. A row of labelled links does not fit at 1280 px
 * beside the brand, the section tabs and the utilities, so the entries open
 * from a compact menu instead: "Tools" with a chevron from 1280 px, the icon
 * alone (with the same name as its tooltip and accessible name) below that.
 * Apps that load their own page follow a divider and carry a ↗.
 */
export default function ToolsNav({ tools }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const appsLabelId = useId();

  const close = useCallback((returnFocus) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    linksIn(rootRef.current)[0]?.focus();

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, close]);

  if (!tools?.length) return null;

  const siteTools = tools.filter((tool) => tool.group !== 'apps');
  const apps = tools.filter((tool) => tool.group === 'apps');

  const handlePanelKeyDown = (event) => {
    const items = linksIn(rootRef.current);
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (next !== null && items.length) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <nav aria-label="Tools" className="fcb-tools-nav" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label="Tools"
        className="fcb-topbar-utility fcb-topbar-utility--labelled fcb-tools-nav-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        title="Tools"
        type="button"
      >
        <ToolsIcon />
        <span className="fcb-topbar-utility-label">Tools</span>
        <Icon name="chevron-down" className="fcb-icon-sm fcb-topbar-utility-label" />
      </button>
      {open ? (
        // A disclosure of links rather than an ARIA menu: the entries are
        // ordinary navigation. Arrow keys, Home and End still move between
        // them, and Esc closes the panel.
        <div
          className="fcb-topbar-menu fcb-tools-nav-panel"
          id={panelId}
          onKeyDown={handlePanelKeyDown}
        >
          {siteTools.length ? (
            <ul className="fcb-tools-nav-list">
              {siteTools.map((tool) => (
                <ToolEntry key={tool.href} tool={tool} />
              ))}
            </ul>
          ) : null}
          {siteTools.length && apps.length ? (
            <span className="fcb-topbar-menu-divider" aria-hidden="true" />
          ) : null}
          {apps.length ? (
            <>
              <span className="fcb-topbar-menu-label" id={appsLabelId}>
                Apps
              </span>
              <ul aria-labelledby={appsLabelId} className="fcb-tools-nav-list">
                {apps.map((tool) => (
                  <ToolEntry external key={tool.href} tool={tool} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
