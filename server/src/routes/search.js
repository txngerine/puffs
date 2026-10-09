import { Router } from 'express';

export const search = Router();

const decodeHtml = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/\s+/g, ' ').trim();

function resultsFrom(html) {
  const anchors = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (!/\bclass\s*=\s*["'][^"']*\bresult__a\b/i.test(match[1])) continue;
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)/i)?.[1];
    if (!href) continue;
    let url;
    try {
      url = new URL(decodeHtml(href), 'https://html.duckduckgo.com');
      const redirect = url.searchParams.get('uddg');
      if (redirect) url = new URL(redirect);
    } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || /(^|\.)duckduckgo\.com$/i.test(url.hostname)) continue;
    anchors.push({ at: re.lastIndex, title: decodeHtml(match[2]), url: url.href });
  }
  return anchors.map((item, i) => {
    const section = html.slice(item.at, anchors[i + 1]?.at || item.at + 1800);
    const snippet = section.match(/<[^>]*class\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] || '';
    return { title: item.title, url: item.url, snippet: decodeHtml(snippet) };
  }).filter((r) => r.title && r.url).slice(0, 5);
}

search.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 240) : '';
  if (!query) return res.status(400).json({ error: 'a search query is required' });
  try {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'EveAssistant/1.0 (web search)', Accept: 'text/html' },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return res.status(502).json({ error: 'search provider returned an error' });
    const html = await response.text();
    res.json({ query, results: resultsFrom(html) });
  } catch {
    res.status(503).json({ error: 'web search is unavailable right now' });
  }
});
