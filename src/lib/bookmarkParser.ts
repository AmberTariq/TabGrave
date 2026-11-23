export interface ParsedInputEntry {
  url: string;
  rawTitle: string;
  rawLine: string;
  isNoteOnly: boolean;
}

/**
 * Parses Netscape/Chrome/Firefox/Safari exported .html bookmark files
 * into clean "<URL> - Title" lines for the Tab Dump desk.
 */
export function parseBookmarkHtml(htmlContent: string): string {
  const template = document.createElement('template');
  template.innerHTML = htmlContent;
  const anchors = template.content.querySelectorAll('a[href]');
  const lines: string[] = [];

  for (const anchor of anchors) {
    const href = getHttpUrl(anchor.getAttribute('href') ?? '');
    if (!href) continue;
    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title && title !== href) {
      lines.push(`<${href}> - ${title}`);
    } else {
      lines.push(`<${href}>`);
    }
  }

  return lines.join('\n');
}

const LINKS = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)|(https?:\/\/(?:\[[\da-f:.]+\]|[^\s<>"{}|\\^`[\]]+)[^\s<>"{}|\\^`[\]]*)/gi;
const BARE_DOMAIN_REGEX = /(?<![@/\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|dev|co|eu|uk|ai|app|info|me|fm|tv)(?![\w.-])(?:[/?#][^\s<>"{}|\\^`[\]]*)?/i;

export function getHttpUrl(value: string): string {
  const url = value.trim();
  if (!/^https?:\/\/[^/]/i.test(url) || /[\s<>\\]/.test(url)) return '';
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password ? '' : url;
  } catch {
    return '';
  }
}

function cleanTitle(title: string): string {
  return title.replace(/^[\s,;\-:|<>()\u2013\u2014]+|[\s,;\-:|<>()\u2013\u2014]+$/g, '');
}

export function extractEntriesFromRawInput(rawInput: string): ParsedInputEntry[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: ParsedInputEntry[] = [];

  for (const line of lines) {
    const imported = line.match(/^<(https?:\/\/[^<>]+)>(?: - (.+))?$/i);
    const importedUrl = imported && getHttpUrl(imported[1]);
    if (imported && importedUrl) {
      entries.push({ url: importedUrl, rawTitle: imported[2] ?? '', rawLine: importedUrl, isNoteOnly: false });
      continue;
    }

    const links = Array.from(line.matchAll(LINKS));
    if (links.length) {
      const parsedLinks = links.flatMap((link, index) => {
        const start = link.index;
        const end = start + link[0].length;
        const enclosed = line[start - 1] === '<' && line[end] === '>';
        const url = getHttpUrl(link[2] ?? (enclosed ? link[3] : cleanTrailingPunctuation(link[3])));
        if (!url) return [];
        const before = index === 0 ? cleanTitle(line.slice(0, start)) : '';
        const after = cleanTitle(line.slice(end, links[index + 1]?.index));
        const rawTitle = link[1]?.trim() ?? [before, after].filter(Boolean).join(' ');
        return [{ url, rawTitle, rawLine: url, isNoteOnly: false }];
      });
      if (parsedLinks.length) {
        entries.push(...parsedLinks);
        continue;
      }
      entries.push({ url: '', rawTitle: line, rawLine: line, isNoteOnly: true });
      continue;
    }

    const domainMatch = line.match(BARE_DOMAIN_REGEX);
    const bareUrl = domainMatch && getHttpUrl(`https://${cleanTrailingPunctuation(domainMatch[0])}`);
    if (domainMatch && bareUrl) {
      entries.push({
        url: bareUrl,
        rawTitle: cleanTitle(line.replace(domainMatch[0], ' ')),
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
  const cleaned = url.replace(/[.,;:!?]+$/, '');
  if (!cleaned.endsWith(')')) return cleaned;
  let excess = (cleaned.match(/\)/g)?.length ?? 0) - (cleaned.match(/\(/g)?.length ?? 0);
  let end = cleaned.length;
  while (excess > 0 && cleaned[end - 1] === ')') {
    end--;
    excess--;
  }
  return cleaned.slice(0, end);
}
