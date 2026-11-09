package com.flighthotel.booking.service;

import java.security.SecureRandom;

import org.springframework.stereotype.Component;

import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.repository.BookingRepository;

/** Human-friendly booking references such as {@code HT-7K3M9Q2X}: no 0/O or 1/I/L, easy to read over the phone. */
@Component
public class BookingReferences {

    private static final char[] ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final BookingRepository bookings;

    public BookingReferences(BookingRepository bookings) {
        this.bookings = bookings;
    }

    public String next(BookingType type) {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder reference = new StringBuilder(type.referencePrefix()).append('-');
            for (int i = 0; i < 8; i++) {
                reference.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
            }
            if (!bookings.existsByBookingReference(reference.toString())) {
                return reference.toString();
            }
        }
        throw new IllegalStateException("Could not generate a unique booking reference");
    }
}
