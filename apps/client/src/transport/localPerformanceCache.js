export async function resetLocalPerformanceCache(fastStart) {
  if (
    typeof fastStart?.remove !== 'function' ||
    typeof fastStart?.rebuild !== 'function'
  ) {
    throw new Error('Local performance cache controls are unavailable.');
  }
  await fastStart.remove();
  return fastStart.rebuild();
}
