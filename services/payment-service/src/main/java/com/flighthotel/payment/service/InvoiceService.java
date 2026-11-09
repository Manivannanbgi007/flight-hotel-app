package com.flighthotel.payment.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.payment.entity.Invoice;
import com.flighthotel.payment.repository.InvoiceRepository;

/**
 * The tax invoice of a confirmed booking. The number (INV/2026-27/000123) comes from a counter per financial year
 * (April to March) that is locked while the number is taken and rolled back with the invoice, so numbers have no gaps
 * and no duplicates.
 */
@Service
public class InvoiceService {

    private static final Logger log = LoggerFactory.getLogger(InvoiceService.class);
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final InvoiceRepository invoices;
    private final JdbcClient jdbc;
    private final PaymentEvents events;
    private final Clock clock;

    public InvoiceService(InvoiceRepository invoices, JdbcClient jdbc, PaymentEvents events, Clock clock) {
        this.invoices = invoices;
        this.jdbc = jdbc;
        this.events = events;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void issue(BookingConfirmed confirmed) {
        UUID bookingId = UUID.fromString(confirmed.getBookingId());
        if (invoices.existsByBookingId(bookingId)) {
            return;
        }
        Instant now = clock.instant();
        String currency = confirmed.getTotalAmount().getCurrency();
        BigDecimal total = EventMoney.amount(confirmed.getTotalAmount());
        BigDecimal tax = EventMoney.amount(confirmed.getTaxAmount());
        Invoice invoice = invoices.save(new Invoice(nextNumber(now), bookingId, confirmed.getBookingReference(),
                UUID.fromString(confirmed.getPaymentId()), UUID.fromString(confirmed.getUserId()),
                confirmed.getCustomerName(), confirmed.getContactEmail(), describe(confirmed), currency,
                total.subtract(tax), tax, EventMoney.amount(confirmed.getDiscountAmount()), total, now));
        events.invoiceIssued(invoice);
        log.info("Invoice issued number={} bookingId={}", invoice.getInvoiceNumber(), bookingId);
    }

    private String nextNumber(Instant now) {
        String year = financialYear(LocalDate.ofInstant(now, INDIA));
        jdbc.sql("INSERT IGNORE INTO invoice_sequences (financial_year, last_number) VALUES (:year, 0)")
                .param("year", year).update();
        int last = jdbc.sql("SELECT last_number FROM invoice_sequences WHERE financial_year = :year FOR UPDATE")
                .param("year", year).query(Integer.class).single();
        jdbc.sql("UPDATE invoice_sequences SET last_number = :next WHERE financial_year = :year")
                .param("next", last + 1).param("year", year).update();
        return "INV/%s/%06d".formatted(year, last + 1);
    }

    /** "2026-27" for April 2026 to March 2027. */
    static String financialYear(LocalDate date) {
        int start = date.getMonthValue() >= 4 ? date.getYear() : date.getYear() - 1;
        return "%d-%02d".formatted(start, (start + 1) % 100);
    }

    private static String describe(BookingConfirmed confirmed) {
        ConfirmedFlightTrip flight = confirmed.getFlight();
        if (flight != null) {
            int travellers = flight.getPassengers().size();
            return "Flight %s: %s (%d %s)".formatted(flight.getTitle(), flight.getSlices().stream()
                    .map(slice -> slice.getSegments().getFirst().getFlightNumber() + " on "
                            + slice.getDepartureLocal().substring(0, 10))
                    .collect(java.util.stream.Collectors.joining(", ")), travellers,
                    travellers == 1 ? "traveller" : "travellers");
        }
        ConfirmedHotelStay hotel = confirmed.getHotel();
        if (hotel == null) {
            return "Booking " + confirmed.getBookingReference();
        }
        return "Hotel stay at %s, %s: %s to %s (%d %s)".formatted(hotel.getHotelName(), hotel.getHotelCity(),
                hotel.getCheckIn(), hotel.getCheckOut(), hotel.getNights(), hotel.getNights() == 1 ? "night" : "nights");
    }
}
