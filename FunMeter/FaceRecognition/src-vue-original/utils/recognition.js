export function toSetOfLabels(results) {
  const set = new Set();
  for (const r of results || []) {
    const lab = (r.label || '').trim();
    if (lab && lab !== 'Unknown') set.add(lab);
  }
  return set;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  const inter = new Set([...a].filter((x) => b.has(x))).size;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}
