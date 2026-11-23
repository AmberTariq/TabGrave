export interface ParsedInputEntry {
  url: string;
  rawTitle: string;
  rawLine: string;
  isNoteOnly: boolean;
}

/**
 * Parses Netscape/Chrome/Firefox/Safari exported .html bookmark files
 * into clean "Title | URL" lines for the Tab Dump desk.
 */
export function parseBookmarkHtml(htmlContent: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const lines: string[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) {
      continue;
    }
    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title && title !== href) {
      lines.push(`${href} - ${title}`);
    } else {
      lines.push(href);
    }
  }

  return lines.join('\n');
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;
const BARE_DOMAIN_REGEX = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|dev|co|eu|uk|ai|app|info|me|fm|tv)(?:\/[^\s<>"{}|\\^`[\]]*)?/i;

export function extractEntriesFromRawInput(rawInput: string): ParsedInputEntry[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: ParsedInputEntry[] = [];

  for (const line of lines) {
    // Handle Markdown link [Title](https://...)
    const mdMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i);
    if (mdMatch) {
      entries.push({
        url: cleanTrailingPunctuation(mdMatch[2]),
        rawTitle: mdMatch[1].trim(),
        rawLine: line,
        isNoteOnly: false,
      });
      continue;
    }

    const urlMatch = line.match(URL_REGEX);
    if (urlMatch) {
      const url = cleanTrailingPunctuation(urlMatch[0]);
      const remainder = line
        .replace(urlMatch[0], '')
        .replace(/^[\s\-:|\u2013\u2014]+|[\s\-:|\u2013\u2014]+$/g, '')
        .trim();
      entries.push({
        url,
        rawTitle: remainder,
        rawLine: line,
        isNoteOnly: false,
      });
      continue;
    }

    const domainMatch = line.match(BARE_DOMAIN_REGEX);
    if (domainMatch) {
      const domainPath = cleanTrailingPunctuation(domainMatch[0]);
      const url = `https://${domainPath}`;
      const remainder = line
        .replace(domainMatch[0], '')
        .replace(/^[\s\-:|\u2013\u2014]+|[\s\-:|\u2013\u2014]+$/g, '')
        .trim();
      entries.push({
        url,
        rawTitle: remainder,
        rawLine: line,
        isNoteOnly: false,
      });
      continue;
    }

    // Pure text note without URL
    entries.push({
      url: '',
      rawTitle: line,
      rawLine: line,
      isNoteOnly: true,
    });
  }

  return entries;
}

function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/, '');
}
