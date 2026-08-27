/**
 * Timeline projection. Ordering is chronological, then stable by id.
 * @param {Array<{ id: string, occurredAt: string, type: string, summary: string, authorityKind?: string }>} events
 * @returns {typeof events}
 */
export function sortTimeline(events) {
  return [...events].sort((a, b) => {
    const byTime = a.occurredAt.localeCompare(b.occurredAt);
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
}
