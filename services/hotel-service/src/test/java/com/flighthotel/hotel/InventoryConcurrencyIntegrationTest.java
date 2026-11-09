package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.error.ConflictException;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.support.Uuids;

/** Phase 4 exit check: parallel holds on the last room → exactly one wins; no overbooking ever. */
class InventoryConcurrencyIntegrationTest extends HotelIntegrationTest {

    @Autowired
    RoomTypeRepository roomTypes;

    @Autowired
    TransactionTemplate transactions;

    @Test
    void parallelHoldsOnTheLastRoomExactlyOneWins() throws Exception {
        UUID roomType = newRoomType(1);
        LocalDate checkIn = offPeak(20);
        LocalDate checkOut = checkIn.plusDays(3);

        int winners = race(20, () -> inventory.hold(roomType, checkIn, checkOut, 1));

        assertThat(winners).isEqualTo(1);
        assertThat(heldPerNight(roomType, checkIn, checkOut)).containsOnly(1);
        assertThat(inventory.freeRooms(List.of(roomType), checkIn, checkOut)).containsEntry(roomType, 0);
    }

    @Test
    void overlappingStaysCompeteForTheSharedNights() throws Exception {
        UUID roomType = newRoomType(1);
        LocalDate day = offPeak(40);
        // Nights 0-2 and 2-4 share night 2; nights 5-6 do not overlap with either.
        List<Callable<Void>> holds = List.of(
                () -> { inventory.hold(roomType, day, day.plusDays(3), 1); return null; },
                () -> { inventory.hold(roomType, day.plusDays(2), day.plusDays(5), 1); return null; },
                () -> { inventory.hold(roomType, day.plusDays(5), day.plusDays(7), 1); return null; });

        int winners = raceAll(holds);

        assertThat(winners).isEqualTo(2);
        // No night is ever held twice, and a failed hold left NO partial nights behind.
        assertThat(heldPerNight(roomType, day, day.plusDays(7))).allMatch(held -> held <= 1);
    }

    @Test
    void manyRoomsAreSharedUntilSoldOut() throws Exception {
        UUID roomType = newRoomType(5);
        LocalDate checkIn = offPeak(60);

        int winners = race(12, () -> inventory.hold(roomType, checkIn, checkIn.plusDays(2), 1));

        assertThat(winners).isEqualTo(5);
        assertThat(heldPerNight(roomType, checkIn, checkIn.plusDays(2))).containsOnly(5);
    }

    @Test
    void releaseAndConfirmMoveTheRooms() {
        UUID roomType = newRoomType(2);
        LocalDate checkIn = offPeak(80);
        LocalDate checkOut = checkIn.plusDays(2);

        inventory.hold(roomType, checkIn, checkOut, 2);
        assertThatThrownBy(() -> inventory.hold(roomType, checkIn, checkOut, 1))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("no longer available");

        inventory.release(roomType, checkIn, checkOut, 1);
        inventory.confirm(roomType, checkIn, checkOut, 1);

        List<int[]> nights = jdbcClient.sql("""
                        SELECT booked_rooms, held_rooms FROM room_inventory WHERE room_type_id = :id
                        AND stay_date >= :from AND stay_date < :to""")
                .param("id", Uuids.param(roomType)).param("from", checkIn).param("to", checkOut)
                .query((rs, i) -> new int[] {rs.getInt(1), rs.getInt(2)}).list();
        assertThat(nights).hasSize(2).allSatisfy(n -> assertThat(n).containsExactly(1, 0));
        assertThat(inventory.freeRooms(List.of(roomType), checkIn, checkOut)).containsEntry(roomType, 1);
    }

    @Test
    void stopSellAndNightsBeyondTheHorizonAreNotSold() {
        UUID roomType = newRoomType(3);
        LocalDate checkIn = offPeak(100);
        inventory.updateNights(roomType, checkIn.plusDays(1), checkIn.plusDays(1), null, true);

        assertThat(inventory.freeRooms(List.of(roomType), checkIn, checkIn.plusDays(3))).containsEntry(roomType, 0);
        assertThatThrownBy(() -> inventory.hold(roomType, checkIn, checkIn.plusDays(3), 1))
                .isInstanceOf(ConflictException.class);

        LocalDate lastNight = inventory.lastSellableNight();
        assertThat(inventory.freeRooms(List.of(roomType), lastNight, lastNight.plusDays(2))).containsEntry(roomType, 0);
    }

    // ------------------------------------------------------------------ helpers

    private UUID newRoomType(int rooms) {
        UUID hotel = hotelId("Panjim Heritage Inn");
        return transactions.execute(status -> {
            RoomType room = new RoomType(hotel);
            room.setName("Race test room " + UUID.randomUUID());
            room.setMaxAdults(2);
            room.setBedConfiguration("1 Double bed");
            room.setTotalRooms(rooms);
            roomTypes.saveAndFlush(room);
            inventory.initialize(room.getId(), rooms);
            return room.getId();
        });
    }

    private List<Integer> heldPerNight(UUID roomType, LocalDate from, LocalDate to) {
        return jdbcClient.sql("""
                        SELECT held_rooms FROM room_inventory WHERE room_type_id = :id
                        AND stay_date >= :from AND stay_date < :to ORDER BY stay_date""")
                .param("id", Uuids.param(roomType)).param("from", from).param("to", to)
                .query(Integer.class).list();
    }

    /** Starts {@code threads} identical holds at the same moment; returns how many succeeded. */
    private static int race(int threads, Runnable hold) throws Exception {
        List<Callable<Void>> tasks = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            tasks.add(() -> {
                hold.run();
                return null;
            });
        }
        return raceAll(tasks);
    }

    private static int raceAll(List<Callable<Void>> tasks) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger winners = new AtomicInteger();
        try (ExecutorService pool = Executors.newFixedThreadPool(tasks.size())) {
            List<Future<?>> futures = new ArrayList<>();
            for (Callable<Void> task : tasks) {
                futures.add(pool.submit(() -> {
                    start.await();
                    try {
                        task.call();
                        winners.incrementAndGet();
                    } catch (ConflictException lost) {
                        // Expected for everyone but the winner(s).
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> future : futures) {
                future.get();
            }
        }
        return winners.get();
    }
}
