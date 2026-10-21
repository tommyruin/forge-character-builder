// The Source column of a spell list. A spell a feature or item gave the character is filed under
// that feature (marked Custom when the character made it), the way the feature's own banner names
// it; every other spell reads as its book. The book stays in the tooltip.

import { CustomBadge } from '../../custom/CustomEntries';
import { sourceLabel } from '../../sourceLabel';

export default function SpellSource({ spell }) {
  const grantedBy = spell.grantedBy;
  if (!grantedBy) return sourceLabel(spell.source);
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1"
      title={sourceLabel(spell.source) ? `Granted by ${grantedBy.name}. Spell source: ${sourceLabel(spell.source)}` : `Granted by ${grantedBy.name}`}
    >
      {grantedBy.name}
      {grantedBy.isCustom && <CustomBadge />}
    </span>
  );
}
