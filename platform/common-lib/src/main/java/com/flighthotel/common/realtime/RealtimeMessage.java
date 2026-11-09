package com.flighthotel.common.realtime;

import java.time.Instant;
import java.util.Map;

import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.common.id.UuidV7;

/**
 * A small "something changed" signal pushed to browsers over SSE (see REALTIME_UPDATES.md).
 * <p>
 * Keep {@code data} tiny and free of personal data: IDs, statuses and counters only. Browsers re-fetch the real
 * data through the REST API, which applies normal authorization.
 *
 * @param type         dotted event name, e.g. {@code booking.status-changed}
 * @param resourceType e.g. {@code BOOKING}
 * @param resourceId   ID of the changed resource (may be null for collection-level signals)
 */
public record RealtimeMessage(String id, String type, String resourceType, String resourceId,
                              Map<String, Object> data, Instant occurredAt, String correlationId) {

    public RealtimeMessage {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("type is required");
        }
        data = data == null ? Map.of() : Map.copyOf(data);
    }

    public static RealtimeMessage of(String type, String resourceType, String resourceId, Map<String, Object> data) {
        return new RealtimeMessage(UuidV7.generate().toString(), type, resourceType, resourceId, data,
                Instant.now(), CorrelationId.current());
    }
}
