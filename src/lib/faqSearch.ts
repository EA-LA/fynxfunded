/** Case-insensitive search: every word must appear in the question or answer. */
export function filterFaq<T extends { q: string; a: string }>(items: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter((item) => {
    const text = `${item.q} ${item.a}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}
