import { SseParser, type SseEvent } from './sseParser';

function parse(...chunks: string[]): { events: SseEvent[]; comments: string[] } {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const parser = new SseParser((e) => events.push(e), (c) => comments.push(c));
  chunks.forEach((chunk) => parser.feed(chunk));
  return { events, comments };
}

describe('SseParser', () => {
  it('parses named events with id and JSON data', () => {
    const { events } = parse('id: 42\nevent: message\ndata: {"type":"x"}\n\n');

    expect(events).toEqual([{ event: 'message', data: '{"type":"x"}', id: '42', retry: undefined }]);
  });

  it('handles lines split across chunks, including a CR LF pair', () => {
    const { events } = parse('event: conn', 'ected\r', '\ndata: {"a":', '1}\r\n\r\n');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'connected', data: '{"a":1}' });
  });

  it('joins multi-line data and defaults the event name to "message"', () => {
    const { events } = parse('data: line1\ndata: line2\n\n');

    expect(events[0]).toMatchObject({ event: 'message', data: 'line1\nline2' });
  });

  it('reports comments (heartbeats) and ignores events without data', () => {
    const { events, comments } = parse(':ping\n\nevent: empty\n\n');

    expect(comments).toEqual(['ping']);
    expect(events).toEqual([]);
  });

  it('reads the retry field and keeps the last event id for later events', () => {
    const { events } = parse('retry: 5000\nid: 7\ndata: a\n\ndata: b\n\n');

    expect(events[0]).toMatchObject({ retry: 5000, id: '7' });
    expect(events[1]).toMatchObject({ data: 'b', id: '7' });
  });
});
