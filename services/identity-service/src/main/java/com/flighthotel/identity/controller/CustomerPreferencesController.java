package com.flighthotel.identity.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.identity.dto.CustomerDtos.PreferencesDto;
import com.flighthotel.identity.service.PreferencesService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/customers/preferences")
@Tag(name = "My account: Travel preferences")
public class CustomerPreferencesController {

    private final PreferencesService preferencesService;

    public CustomerPreferencesController(PreferencesService preferencesService) {
        this.preferencesService = preferencesService;
    }

    @GetMapping
    @Operation(summary = "My travel preferences (defaults if never saved)")
    public PreferencesDto get() {
        return preferencesService.get();
    }

    @PutMapping
    @Operation(summary = "Save my travel preferences")
    public PreferencesDto update(@Valid @RequestBody PreferencesDto request) {
        return preferencesService.update(request);
    }
}
