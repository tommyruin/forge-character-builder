import { useEffect } from 'react';
import useSheetTemplateSetting from '../../../hooks/useSheetTemplateSetting';
import useSheetColoursSetting from '../../../hooks/useSheetColoursSetting';
import useSheetFontsSetting from '../../../hooks/useSheetFontsSetting';
import useSheetPagesSetting from '../../../hooks/useSheetPagesSetting';
import FilterSelect from '../../FilterSelect';
import Icon from '../../Icon';
import { ensureSheetFontFaces, sheetFaceFontFamily } from '../../../sheetFontFaces.js';
import { useWorkspace } from '../../WorkspaceContext';

const TEMPLATE_SET_LABELS = {
  2014: 'Classic layout for the 2014 rules: ability scores, saving throws and skills in their own columns.',
  2024: 'Layout for the 2024 rules: each ability carries its saving throw and skills.',
};

const PART_LABELS = {
  accent: 'Frames & ribbons',
  lines: 'Lines & ornaments',
  text: 'Text',
};

const PART_TIPS = {
  accent: "Colours the sheet's borders, title ribbons and shields.",
  lines: 'Colours the inner rules, ornaments and small captions.',
  text: 'Colours the labels and the values written into the sheet.',
};

const ROLE_LABELS = {
  titles: 'Titles',
  captions: 'Captions',
  body: 'Body text',
  numbers: 'Numbers',
};

const ROLE_TIPS = {
  titles: 'The section names and ribbon titles.',
  captions: 'The small labels beside fields.',
  body: 'Features, descriptions and most values.',
  numbers: 'Ability scores, armor class, hit points and similar figures.',
};

function cssColor([red, green, blue]) {
  return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
}

/** A heading with an explanatory tip on hover and for assistive technology. */
function TipHeading({ label, tip }) {
  return (
    <h3 className="fcb-sheet-colour-part">
      {label}
      <span className="fcb-info-tip" title={tip} aria-label={tip} role="img">
        <Icon name="info" className="fcb-info-tip-icon" />
      </span>
    </h3>
  );
}

/**
 * Sheet settings: the template set (2014 or 2024 layout), the sheet's
 * colours — a preset theme, or each part chosen on its own — and the
 * typefaces per role, each shown in its own face. Everything persists per
 * browser as soon as it is chosen and applies to the sheet tab, the split
 * preview and exports alike.
 */
