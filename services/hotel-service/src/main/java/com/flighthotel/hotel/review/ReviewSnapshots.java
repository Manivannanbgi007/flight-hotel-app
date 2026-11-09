package com.flighthotel.hotel.review;

import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.hotel.HotelReviewSnapshot;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.ReviewRepository;

/**
 * Publishes the whole guest review as it is now ({@code HotelReviewSnapshot} on {@code hotel.events}, key = review id)
 * with the hotel's name and city, for read models such as search-service: event-carried state transfer, so they never
 * have to ask hotel-service.
 * <p>
 * {@link #changed} is called when a review is written or moderated; the snapshot itself is written to the outbox just
 * before the transaction commits, once per review and transaction, so it carries the final state of that transaction.
 * The other consumers of {@code hotel.events} ignore event types they do not know.
 */
@Component
public class ReviewSnapshots {

    static final String AGGREGATE_TYPE = "hotel";
    private static final Logger log = LoggerFactory.getLogger(ReviewSnapshots.class);

    private final OutboxEventPublisher outbox;
    private final ReviewRepository reviews;
    private final HotelRepository hotels;
    private final Clock clock;

    public ReviewSnapshots(OutboxEventPublisher outbox, ReviewRepository reviews, HotelRepository hotels, Clock clock) {
        this.outbox = outbox;
        this.reviews = reviews;
        this.hotels = hotels;
        this.clock = clock;
    }

    /** The review changed in the current transaction: its snapshot goes out with the commit. */
    public void changed(UUID reviewId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            log.warn("Review {} changed outside a transaction: no snapshot published", reviewId);
            return;
        }
        // Looked up among the current transaction's synchronizations (not a bound resource), so a nested
        // REQUIRES_NEW transaction gets its own list and the outer one is untouched.
        PendingSnapshots pending = TransactionSynchronizationManager.getSynchronizations().stream()
                .filter(PendingSnapshots.class::isInstance).map(PendingSnapshots.class::cast).findFirst()
                .orElseGet(() -> {
                    PendingSnapshots created = new PendingSnapshots();
                    TransactionSynchronizationManager.registerSynchronization(created);
                    return created;
                });
        pending.ids.add(reviewId);
    }

    /** Writes the snapshot now (the backfill and the development seed; normal changes go through {@link #changed}). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(Review review) {
        outbox.publish(AGGREGATE_TYPE, review.getId().toString(), snapshot(review));
    }

    HotelReviewSnapshot snapshot(Review review) {
        HotelReviewSnapshot.Builder snapshot = HotelReviewSnapshot.newBuilder()
                .setReviewId(review.getId().toString())
                .setHotelId(review.getHotelId().toString())
                .setReservationId(review.getReservationId().toString())
                .setBookingId(review.getBookingId().toString())
                .setBookingReference(review.getBookingReference())
                .setUserId(review.getUserId().toString())
                .setAuthorName(review.getAuthorName())
                .setStayedOn(review.getStayedOn())
                .setRating(review.getRating())
                .setTitle(review.getTitle())
                .setText(review.getText())
                .setStatus(review.getStatus().name())
                .setCreatedAt(review.getCreatedAt() != null ? review.getCreatedAt() : clock.instant())
                .setChangedAt(clock.instant());
        hotels.findById(review.getHotelId()).ifPresent(hotel -> snapshot.setHotelName(hotel.getName())
                .setHotelCity(hotel.getCity()));
        return snapshot.build();
    }

    /** The reviews changed in one transaction; their snapshots are written just before it commits. */
    private final class PendingSnapshots implements TransactionSynchronization {

        private final Set<UUID> ids = new LinkedHashSet<>();

        @Override
        public void beforeCommit(boolean readOnly) {
            for (UUID id : ids) {
                // From the persistence context: the same (managed) review the transaction changed.
                reviews.findById(id).ifPresent(ReviewSnapshots.this::publish);
            }
        }
    }
}
