package com.flighthotel.reporting.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * @param value           new value as text; validated against the setting's type
 * @param expectedVersion the version the admin was looking at; protects against overwriting someone else's change
 */
public record UpdateSystemSettingRequest(
        @NotNull @Size(max = 2000) String value,
        @NotNull @PositiveOrZero Long expectedVersion) {
}
