export function fastStartActivityFor(status, observedBuilding = false) {
  if (!status?.enabled || !status?.supported) return null;
  if (status.readiness === 'building' && status.bootMode) {
    return {
      kind: 'building',
      message:
        'Updating Fast Start… Keep this tab open for a faster next launch.',
    };
  }
  if (!observedBuilding) return null;
  if (status.readiness === 'ready') {
    return {
      kind: 'ready',
      message: 'Fast Start is ready for the next launch.',
    };
  }
  if (status.error) {
    return {
      kind: 'error',
      message:
        'Fast Start could not be updated. Normal loading will still work.',
    };
  }
  return null;
}
