package com.flighthotel.hotel.reservation;

import java.security.SecureRandom;

import org.springframework.stereotype.Component;

import com.flighthotel.hotel.repository.HotelReservationRepository;

/**
 * The hotel's own numbers for a stay, read out over the phone: unambiguous characters only (no 0/O, 1/I/L).
 * Confirmation {@code HK7M3Q9P2X}; cancellation {@code HXK7M3Q9P2} (X for "cancelled"), whoever cancelled.
 */
@Component
public class ReservationNumbers {

    private static final char[] ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final HotelReservationRepository reservations;

    public ReservationNumbers(HotelReservationRepository reservations) {
        this.reservations = reservations;
    }

    public String newConfirmationNumber() {
        for (int attempt = 0; attempt < 5; attempt++) {
            String number = random("H", 9);
            if (!reservations.existsByConfirmationNumber(number)) {
                return number;
            }
        }
        throw new IllegalStateException("Could not generate a unique confirmation number");
    }

    public String newCancellationReference() {
        for (int attempt = 0; attempt < 5; attempt++) {
            String number = random("HX", 8);
            if (!reservations.existsByCancellationReference(number)) {
                return number;
            }
        }
        throw new IllegalStateException("Could not generate a unique cancellation reference");
    }

    private static String random(String prefix, int length) {
        StringBuilder number = new StringBuilder(prefix);
        for (int i = 0; i < length; i++) {
            number.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
        }
        return number.toString();
    }
}
