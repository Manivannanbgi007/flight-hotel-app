package com.flighthotel.common.realtime;

/** What travels through Redis Pub/Sub: the message plus its audience. Only {@code message} reaches browsers. */
public record RealtimeEnvelope(RealtimeMessage message, RealtimeAudience audience) {
}
