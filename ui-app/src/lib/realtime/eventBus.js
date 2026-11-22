/**
 * Client-side publish/subscribe. The realtime connection publishes every server message here; components and
 * hooks subscribe to the message types they care about.
 *
 * Subscribe to `'*'` to receive everything.
 */
export class RealtimeEventBus {
  handlers = new Map();

  subscribe(type, handler) {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  publish(message) {
    const targets = [...(this.handlers.get(message.type) ?? []), ...(this.handlers.get('*') ?? [])];
    for (const handler of targets) {
      try {
        handler(message);
      } catch (error) {
        // One broken subscriber must not stop the others.
        console.error('Realtime handler failed for', message.type, error);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}

/** The app-wide bus. */
export const realtimeBus = new RealtimeEventBus();
