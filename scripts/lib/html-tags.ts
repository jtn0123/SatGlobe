/** Extract HTML-like tags while ignoring comparison operators and malformed candidates. */
export function extractHtmlTags(text: string): string[] {
  const matches: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);

    if (start < 0) {
      break;
    }
    const end = text.indexOf('>', start + 1);

    if (end < 0) {
      break;
    }
    const candidate = text.slice(start, end + 1);
    const tagStart = candidate[1] === '/' ? 2 : 1;

    if ((/[A-Za-z]/u).test(candidate[tagStart] ?? '')) {
      matches.push(candidate);
      cursor = end + 1;
    } else {
      cursor = start + 1;
    }
  }

  return matches.sort((left, right) => left.localeCompare(right));
}
