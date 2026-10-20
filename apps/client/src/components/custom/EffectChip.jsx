import { InfoTip } from './fields';

// One effect to add: the chip and, beside it, an (i) that says what it does with an example.
export default function EffectChip({ chip }) {
  return (
    <span className="fcb-effect-chip">
      <button type="button" className="fcb-effect-chip-add" onClick={chip.add}>
        + {chip.label}
      </button>
      <InfoTip label={chip.label} text={chip.hint} />
    </span>
  );
}
