package com.flighthotel.common.crypto;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypts sensitive values (passport numbers, private signing keys) before they are stored.
 * <p>
 * AES-256-GCM with a random 96-bit IV per value; GCM also detects tampering. Stored format:
 * {@code v1:<base64(iv || ciphertext+tag)>}. The {@code v1} prefix allows a future key/algorithm rotation.
 * <p>
 * The 32-byte key comes from {@code DATA_ENCRYPTION_KEY} (locally {@code .env}, in production a secrets manager).
 */
public class FieldEncryptor {

    private static final String PREFIX = "v1:";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public FieldEncryptor(String base64Key) {
        byte[] keyBytes;
        try {
            keyBytes = Base64.getDecoder().decode(base64Key == null ? "" : base64Key.trim());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("DATA_ENCRYPTION_KEY is not valid base64", ex);
        }
        if (keyBytes.length != 32) {
            throw new IllegalStateException(
                    "DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate: openssl rand -base64 32)");
        }
        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    public String encrypt(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] combined = ByteBuffer.allocate(iv.length + ciphertext.length).put(iv).put(ciphertext).array();
            return PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Encryption failed", ex);
        }
    }

    public String decrypt(String stored) {
        if (stored == null) {
            return null;
        }
        if (!stored.startsWith(PREFIX)) {
            throw new IllegalStateException("Unknown encrypted value format");
        }
        try {
            byte[] combined = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, combined, 0, IV_BYTES));
            byte[] plaintext = cipher.doFinal(combined, IV_BYTES, combined.length - IV_BYTES);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            // Wrong key or tampered data. Never include the value in the message.
            throw new IllegalStateException("Decryption failed", ex);
        }
    }
}
