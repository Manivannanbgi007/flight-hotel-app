package com.flighthotel.hotel.entity;

/** Who cancelled a confirmed reservation. */
public enum CancelledBy {
    /** The customer (or support on their behalf), through booking-service's cancellation saga. */
    CUSTOMER,
    /** The hotel itself (overbooking, closure): booking-service refunds the guest in full. */
    HOTEL
}
