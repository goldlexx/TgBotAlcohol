export function timeline(base, episodes) {
  const intervals = [];
  let start = base.ms, precision = base.precision;
  const sorted = [...episodes].sort((a, b) => a.start - b.start);
  for (const [index, episode] of sorted.entries()) {
    if (episode.start < start || (episode.last !== null && episode.last < episode.start)
        || (episode.last === null && index !== sorted.length - 1)) throw new Error('overlap');
    if (episode.start > start) intervals.push({ start, end: episode.start, precision });
    if (episode.last === null) return intervals;
    start = episode.last;
    precision = episode.precision;
  }
  intervals.push({ start, end: null, precision });
  return intervals;
}
