export function chunkPages(pages: string[], size = 1200, overlap = 200) {
  const out: { page: number; content: string }[] = [];
  pages.forEach((text, i) => {
    const clean = text.replace(/\s+/g, " ").trim();
    for (let s = 0; s < clean.length; s += size - overlap) {
      const piece = clean.slice(s, s + size);
      if (piece.length > 50) out.push({ page: i + 1, content: piece });
      if (s + size >= clean.length) break;
    }
  });
  return out;
}