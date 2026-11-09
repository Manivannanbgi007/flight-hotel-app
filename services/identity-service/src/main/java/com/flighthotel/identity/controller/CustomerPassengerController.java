package com.flighthotel.identity.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.identity.dto.CustomerDtos.PassengerRequest;
import com.flighthotel.identity.dto.CustomerDtos.PassengerResponse;
import com.flighthotel.identity.service.PassengerService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/customers/passengers")
@Tag(name = "My account: Saved passengers")
public class CustomerPassengerController {

    private final PassengerService passengerService;

    public CustomerPassengerController(PassengerService passengerService) {
        this.passengerService = passengerService;
    }

    @GetMapping
    @Operation(summary = "My saved passengers (passport numbers are masked)")
    public List<PassengerResponse> list() {
        return passengerService.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Save a passenger (max 20)")
    public PassengerResponse create(@Valid @RequestBody PassengerRequest request) {
        return passengerService.create(request);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Change a saved passenger; an empty passport number keeps the stored one")
    public PassengerResponse update(@PathVariable UUID id, @Valid @RequestBody PassengerRequest request) {
        return passengerService.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a saved passenger")
    public void delete(@PathVariable UUID id) {
        passengerService.delete(id);
    }
}
