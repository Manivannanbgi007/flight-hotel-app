package com.flighthotel.identity.service.impl;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.identity.dto.CustomerDtos.PassengerRequest;
import com.flighthotel.identity.dto.CustomerDtos.PassengerResponse;
import com.flighthotel.identity.entity.CustomerPassenger;
import com.flighthotel.identity.mapper.IdentityMapper;
import com.flighthotel.identity.repository.CustomerPassengerRepository;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.service.PassengerService;

@Service
public class PassengerServiceImpl implements PassengerService {

    private final CustomerPassengerRepository passengers;
    private final UserRepository users;
    private final IdentityMapper mapper;

    public PassengerServiceImpl(CustomerPassengerRepository passengers, UserRepository users, IdentityMapper mapper) {
        this.passengers = passengers;
        this.users = users;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    public List<PassengerResponse> list() {
        return passengers.findByUserIdOrderByCreatedAtAsc(currentUserId()).stream().map(mapper::toPassenger).toList();
    }

    @Override
    @Transactional
    public PassengerResponse create(PassengerRequest request) {
        UUID userId = currentUserId();
        // Row lock on the user: two parallel "add passenger" calls cannot both pass the limit check.
        users.lockById(userId);
        if (passengers.countByUserId(userId) >= MAX_PASSENGERS) {
            throw new BusinessRuleException("PASSENGER_LIMIT_REACHED",
                    "You can save up to " + MAX_PASSENGERS + " passengers. Remove one to add another.",
                    Map.of("limit", MAX_PASSENGERS));
        }
        CustomerPassenger passenger = new CustomerPassenger(userId);
        apply(passenger, request);
        return mapper.toPassenger(passengers.saveAndFlush(passenger));
    }

    @Override
    @Transactional
    public PassengerResponse update(UUID id, PassengerRequest request) {
        CustomerPassenger passenger = findOwned(id);
        apply(passenger, request);
        return mapper.toPassenger(passengers.saveAndFlush(passenger));
    }

    @Override
    @Transactional
    public void delete(UUID id) {
        passengers.delete(findOwned(id));
    }

    private CustomerPassenger findOwned(UUID id) {
        return passengers.findByIdAndUserId(id, currentUserId())
                .orElseThrow(() -> new ResourceNotFoundException("Passenger", id));
    }

    private static void apply(CustomerPassenger passenger, PassengerRequest request) {
        passenger.setPassengerType(request.passengerType());
        passenger.setFirstName(request.firstName().trim());
        passenger.setLastName(request.lastName().trim());
        passenger.setDateOfBirth(request.dateOfBirth());
        passenger.setGender(request.gender());
        passenger.setNationality(blankToNull(request.nationality()));
        applyPassport(passenger, request);
    }

    /**
     * New number → all three passport fields are required. No number → the stored number is kept, but its expiry
     * and issuing country may still be updated (both together). {@code removePassport} deletes it.
     */
    private static void applyPassport(CustomerPassenger passenger, PassengerRequest request) {
        if (request.removePassport()) {
            passenger.removePassport();
            return;
        }
        String number = blankToNull(request.passportNumber());
        LocalDate expiry = request.passportExpiry();
        String country = blankToNull(request.passportCountry());
        if (number != null) {
            requireComplete(expiry, country);
            passenger.setPassport(number, expiry, country);
        } else if (expiry != null || country != null) {
            if (!passenger.hasPassport()) {
                throw passportIncomplete();
            }
            requireComplete(expiry, country);
            passenger.setPassport(passenger.getPassportNumber(), expiry, country);
        }
    }

    private static void requireComplete(LocalDate expiry, String country) {
        if (expiry == null || country == null) {
            throw passportIncomplete();
        }
    }

    private static BusinessRuleException passportIncomplete() {
        return new BusinessRuleException("PASSPORT_DETAILS_INCOMPLETE",
                "Passport number, expiry date and issuing country must be given together.");
    }

    private static UUID currentUserId() {
        return CurrentUser.require().id();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
