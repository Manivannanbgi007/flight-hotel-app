package com.flighthotel.common.realtime;

/**
 * Sends auto-refresh signals to browsers (through the realtime hub in notification-service).
 * <p>
 * When called inside a database transaction, the message is sent <b>after commit</b>, so a browser that
 * re-fetches immediately sees the new data. If the transaction rolls back, nothing is sent.
 * <p>
 * Publishing never throws: a failed realtime signal must not break the business operation. Browsers resync on
 * reconnect, and status pages fall back to polling.
 */
public interface RealtimePublisher {

    void publish(RealtimeMessage message, RealtimeAudience audience);
}