export default function SheetSettingsPanel() {
  const { templateSet, setTemplateSet, templateSets } = useSheetTemplateSetting();
  // The panel also renders outside a workspace (settings, tests), where there
  // is no character to compare the layout against.
  const workspace = useWorkspace();
  const rulesetMode = workspace?.detail?.rulesetMode;
  const mismatchedEdition = (rulesetMode === '2014' || rulesetMode === '2024') && rulesetMode !== templateSet;
  const { colours, theme, setColours, setTheme, palette, themes, themeNames } = useSheetColoursSetting();
  const { pages, togglePage, pageNames, pageLabels, pageTips } = useSheetPagesSetting();
  const { fonts, setFonts, faces, faceNames, roles } = useSheetFontsSetting();
  useEffect(() => {
    ensureSheetFontFaces();
  }, []);
  return (
    <>
      <section className="fcb-panel">
        <header className="fcb-panel-header">
          <h2 className="fcb-panel-title">Sheet layout</h2>
        </header>
        <div className="fcb-panel-body space-y-3">
          <div className="fcb-sheet-set-toggle" role="group" aria-label="Sheet layout">
            {templateSets.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`fcb-sheet-set-option${candidate === templateSet ? ' is-active' : ''}`}
                onClick={() => setTemplateSet(candidate)}
                aria-pressed={candidate === templateSet}
              >
                {candidate}
              </button>
            ))}
          </div>
          <p className="fcb-muted-copy text-sm">{TEMPLATE_SET_LABELS[templateSet]}</p>
          {mismatchedEdition && (
            <div className="fcb-sheet-set-mismatch space-y-2">
              <p className="fcb-muted-copy text-sm">
                {`This character is built on the ${rulesetMode} rules, but the sheet prints the ${templateSet} layout.`}
              </p>
              <button
                type="button"
                className="fcb-button"
                aria-label={`Match the sheet layout to the ${rulesetMode} ruleset`}
                onClick={() => setTemplateSet(rulesetMode)}
              >
                Match ruleset
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="fcb-panel">
        <header className="fcb-panel-header">
          <h2 className="fcb-panel-title">Sheet pages</h2>
        </header>
        <div className="fcb-panel-body space-y-3">
          <p className="fcb-muted-copy text-sm">
            Untick a page to leave it out of the sheet, the split-view preview and every
            export. The remaining pages keep their numbering.
          </p>
          <div className="fcb-sheet-page-toggles space-y-2" role="group" aria-label="Sheet pages">
            {pageNames.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pages[name]}
                  onChange={() => togglePage(name)}
                  aria-label={pageLabels[name]}
                />
                <span>{pageLabels[name]}</span>
                <span className="fcb-info-tip" title={pageTips[name]} aria-label={pageTips[name]} role="img">
                  <Icon name="info" className="fcb-info-tip-icon" />
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>
      <section className="fcb-panel">
        <header className="fcb-panel-header">
          <h2 className="fcb-panel-title">Sheet colours</h2>
        </header>
        <div className="fcb-panel-body space-y-4">
          <div>
            <TipHeading label="Themes" tip="A preset combination of the three colours below." />
            <div className="fcb-sheet-accent-swatches" role="group" aria-label="Sheet colour themes">
              {themeNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`fcb-sheet-accent-swatch fcb-sheet-theme-swatch${name === theme ? ' is-active' : ''}`}
                  onClick={() => setTheme(name)}
                  aria-pressed={name === theme}
                >
                  <span className="fcb-sheet-theme-discs" aria-hidden="true">
                    <span className="fcb-sheet-accent-swatch-disc" style={{ '--fcb-swatch': cssColor(palette[themes[name].accent].rgb) }} />
                    <span className="fcb-sheet-accent-swatch-disc" style={{ '--fcb-swatch': cssColor(palette[themes[name].lines].rgb) }} />
                    <span className="fcb-sheet-accent-swatch-disc" style={{ '--fcb-swatch': cssColor(palette[themes[name].text].rgb) }} />
                  </span>
                  <span>{themes[name].label}</span>
                </button>
              ))}
            </div>
          </div>
          {Object.keys(PART_LABELS).map((part) => (
            <div key={part}>
              <TipHeading label={PART_LABELS[part]} tip={PART_TIPS[part]} />
              <div className="fcb-sheet-accent-swatches" role="group" aria-label={PART_LABELS[part]}>
                {Object.keys(palette).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`fcb-sheet-accent-swatch${name === colours[part] ? ' is-active' : ''}`}
                    style={{ '--fcb-swatch': cssColor(palette[name].rgb) }}
                    onClick={() => setColours({ [part]: name })}
                    aria-pressed={name === colours[part]}
                    aria-label={`${palette[name].label} ${PART_LABELS[part].toLowerCase()}`}
                  >
                    <span className="fcb-sheet-accent-swatch-disc" aria-hidden="true" />
                    <span>{palette[name].label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="fcb-panel">
        <header className="fcb-panel-header">
          <h2 className="fcb-panel-title">Sheet typefaces</h2>
        </header>
        <div className="fcb-panel-body space-y-4">
          {roles.map((role) => (
            <div key={role} className="fcb-sheet-face-row">
              <TipHeading label={ROLE_LABELS[role]} tip={ROLE_TIPS[role]} />
              <FilterSelect
                className="fcb-sheet-face-select"
                testId={`sheet-face-${role}`}
                value={fonts[role]}
                onChange={(name) => setFonts({ [role]: name })}
                options={faceNames
                  .filter((name) => faces[name].roles.includes(role))
                  .map((name) => ({ value: name, label: faces[name].label, style: { fontFamily: sheetFaceFontFamily(name) } }))}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
