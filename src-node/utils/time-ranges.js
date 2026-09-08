/**
 * Shared time-range helpers.
 *
 * Kept in one place so time-entry inserts, edits and calendar sync all apply
 * identical overlap rules.
 */

/** Parse "HH:MM" into minutes since midnight. */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Format minutes since midnight as "HH:MM". */
export function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Split [startTime, endTime) around any existing entries, returning only the
 * portions that remain free. An empty array means the range is fully covered.
 */
export function splitTimeRange(startTime, endTime, existingEntries) {
  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);

  if (startMins >= endMins) return [];

  let segments = [{ start: startTime, end: endTime }];

  for (const row of existingEntries) {
    if (!row.start_time || !row.end_time) continue;

    const exStart = timeToMinutes(row.start_time);
    const exEnd = timeToMinutes(row.end_time);

    if (exStart >= exEnd) continue;

    segments = segments.flatMap(({ start, end }) => {
      const segStart = timeToMinutes(start);
      const segEnd = timeToMinutes(end);

      if (exStart >= segEnd || exEnd <= segStart) {
        return [{ start, end }];
      }

      const parts = [];
      if (segStart < exStart) parts.push({ start, end: minutesToTime(exStart) });
      if (exEnd < segEnd) parts.push({ start: minutesToTime(exEnd), end });
      return parts;
    });
  }

  return segments.map(({ start, end }) => ({
    start,
    end,
    durationMins: timeToMinutes(end) - timeToMinutes(start)
  }));
}
