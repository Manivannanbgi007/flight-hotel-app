package com.flighthotel.hotel.search;

import static java.time.temporal.ChronoUnit.DAYS;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.hotel.dto.PublicHotelDtos.NightlyPrice;
import com.flighthotel.hotel.dto.PublicHotelDtos.Quote;
import com.flighthotel.hotel.dto.PublicHotelDtos.QuoteRequest;
import com.flighthotel.hotel.dto.PublicHotelDtos.TaxLine;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.pricing.PricingService.CancellationTerms;
import com.flighthotel.hotel.pricing.PricingService.NightPrice;
import com.flighthotel.hotel.pricing.PricingService;
import com.flighthotel.hotel.search.OfferCalculator.PricedPlan;
import com.flighthotel.hotel.search.OfferCalculator.RoomOfferData;

import tools.jackson.databind.json.JsonMapper;

/**
 * "Revalidate room availability and pricing" (requirement §10, step 5). The quote is the price the customer saw;
 * booking-service will hold the rooms against it within {@link #TTL} (BOOKING_WORKFLOW.md §2). Nothing is reserved
 * yet: the rooms are only held when the booking starts.
 */
@Service
public class QuoteService {

    public static final Duration TTL = Duration.ofMinutes(15);
    private static final String KEY_PREFIX = "hotel:quote:";

    private final HotelDetailsService details;
    private final OfferCalculator offers;
    private final PricingService pricing;
    private final StayValidator stayValidator;
    private final StringRedisTemplate redis;
    private final JsonMapper jsonMapper;
    private final Clock clock;

    public QuoteService(HotelDetailsService details, OfferCalculator offers, PricingService pricing,
            StayValidator stayValidator, StringRedisTemplate redis, JsonMapper jsonMapper, Clock clock) {
        this.details = details;
        this.offers = offers;
        this.pricing = pricing;
        this.stayValidator = stayValidator;
        this.redis = redis;
        this.jsonMapper = jsonMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Quote create(QuoteRequest request) {
        stayValidator.validate(request.stay());
        Hotel hotel = details.findActive(request.hotelId().toString());
        RoomOfferData room = offers.offers(List.of(hotel.getId()), request.stay()).getOrDefault(hotel.getId(), List.of())
                .stream().filter(offer -> offer.roomType().getId().equals(request.roomTypeId())).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Room type", request.roomTypeId()));
        PricedPlan plan = room.plans().stream().filter(p -> p.plan().getId().equals(request.ratePlanId())).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Rate plan", request.ratePlanId()));
        if (!room.fits()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "ROOM_TOO_SMALL",
                    "This room type cannot accommodate your party in " + request.stay().rooms() + " room(s).");
        }
        if (!room.available()) {
            throw new ConflictException("ROOMS_NOT_AVAILABLE", "These rooms are no longer available for your dates.");
        }

        Instant now = clock.instant();
        CancellationTerms terms = pricing.cancellation(plan.plan(), hotel, request.stay().checkIn());
        Quote quote = new Quote(UuidV7.generate(), now, now.plus(TTL), hotel.getId(), hotel.getSlug(), hotel.getName(),
                hotel.getAddressLine() + ", " + hotel.getCity(), hotel.getCheckInTime(), hotel.getCheckOutTime(),
                room.roomType().getId(), room.roomType().getName(), plan.plan().getId(), plan.plan().getName(),
                plan.plan().isBreakfastIncluded(), request.stay().checkIn(), request.stay().checkOut(),
                (int) DAYS.between(request.stay().checkIn(), request.stay().checkOut()), request.stay().rooms(),
                request.stay().adults(), request.stay().children(),
                request.stay().childAges() == null ? List.of() : List.copyOf(request.stay().childAges()),
                plan.price().nights().stream().map(n -> new NightlyPrice(n.date(), n.price(), n.season())).toList(),
                plan.price().subtotal(), plan.price().taxes(), taxLines(plan.price().nights(), request.stay().rooms()),
                plan.price().total(), plan.price().currency(), plan.plan().isRefundable(), terms.freeCancellation(),
                terms.freeUntil(), terms.feePercent(), terms.description(), hotel.getDataSource() == DataSource.DEMO);
        redis.opsForValue().set(KEY_PREFIX + quote.quoteId(), jsonMapper.writeValueAsString(quote), TTL);
        return quote;
    }

    /** A quote that has not expired yet (booking-service and the review page read it). */
    public Optional<Quote> find(UUID quoteId) {
        String json = redis.opsForValue().get(KEY_PREFIX + quoteId);
        return json == null ? Optional.empty() : Optional.of(jsonMapper.readValue(json, Quote.class));
    }

    /** GST per rate, so the breakdown can show "GST 12% … ₹x". Also used for the price held for a booking. */
    public static List<TaxLine> taxLines(List<NightPrice> nights, int rooms) {
        Map<BigDecimal, BigDecimal> byRate = new TreeMap<>();
        for (NightPrice night : nights) {
            BigDecimal tax = night.price().multiply(night.taxRatePercent())
                    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(rooms));
            byRate.merge(night.taxRatePercent().stripTrailingZeros(), tax, BigDecimal::add);
        }
        return byRate.entrySet().stream()
                .map(e -> new TaxLine("GST " + e.getKey().toPlainString() + "%", e.getKey(),
                        e.getValue().setScale(2, RoundingMode.HALF_UP)))
                .toList();
    }
}
