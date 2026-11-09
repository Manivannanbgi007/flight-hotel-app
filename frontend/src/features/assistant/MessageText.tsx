import { Fragment } from 'react';

import { parseMessageText, type Inline } from './messageFormat';

/**
 * An answer as plain text: paragraphs, line breaks, simple lists and bold. Never HTML, never links: React escapes
 * every string, and addresses stay text (`messageFormat.ts`).
 */
export function MessageText({ text }: { text: string }) {
  const blocks = parseMessageText(text);
  return (
    <div className="flex flex-col gap-2 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        if (block.kind === 'table') {
          // One card per row: the first cell is its title, the others are "column: value" pairs.
          return (
            <ul key={index} className="flex flex-col gap-2">
              {block.rows.map((row, i) => (
                <li key={i} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <p className="font-semibold text-slate-900"><Runs runs={row[0] ?? []} /></p>
                  {row.length > 1 && (
                    <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                      {row.slice(1).map((cell, c) => (
                        <Fragment key={c}>
                          <dt className="text-slate-600"><Runs runs={block.headers[c + 1] ?? []} /></dt>
                          <dd className="text-slate-800"><Runs runs={cell} /></dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5 marker:text-role-500">
              {block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}
            </ul>
          );
        }
        if (block.kind === 'numbers') {
          return (
            <ol key={index} start={block.start} className="flex list-decimal flex-col gap-1 pl-5 marker:font-semibold marker:text-role-700">
              {block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}
            </ol>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                <Runs runs={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Runs({ runs }: { runs: Inline[] }) {
  return runs.map((run, index) => (run.bold
    ? <strong key={index} className="font-semibold text-slate-900">{run.text}</strong>
    : <Fragment key={index}>{run.text}</Fragment>));
}
