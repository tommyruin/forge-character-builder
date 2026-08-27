import React, { useMemo } from 'react';
import {
  formatRequirementExpression,
  isInternalClassGrantRequirement,
  requirementExpressionForPresentation,
  requirementDuplicatesPrerequisite,
} from './requirementPresentation';

const SAFE_URL_PATTERN = /^(https?:|mailto:)/i;
const CLASS_MAP = {
  flavor: 'fcb-hb-flavor',
  sidebar: 'fcb-hb-sidebar',
  emphasis: 'fcb-hb-emphasis',
  indent: 'fcb-hb-indent',
  caption: 'fcb-hb-caption',
  feature: 'fcb-hb-feature',
  note: 'fcb-hb-note',
  descriptive: 'fcb-hb-descriptive',
  quote: 'fcb-hb-quote',
  attribution: 'fcb-hb-attribution',
  reference: 'fcb-rich-reference',
  wide: 'fcb-hb-wide',
  classTable: 'fcb-hb-class-table',
  frame: 'fcb-hb-frame',
  decoration: 'fcb-hb-decoration',
  monster: 'fcb-hb-monster',
  bonus: 'fcb-hb-bonus',
  spellList: 'fcb-hb-spell-list',
  'spell-meta': 'fcb-spell-meta',
  'spell-meta-line': 'fcb-spell-meta-line',
  'stat-block': 'fcb-stat-block',
  'stat-line': 'fcb-stat-line',
  entry: 'fcb-hb-entry',
};

function textFromHtml(value) {
  if (!value) return '';
  if (typeof DOMParser === 'undefined') return String(value).replace(/<[^>]*>/g, ' ');
  const parser = new DOMParser();
  const document = parser.parseFromString(`<body>${value}</body>`, 'text/html');
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

// Table structure admits no text children: corpus tables are pretty-printed, and
// the whitespace between their tags is invalid markup React refuses to render.
const TABLE_STRUCTURE_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
]);

function getChildren(node, keyPrefix) {
  const dropWhitespace = TABLE_STRUCTURE_TAGS.has(
    node.tagName?.toLowerCase?.() ?? '',
  );
  return Array.from(node.childNodes)
    .filter(
      (child) =>
        !(dropWhitespace && child.nodeType === 3 && !child.textContent?.trim()),
    )
    .map((child, index) => renderNode(child, `${keyPrefix}-${index}`))
    .filter((child) => child !== null && child !== undefined && child !== false);
}

function renderInlineChildren(node, keyPrefix) {
  const children = getChildren(node, keyPrefix);
  return children.length > 0 ? children : node.textContent;
}

function mappedClassName(element, ...extraClasses) {
  const classes = [];
  for (const [source, target] of Object.entries(CLASS_MAP)) {
    if (element.classList?.contains(source)) classes.push(target);
  }
  classes.push(...extraClasses.filter(Boolean));
  return classes.length > 0 ? classes.join(' ') : undefined;
}

/** True when the authored inline style centers the element's text. */
function hasCenteredStyle(element) {
  const style = element.getAttribute?.('style') ?? '';
  return /text-align\s*:\s*center/i.test(style);
}

/**
 * Table-cell presentation authored in the corpus: colspan/rowspan geometry,
 * "col-N" width classes, and centered inline styles. Raw style strings are
 * never forwarded — only this safe, recognized subset.
 */
function cellPresentation(element) {
  const props = {};
  const colSpan = Number.parseInt(element.getAttribute?.('colspan') ?? '', 10);
  const rowSpan = Number.parseInt(element.getAttribute?.('rowspan') ?? '', 10);
  if (Number.isInteger(colSpan) && colSpan > 1) props.colSpan = colSpan;
  if (Number.isInteger(rowSpan) && rowSpan > 1) props.rowSpan = rowSpan;
  const extraClasses = [];
  if (hasCenteredStyle(element) || element.classList?.contains('center')) {
    extraClasses.push('fcb-hb-center');
  }
  for (const cls of element.classList ?? []) {
    const width = /^col-(\d{1,2})$/.exec(cls);
    if (width) props.style = { width: `${width[1]}%` };
  }
  return { props, extraClasses };
}

