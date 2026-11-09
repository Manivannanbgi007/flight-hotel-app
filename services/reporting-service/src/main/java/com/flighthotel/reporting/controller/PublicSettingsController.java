package com.flighthotel.reporting.controller;

import java.util.List;
import java.util.concurrent.TimeUnit;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.reporting.dto.PublicSettingResponse;
import com.flighthotel.reporting.service.SystemSettingService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/public/settings")
@Tag(name = "Public: Site settings")
public class PublicSettingsController {

    private final SystemSettingService settingService;

    public PublicSettingsController(SystemSettingService settingService) {
        this.settingService = settingService;
    }

    @GetMapping
    @Operation(summary = "Settings the website shows to everyone (brand name, support contacts, ...)")
    public ResponseEntity<List<PublicSettingResponse>> findPublic() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .body(settingService.findPublic());
    }
}
