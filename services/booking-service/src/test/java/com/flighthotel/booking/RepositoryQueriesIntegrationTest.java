package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.Coupon;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.CouponRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;

/**
 * The hand-written queries that decide money and what the jobs pick up, against the real schema: how much of a
 * booking's money is already back with the customer, which refund requests are re-sent, and the admin coupon search.
 */
class RepositoryQueriesIntegrationTest extends BookingIntegrationTest {

    @Autowired
    BookingRepository bookings;

    @Autowired
    RefundRequestRepository refunds;

    @Autowired
    CouponRepository coupons;

    @Test
    void onlyRefundsOfTheBookingItselfThatDidNotFailCount() {
        UUID booking = booking();
        UUID other = booking();
        Instant now = Instant.now();
        refund(booking, "300.00", RefundRequest.GOODWILL, null, now);
        refund(booking, "200.00", RefundRequest.GOODWILL, RefundRequest.COMPLETED, now);
        refund(booking, "100.00", RefundRequest.GOODWILL, RefundRequest.FAILED, now);
        refund(booking, "1000.00", RefundRequest.CANCELLATION, null, now);
        // A second payment for the same booking is refunded too, but it was never the booking's money.
        refund(booking, "2625.00", RefundRequest.DUPLICATE_PAYMENT, RefundRequest.COMPLETED, now);
        refund(other, "999.00", RefundRequest.GOODWILL, null, now);

        // Goodwill given or on its way (the failed one never reached the customer).
        assertThat(refunds.sumGoodwill(booking)).isEqualByComparingTo("500.00");
        // Everything of the booking's own money that is back or on its way.
        assertThat(refunds.sumRefundingTheBooking(booking)).isEqualByComparingTo("1500.00");
        // None at all: zero, not null.
        UUID untouched = booking();
        assertThat(refunds.sumGoodwill(untouched)).isEqualByComparingTo("0");
        assertThat(refunds.sumRefundingTheBooking(untouched)).isEqualByComparingTo("0");
    }

    @Test
    void unansweredRefundRequestsArePickedUpOldestFirst() {
        // Far in the past, so requests of other tests (sent now) are never older.
        Instant old = Instant.parse("2001-01-01T00:00:00Z");
        UUID booking = booking();
        RefundRequest second = refund(booking, "10.00", RefundRequest.GOODWILL, null, old.plus(2, ChronoUnit.HOURS));
        RefundRequest first = refund(booking, "10.00", RefundRequest.GOODWILL, null, old.plus(1, ChronoUnit.HOURS));
        refund(booking, "10.00", RefundRequest.GOODWILL, RefundRequest.COMPLETED, old);
        refund(booking, "10.00", RefundRequest.GOODWILL, RefundRequest.FAILED, old);
        refund(booking, "10.00", RefundRequest.GOODWILL, null, old.plus(5, ChronoUnit.HOURS));

        Instant before = old.plus(3, ChronoUnit.HOURS);
        assertThat(refunds.findRequestedSentBefore(before, PageRequest.of(0, 10)))
                .containsExactly(first.getId(), second.getId());
        assertThat(refunds.findRequestedSentBefore(before, PageRequest.of(0, 1))).containsExactly(first.getId());
    }

    @Test
    void theCouponSearchMatchesCodeOrTitleAndFiltersByStatus() {
        String tag = UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        Coupon monsoon = coupon("RQ" + tag + "-A", "Monsoon " + tag, "ACTIVE");
        Coupon winter = coupon("RQ" + tag + "-B", "Winter " + tag, "INACTIVE");
        String byTag = "%" + tag.toLowerCase() + "%";

        assertThat(coupons.search(byTag, null, PageRequest.of(0, 10)).map(Coupon::getId))
                .containsExactlyInAnyOrder(monsoon.getId(), winter.getId());
        assertThat(coupons.search(byTag, "ACTIVE", PageRequest.of(0, 10)).map(Coupon::getId))
                .containsExactly(monsoon.getId());
        // The title matches without regard to case; the code too.
        assertThat(coupons.search("%monsoon " + tag.toLowerCase() + "%", null, PageRequest.of(0, 10))
                .map(Coupon::getId)).containsExactly(monsoon.getId());
        assertThat(coupons.search("%rq" + tag.toLowerCase() + "-b%", null, PageRequest.of(0, 10))
                .map(Coupon::getId)).containsExactly(winter.getId());
        // No text: the status alone.
        assertThat(coupons.search(null, "INACTIVE", PageRequest.of(0, 500)).map(Coupon::getId))
                .contains(winter.getId()).doesNotContain(monsoon.getId());
    }

    // ------------------------------------------------------------------ helpers

    private UUID booking() {
        String reference = "HT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        Booking booking = Booking.initiate(BookingType.HOTEL, reference, UUID.randomUUID(), "asha@example.com",
                "+91 98000 00000", null, "key-" + UUID.randomUUID(), "0".repeat(64));
        return bookings.save(booking).getId();
    }

    private RefundRequest refund(UUID bookingId, String amount, String reason, String outcome, Instant requestedAt) {
        RefundRequest refund = new RefundRequest(bookingId, UUID.randomUUID(), new BigDecimal(amount), "INR", reason,
                requestedAt);
        if (RefundRequest.COMPLETED.equals(outcome)) {
            refund.completed(requestedAt);
        } else if (RefundRequest.FAILED.equals(outcome)) {
            refund.failed("Rejected by the bank");
        }
        return refunds.save(refund);
    }

    private Coupon coupon(String code, String title, String status) {
        Coupon coupon = new Coupon(code);
        coupon.setTitle(title);
        coupon.setDiscountType(Coupon.PERCENT);
        coupon.setDiscountValue(BigDecimal.TEN);
        coupon.setValidFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        coupon.setValidTo(Instant.now().plus(30, ChronoUnit.DAYS));
        coupon.setStatus(status);
        return coupons.save(coupon);
    }
}
