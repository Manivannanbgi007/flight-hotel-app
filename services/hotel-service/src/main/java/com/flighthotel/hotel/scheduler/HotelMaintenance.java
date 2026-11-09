package com.flighthotel.hotel.scheduler;

import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.search.HotelIndexer;

/**
 * Keeps derived data healthy:
 * <ul>
 *   <li>every night the inventory is extended so rooms stay bookable {@value InventoryService#HORIZON_DAYS} days
 *       ahead,</li>
 *   <li>on startup the search index is checked against MySQL and rebuilt if it is missing or incomplete (fresh
 *       install, Elasticsearch data loss, or events published before the Debezium connector existed).</li>
 * </ul>
 * Both are idempotent, so several instances may run them.
 */
@Component
public class HotelMaintenance {

    private static final Logger log = LoggerFactory.getLogger(HotelMaintenance.class);

    private final InventoryService inventory;
    private final RoomTypeRepository roomTypes;
    private final HotelRepository hotels;
    private final HotelIndexer indexer;

    public HotelMaintenance(InventoryService inventory, RoomTypeRepository roomTypes, HotelRepository hotels,
            HotelIndexer indexer) {
        this.inventory = inventory;
        this.roomTypes = roomTypes;
        this.hotels = hotels;
        this.indexer = indexer;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        extendInventoryHorizon();
        try {
            boolean created = indexer.ensureIndex();
            long indexed = indexer.documentCount();
            long active = hotels.countByStatus(HotelStatus.ACTIVE);
            if (created || indexed != active) {
                log.info("Search index out of date (indexed={} active={}); rebuilding", indexed, active);
                indexer.reindexAll();
            }
        } catch (RuntimeException ex) {
            // Search is unavailable until Elasticsearch is back; the next catalog change or restart repairs it.
            log.error("Search index check failed", ex);
        }
    }

    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Kolkata")
    public void extendInventoryHorizon() {
        Map<UUID, Integer> totals = roomTypes.findAll().stream()
                .collect(Collectors.toMap(RoomType::getId, RoomType::getTotalRooms));
        inventory.extendHorizon(totals);
    }
}
