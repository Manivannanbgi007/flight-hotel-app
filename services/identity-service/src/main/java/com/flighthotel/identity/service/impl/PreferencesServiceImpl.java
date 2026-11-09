package com.flighthotel.identity.service.impl;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.identity.dto.CustomerDtos.PreferencesDto;
import com.flighthotel.identity.entity.TravelPreferences;
import com.flighthotel.identity.mapper.IdentityMapper;
import com.flighthotel.identity.repository.TravelPreferencesRepository;
import com.flighthotel.identity.service.PreferencesService;

@Service
public class PreferencesServiceImpl implements PreferencesService {

    static final String DEFAULT_CURRENCY = "INR";

    private final TravelPreferencesRepository preferences;
    private final IdentityMapper mapper;

    public PreferencesServiceImpl(TravelPreferencesRepository preferences, IdentityMapper mapper) {
        this.preferences = preferences;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    public PreferencesDto get() {
        return preferences.findById(currentUserId())
                .map(mapper::toPreferences)
                .orElseGet(() -> new PreferencesDto(null, null, null, null, DEFAULT_CURRENCY, false));
    }

    @Override
    @Transactional
    public PreferencesDto update(PreferencesDto request) {
        UUID userId = currentUserId();
        TravelPreferences entity = preferences.findById(userId).orElseGet(() -> new TravelPreferences(userId));
        entity.setPreferredCabin(request.preferredCabin());
        entity.setHomeAirport(request.homeAirport() == null || request.homeAirport().isBlank() ? null : request.homeAirport());
        entity.setSeatPreference(request.seatPreference());
        entity.setMealPreference(request.mealPreference());
        entity.setPreferredCurrency(request.preferredCurrency());
        entity.setNewsletterOptIn(request.newsletterOptIn());
        return mapper.toPreferences(preferences.saveAndFlush(entity));
    }

    private static UUID currentUserId() {
        return CurrentUser.require().id();
    }
}
