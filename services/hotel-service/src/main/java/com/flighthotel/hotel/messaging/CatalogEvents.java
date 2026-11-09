package com.flighthotel.hotel.messaging;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;
import com.flighthotel.events.hotel.HotelCatalogChanged;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.staff.HotelStaffStore;

/**
 * "A customer-visible part of this hotel changed." Written to the outbox in the caller's transaction; hotel-service
 * itself consumes it to rebuild the search document (HotelIndexer); other services may follow later.
 */
@Component
public class CatalogEvents {

    static final String AGGREGATE_TYPE = "hotel";

    private final OutboxEventPublisher outbox;
    private final RealtimePublisher realtime;
    private final HotelStaffStore staff;
    private final Clock clock;

    public CatalogEvents(OutboxEventPublisher outbox, RealtimePublisher realtime, HotelStaffStore staff, Clock clock) {
        this.outbox = outbox;
        this.realtime = realtime;
        this.staff = staff;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void catalogChanged(UUID hotelId, HotelStatus status) {
        outbox.publish(AGGREGATE_TYPE, hotelId.toString(), HotelCatalogChanged.newBuilder()
                .setHotelId(hotelId.toString())
                .setStatus(status.name())
                .setChangedAt(clock.instant())
                .build());
    }

    /** The hotel's managers (and admins) see their inventory calendar and pricing screens refresh. */
    public void inventoryChanged(UUID hotelId) {
        List<UUID> managers = staff.managersOf(hotelId).stream().map(HotelStaffStore.StaffMember::userId).toList();
        RealtimeAudience audience = managers.isEmpty()
                ? RealtimeAudience.roles(Roles.ADMIN)
                : RealtimeAudience.users(managers).andRoles(Roles.ADMIN);
        realtime.publish(RealtimeMessage.of("hotel.inventory-changed", "HOTEL", hotelId.toString(),
                Map.of("hotelId", hotelId.toString())), audience);
    }
}
