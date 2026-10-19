// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { useCustomContent } from '../CustomEntries';
import { mount, settle } from './harness';

const entries = [
  { kind: 'feature', elementId: 'ID_CUSTOM_A', draft: { name: 'Boon' } },
  { kind: 'item', elementId: 'ID_CUSTOM_B', draft: { name: 'Sword' } },
  // An entry from before items existed carries no kind and is a feature.
  { elementId: 'ID_CUSTOM_C', draft: { name: 'Old gift' } },
];

// One services object for the whole run: a new one every render would refetch forever.
const services = { list: vi.fn(async () => ({ entries, problems: [] })) };

function Names({ kind }) {
  const { entries: listed } = useCustomContent(services, 0, kind);
  return <ul>{listed.map((entry) => <li key={entry.elementId}>{entry.draft.name}</li>)}</ul>;
}

const names = () => [...document.querySelectorAll('li')].map((node) => node.textContent);

describe('the custom entries a tab lists', () => {
  it('are features for Build, so an item never lands in a Build section', async () => {
    await mount(<Names />);
    await settle();
    expect(names()).toEqual(['Boon', 'Old gift']);
  });

  it('are items for Equipment', async () => {
    await mount(<Names kind="item" />);
    await settle();
    expect(names()).toEqual(['Sword']);
  });
});
