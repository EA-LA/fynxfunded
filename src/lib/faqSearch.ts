/** Case-insensitive search: every word must appear in the question or answer. */
export function filterFaq(items: { q: string; a: string }[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter((item) => {
    const text = `${item.q} ${item.a}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}
