// The Source column of a spell list. A spell a feature or item gave the character is filed under
// that feature (marked Custom when the character made it), the way the feature's own banner names
// it; every other spell reads as its book. The book stays in the tooltip.

import { CustomBadge } from '../../custom/CustomEntries';

export default function SpellSource({ spell }) {
  const grantedBy = spell.grantedBy;
  if (!grantedBy) return spell.source;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1"
      title={`Granted by ${grantedBy.name}. Spell source: ${spell.source}`}
    >
      {grantedBy.name}
      {grantedBy.isCustom && <CustomBadge />}
    </span>
  );
}
