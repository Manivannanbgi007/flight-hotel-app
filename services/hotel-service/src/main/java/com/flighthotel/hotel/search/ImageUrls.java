package com.flighthotel.hotel.search;

import java.util.UUID;

/** Public URLs of hotel photos (served by PublicHotelController; same origin through the gateway). */
public final class ImageUrls {

    private ImageUrls() {
    }

    public static String large(UUID imageId) {
        return "/api/hotels/images/" + imageId;
    }

    public static String thumb(UUID imageId) {
        return "/api/hotels/images/" + imageId + "?size=thumb";
    }
}
