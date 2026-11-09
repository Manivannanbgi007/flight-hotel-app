import { Fragment } from 'react';

import { usableSegments } from './searchModel';
import type { TextSegment } from './types';

/** The matched words: a soft wash of the portal colour, with dark text on it (role-900 on role-100 keeps AA contrast). */
const MARK_CLASS = 'rounded-[0.25rem] bg-role-100 font-semibold text-role-900 [box-decoration-break:clone]';

/**
 * A search result's text with the matched words in `<mark>`. The pieces are plain text from the server and are rendered
 * as React text (never as HTML), so a result can never inject markup. Without pieces (or with malformed ones) the plain
 * `text` is shown.
 */
export function HighlightedText({ segments, text, className }: {
  segments: TextSegment[] | null | undefined;
  text: string;
  className?: string;
}) {
  const pieces = usableSegments(segments);
  if (!pieces) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }
  return (
    <span className={className}>
      {pieces.map((piece, index) => (piece.match
        ? <mark key={index} className={MARK_CLASS}>{piece.text}</mark>
        : <Fragment key={index}>{piece.text}</Fragment>))}
    </span>
  );
}
