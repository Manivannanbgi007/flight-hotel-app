package com.flighthotel.hotel.support;

import java.nio.ByteBuffer;
import java.sql.Types;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.SqlParameterValue;

/** UUID ↔ BINARY(16) for plain SQL (same byte order Hibernate uses for JPA entities). */
public final class Uuids {

    private Uuids() {
    }

    public static byte[] toBytes(UUID uuid) {
        return ByteBuffer.allocate(16).putLong(uuid.getMostSignificantBits()).putLong(uuid.getLeastSignificantBits())
                .array();
    }

    public static UUID fromBytes(byte[] bytes) {
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        return new UUID(buffer.getLong(), buffer.getLong());
    }

    /** A BINARY(16) query parameter (typed, so it is never mistaken for a list of values). */
    public static SqlParameterValue param(UUID uuid) {
        return new SqlParameterValue(Types.BINARY, toBytes(uuid));
    }

    /** For {@code column IN (:ids)}. */
    public static List<SqlParameterValue> params(Collection<UUID> uuids) {
        return uuids.stream().map(Uuids::param).toList();
    }
}
