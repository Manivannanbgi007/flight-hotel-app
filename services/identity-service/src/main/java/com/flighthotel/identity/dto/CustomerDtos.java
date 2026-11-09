package com.flighthotel.identity.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.flighthotel.identity.entity.CabinClass;
import com.flighthotel.identity.entity.Gender;
import com.flighthotel.identity.entity.MealPreference;
import com.flighthotel.identity.entity.PassengerType;
import com.flighthotel.identity.entity.SeatPreference;

/** Request and response bodies of /api/customers (see API_DOCUMENTATION.md §3). */
public final class CustomerDtos {

    private static final String COUNTRY = "^[A-Z]{2}$";

    private CustomerDtos() {
    }

    public record ProfileResponse(UUID id, String email, String firstName, String lastName, String phone,
                                  LocalDate dateOfBirth, String nationality, Set<String> roles, boolean emailVerified,
                                  boolean hasPhoto, Instant memberSince) {
    }

    public record UpdateProfileRequest(
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String firstName,
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String lastName,
            @Pattern(regexp = AuthDtos.PHONE_PATTERN, message = "must be 7-15 digits, optionally starting with +") String phone,
            @Past LocalDate dateOfBirth,
            @Pattern(regexp = COUNTRY, message = "must be a 2-letter country code") String nationality) {
    }

    public record PassengerRequest(
            @NotNull PassengerType passengerType,
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String firstName,
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String lastName,
            @Past LocalDate dateOfBirth,
            Gender gender,
            @Pattern(regexp = COUNTRY, message = "must be a 2-letter country code") String nationality,
            @Pattern(regexp = "^[A-Z0-9]{5,20}$", message = "must be 5-20 capital letters or digits") String passportNumber,
            @Future LocalDate passportExpiry,
            @Pattern(regexp = COUNTRY, message = "must be a 2-letter country code") String passportCountry,
            boolean removePassport) {
    }

    public record PassengerResponse(UUID id, PassengerType passengerType, String firstName, String lastName,
                                    LocalDate dateOfBirth, Gender gender, String nationality, boolean hasPassport,
                                    String passportNumberMasked, LocalDate passportExpiry, String passportCountry) {
    }

    public record PreferencesDto(
            CabinClass preferredCabin,
            @Pattern(regexp = "^[A-Z]{3}$", message = "must be a 3-letter airport code") String homeAirport,
            SeatPreference seatPreference,
            MealPreference mealPreference,
            @NotNull @Pattern(regexp = "^INR$", message = "only INR is supported") String preferredCurrency,
            boolean newsletterOptIn) {
    }

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 10, max = 64) String newPassword) {
    }

    public record LoginHistoryResponse(Instant occurredAt, boolean success, String failureReason, String ipAddress,
                                       String userAgent) {
    }
}
