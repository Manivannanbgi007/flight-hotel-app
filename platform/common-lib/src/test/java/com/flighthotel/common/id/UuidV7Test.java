package com.flighthotel.common.id;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class UuidV7Test {

    @Test
    void generatesVersion7WithIetfVariant() {
        UUID uuid = UuidV7.generate();

        assertThat(uuid.version()).isEqualTo(7);
        assertThat(uuid.variant()).isEqualTo(2);
    }

    @Test
    void embedsTheTimestamp() {
        long now = 1_793_000_000_000L;

        assertThat(UuidV7.timestampOf(UuidV7.generate(now))).isEqualTo(now);
    }

    @Test
    void sortsByCreationTime() {
        UUID earlier = UuidV7.generate(1_000L);
        UUID later = UuidV7.generate(2_000L);

        // String order = byte order for UUIDs, which is what MySQL BINARY(16) indexes use.
        assertThat(earlier.toString()).isLessThan(later.toString());
    }

    @Test
    void idsFromGenerateSortInCreationOrderEvenInTheSameMillisecond() {
        // 20,000 ids in a tight loop: many share a millisecond (and the 12-bit counter overflows), the order still holds.
        UUID previous = UuidV7.generate();
        for (int i = 0; i < 20_000; i++) {
            UUID next = UuidV7.generate();
            assertThat(next.toString()).as("id %s after %s", next, previous).isGreaterThan(previous.toString());
            previous = next;
        }
    }

    @Test
    void generatedIdsAreUniqueAcrossThreads() throws Exception {
        Set<UUID> ids = java.util.concurrent.ConcurrentHashMap.newKeySet();
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(8)) {
            var futures = new java.util.ArrayList<java.util.concurrent.Future<?>>();
            for (int t = 0; t < 8; t++) {
                futures.add(executor.submit(() -> {
                    for (int i = 0; i < 5_000; i++) {
                        ids.add(UuidV7.generate());
                    }
                }));
            }
            for (var future : futures) {
                future.get();
            }
        }
        assertThat(ids).hasSize(40_000);
    }

    @Test
    void isUniqueWithinTheSameMillisecond() {
        Set<UUID> ids = new HashSet<>();
        for (int i = 0; i < 10_000; i++) {
            ids.add(UuidV7.generate(42L));
        }
        assertThat(ids).hasSize(10_000);
    }
}
