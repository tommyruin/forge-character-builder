// One look and one behaviour for every "show more" section: a native <details>, so it opens with a
// click, Enter or Space and a screen reader announces it as expandable, with the same chevron (it
// points right when closed and down when open) and the same sentence-case label everywhere.
//
// `variant="panel"` is a closed panel of its own (More pack tools, Manage coins); the default is an
// inline section inside a form (More options, More effects, Advanced).

export default function Disclosure({
  summary,
  children,
  className = '',
  bodyClassName = '',
  summaryClassName = '',
  variant = 'inline',
  // `bare` leaves the children unwrapped, for a section that already lays out its own body.
  bare = false,
  ...props
}) {
  return (
    <details className={`fcb-disclosure fcb-disclosure--${variant} ${className}`.trim()} {...props}>
      <summary className={`fcb-disclosure-summary ${summaryClassName}`.trim()}>
        {summary}
      </summary>
      {bare ? children : <div className={`fcb-disclosure-body ${bodyClassName}`.trim()}>{children}</div>}
    </details>
  );
}
