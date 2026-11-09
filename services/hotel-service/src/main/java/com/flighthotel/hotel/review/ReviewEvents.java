package com.flighthotel.hotel.review;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.staff.HotelStaffStore;

/**
 * {@code review.changed} (REALTIME_UPDATES.md §6): the author's "My reviews", the moderation queue and the hotel
 * managers' review list refresh. Ids and the status only; sent after commit by the publisher.
 */
@Component
public class ReviewEvents {

    private final RealtimePublisher realtime;
    private final HotelStaffStore staff;

    public ReviewEvents(RealtimePublisher realtime, HotelStaffStore staff) {
        this.realtime = realtime;
        this.staff = staff;
    }

    public void changed(Review review) {
        List<UUID> users = new ArrayList<>();
        users.add(review.getUserId());
        staff.managersOf(review.getHotelId()).forEach(manager -> users.add(manager.userId()));
        realtime.publish(RealtimeMessage.of("review.changed", "REVIEW", review.getId().toString(),
                        Map.of("hotelId", review.getHotelId().toString(), "status", review.getStatus().name())),
                RealtimeAudience.users(users).andRoles(Roles.ADMIN));
    }
}
