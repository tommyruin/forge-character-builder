// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ContentRenderer from '../ContentRenderer';

function renderRich(content) {
  return renderToStaticMarkup(<ContentRenderer content={content} />);
}

describe('ContentRenderer corpus class semantics', () => {
  // The corpus authors its descriptions against these class semantics.

  it('renders span.feature as a strong feature label', () => {
    const markup = renderRich('<span class="feature">Darkvision. </span>You can see in dim light.');
    expect(markup).toContain('<strong class="fcb-hb-feature">Darkvision. </strong>');
  });

  it('renders span.emphasis as a strong label', () => {
    const markup = renderRich('<span class="emphasis">Male Names: </span>Adrik, Alberich.');
    expect(markup).toContain('<strong class="fcb-hb-emphasis">Male Names: </strong>');
  });

  it('renders div.sidebar as a styled callout container', () => {
    const markup = renderRich('<div class="sidebar"><h5>Variant Rule</h5><p>Sidebar text.</p></div>');
    expect(markup).toContain('<div class="fcb-hb-sidebar">');
  });

  it('keeps p.flavor mapped to the flavor class', () => {
    const markup = renderRich('<p class="flavor">Bold and hardy, dwarves are known as skilled warriors.</p>');
    expect(markup).toContain('<p class="fcb-hb-flavor">');
  });

  it('maps the generated stat block container', () => {
    const markup = renderRich(
      '<div class="stat-block"><p><span class="feature">Damage. </span>1d12</p></div>',
    );
    expect(markup).toContain('<div class="fcb-stat-block">');
  });

  it('drops whitespace between table structure tags', () => {
    // Corpus tables are pretty-printed; whitespace text nodes are invalid as
    // children of table/thead/tbody/tr and React rejects them at runtime.
    const markup = renderRich(
      '<table>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>Level</th>\n\t\t</tr>\n\t</thead>\n' +
        '\t<tbody>\n\t\t<tr>\n\t\t\t<td>1st</td>\n\t\t</tr>\n\t</tbody>\n</table>',
    );

    expect(markup).toContain('<table><thead><tr><th>Level</th></tr></thead>');
    expect(markup).toContain('<tbody><tr><td>1st</td></tr></tbody>');
  });

  it('keeps the empty indent span used as a paragraph separator', () => {
    const markup = renderRich('First paragraph.<br/><span class="indent"></span>Second paragraph.');
    expect(markup).toContain('<span class="fcb-hb-indent"></span>');
  });
});
