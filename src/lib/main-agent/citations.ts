import type {
  BetaContentBlock,
  BetaContentBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

interface Citation {
  url: string;
  title: string;
  cited_text: string;
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function getTextWithCitations(content: BetaContentBlock[]) {
  const parts: string[] = [];

  for (const block of content) {
    if (block.type !== "text") continue;

    const textBlock = block as unknown as {
      type: "text";
      text: string;
      citations?: Array<{
        type: string;
        url?: string;
        title?: string;
        cited_text?: string;
      }>;
    };

    if (!textBlock.citations?.length) {
      parts.push(textBlock.text);
      continue;
    }

    const citations: Citation[] = [];
    for (const c of textBlock.citations) {
      if (c.url && c.title && c.cited_text) {
        citations.push({ url: c.url, title: c.title, cited_text: c.cited_text });
      }
    }

    if (citations.length === 0) {
      parts.push(textBlock.text);
      continue;
    }

    const insertions: Array<{ index: number; link: string }> = [];
    const usedUrls = new Set<string>();

    for (const citation of citations) {
      if (usedUrls.has(citation.url)) continue;

      const searchText = citation.cited_text.replace(/\.{3}$/, "").trim();
      let matchStart = textBlock.text.indexOf(searchText);

      if (matchStart === -1 && searchText.length > 60) {
        matchStart = textBlock.text.indexOf(searchText.slice(0, 60));
      }
      if (matchStart === -1 && searchText.length > 30) {
        matchStart = textBlock.text.indexOf(searchText.slice(0, 30));
      }

      if (matchStart === -1) {
        const domain = getDomain(citation.url);
        const safeTitle = citation.title.replace(/"/g, "'");
        insertions.push({
          index: textBlock.text.length,
          link: ` [${domain}](${citation.url} "${safeTitle}")`,
        });
        usedUrls.add(citation.url);
        continue;
      }

      const matchEnd = matchStart + searchText.length;
      const sentenceEndPattern = /[.!?](?:\s|$)/g;
      sentenceEndPattern.lastIndex = matchEnd > 0 ? matchEnd - 1 : 0;

      let sentenceEnd = -1;
      const sentenceMatch = sentenceEndPattern.exec(textBlock.text);
      if (sentenceMatch) {
        sentenceEnd = sentenceMatch.index + 1;
      }

      if (sentenceEnd === -1) {
        sentenceEndPattern.lastIndex = matchStart;
        const fallbackMatch = sentenceEndPattern.exec(textBlock.text);
        sentenceEnd = fallbackMatch ? fallbackMatch.index + 1 : textBlock.text.length;
      }

      const domain = getDomain(citation.url);
      const safeTitle = citation.title.replace(/"/g, "'");
      insertions.push({
        index: sentenceEnd,
        link: ` [${domain}](${citation.url} "${safeTitle}")`,
      });
      usedUrls.add(citation.url);
    }

    insertions.sort((a, b) => b.index - a.index);

    let result = textBlock.text;
    for (const ins of insertions) {
      result = result.slice(0, ins.index) + ins.link + result.slice(ins.index);
    }

    parts.push(result);
  }

  return parts.join("");
}

export function getAssistantHistoryContent(content: unknown): BetaContentBlockParam[] | string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block): block is BetaContentBlockParam => {
      return typeof block === "object" && block != null && "type" in block && block.type === "text";
    })
    .map((block) => {
      // Strip citations from history — the encrypted_index references
      // become invalid in subsequent turns and cause API errors
      const anyBlock = block as unknown as Record<string, unknown>;
      if (anyBlock.citations) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { citations, ...rest } = anyBlock;
        return rest as unknown as BetaContentBlockParam;
      }
      return block;
    });
}
