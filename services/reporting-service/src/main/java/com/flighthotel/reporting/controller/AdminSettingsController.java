package com.flighthotel.reporting.controller;

import java.util.List;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.reporting.dto.SystemSettingResponse;
import com.flighthotel.reporting.dto.UpdateSystemSettingRequest;
import com.flighthotel.reporting.service.SystemSettingService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/admin/settings")
@Tag(name = "Admin: System settings")
public class AdminSettingsController {

    private final SystemSettingService settingService;

    public AdminSettingsController(SystemSettingService settingService) {
        this.settingService = settingService;
    }

    @GetMapping
    @Operation(summary = "List all system settings (ADMIN)")
    public List<SystemSettingResponse> findAll() {
        return settingService.findAll();
    }

    @PutMapping("/{key}")
    @Operation(summary = "Change a setting (ADMIN). The change reaches every service within seconds.")
    public SystemSettingResponse update(@PathVariable String key, @Valid @RequestBody UpdateSystemSettingRequest request) {
        return settingService.update(key, request);
    }
}
