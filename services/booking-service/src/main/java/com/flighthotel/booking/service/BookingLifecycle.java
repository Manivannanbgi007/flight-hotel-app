package com.flighthotel.booking.service;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingStatusChange;
import com.flighthotel.booking.repository.BookingStatusChangeRepository;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;

/**
 * The only way a booking's status changes: state machine check, a timeline row, a live update for the customer's
 * open screens (sent after commit) and the booking's snapshot for read models, all in the caller's transaction.
 */
@Component
public class BookingLifecycle {

    private final BookingStatusChangeRepository history;
    private final RealtimePublisher realtime;
    private final BookingSnapshots snapshots;
    private final Clock clock;

    public BookingLifecycle(BookingStatusChangeRepository history, RealtimePublisher realtime,
            BookingSnapshots snapshots, Clock clock) {
        this.history = history;
        this.realtime = realtime;
        this.snapshots = snapshots;
        this.clock = clock;
    }

    /** First timeline row of a new booking. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void created(Booking booking, String reason) {
        record(booking, null, booking.getStatus(), reason, null);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void move(Booking booking, BookingStatus to, String reason, String eventId) {
        BookingStatus from = booking.moveTo(to);
        record(booking, from, to, reason, eventId);
    }

    /** Something worth showing on the timeline that does not change the status (e.g. a failed payment). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void note(Booking booking, String reason, String eventId) {
        record(booking, booking.getStatus(), booking.getStatus(), reason, eventId);
    }

    /**
     * Tells open screens to refresh without a timeline row (e.g. payment status only), and read models such as
     * reporting-service (the booking's snapshot is published with the commit).
     */
    public void changed(Booking booking) {
        snapshots.changed(booking.getId());
        realtime.publish(RealtimeMessage.of("booking.status-changed", "BOOKING", booking.getId().toString(),
                        Map.of("status", booking.getStatus().name(), "paymentStatus", booking.getPaymentStatus().name())),
                RealtimeAudience.user(booking.getUserId()).andRoles(Roles.ADMIN, Roles.SUPPORT_AGENT));
    }

    public Instant now() {
        return clock.instant();
    }

    private void record(Booking booking, BookingStatus from, BookingStatus to, String reason, String eventId) {
        String actor = eventId != null ? SecurityAuditorAware.SYSTEM
                : CurrentUser.get().map(user -> user.id().toString()).orElse(SecurityAuditorAware.SYSTEM);
        history.save(new BookingStatusChange(booking.getId(), from, to, reason, actor, eventId, clock.instant()));
        changed(booking);
    }
}
