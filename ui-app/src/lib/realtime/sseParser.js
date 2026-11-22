export class SseParser {
  buffer = '';
  dataLines = [];
  eventType = '';
  lastEventId;
  retry;

  constructor(onEvent, onComment) {
    this.onEvent = onEvent;
    this.onComment = onComment;
  }

  /** Feed the next decoded chunk. Chunks may split lines (or even a CR LF pair) anywhere. */
  feed(chunk) {
    this.buffer += chunk;
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char === '\n') {
        this.processLine(this.buffer.slice(start, i));
        start = i + 1;
      } else if (char === '\r') {
        if (i === this.buffer.length - 1) {
          // Could be the first half of CR LF: wait for the next chunk.
          break;
        }
        this.processLine(this.buffer.slice(start, i));
        if (this.buffer[i + 1] === '\n') {
          i++;
        }
        start = i + 1;
      }
    }
    this.buffer = this.buffer.slice(start);
  }

  processLine(line) {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) {
      this.onComment?.(line.slice(1).trimStart());
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.lastEventId = value;
        }
        break;
      case 'retry':
        if (/^\d+$/.test(value)) {
          this.retry = Number.parseInt(value, 10);
        }
        break;
      default:
        // Unknown fields are ignored, as the spec requires.
        break;
    }
  }

  dispatch() {
    if (this.dataLines.length === 0) {
      this.eventType = '';
      return;
    }
    const event = {
      event: this.eventType || 'message',
      data: this.dataLines.join('\n'),
      id: this.lastEventId,
      retry: this.retry,
    };
    this.dataLines = [];
    this.eventType = '';
    this.onEvent(event);
  }
}
