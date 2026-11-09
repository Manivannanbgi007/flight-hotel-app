package com.flighthotel.identity.service;

import com.flighthotel.identity.dto.CustomerDtos.PreferencesDto;

/** The logged-in user's travel preferences (API_DOCUMENTATION.md §3.3). */
public interface PreferencesService {

    /** Defaults when nothing was saved yet. */
    PreferencesDto get();

    PreferencesDto update(PreferencesDto preferences);
}
