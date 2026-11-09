package com.flighthotel.common.dev;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.UUID;

/**
 * <b>Development only.</b> Deterministic ids for the development seed ({@code DEV_SEED_ENABLED}): the same name always
 * gives the same id, so every service can refer to a seeded user, hotel or booking by id without asking the service
 * that owns it, and a second run of a seeder finds its rows again instead of creating duplicates.
 * <p>
 * Ids are name-based UUIDs (version 3): {@code UUID.nameUUIDFromBytes("dev-<kind>:<key>")}. For users the name is
 * {@code "dev-user:" + email}.
 */
public final class DevIds {

    /** No 0/O, 1/I/L: the same alphabet as the real booking references, hotel confirmation numbers and PNRs. */
    private static final char[] ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".toCharArray();

    private DevIds() {
    }

    /** The id of a full name such as {@code "dev-hotel:arabian-sands"}. */
    public static UUID of(String name) {
        return UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
    }

    /** {@code of("dev-" + kind + ":" + key)}, for example {@code of("booking", "h1")}. */
    public static UUID of(String kind, String key) {
        return of("dev-" + kind + ":" + key);
    }

    /** The id of a development account (email in lower case). */
    public static UUID user(String email) {
        return of("dev-user:" + email.trim().toLowerCase(Locale.ROOT));
    }

    /** The 16 bytes MySQL stores in a {@code BINARY(16)} id column. */
    public static byte[] bytes(UUID id) {
        return ByteBuffer.allocate(16).putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).array();
    }

    /**
     * A stable code for a seeded record: {@code prefix + length characters} from the readable alphabet, derived from
     * the key (for example booking reference {@code HT-DEV...}, confirmation number {@code H...}).
     */
    public static String code(String prefix, String key, int length) {
        byte[] hash = sha256("dev-code:" + prefix + ":" + key);
        StringBuilder code = new StringBuilder(prefix);
        for (int i = 0; i < length; i++) {
            code.append(ALPHABET[(hash[i] & 0xFF) % ALPHABET.length]);
        }
        return code.toString();
    }

    /** A stable string of decimal digits (ticket and order numbers). */
    public static String digits(String key, int length) {
        byte[] hash = sha256("dev-digits:" + key);
        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < length; i++) {
            digits.append((hash[i % hash.length] & 0xFF) % 10);
        }
        return digits.toString();
    }

    /** A stable lower-case hex string (provider order and payment ids). */
    public static String hex(String key, int length) {
        byte[] hash = sha256("dev-hex:" + key);
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }
        return hex.substring(0, length);
    }

    private static byte[] sha256(String text) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
