import { Fragment, forwardRef } from 'react';

/**
 * The shared shell every workspace tab is built from.
 *
 * The roles are: shell → band stack (0..n bands) → rail → content region →
 * panel → scroll region. Every tab renders through this shell rather than its
 * own markup: the sub-tab bar, the builder-layout class and the content region
 * sit at the same depth in every tab, and layout rules key off that structure,
 * so structural disagreement is exactly what would let the
 * same defect be fixed five times in five tabs without ever being fixed once.
 *
 * What the shell owns: which structural classes land on the root, the order of
 * the band stack, and one uniform depth for the content region. What each tab
 * still owns: its own decoration class, and what goes inside the regions.
 *
 * `data-layout-role` is stamped alongside the class names so layout rules can
 * be written against the role rather than against a tab-specific name.
 */

const CONTENT_CLASS = {
  // Primary pane plus the description pane beside it.
  split: 'fcb-builder-grid',
  // Two equal panes.
  'two-panel': 'fcb-two-panel-grid',
  // A single column the tab fills itself.
  stack: 'fcb-manage-content',
};

export default function WorkspaceTabLayout({
  as: Tag = 'div',
  className = '',
  panel = false,
  bands = null,
  lead = null,
  rail = null,
  shape = 'none',
  contentClassName = '',
  children,
  ...rest
}) {
  const bandList = (Array.isArray(bands) ? bands : [bands]).filter(Boolean);
  const classes = [
    'fcb-workspace-tab',
    // A tab that renders a band keeps that band flush against the workspace
    // navigation; one that does not takes the band gap on the shell instead.
    bandList.length > 0 ? 'fcb-has-subtabs' : '',
    // The rail is a sidebar column on a wide pane and a band on a narrow one,
    // which is what this class switches between.
    rail ? 'fcb-builder-layout' : '',
    panel ? 'fcb-panel' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const contentClass = [CONTENT_CLASS[shape] ?? '', contentClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classes} data-layout-role="shell" {...rest}>
      {bandList.map((band, index) => (
        // Bands are positional: a tab's stack is fixed markup, not a list that
        // reorders, so the index is a stable identity.
        <Fragment key={index}>{band}</Fragment>
      ))}
      {/* Status lines that belong above the rail rather than inside the
          content region, which is a grid and would take them as a cell. */}
      {lead}
      {rail}
      {contentClass ? (
        <div className={contentClass} data-layout-role="content">
          {children}
        </div>
      ) : (
        children
      )}
    </Tag>
  );
}

/**
 * A band: a row that continues the workspace navigation above it. Bands stack
 * flush, bleed to the pane edges, and carry no top radius — stated once here
 * so a tab cannot spell the class list differently and drift out of the rules.
 *
 * Always a plain wrapper, never the tab strip itself. The band sizes its own
 * row and centres what it holds; a `.fcb-secondary-tabs` strip stretches its
 * tabs to fill it. Put both on one element and the tabs centre at their
 * natural height instead, leaving a sliver of band above and below them.
 */
export function WorkspaceBand({ className = '', children, ...rest }) {
  return (
    <div
      className={`fcb-subtab-bar${className ? ` ${className}` : ''}`}
      data-layout-role="band"
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A panel: the framed surface content sits on. Emits the class names the
 * stylesheet already uses, so adopting it changes nothing visually.
 */
export function WorkspacePanel({
  as: Tag = 'section',
  className = '',
  title,
  actions = null,
  bodyClassName = '',
  bodyRef,
  children,
  ...rest
}) {
  return (
    <Tag className={`fcb-panel${className ? ` ${className}` : ''}`} {...rest}>
      {(title || actions) && (
        <header className="fcb-panel-header">
          {title ? <h2 className="fcb-panel-title">{title}</h2> : <div />}
          {actions}
        </header>
      )}
      <div
        className={`fcb-panel-body${bodyClassName ? ` ${bodyClassName}` : ''}`}
        ref={bodyRef}
      >
        {children}
      </div>
    </Tag>
  );
}

/**
 * The scroll region. It is deliberately not part of the shell: a tab decides
 * where its scroller belongs, because putting it on the panel body — which
 * carries the panel's rounded corners — paints a scrollbar track straight down
 * the radius. It never carries a border radius itself for that reason.
 */
export const WorkspaceScroll = forwardRef(function WorkspaceScroll(
  { as: Tag = 'div', className = '', children, ...rest },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={className}
      data-layout-role="scroll"
      {...rest}
    >
      {children}
    </Tag>
  );
});