function renderNode(node, key) {
  if (node.nodeType === 3) {
    return node.textContent;
  }

  if (node.nodeType !== 1) {
    return null;
  }

  const element = node;
  const tag = element.tagName.toLowerCase();
  const children = getChildren(element, key);
  const hasUnderline = element.classList?.contains('underline');
  const className = mappedClassName(element);

  switch (tag) {
    case 'h1':
    case 'title':
      return <h1 key={key}>{children}</h1>;
    case 'h2':
    case 'subtitle':
      return <h2 key={key}>{children}</h2>;
    case 'h3':
      return <h3 key={key}>{children}</h3>;
    case 'h4':
      return <h4 key={key}>{children}</h4>;
    case 'h5':
      return <h5 key={key}>{children}</h5>;
    case 'h6':
      return <h6 key={key}>{children}</h6>;
    case 'p':
      return (
        <p
          key={key}
          className={mappedClassName(
            element,
            hasUnderline ? 'fcb-rich-lead' : undefined,
            /text-indent/i.test(element.getAttribute?.('style') ?? '') ? 'fcb-hb-indent' : undefined,
          )}
        >
          {children}
        </p>
      );
    case 'div':
    case 'section':
    case 'article':
    case 'description':
      return (
        <div key={key} className={className}>
          {children}
        </div>
      );
    case 'br':
      return <br key={key} />;
    case 'hr':
      return <hr key={key} />;
    case 'strong':
    case 'b':
      return <strong key={key} className={className}>{renderInlineChildren(element, key)}</strong>;
    case 'em':
    case 'i':
      return <em key={key}>{renderInlineChildren(element, key)}</em>;
    case 'u':
      return <span key={key} className="fcb-rich-underline">{renderInlineChildren(element, key)}</span>;
    case 'span': {
      if (element.classList?.contains('feature')) {
        return <strong key={key} className="fcb-hb-feature">{renderInlineChildren(element, key)}</strong>;
      }
      if (element.classList?.contains('emphasis')) {
        return <strong key={key} className="fcb-hb-emphasis">{renderInlineChildren(element, key)}</strong>;
      }
      return <span key={key} className={className}>{renderInlineChildren(element, key)}</span>;
    }
    case 'small':
      return <span key={key} className={className}>{renderInlineChildren(element, key)}</span>;
    case 'sup':
      return <sup key={key}>{renderInlineChildren(element, key)}</sup>;
    case 'sub':
      return <sub key={key}>{renderInlineChildren(element, key)}</sub>;
    case 'code':
      return <code key={key}>{renderInlineChildren(element, key)}</code>;
    case 'pre':
      return <pre key={key} className={className}>{children}</pre>;
    case 'ul':
      return <ul key={key} className={mappedClassName(element, element.classList?.contains('unstyled') ? 'fcb-rich-list-plain' : undefined)}>{children}</ul>;
    case 'ol':
      return <ol key={key} className={className}>{children}</ol>;
    case 'li':
      return <li key={key} className={className}>{children}</li>;
    case 'dl':
      return <dl key={key} className={className}>{children}</dl>;
    case 'dt':
      return <dt key={key} className={className}>{children}</dt>;
    case 'dd':
      return <dd key={key} className={className}>{children}</dd>;
    case 'blockquote':
      return <blockquote key={key} className={mappedClassName(element, 'fcb-hb-quote')}>{children}</blockquote>;
    case 'table':
      return (
        <div key={key} className={mappedClassName(element, 'fcb-rich-table-wrap')}>
          <table className={mappedClassName(element, hasCenteredStyle(element) ? 'fcb-hb-center' : undefined)}>
            {children}
          </table>
        </div>
      );
    case 'thead':
      return <thead key={key}>{children}</thead>;
    case 'tbody':
      return <tbody key={key}>{children}</tbody>;
    case 'tfoot':
      return <tfoot key={key}>{children}</tfoot>;
    case 'tr':
      return <tr key={key}>{children}</tr>;
    case 'th': {
      const cell = cellPresentation(element);
      return (
        <th
          key={key}
          scope={element.getAttribute('scope') === 'row' ? 'row' : undefined}
          className={mappedClassName(element, ...cell.extraClasses)}
          {...cell.props}
        >
          {children}
        </th>
      );
    }
    case 'td': {
      const cell = cellPresentation(element);
      return (
        <td key={key} className={mappedClassName(element, ...cell.extraClasses)} {...cell.props}>
          {children}
        </td>
      );
    }
    case 'center':
      return <div key={key} className={mappedClassName(element, 'fcb-hb-center')}>{children}</div>;
    case 'a': {
      const href = element.getAttribute('href')?.trim();
      if (!href || !SAFE_URL_PATTERN.test(href)) {
        return <span key={key}>{renderInlineChildren(element, key)}</span>;
      }
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {renderInlineChildren(element, key)}
        </a>
      );
    }
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function renderFragment(value) {
  if (!value) return null;
  if (typeof DOMParser === 'undefined') return String(value);
  const parser = new DOMParser();
  const document = parser.parseFromString(`<body>${value}</body>`, 'text/html');
  return Array.from(document.body.childNodes)
    .map((node, index) => renderNode(node, `fcb-rich-${index}`))
    .filter((node) => node !== null && node !== undefined && node !== false);
}

function hasContent(value) {
  return Boolean(textFromHtml(value));
}

function MetadataPill({ label, value, formatValue = textFromHtml }) {
  const displayValue = formatValue(textFromHtml(value));
  if (!displayValue) return null;
  return (
    <span className="fcb-meta-pill">
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </span>
  );
}

function SourceReference({ source, page, url }) {
  if (!source && !page && !url) return null;
  const displaySource = textFromHtml(source || 'Source');
  const displayPage = textFromHtml(page);
  const safeUrl = url && SAFE_URL_PATTERN.test(url.trim()) ? url.trim() : null;
  const content = (
    <>
      <span>{displaySource}</span>
      {displayPage && <strong>p. {displayPage}</strong>}
    </>
  );
  if (safeUrl) {
    return (
      <a className="fcb-source-link" href={safeUrl} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }
  return <span className="fcb-source-link">{content}</span>;
}

export default function ContentRenderer({
  element,
  content,
  title,
  subtitle,
  source,
  sourcePage,
  sourceUrl,
  sheetDescription,
  requirements,
  prerequisite,
  empty = 'No description available.',
  compact = false,
}) {
  const displayTitle = title ?? sheetDescription?.alternateName ?? element?.sheetDescription?.alternateName ?? element?.name;
  const displaySubtitle = subtitle ?? element?.type;
  const displaySource = source ?? element?.source;
  const displayPage = sourcePage ?? element?.sourcePage;
  const displayUrl = sourceUrl ?? element?.sourceUrl;
  const displayRequirements = requirements ?? element?.requirements;
  const displayPrerequisite = prerequisite ?? element?.prerequisite;
  const displayRarity = element?.rarity;
  const displayAttunement = element?.attunement?.required
    ? `Required${element.attunement.addition ? ` ${element.attunement.addition}` : ''}`
    : null;
  const rawRequirementText = textFromHtml(displayRequirements);
  const requirementText = requirementExpressionForPresentation({
    elementName: displayTitle,
    elementType: displaySubtitle,
    requirements: rawRequirementText,
  });
  const hideInternalClassRequirement = isInternalClassGrantRequirement({
    elementType: displaySubtitle,
    requirements: rawRequirementText,
  });
  const visibleRequirements =
    hideInternalClassRequirement ||
    !requirementText ||
    requirementDuplicatesPrerequisite({
      prerequisite: textFromHtml(displayPrerequisite),
      requirements: requirementText,
    })
    ? null
    : requirementText;
  const displaySheet = sheetDescription ?? element?.sheetDescription;
  const mainContent = content ?? element?.generatedDescription ?? element?.description;

  const renderedMain = useMemo(() => renderFragment(mainContent), [mainContent]);
  const hasMain = hasContent(mainContent);
  const sheetEntries = displaySheet?.entries?.filter((entry) => hasContent(entry.description)) ?? [];
  const hasSheetMeta = Boolean(displaySheet?.usage || displaySheet?.action || sheetEntries.length > 0);

  return (
    <div className={`fcb-content-renderer ${compact ? 'fcb-content-renderer-compact' : ''}`}>
      {(displayTitle || displaySubtitle || displaySource) && (
        <header className="fcb-content-header">
          {displayTitle && <h2>{displayTitle}</h2>}
          <div className="fcb-content-meta">
            {displaySubtitle && <span>{displaySubtitle}</span>}
            <SourceReference source={displaySource} page={displayPage} url={displayUrl} />
          </div>
        </header>
      )}

      {(displayPrerequisite || visibleRequirements || displaySheet?.usage || displaySheet?.action || displayRarity || displayAttunement) && (
        <div className="fcb-meta-strip">
          <MetadataPill label="Prerequisite" value={displayPrerequisite} />
          <MetadataPill
            label="Requirements"
            value={visibleRequirements}
            formatValue={formatRequirementExpression}
          />
          <MetadataPill label="Usage" value={displaySheet?.usage} />
          <MetadataPill label="Action" value={displaySheet?.action} />
          <MetadataPill label="Rarity" value={displayRarity} />
          <MetadataPill label="Attunement" value={displayAttunement} />
        </div>
      )}

      {hasMain ? (
        <div className="fcb-rich-text">{renderedMain}</div>
      ) : (
        <p className="fcb-empty-copy">{empty}</p>
      )}

      {hasSheetMeta && (
        <section className="fcb-sheet-descriptions">
          <h3>Sheet Description</h3>
          {sheetEntries.map((entry, index) => (
            <article key={`${entry.level}-${index}`} className="fcb-sheet-entry">
              <div className="fcb-sheet-entry-meta">
                <MetadataPill label="Level" value={entry.level > 1 ? entry.level : '1+'} />
                <MetadataPill label="Usage" value={entry.usage} />
                <MetadataPill label="Action" value={entry.action} />
              </div>
              <div className="fcb-rich-text fcb-rich-text-sheet">
                {renderFragment(entry.description)}
              </div>
            </article>
          ))}
          {sheetEntries.length === 0 && (
            <p className="fcb-empty-copy">This element is marked for sheet display without additional sheet text.</p>
          )}
        </section>
      )}
    </div>
  );
}
