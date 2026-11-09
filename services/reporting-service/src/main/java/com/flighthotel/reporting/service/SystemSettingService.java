package com.flighthotel.reporting.service;

import java.util.List;

import com.flighthotel.reporting.dto.PublicSettingResponse;
import com.flighthotel.reporting.dto.SystemSettingResponse;
import com.flighthotel.reporting.dto.UpdateSystemSettingRequest;

public interface SystemSettingService {

    List<SystemSettingResponse> findAll();

    List<PublicSettingResponse> findPublic();

    SystemSettingResponse update(String key, UpdateSystemSettingRequest request);

    /** Broadcasts settings that changed but were never published (e.g. defaults inserted by Flyway). */
    int publishPendingChanges();
}
