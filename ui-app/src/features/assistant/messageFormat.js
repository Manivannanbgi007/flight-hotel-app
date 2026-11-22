const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** `| a | b |` → the cells. */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMessageText(text) {
  const blocks = [];
  let current = null;
  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };

  // Thin and narrow no-break spaces (the model writes "20 December 2026" with them) look like no space at all.
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2009\u200A\u202F]/g, ' ')
    .split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '') {
      close();
      continue;
    }
    // A table: a header row followed by the |---|---| rule, then the rows.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? '')) {
      close();
      const headers = cells(line).map(parseInline);
      const rows = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(cells(lines[index]).map(parseInline));
        index++;
      }
      index--;
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (bullet) {
      if (current?.kind !== 'bullets') {
        close();
        current = { kind: 'bullets', items: [] };
      }
      current.items.push(parseInline(bullet[1]));
    } else if (number) {
      if (current?.kind !== 'numbers') {
        close();
        current = { kind: 'numbers', start: Number(number[1]), items: [] };
      }
      current.items.push(parseInline(number[2]));
    } else {
      if (current?.kind !== 'paragraph') {
        close();
        current = { kind: 'paragraph', lines: [] };
      }
      current.lines.push(parseInline(line.trim()));
    }
  }
  close();
  return blocks;
}

/**
 * `**bold**` → bold runs. A `**` without its partner is dropped: while an answer streams, the closing marker has
 * often not arrived yet.
 */
export function parseInline(text) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*/g;
  const plain = (value) => value.replace(/\*\*/g, '');
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push({ text: plain(text.slice(last, match.index)), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: plain(text.slice(last)), bold: false });
  return parts.filter((part) => part.text !== '');
}

/** Plain text for reading aloud and announcing: the markers removed. */
export function plainText(text) {
  return (
    text
      .replace(/\*\*/g, '')
      .replace(/[\u2009\u200A\u202F]/g, ' ')
      // Tables: no rule lines, cells separated by commas.
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
      .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, '')
      .replace(/[ \t]*\|[ \t]*/g, ', ')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

/**
 * The next complete sentences of a streaming answer, for the screen-reader live region (announcing every word would
 * be noise). `from` is how much was announced already. Returns the chunk (may be empty) and the new position, or null
 * while no sentence after `from` is complete.
 */
export function nextSentences(text, from) {
  const rest = text.slice(from);
  const pattern = /[.!?…:](?=\s)|\n/g;
  let end = -1;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    end = match.index + match[0].length;
  }
  if (end <= 0) {
    return null;
  }
  return { chunk: plainText(rest.slice(0, end)), to: from + end };
}
