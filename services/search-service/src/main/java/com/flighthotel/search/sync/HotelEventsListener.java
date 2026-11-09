package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;

import java.util.List;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.events.hotel.HotelCatalogChanged;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelReviewSnapshot;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.IndexWriter.Merge;
import com.flighthotel.search.support.Format;

/**
 * hotel.events →
 * <ul>
 *   <li>{@code HotelInventoryHeld}: the hotel reservation behind a booking (its id lets a hotel manager open it; hotel
 *       name and room type become searchable);</li>
 *   <li>{@code HotelReviewSnapshot}: review documents (REVIEWS);</li>
 *   <li>{@code HotelCatalogChanged}: the destinations are rebuilt soon (a hotel opened or closed in a city).</li>
 * </ul>
 * Hotels themselves are not copied: they are searched in hotel-service's own {@code hotels} index.
 */
@Component
public class HotelEventsListener extends AbstractConsumerSeekAware {

    static final List<String> REVIEW_FIELDS = List.of("category", "entityId", "title", "subtitle", "description",
            "names", "details", "identifiers", "reference", "status", "date", "createdAt", "ownerUserId", "hotelId",
            "bookingId", "reservationId", "display");

    private final IndexWriter writer;
    private final DestinationsIndexer destinations;

    public HotelEventsListener(IndexWriter writer, DestinationsIndexer destinations) {
        this.writer = writer;
        this.destinations = destinations;
    }

    @KafkaListener(id = "search-hotels", groupId = "search-hotels", topics = "hotel.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        switch (event) {
            case HotelInventoryHeld e -> writer.merge(BOOKINGS, e.getBookingId(), Merge.of(Fields.partial()
                    .put("reservationId", e.getReservationId())
                    .put("hotelId", e.getHotelId())
                    .add("details", e.getHotelName(), e.getHotelCity(), e.getRoomTypeName(), e.getRatePlanName()))
                    .union());
            case HotelReviewSnapshot e -> review(e);
            case HotelCatalogChanged e -> destinations.requestRefresh();
            default -> {
                // Holds released, check-ins and the like change nothing that is searched.
            }
        }
    }

    private void review(HotelReviewSnapshot e) {
        Fields fields = Fields.of(REVIEWS, e.getReviewId())
                .put("title", Format.firstNonBlank(e.getTitle(), e.getHotelName(), "Review"))
                .put("subtitle", Format.join(e.getHotelName(), e.getRating() + "/5", "by " + e.getAuthorName()))
                .put("description", e.getText())
                .add("names", e.getAuthorName())
                .add("details", e.getHotelName(), e.getHotelCity())
                .add("identifiers", e.getBookingReference(), e.getReviewId())
                .put("reference", e.getBookingReference())
                .put("status", e.getStatus())
                .put("date", e.getStayedOn())
                .put("createdAt", e.getCreatedAt())
                .put("ownerUserId", e.getUserId())
                .put("hotelId", e.getHotelId())
                .put("bookingId", e.getBookingId())
                .put("reservationId", e.getReservationId())
                .put("display", Format.map("rating", e.getRating(), "hotelName", e.getHotelName(),
                        "authorName", e.getAuthorName()));
        writer.replaceState(REVIEWS, e.getReviewId(), e.getChangedAt(), fields, REVIEW_FIELDS);
    }
}
