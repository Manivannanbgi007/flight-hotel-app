package com.flighthotel.hotel.demo;

import java.util.List;
import java.util.Set;

import com.flighthotel.hotel.entity.PropertyType;

/** The fictional demo catalogue (DemoHotelSeeder). Names and places are invented; coordinates are near real cities. */
final class DemoData {

    private DemoData() {
    }

    record DemoLandmark(String city, String name, String type, double lat, double lon) {
    }

    record DemoRoom(String name, String description, int adults, int children, String beds, int sizeSqm, int rooms,
                    int price, Set<String> amenities) {
    }

    record DemoHotel(String name, String city, String state, PropertyType type, Integer stars, String address,
                     double lat, double lon, double rating, int reviews, String description, Set<String> amenities,
                     List<DemoRoom> rooms) {
    }

    static final List<List<String>> PALETTES = List.of(
            List.of("#0e7490", "#1e40af"), List.of("#b45309", "#7c2d12"), List.of("#15803d", "#164e63"),
            List.of("#7c3aed", "#1e3a8a"), List.of("#be185d", "#7c2d12"), List.of("#0f766e", "#334155"));

    static final List<DemoLandmark> LANDMARKS = List.of(
            new DemoLandmark("Goa", "Goa city centre (Panaji)", "CITY_CENTRE", 15.4909, 73.8278),
            new DemoLandmark("Goa", "Calangute Beach", "BEACH", 15.5439, 73.7553),
            new DemoLandmark("Goa", "Goa International Airport", "AIRPORT", 15.3808, 73.8314),
            new DemoLandmark("Bengaluru", "Bengaluru city centre (MG Road)", "CITY_CENTRE", 12.9750, 77.6060),
            new DemoLandmark("Bengaluru", "Kempegowda International Airport", "AIRPORT", 13.1989, 77.7068),
            new DemoLandmark("Mumbai", "Mumbai city centre (CST)", "CITY_CENTRE", 18.9398, 72.8355),
            new DemoLandmark("Mumbai", "Juhu Beach", "BEACH", 19.0988, 72.8267),
            new DemoLandmark("Mumbai", "Mumbai International Airport", "AIRPORT", 19.0896, 72.8656),
            new DemoLandmark("New Delhi", "New Delhi city centre (Connaught Place)", "CITY_CENTRE", 28.6315, 77.2167),
            new DemoLandmark("New Delhi", "India Gate", "ATTRACTION", 28.6129, 77.2295),
            new DemoLandmark("New Delhi", "Delhi International Airport", "AIRPORT", 28.5562, 77.1000),
            new DemoLandmark("Jaipur", "Jaipur city centre", "CITY_CENTRE", 26.9124, 75.7873),
            new DemoLandmark("Jaipur", "Hawa Mahal", "ATTRACTION", 26.9239, 75.8267),
            new DemoLandmark("Jaipur", "Amber Fort", "ATTRACTION", 26.9855, 75.8513),
            new DemoLandmark("Chennai", "Chennai city centre", "CITY_CENTRE", 13.0827, 80.2707),
            new DemoLandmark("Chennai", "Marina Beach", "BEACH", 13.0500, 80.2824),
            new DemoLandmark("Chennai", "Chennai International Airport", "AIRPORT", 12.9941, 80.1709),
            new DemoLandmark("Kochi", "Kochi city centre", "CITY_CENTRE", 9.9312, 76.2673),
            new DemoLandmark("Kochi", "Fort Kochi", "ATTRACTION", 9.9658, 76.2421),
            new DemoLandmark("Udaipur", "Udaipur city centre", "CITY_CENTRE", 24.5854, 73.7125),
            new DemoLandmark("Udaipur", "City Palace", "ATTRACTION", 24.5764, 73.6835));

    private static final Set<String> BASIC_ROOM = Set.of("AIR_CONDITIONING", "TV", "KETTLE", "HAIR_DRYER");
    private static final Set<String> COMFORT_ROOM = Set.of("AIR_CONDITIONING", "TV", "SAFE", "KETTLE", "WORK_DESK", "HAIR_DRYER");
    private static final Set<String> LUXURY_ROOM = Set.of("AIR_CONDITIONING", "TV", "SAFE", "MINIBAR", "KETTLE", "BATHTUB",
            "HAIR_DRYER", "WORK_DESK");

