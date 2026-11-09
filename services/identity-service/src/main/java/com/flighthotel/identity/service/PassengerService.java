package com.flighthotel.identity.service;

import java.util.List;
import java.util.UUID;

import com.flighthotel.identity.dto.CustomerDtos.PassengerRequest;
import com.flighthotel.identity.dto.CustomerDtos.PassengerResponse;

/** The logged-in customer's saved passengers (API_DOCUMENTATION.md §3.2). Only the owner can see or change them. */
public interface PassengerService {

    int MAX_PASSENGERS = 20;

    List<PassengerResponse> list();

    PassengerResponse create(PassengerRequest request);

    PassengerResponse update(UUID id, PassengerRequest request);

    void delete(UUID id);
}
