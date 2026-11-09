package com.flighthotel.notification.realtime;

import java.io.IOException;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * One open SSE stream of one browser.
 * <p>
 * Events are put in a bounded queue and written by a dedicated (virtual) writer thread, so:
 * <ul>
 *   <li>events reach the browser in the order they were queued,</li>
 *   <li>a slow client never blocks delivery to other clients,</li>
 *   <li>a client that falls too far behind is disconnected (it reconnects and re-syncs).</li>
 * </ul>
 */
public final class RealtimeConnection {

    private static final Logger log = LoggerFactory.getLogger(RealtimeConnection.class);

    private sealed interface Outgoing permits Send, Close {
    }

    private record Send(SseEmitter.SseEventBuilder event) implements Outgoing {
    }

    private record Close(SseEmitter.SseEventBuilder finalEvent) implements Outgoing {
    }

    private final String id;
    private final String userId;
    private final Set<String> roles;
    private final Instant openedAt;
    private final Instant tokenExpiresAt;
    private final SseEmitter emitter;
    private final BlockingQueue<Outgoing> queue;
    private final AtomicBoolean open = new AtomicBoolean(true);
    private volatile Consumer<RealtimeConnection> onClosed = c -> { };

    public RealtimeConnection(String id, String userId, Set<String> roles, Instant openedAt, Instant tokenExpiresAt,
            SseEmitter emitter, int queueCapacity) {
        this.id = id;
        this.userId = userId;
        this.roles = Set.copyOf(roles);
        this.openedAt = openedAt;
        this.tokenExpiresAt = tokenExpiresAt;
        this.emitter = emitter;
        // +1 leaves room for the final Close marker even when the queue is full.
        this.queue = new ArrayBlockingQueue<>(queueCapacity + 1);
        emitter.onCompletion(this::markClosed);
        emitter.onTimeout(this::markClosed);
        emitter.onError(ex -> markClosed());
    }

    void onClosed(Consumer<RealtimeConnection> callback) {
        this.onClosed = callback;
    }

    /** Queues an event. Returns {@code false} if the stream is closed or the client is too slow (then it is closed). */
    public boolean send(SseEmitter.SseEventBuilder event) {
        if (!open.get()) {
            return false;
        }
        if (queue.remainingCapacity() <= 1 || !queue.offer(new Send(event))) {
            log.info("Closing slow realtime stream connectionId={} userId={}", id, userId);
            close(null);
            return false;
        }
        return true;
    }

    /** Sends {@code finalEvent} (if any) after the already-queued events, then ends the stream. */
    public void close(SseEmitter.SseEventBuilder finalEvent) {
        if (open.compareAndSet(true, false)) {
            queue.offer(new Close(finalEvent));
            onClosed.accept(this);
        }
    }

    /** Writer loop; runs on its own virtual thread until the stream ends. */
    void runWriter() {
        try {
            while (true) {
                Outgoing next = queue.poll(1, TimeUnit.SECONDS);
                if (next == null) {
                    if (!open.get() && queue.isEmpty()) {
                        break;
                    }
                    continue;
                }
                if (next instanceof Send send) {
                    emitter.send(send.event());
                } else if (next instanceof Close closeMarker) {
                    if (closeMarker.finalEvent() != null) {
                        emitter.send(closeMarker.finalEvent());
                    }
                    emitter.complete();
                    break;
                }
            }
        } catch (IOException | IllegalStateException ex) {
            // Client went away (closed tab, network loss). Normal for long-lived streams.
            log.debug("Realtime stream ended connectionId={} reason={}", id, ex.toString());
            markClosed();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            emitter.complete();
            markClosed();
        }
    }

    private void markClosed() {
        if (open.compareAndSet(true, false)) {
            onClosed.accept(this);
        }
        queue.clear();
    }

    public boolean isOpen() {
        return open.get();
    }

    public String id() {
        return id;
    }

    public String userId() {
        return userId;
    }

    public Set<String> roles() {
        return roles;
    }

    public Instant openedAt() {
        return openedAt;
    }

    public Instant tokenExpiresAt() {
        return tokenExpiresAt;
    }
}
