import { useCallback, useEffect, useRef } from 'react';
import ContentRenderer from '../../ContentRenderer';

export default function SpellDetails({ spell, panelProps = {} }) {
  const {
    scrollRef,
    onReturn,
    onContentReady,
    returnLabel = 'Back to list',
    detailsLabel = 'Spell details',
  } = panelProps;
  const panelRef = useRef(null);
  const setPanelRef = useCallback(
    (node) => {
      panelRef.current = node;
      if (typeof scrollRef === 'function') scrollRef(node);
    },
    [scrollRef],
  );

  useEffect(() => {
    if (!onContentReady) return undefined;
    const handle = window.requestAnimationFrame(() => {
      onContentReady(panelRef.current);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [onContentReady, spell?.id]);

  if (!spell) return null;

  const level = spell.level === 0 ? 'Cantrip' : `${spell.level}${spell.level === 1 ? 'st' : spell.level === 2 ? 'nd' : spell.level === 3 ? 'rd' : 'th'} level`;
  // The casting metadata renders INSIDE the formatted description block —
  // "Conjuration Cantrip" then bold Casting Time / Range / Components /
  // Duration lines above the spell text — never as a separate plain list
  // below the styled card.
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const headline = spell.level === 0
    ? `${spell.school ? `${escapeHtml(spell.school)} ` : ''}Cantrip`
    : `${level}${spell.school ? ` ${escapeHtml(spell.school)}` : ''}`;
  const metaLines = [
    ['Casting Time', spell.castingTime],
    ['Range', spell.range],
    ['Components', spell.components],
    ['Duration', spell.duration],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<p class="spell-meta-line"><strong>${label}:</strong> ${escapeHtml(value)}</p>`)
    .join('');
  // The wrapper class styles the gap between the Duration line and the start
  // of the spell text; the line class keeps metadata rows tight and unindented.
  const composedContent = `<div class="spell-meta"><p class="spell-meta-line"><strong>${headline}</strong></p>${metaLines}</div>${spell.description ?? ''}`;

  return (
    <aside
      className={`fcb-panel fcb-description-panel ${onReturn ? 'is-mobile-navigation-target' : ''}`}
    >
      {/* The panel clips to its radius and this region scrolls: a scrollbar is
          painted on the border box, so a rounded panel that scrolls itself gets
          a straight track down its edge. Putting the ref on the panel instead
          leaves a long spell with no way to reach the rest of it. */}
      <div
        ref={setPanelRef}
        aria-label={onReturn ? detailsLabel : undefined}
        tabIndex={onReturn ? -1 : undefined}
        className="fcb-description-scroll"
      >
        {onReturn && (
          <button
            type="button"
            className="fcb-button fcb-description-return"
            data-testid="description-return"
            aria-label={returnLabel}
            onClick={onReturn}
          >
            ← {returnLabel}
          </button>
        )}
        <div className="fcb-panel-body">
          <ContentRenderer
            title={spell.name}
            subtitle="Spell"
            source={spell.source}
            content={composedContent}
            empty="No description available."
          />
        </div>
      </div>
    </aside>
  );
}
