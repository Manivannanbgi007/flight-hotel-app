package com.flighthotel.booking.entity;

import static com.flighthotel.booking.entity.BookingStatus.CANCELLATION_PENDING;
import static com.flighthotel.booking.entity.BookingStatus.CANCELLED;
import static com.flighthotel.booking.entity.BookingStatus.COMPLETED;
import static com.flighthotel.booking.entity.BookingStatus.CONFIRMED;
import static com.flighthotel.booking.entity.BookingStatus.EXPIRED;
import static com.flighthotel.booking.entity.BookingStatus.FAILED;
import static com.flighthotel.booking.entity.BookingStatus.INITIATED;
import static com.flighthotel.booking.entity.BookingStatus.PAYMENT_SUCCESS;
import static com.flighthotel.booking.entity.BookingStatus.PENDING_PAYMENT;
import static com.flighthotel.booking.entity.BookingStatus.REFUNDED;
import static com.flighthotel.booking.entity.BookingStatus.REFUND_PENDING;
import static com.flighthotel.booking.entity.BookingStatus.SUPPLIER_PENDING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/**
 * The booking state machine of BOOKING_WORKFLOW.md section 1, written out arrow by arrow, and the booking's own
 * bookkeeping (payment status, refunds, the support queue flag, the payment window).
 */
class BookingStateMachineTest {

    /** The arrows of the documented diagram; everything else must be refused. */
    private static final Map<BookingStatus, Set<BookingStatus>> DOCUMENTED = Map.ofEntries(
            Map.entry(INITIATED, EnumSet.of(PENDING_PAYMENT, FAILED)),
            Map.entry(PENDING_PAYMENT, EnumSet.of(PAYMENT_SUCCESS, EXPIRED, FAILED)),
            Map.entry(PAYMENT_SUCCESS, EnumSet.of(SUPPLIER_PENDING)),
            Map.entry(SUPPLIER_PENDING, EnumSet.of(CONFIRMED, REFUND_PENDING)),
            Map.entry(CONFIRMED, EnumSet.of(COMPLETED, CANCELLATION_PENDING)),
            Map.entry(CANCELLATION_PENDING, EnumSet.of(CANCELLED, CONFIRMED)),
            Map.entry(CANCELLED, EnumSet.of(REFUND_PENDING)),
            Map.entry(EXPIRED, EnumSet.of(REFUND_PENDING)),
            Map.entry(FAILED, EnumSet.of(REFUND_PENDING)),
            Map.entry(REFUND_PENDING, EnumSet.of(REFUNDED)),
            Map.entry(REFUNDED, EnumSet.noneOf(BookingStatus.class)),
            Map.entry(COMPLETED, EnumSet.noneOf(BookingStatus.class)));

    @Test
    void everyStatusMovesOnlyAlongTheDocumentedArrows() {
        assertThat(DOCUMENTED.keySet()).containsExactlyInAnyOrder(BookingStatus.values());
        List<String> wrong = new ArrayList<>();
        for (BookingStatus from : BookingStatus.values()) {
            for (BookingStatus to : BookingStatus.values()) {
                if (from.canMoveTo(to) != DOCUMENTED.get(from).contains(to)) {
                    wrong.add(from + " -> " + to + (from.canMoveTo(to) ? " is allowed" : " is refused"));
                }
            }
        }
        assertThat(wrong).isEmpty();
    }

