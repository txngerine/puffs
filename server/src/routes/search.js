import { Router } from 'express';

export const search = Router();

const wikiLanguage = (value) => {
  const code = String(value || '').toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(code) ? code : 'en';
};

search.get('/answer', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 240) : '';
  if (!query) return res.status(400).json({ error: 'a question is required' });
  const lang = wikiLanguage(req.query.lang);
  try {
    const endpoint = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    endpoint.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '1', format: 'json', origin: '*' });
    const found = await fetch(endpoint, { headers: { 'User-Agent': 'EveAssistant/1.0 (Wikipedia answer lookup)' }, signal: AbortSignal.timeout(7000) });
    if (!found.ok) return res.status(502).json({ error: 'Wikipedia lookup failed' });
    const title = (await found.json()).query?.search?.[0]?.title;
    if (!title) return res.json({ query, answer: null });
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    const summaryResponse = await fetch(summaryUrl, { headers: { 'User-Agent': 'EveAssistant/1.0 (Wikipedia answer lookup)', Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
    if (!summaryResponse.ok) return res.json({ query, answer: null });
    const summary = await summaryResponse.json();
    const extract = typeof summary.extract === 'string' ? summary.extract.trim().slice(0, 1800) : '';
    const article = summary.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    res.json({ query, answer: extract ? { title: summary.title || title, extract, url: article } : null });
  } catch {
    res.status(503).json({ error: 'Wikipedia is unavailable right now' });
  }
});

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