    private static Set<String> with(Set<String> base, String... extra) {
        java.util.Set<String> result = new java.util.HashSet<>(base);
        result.addAll(List.of(extra));
        return Set.copyOf(result);
    }

    static final List<DemoHotel> HOTELS = List.of(
            new DemoHotel("Sea Breeze Resort", "Goa", "Goa", PropertyType.RESORT, 4, "Beach Road, Calangute", 15.5412, 73.7630,
                    4.4, 312, "A relaxed beach resort a short walk from Calangute Beach, with a lagoon-style pool and a kids' club.",
                    Set.of("POOL", "SPA", "RESTAURANT", "BAR", "FREE_WIFI", "BEACH_ACCESS", "PARKING", "AIRPORT_SHUTTLE", "KIDS_CLUB"),
                    List.of(new DemoRoom("Garden View Room", "Bright room facing the tropical garden.", 2, 1, "1 King bed", 28, 20, 6200, with(COMFORT_ROOM, "BALCONY")),
                            new DemoRoom("Sea View Suite", "Separate living area and a balcony facing the sea.", 2, 2, "1 King bed + sofa bed", 45, 8, 11800, with(LUXURY_ROOM, "BALCONY", "SEA_VIEW")))),
            new DemoHotel("Palm Grove Villas", "Goa", "Goa", PropertyType.VILLA, 5, "Fort Aguada Road, Candolim", 15.5180, 73.7623,
                    4.7, 128, "Private villas with plunge pools among coconut palms, ten minutes from Candolim Beach.",
                    Set.of("POOL", "SPA", "RESTAURANT", "FREE_WIFI", "BEACH_ACCESS", "PARKING", "PET_FRIENDLY"),
                    List.of(new DemoRoom("Pool Villa", "Two-bedroom villa with a private plunge pool.", 4, 2, "2 King beds", 120, 6, 18500, with(LUXURY_ROOM, "BALCONY")))),
            new DemoHotel("Panjim Heritage Inn", "Goa", "Goa", PropertyType.GUEST_HOUSE, 3, "Rua de Natal, Fontainhas, Panaji", 15.4977, 73.8318,
                    4.1, 540, "A restored Portuguese-era townhouse in the colourful Latin Quarter of Panaji.",
                    Set.of("FREE_WIFI", "RESTAURANT", "FRONT_DESK_24H"),
                    List.of(new DemoRoom("Heritage Double", "High ceilings and original tiles.", 2, 1, "1 Queen bed", 22, 10, 3200, BASIC_ROOM),
                            new DemoRoom("Family Room", "Room for the whole family.", 3, 2, "1 Queen bed + 2 Single beds", 32, 4, 4800, BASIC_ROOM))),
            new DemoHotel("Garden City Business Hotel", "Bengaluru", "Karnataka", PropertyType.HOTEL, 4, "Residency Road", 12.9716, 77.5946,
                    4.3, 890, "Modern business hotel near MG Road with fast Wi-Fi, meeting rooms and EV charging.",
                    Set.of("FREE_WIFI", "GYM", "RESTAURANT", "BUSINESS_CENTRE", "PARKING", "FRONT_DESK_24H", "EV_CHARGING"),
                    List.of(new DemoRoom("Executive King", "Large desk and ergonomic chair.", 2, 1, "1 King bed", 30, 40, 7400, with(COMFORT_ROOM, "CITY_VIEW")),
                            new DemoRoom("Business Twin", "Two beds for colleagues travelling together.", 2, 0, "2 Single beds", 28, 30, 6900, COMFORT_ROOM))),
            new DemoHotel("Indiranagar Studio Apartments", "Bengaluru", "Karnataka", PropertyType.APARTMENT, 3, "100 Feet Road, Indiranagar", 12.9784, 77.6408,
                    4.0, 210, "Serviced studios with kitchenettes in Bengaluru's café and nightlife district.",
                    Set.of("FREE_WIFI", "PARKING", "WHEELCHAIR_ACCESSIBLE"),
                    List.of(new DemoRoom("Studio", "Studio with kitchenette and washing machine.", 2, 1, "1 Queen bed", 35, 15, 4200, with(BASIC_ROOM, "WORK_DESK")))),
            new DemoHotel("Koramangala Backpackers", "Bengaluru", "Karnataka", PropertyType.HOSTEL, null, "5th Block, Koramangala", 12.9352, 77.6245,
                    3.9, 460, "A friendly hostel with a rooftop common room and simple private rooms.",
                    Set.of("FREE_WIFI", "FRONT_DESK_24H"),
                    List.of(new DemoRoom("Private Double", "Compact private room with shared lounge access.", 2, 0, "1 Double bed", 14, 10, 1800, Set.of("AIR_CONDITIONING")))),
            new DemoHotel("Marine Drive Palace", "Mumbai", "Maharashtra", PropertyType.HOTEL, 5, "Netaji Subhash Chandra Bose Road", 18.9440, 72.8236,
                    4.6, 1210, "Art-deco landmark on the Queen's Necklace with a rooftop pool and sunset bar.",
                    Set.of("POOL", "SPA", "GYM", "RESTAURANT", "BAR", "FREE_WIFI", "ROOM_SERVICE", "FRONT_DESK_24H"),
                    List.of(new DemoRoom("Deluxe City View", "Elegant room overlooking the city.", 2, 1, "1 King bed", 32, 50, 14500, with(LUXURY_ROOM, "CITY_VIEW")),
                            new DemoRoom("Ocean View Suite", "Corner suite with views of the Arabian Sea.", 2, 2, "1 King bed + sofa bed", 60, 12, 26000, with(LUXURY_ROOM, "SEA_VIEW", "BALCONY")))),
            new DemoHotel("Juhu Sands Hotel", "Mumbai", "Maharashtra", PropertyType.HOTEL, 4, "Juhu Tara Road", 19.1000, 72.8270,
                    4.2, 640, "Beachfront hotel close to the airport with a pool facing Juhu Beach.",
                    Set.of("POOL", "RESTAURANT", "FREE_WIFI", "BEACH_ACCESS", "AIRPORT_SHUTTLE"),
                    List.of(new DemoRoom("Superior Room", "Comfortable room, partial sea view.", 2, 1, "1 King bed", 26, 35, 8200, with(COMFORT_ROOM, "SEA_VIEW")))),
            new DemoHotel("Connaught Grand", "New Delhi", "Delhi", PropertyType.HOTEL, 5, "Barakhamba Road, Connaught Place", 28.6328, 77.2197,
                    4.5, 980, "Grand hotel in the heart of New Delhi, walking distance to Connaught Place.",
                    Set.of("POOL", "SPA", "GYM", "RESTAURANT", "BAR", "FREE_WIFI", "BUSINESS_CENTRE", "FRONT_DESK_24H"),
                    List.of(new DemoRoom("Premier Room", "Spacious room with marble bathroom.", 2, 1, "1 King bed", 34, 45, 12500, LUXURY_ROOM),
                            new DemoRoom("Club Suite", "Suite with club lounge access.", 2, 2, "1 King bed + sofa bed", 58, 10, 22000, with(LUXURY_ROOM, "CITY_VIEW")))),
            new DemoHotel("Aerocity Transit Hotel", "New Delhi", "Delhi", PropertyType.HOTEL, 3, "Aerocity, near IGI Airport", 28.5530, 77.1190,
                    4.0, 720, "Practical hotel five minutes from the airport, ideal for early flights.",
                    Set.of("FREE_WIFI", "AIRPORT_SHUTTLE", "RESTAURANT", "FRONT_DESK_24H", "GYM"),
                    List.of(new DemoRoom("Standard Queen", "Quiet, soundproofed room.", 2, 1, "1 Queen bed", 22, 60, 5200, COMFORT_ROOM))),
            new DemoHotel("Pink City Haveli", "Jaipur", "Rajasthan", PropertyType.GUEST_HOUSE, 4, "Johari Bazaar Road", 26.9220, 75.8200,
                    4.6, 410, "A restored haveli with painted courtyards, a few minutes from the Hawa Mahal.",
                    Set.of("FREE_WIFI", "RESTAURANT", "POOL", "PARKING"),
                    List.of(new DemoRoom("Heritage Room", "Hand-painted walls and carved furniture.", 2, 1, "1 King bed", 26, 12, 6800, COMFORT_ROOM),
                            new DemoRoom("Maharaja Suite", "Suite with a private jharokha balcony.", 2, 2, "1 King bed", 50, 3, 13500, with(LUXURY_ROOM, "BALCONY")))),
            new DemoHotel("Amber Hills Resort", "Jaipur", "Rajasthan", PropertyType.RESORT, 5, "Amer Road", 26.9800, 75.8450,
                    4.5, 260, "Hillside resort with cottages and views of Amber Fort.",
                    Set.of("POOL", "SPA", "RESTAURANT", "BAR", "FREE_WIFI", "PARKING", "KIDS_CLUB"),
                    List.of(new DemoRoom("Garden Cottage", "Cottage with a private sit-out.", 2, 2, "1 King bed", 48, 18, 15500, with(LUXURY_ROOM, "BALCONY")))),
            new DemoHotel("Marina Bay Hotel", "Chennai", "Tamil Nadu", PropertyType.HOTEL, 4, "Kamarajar Salai", 13.0560, 80.2780,
                    4.2, 530, "Sea-facing hotel on the Marina with a large outdoor pool.",
                    Set.of("POOL", "GYM", "RESTAURANT", "FREE_WIFI", "BEACH_ACCESS", "PARKING"),
                    List.of(new DemoRoom("Deluxe Sea Facing", "Floor-to-ceiling windows facing the sea.", 2, 1, "1 King bed", 30, 30, 7800, with(COMFORT_ROOM, "SEA_VIEW")))),
            new DemoHotel("Backwater Retreat", "Kochi", "Kerala", PropertyType.RESORT, 4, "Vypeen Island Road", 9.9400, 76.2600,
                    4.5, 300, "Calm lagoon-side retreat with Ayurvedic spa and sunset boat rides.",
                    Set.of("POOL", "SPA", "RESTAURANT", "FREE_WIFI", "PARKING", "AIRPORT_SHUTTLE"),
                    List.of(new DemoRoom("Lagoon Cottage", "Cottage on the water's edge.", 2, 2, "1 King bed", 40, 14, 9800, with(COMFORT_ROOM, "BALCONY")))),
            new DemoHotel("Fort Kochi Homestay", "Kochi", "Kerala", PropertyType.GUEST_HOUSE, 3, "Princess Street, Fort Kochi", 9.9650, 76.2430,
                    4.3, 190, "Family-run homestay with home-cooked Kerala breakfast.",
                    Set.of("FREE_WIFI", "RESTAURANT"),
                    List.of(new DemoRoom("Courtyard Double", "Opens onto a quiet courtyard.", 2, 1, "1 Queen bed", 20, 6, 2900, BASIC_ROOM))),
            new DemoHotel("Lake Pichola Palace", "Udaipur", "Rajasthan", PropertyType.HOTEL, 5, "Lake Pichola Road", 24.5760, 73.6800,
                    4.8, 450, "Palace hotel on the shore of Lake Pichola with views of the City Palace.",
                    Set.of("POOL", "SPA", "RESTAURANT", "BAR", "FREE_WIFI", "ROOM_SERVICE"),
                    List.of(new DemoRoom("Lake View Room", "Wake up to the lake and the Aravalli hills.", 2, 1, "1 King bed", 36, 20, 16500, with(LUXURY_ROOM, "BALCONY")),
                            new DemoRoom("Royal Suite", "Two rooms, antique furniture, lake terrace.", 2, 2, "1 King bed + sofa bed", 70, 5, 32000, with(LUXURY_ROOM, "BALCONY")))));
}
