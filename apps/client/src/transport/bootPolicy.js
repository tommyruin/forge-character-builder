// Split ingest (interactive after core content, supplemental content ingested afterwards)
// is a diagnostic mode: on the single FIFO engine worker the rebuild it queues lands ahead
// of user calls. One complete ingest is the responsive default.
export function shouldSplitContentIngest(value) {
  return value === '1';
}
