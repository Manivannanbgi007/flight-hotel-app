package com.flighthotel.common.id;

import java.security.SecureRandom;
import java.util.UUID;

/**
 * Generates UUID version 7 values (RFC 9562): a 48-bit millisecond timestamp followed by random bits.
 * <p>
 * They sort by creation time, which keeps MySQL B-tree indexes compact (random UUID v4 values cause page splits).
 * <p>
 * {@link #generate()} is also <b>monotonic inside one JVM</b> (RFC 9562, method 1: a counter in the 12 {@code rand_a}
 * bits): ids created in the same millisecond still sort in creation order. Code relies on that to order rows that
 * share a timestamp, for example the status changes of one booking written in one transaction.
 */
public final class UuidV7 {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int COUNTER_MAX = 0xFFF;

    private static long lastMillis = -1;
    private static int counter;

    private UuidV7() {
    }

    public static UUID generate() {
        return next(System.currentTimeMillis());
    }

    /** Strictly increasing: same millisecond (or a clock that stepped back) counts up; a full counter borrows 1 ms. */
    private static synchronized UUID next(long nowMillis) {
        long millis = Math.max(nowMillis, lastMillis);
        if (millis == lastMillis) {
            counter++;
            if (counter > COUNTER_MAX) {
                millis++;
                counter = RANDOM.nextInt(0x100);
            }
        } else {
            counter = RANDOM.nextInt(0x100);   // room to count up within this millisecond
        }
        lastMillis = millis;
        return build(millis, counter);
    }

    /** Random ids for an explicit time (tests): not monotonic. */
    static UUID generate(long epochMillis) {
        return build(epochMillis, RANDOM.nextInt(COUNTER_MAX + 1));
    }

    private static UUID build(long epochMillis, int randA) {
        byte[] random = new byte[10];
        RANDOM.nextBytes(random);

        long msb = (epochMillis & 0xFFFF_FFFF_FFFFL) << 16;  // 48-bit timestamp
        msb |= 0x7000L;                                      // version 7
        msb |= randA & 0xFFFL;                               // 12 bits (rand_a): counter or random

        long lsb = 0x8000_0000_0000_0000L;                   // IETF variant (10xx)
        lsb |= (random[2] & 0x3FL) << 56;
        for (int i = 3; i < 10; i++) {
            lsb |= (random[i] & 0xFFL) << (8 * (9 - i));
        }
        return new UUID(msb, lsb);
    }

    /** Extracts the creation time (epoch millis) from a version 7 UUID. */
    public static long timestampOf(UUID uuid) {
        if (uuid.version() != 7) {
            throw new IllegalArgumentException("Not a UUID v7: " + uuid);
        }
        return uuid.getMostSignificantBits() >>> 16;
    }
}
