package com.flighthotel.hotel.staff;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.hotel.repository.HotelRepository;

/**
 * "Hotel managers can only touch hotels listed for them in hotel_staff" (SECURITY_GUIDE.md §6). Admins have
 * {@code HOTEL_MANAGE_ANY}. Every manager service method starts with {@link #requireManage(UUID)}.
 */
@Component
public class HotelAccess {

    public static final String MANAGE_ANY = "HOTEL_MANAGE_ANY";
    public static final String MANAGE_ASSIGNED = "HOTEL_MANAGE_ASSIGNED";

    private final HotelRepository hotels;
    private final HotelStaffStore staff;

    public HotelAccess(HotelRepository hotels, HotelStaffStore staff) {
        this.hotels = hotels;
        this.staff = staff;
    }

    public boolean canManageAny() {
        return CurrentUser.get().map(user -> user.hasPermission(MANAGE_ANY)).orElse(false);
    }

    /** 404 if the hotel does not exist, 403 if the user may not manage it. */
    public AuthenticatedUser requireManage(UUID hotelId) {
        AuthenticatedUser user = CurrentUser.require();
        if (!hotels.existsById(hotelId)) {
            throw new ResourceNotFoundException("Hotel", hotelId);
        }
        if (user.hasPermission(MANAGE_ANY)) {
            return user;
        }
        if (user.hasPermission(MANAGE_ASSIGNED) && staff.isAssigned(hotelId, user.id())) {
            return user;
        }
        throw new ApiException(HttpStatus.FORBIDDEN, "HOTEL_NOT_ASSIGNED", "You are not assigned to this hotel.");
    }
}