    @Test
    void aRefusedMoveThrowsAndLeavesTheStatusAlone() {
        Booking booking = booking();
        assertThatThrownBy(() -> booking.moveTo(CONFIRMED))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Booking HT-TEST0001 cannot move from INITIATED to CONFIRMED");
        assertThat(booking.getStatus()).isEqualTo(INITIATED);

        assertThat(booking.moveTo(PENDING_PAYMENT)).isEqualTo(INITIATED);
        assertThat(booking.getStatus()).isEqualTo(PENDING_PAYMENT);
        // Nothing comes back from a final state.
        booking.moveTo(FAILED);
        booking.moveTo(REFUND_PENDING);
        booking.moveTo(REFUNDED);
        for (BookingStatus next : BookingStatus.values()) {
            assertThatThrownBy(() -> booking.moveTo(next)).isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void myTripsTabsAndWhenConfirmationNumbersMayBeShown() {
        assertThat(EnumSet.allOf(BookingStatus.class).stream().filter(s -> s.tab() == BookingTab.PENDING))
                .containsExactlyInAnyOrder(INITIATED, PENDING_PAYMENT, PAYMENT_SUCCESS, SUPPLIER_PENDING);
        assertThat(EnumSet.allOf(BookingStatus.class).stream().filter(s -> s.tab() == BookingTab.UPCOMING))
                .containsExactlyInAnyOrder(CONFIRMED, CANCELLATION_PENDING);
        assertThat(EnumSet.allOf(BookingStatus.class).stream().filter(s -> s.tab() == BookingTab.COMPLETED))
                .containsExactly(COMPLETED);
        assertThat(EnumSet.allOf(BookingStatus.class).stream().filter(s -> s.tab() == BookingTab.CANCELLED))
                .containsExactlyInAnyOrder(CANCELLED, REFUND_PENDING, REFUNDED, FAILED, EXPIRED);
        // Golden rule 3: never before the supplier confirmed, and not for a refund of a booking that never was.
        assertThat(EnumSet.allOf(BookingStatus.class).stream().filter(BookingStatus::isConfirmedOrLater))
                .containsExactlyInAnyOrder(CONFIRMED, COMPLETED, CANCELLATION_PENDING, CANCELLED);
    }

    @Test
    void thePriceIsBasePlusTaxMinusDiscount() {
        Booking booking = booking();
        booking.price(new BigDecimal("10000.00"), new BigDecimal("1200.00"), new BigDecimal("500.00"), "INR",
                List.of());
        assertThat(booking.getTotalAmount()).isEqualByComparingTo("10700.00");
        assertThat(booking.getFeeAmount()).isEqualByComparingTo("0");
    }

    @Test
    void refundsAddUpToPartiallyRefundedThenRefunded() {
        Booking booking = booking();
        booking.price(new BigDecimal("1000.00"), BigDecimal.ZERO, BigDecimal.ZERO, "INR", List.of());
        booking.paid(UUID.randomUUID());
        assertThat(booking.getPaymentStatus()).isEqualTo(PaymentStatus.PAID);

        booking.refundCompleted(new BigDecimal("300.00"));
        assertThat(booking.getPaymentStatus()).isEqualTo(PaymentStatus.PARTIALLY_REFUNDED);
        booking.refundCompleted(new BigDecimal("700.00"));
        assertThat(booking.getPaymentStatus()).isEqualTo(PaymentStatus.REFUNDED);
        assertThat(booking.getRefundedAmount()).isEqualByComparingTo("1000.00");
    }

    @Test
    void aFailedPaymentAttemptNeverHidesAPaymentThatSucceeded() {
        Booking booking = booking();
        booking.paymentFailed();
        assertThat(booking.getPaymentStatus()).isEqualTo(PaymentStatus.PAYMENT_FAILED);
        booking.paid(UUID.randomUUID());
        booking.paymentFailed();   // a late failure of an older attempt
        assertThat(booking.getPaymentStatus()).isEqualTo(PaymentStatus.PAID);
    }

    @Test
    void theSupportQueueKeepsTheFirstFlagTimeAndClearsOnlyMatchingReasons() {
        Booking booking = booking();
        Instant first = Instant.parse("2026-11-01T10:00:00Z");
        booking.needsAttention("REFUND_FAILED", "x".repeat(600), first);
        assertThat(booking.getAttentionNote()).hasSize(500);
        booking.needsAttention("SUPPLIER_TIMEOUT", "Still no answer", first.plusSeconds(3600));
        assertThat(booking.getAttentionReason()).isEqualTo("SUPPLIER_TIMEOUT");
        assertThat(booking.getAttentionSince()).isEqualTo(first);

        booking.attentionResolved("REFUND_FAILED");   // another problem went away: the flag stays
        assertThat(booking.getAttentionReason()).isEqualTo("SUPPLIER_TIMEOUT");
        booking.attentionResolved("SUPPLIER_TIMEOUT", "REFUND_FAILED");
        assertThat(booking.getAttentionReason()).isNull();
        assertThat(booking.getAttentionSince()).isNull();

        booking.needsAttention("MANUAL", null, first);
        booking.attentionResolved();   // by a person: whatever the reason
        assertThat(booking.getAttentionReason()).isNull();
    }

    @Test
    void aBookingIsPayableOnlyWhilePendingAndBeforeTheDeadline() {
        Instant deadline = Instant.parse("2026-11-06T10:15:00Z");
        Booking booking = booking();
        booking.inventoryHeld("Sea Breeze Resort", "Goa", LocalDate.of(2026, 12, 10), LocalDate.of(2026, 12, 12),
                deadline, deadline, "HOTEL", null, null, null);
        assertThat(booking.isPayable(deadline.minusSeconds(60))).isFalse();   // not held yet

        booking.moveTo(PENDING_PAYMENT);
        assertThat(booking.isPayable(deadline.minusMillis(1))).isTrue();
        assertThat(booking.isPayable(deadline)).isFalse();
        booking.moveTo(EXPIRED);
        assertThat(booking.isPayable(deadline.minusSeconds(60))).isFalse();
    }

    private static Booking booking() {
        return Booking.initiate(BookingType.HOTEL, "HT-TEST0001", UUID.randomUUID(), "asha@example.com",
                "+91 98000 00000", null, "key-1", "hash");
    }
}
