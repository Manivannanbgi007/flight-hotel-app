package com.flighthotel.hotel.search;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.hotel.support.Uuids;

/** Reference points for "distance from" (city centre, airport, beach). */
@Component
public class LandmarkStore {

    private final JdbcClient jdbc;

    public LandmarkStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** The city centre of a destination typed by the user ("goa", "Goa"), if we know the city. */
    public Optional<Landmark> cityCentre(String city) {
        return jdbc.sql("SELECT * FROM landmarks WHERE LOWER(city) = :city AND landmark_type = 'CITY_CENTRE' LIMIT 1")
                .param("city", city.trim().toLowerCase(Locale.ROOT))
                .query((rs, i) -> map(rs))
                .optional();
    }

    public List<Landmark> inCity(String city) {
        return jdbc.sql("SELECT * FROM landmarks WHERE LOWER(city) = :city ORDER BY landmark_type, name")
                .param("city", city.trim().toLowerCase(Locale.ROOT))
                .query((rs, i) -> map(rs))
                .list();
    }

    public void add(String city, String name, String type, double latitude, double longitude) {
        jdbc.sql("""
                        INSERT INTO landmarks (id, city, name, landmark_type, latitude, longitude)
                        VALUES (:id, :city, :name, :type, :lat, :lon)""")
                .param("id", Uuids.param(UuidV7.generate()))
                .param("city", city)
                .param("name", name)
                .param("type", type)
                .param("lat", BigDecimal.valueOf(latitude))
                .param("lon", BigDecimal.valueOf(longitude))
                .update();
    }

    public long count() {
        return jdbc.sql("SELECT COUNT(*) FROM landmarks").query(Long.class).single();
    }

    private static Landmark map(ResultSet rs) throws SQLException {
        return new Landmark(Uuids.fromBytes(rs.getBytes("id")), rs.getString("city"), rs.getString("name"),
                rs.getString("landmark_type"), rs.getDouble("latitude"), rs.getDouble("longitude"));
    }

    public record Landmark(UUID id, String city, String name, String type, double latitude, double longitude) {

        /** Great-circle distance in km (haversine). */
        public double distanceKmTo(double lat, double lon) {
            double earthRadiusKm = 6371.0;
            double dLat = Math.toRadians(lat - latitude);
            double dLon = Math.toRadians(lon - longitude);
            double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(latitude))
                    * Math.cos(Math.toRadians(lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
    }
}
