package com.flighthotel.payment.provider;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** HMAC-SHA256 as the providers use it for signatures, with a constant-time comparison. */
public final class Signatures {

    private Signatures() {
    }

    public static String hmacSha256Hex(byte[] data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(data));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("HMAC-SHA256 is not available", ex);
        }
    }

    public static String hmacSha256Hex(String data, String secret) {
        return hmacSha256Hex(data.getBytes(StandardCharsets.UTF_8), secret);
    }

    /** True when {@code signature} is the hex HMAC of the data. Never reveals where the first difference is. */
    public static boolean matches(byte[] data, String secret, String signature) {
        if (secret == null || secret.isBlank() || signature == null) {
            return false;
        }
        byte[] expected = hmacSha256Hex(data, secret).getBytes(StandardCharsets.UTF_8);
        byte[] actual = signature.strip().toLowerCase(java.util.Locale.ROOT).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, actual);
    }
}
