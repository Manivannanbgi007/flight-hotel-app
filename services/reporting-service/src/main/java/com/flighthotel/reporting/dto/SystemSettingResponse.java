package com.flighthotel.reporting.dto;

import java.time.Instant;

import com.flighthotel.reporting.entity.SettingValueType;

public record SystemSettingResponse(
        String key,
        String value,
        SettingValueType valueType,
        String description,
        boolean publicSetting,
        long version,
        Instant updatedAt,
        String updatedBy) {
}
