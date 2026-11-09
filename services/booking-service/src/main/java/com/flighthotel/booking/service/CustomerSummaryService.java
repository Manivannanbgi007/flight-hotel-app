package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.SegmentView;
import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.dto.SummaryDtos.BookingCounts;
import com.flighthotel.booking.dto.SummaryDtos.CustomerSummary;
import com.flighthotel.booking.dto.SummaryDtos.Money;
import com.flighthotel.booking.dto.SummaryDtos.MonthActivity;
import com.flighthotel.booking.dto.SummaryDtos.NextFlight;
import com.flighthotel.booking.dto.SummaryDtos.NextHotel;
import com.flighthotel.booking.dto.SummaryDtos.NextTrip;
import com.flighthotel.booking.dto.SummaryDtos.Spending;
import com.flighthotel.booking.dto.SummaryDtos.SummaryRange;
import com.flighthotel.booking.dto.SummaryDtos.TripCounts;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingTab;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.analytics.Interval.Bucket;
import com.flighthotel.common.analytics.Timeline;
import com.flighthotel.common.security.CurrentUser;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The customer dashboard (Phase 11 §11.3): the signed-in user's own bookings only, whoever calls (a staff account sees
 * its own, usually empty, figures). Definitions in {@link com.flighthotel.booking.dto.SummaryDtos}. Ranges are India
 * days: the presets of {@link DayRange} (default {@code LAST_12_MONTHS}), {@code CUSTOM} (at most five years) or
 * {@code ALL_TIME} (from the user's first booking).
 */
@Service
@PreAuthorize("isAuthenticated()")
public class CustomerSummaryService {

    static final String DEFAULT_RANGE = "LAST_12_MONTHS";
    static final String ALL_TIME = "ALL_TIME";
    /** ALL_TIME never reaches back further than this (the monthly series stays short). */
    static final int ALL_TIME_YEARS = 10;

    private final JdbcClient jdbc;
    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final FlightBookingRepository flightBookings;
    private final JsonMapper json;
    private final Clock clock;

    public CustomerSummaryService(JdbcClient jdbc, BookingRepository bookings, HotelBookingRepository hotelBookings,
            FlightBookingRepository flightBookings, JsonMapper json, Clock clock) {
        this.jdbc = jdbc;
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.json = json;
        this.clock = clock;
    }

    /** One booking created in the range, as far as the figures need it. */
    private record Row(BookingType type, BookingStatus status, boolean paid, boolean confirmed, boolean cancelled,
            BigDecimal total, BigDecimal refunded, LocalDate day) {
    }

    @Transactional(readOnly = true)
    public CustomerSummary summary(String preset, LocalDate from, LocalDate to) {
        String user = CurrentUser.require().id().toString();
        Instant now = clock.instant();
        LocalDate today = LocalDate.now(clock.withZone(DayRange.INDIA));
        DayRange range = range(preset, from, to, today, user);

        List<Row> rows = jdbc.sql("""
                        SELECT booking_type, status, paid_payment_id IS NOT NULL AS paid,
                            confirmed_at IS NOT NULL AS confirmed, cancelled_at IS NOT NULL AS cancelled,
                            total_amount, refunded_amount, created_at
                        FROM bookings WHERE user_id = UUID_TO_BIN(:user) AND created_at >= :start AND created_at < :end""")
                .param("user", user)
                .param("start", range.startUtc(DayRange.INDIA))
                .param("end", range.endUtc(DayRange.INDIA))
                .query((rs, i) -> new Row(BookingType.valueOf(rs.getString("booking_type")),
                        BookingStatus.valueOf(rs.getString("status")), rs.getBoolean("paid"),
                        rs.getBoolean("confirmed"), rs.getBoolean("cancelled"), rs.getBigDecimal("total_amount"),
                        rs.getBigDecimal("refunded_amount"), indiaDay(rs.getObject("created_at", LocalDateTime.class))))
                .list();
        BigDecimal inProgress = jdbc.sql("""
                        SELECT COALESCE(SUM(r.amount), 0) FROM booking_refund_requests r JOIN bookings b ON b.id = r.booking_id
                        WHERE b.user_id = UUID_TO_BIN(:user) AND b.created_at >= :start AND b.created_at < :end
                            AND r.status = 'REQUESTED' AND r.reason <> 'DUPLICATE_PAYMENT'""")
                .param("user", user)
                .param("start", range.startUtc(DayRange.INDIA))
                .param("end", range.endUtc(DayRange.INDIA))
                .query(BigDecimal.class).single();

        List<Row> confirmed = rows.stream().filter(Row::confirmed).toList();
        BookingCounts counts = new BookingCounts(confirmed.size(), count(confirmed, BookingType.HOTEL),
                count(confirmed, BookingType.FLIGHT),
                confirmed.stream().filter(r -> !r.cancelled() && r.status().tab() == BookingTab.UPCOMING).count(),
                confirmed.stream().filter(r -> r.status() == BookingStatus.COMPLETED).count(),
                confirmed.stream().filter(Row::cancelled).count());
        Money all = money(rows, null);
        Spending spending = new Spending("INR", all.paid(), all.refunded(), all.net(), money(inProgress),
                money(rows, BookingType.HOTEL), money(rows, BookingType.FLIGHT));

        return new CustomerSummary(new SummaryRange(range.preset(), range.from(), range.to()), counts, trips(user),
                spending, monthly(range, rows), nextTrip(user, today, now), now);
    }

    private DayRange range(String preset, LocalDate from, LocalDate to, LocalDate today, String user) {
        if (preset == null || !ALL_TIME.equals(preset.strip().toUpperCase(Locale.ROOT))) {
            return DayRange.resolve(preset, from, to, today, DEFAULT_RANGE, DayRange.FIVE_YEARS);
        }
        LocalDateTime first = jdbc.sql("SELECT MIN(created_at) FROM bookings WHERE user_id = UUID_TO_BIN(:user)")
                .param("user", user).query(LocalDateTime.class).optional().orElse(null);
        LocalDate earliest = today.withDayOfMonth(1).minusYears(ALL_TIME_YEARS);
        LocalDate start = first == null ? today : indiaDay(first);
        return new DayRange(ALL_TIME, start.isBefore(earliest) ? earliest : start.isAfter(today) ? today : start,
                today);
    }

    /** All the user's bookings now, by the My Trips tab (a cancelled booking that was confirmed: "cancelled"). */
    private TripCounts trips(String user) {
        long[] trips = new long[4];
        jdbc.sql("SELECT status, cancelled_at IS NOT NULL AS cancelled, COUNT(*) AS n FROM bookings "
                        + "WHERE user_id = UUID_TO_BIN(:user) GROUP BY status, cancelled")
                .param("user", user)
                .query((java.sql.ResultSet rs) -> {
                    BookingTab tab = BookingStatus.valueOf(rs.getString("status")).tab();
                    long n = rs.getLong("n");
                    if (rs.getBoolean("cancelled")) {
                        trips[2] += n;
                    } else if (tab == BookingTab.UPCOMING) {
                        trips[0] += n;
                    } else if (tab == BookingTab.COMPLETED) {
                        trips[1] += n;
                    } else if (tab == BookingTab.PENDING) {
                        trips[3] += n;
                    }
                });
        return new TripCounts(trips[0], trips[1], trips[2], trips[3]);
    }

    private static List<MonthActivity> monthly(DayRange range, List<Row> rows) {
        Timeline months = Timeline.of(range, Interval.MONTH);
        List<List<Row>> byMonth = new ArrayList<>();
        months.buckets().forEach(bucket -> byMonth.add(new ArrayList<>()));
        rows.forEach(row -> {
            int index = months.indexOf(row.day());
            if (index >= 0) {
                byMonth.get(index).add(row);
            }
        });
        List<MonthActivity> activity = new ArrayList<>();
        for (int i = 0; i < months.size(); i++) {
            Bucket bucket = months.buckets().get(i);
            List<Row> month = byMonth.get(i);
            List<Row> confirmed = month.stream().filter(Row::confirmed).toList();
            Money money = money(month, null);
            activity.add(new MonthActivity(bucket.key(), bucket.start(), bucket.end(), confirmed.size(),
                    count(confirmed, BookingType.HOTEL), count(confirmed, BookingType.FLIGHT), money.paid(),
                    money.refunded(), money.net()));
        }
        return activity;
    }

    /** The confirmed trip that starts first and has not ended yet (by India day). */
    private NextTrip nextTrip(String user, LocalDate today, Instant now) {
        UUID id = jdbc.sql("""
                        SELECT BIN_TO_UUID(id) FROM bookings
                        WHERE user_id = UUID_TO_BIN(:user) AND status = 'CONFIRMED' AND start_date IS NOT NULL
                            AND COALESCE(end_date, start_date) >= :today
                        ORDER BY start_date, starts_at, created_at LIMIT 1""")
                .param("user", user).param("today", today)
                .query(String.class).optional().map(UUID::fromString).orElse(null);
        if (id == null) {
            return null;
        }
        Booking booking = bookings.findById(id).orElseThrow();
        boolean started = booking.getStartsAt() != null ? !booking.getStartsAt().isAfter(now)
                : !booking.getStartDate().isAfter(today);
        long daysUntil = Math.max(0, ChronoUnit.DAYS.between(today, booking.getStartDate()));
        NextHotel hotel = booking.getBookingType() == BookingType.HOTEL
                ? hotelBookings.findById(id).map(CustomerSummaryService::hotel).orElse(null) : null;
        NextFlight flight = booking.getBookingType() == BookingType.FLIGHT
                ? flightBookings.findById(id).map(this::flight).orElse(null) : null;
        return new NextTrip(booking.getId(), booking.getBookingReference(), booking.getBookingType(),
                booking.getStatus(), booking.getTitle(), booking.getDestination(), booking.getStartDate(),
                booking.getEndDate(), booking.getStartsAt(), daysUntil, started, booking.getTotalAmount(),
                booking.getCurrency(), hotel, flight);
    }

    /** Confirmed only, so the confirmation number may be shown (golden rule 3). */
    private static NextHotel hotel(HotelBooking hotel) {
        Integer guests = hotel.getAdults() == null ? null
                : hotel.getAdults() + (hotel.getChildren() == null ? 0 : hotel.getChildren());
        return new NextHotel(hotel.getHotelName(), hotel.getHotelCity(), hotel.getHotelAddress(), hotel.getCheckIn(),
                hotel.getCheckOut(), hotel.getCheckInTime(), hotel.getCheckOutTime(), hotel.getNights(),
                hotel.getRooms(), guests, hotel.getRoomTypeName(), hotel.getConfirmationNumber());
    }

    /** The outbound flight (first slice), the return departure if any. Confirmed only, so the PNR may be shown. */
    private NextFlight flight(FlightBooking flight) {
        List<SliceView> slices = flight.getSlicesJson() == null ? List.of()
                : json.readValue(flight.getSlicesJson(), new TypeReference<List<SliceView>>() { });
        if (slices.isEmpty()) {
            return new NextFlight(flight.getTripType(), flight.getCabin(), null, null, null, null, null, null, null,
                    null, 0, passengers(flight), flight.getPnr(), null);
        }
        SliceView out = slices.getFirst();
        SegmentView first = out.segments() == null || out.segments().isEmpty() ? null : out.segments().getFirst();
        return new NextFlight(flight.getTripType(), flight.getCabin(), out.origin(), out.destination(),
                out.originCity(), out.destinationCity(), out.departureLocal(), out.arrivalLocal(),
                first == null ? null : first.airlineName(), first == null ? null : first.flightNumber(), out.stops(),
                passengers(flight), flight.getPnr(), slices.size() > 1 ? slices.get(1).departureLocal() : null);
    }

    private static Integer passengers(FlightBooking flight) {
        return flight.getAdults() + flight.getChildren() + flight.getInfants();
    }

    // ------------------------------------------------------------------ helpers

    private static long count(List<Row> rows, BookingType type) {
        return rows.stream().filter(r -> r.type() == type).count();
    }

    /** Paid: the totals of paid bookings; refunded: their completed refunds (never a duplicate payment's). */
    private static Money money(List<Row> rows, BookingType type) {
        BigDecimal paid = BigDecimal.ZERO;
        BigDecimal refunded = BigDecimal.ZERO;
        for (Row row : rows) {
            if (type == null || row.type() == type) {
                if (row.paid()) {
                    paid = paid.add(row.total());
                }
                refunded = refunded.add(row.refunded());
            }
        }
        return new Money(money(paid), money(refunded), money(paid.subtract(refunded)));
    }

    private static BigDecimal money(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.HALF_UP);
    }

    private static LocalDate indiaDay(LocalDateTime utc) {
        return utc.toInstant(ZoneOffset.UTC).atZone(DayRange.INDIA).toLocalDate();
    }
}
