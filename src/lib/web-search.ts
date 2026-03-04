const RESULT_LINK_REGEX =
  /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export interface WebSearchResult {
  title: string;
  url: string;
}

export async function webSearch(
  query: string,
  maxResults = 5,
): Promise<WebSearchResult[]> {
  const target = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(target, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; EndlessDevBot/1.0)",
      accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`);
  }

  const html = await response.text();
  const results: WebSearchResult[] = [];

  for (const match of html.matchAll(RESULT_LINK_REGEX)) {
    const url = decodeHtml(match[1]);
    const title = decodeHtml(match[2]);
    if (!url || !title) continue;
    results.push({ title, url });
    if (results.length >= maxResults) break;
  }

  return results;
}
