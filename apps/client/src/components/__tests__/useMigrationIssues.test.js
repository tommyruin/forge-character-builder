import { describe, expect, it } from 'vitest';
import { pruneResolvedGrantIssues } from '../../hooks/useMigrationIssues';

describe('pruneResolvedGrantIssues', () => {
  it('removes a persisted grant warning when the element is in the final character state', () => {
    const resolved = {
      kind: 'elementMissing',
      previousElementId: 'ID_WIND_CALLER',
      previousElementName: 'Wind Caller',
    };
    const stillMissing = {
      kind: 'elementMissing',
      previousElementId: 'ID_REMOVED_FEATURE',
      previousElementName: 'Removed Feature',
    };

    expect(pruneResolvedGrantIssues(
      [resolved, stillMissing],
      [{ id: 'ID_WIND_CALLER' }],
    )).toEqual([stillMissing]);
  });

  it('keeps genuine missing grants and selection issues visible', () => {
    const missingGrant = { kind: 'elementMissing', previousElementId: 'ID_REMOVED_FEATURE' };
    const invalidSelection = { kind: 'selectionInvalidated', previousElementId: 'ID_WIND_CALLER' };

    expect(pruneResolvedGrantIssues(
      [missingGrant, invalidSelection],
      [{ id: 'ID_WIND_CALLER' }],
    )).toEqual([missingGrant, invalidSelection]);
  });
});
