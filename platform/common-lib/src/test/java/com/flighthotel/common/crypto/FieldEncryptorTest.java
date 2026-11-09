package com.flighthotel.common.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Base64;

import org.junit.jupiter.api.Test;

class FieldEncryptorTest {

    private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);
    private final FieldEncryptor encryptor = new FieldEncryptor(KEY);

    @Test
    void roundTripsAndNeverStoresPlaintext() {
        String stored = encryptor.encrypt("Z1234567");

        assertThat(stored).startsWith("v1:").doesNotContain("Z1234567");
        assertThat(encryptor.decrypt(stored)).isEqualTo("Z1234567");
    }

    @Test
    void sameValueEncryptsDifferentlyEachTime() {
        assertThat(encryptor.encrypt("Z1234567")).isNotEqualTo(encryptor.encrypt("Z1234567"));
    }

    @Test
    void detectsTamperingAndWrongKeys() {
        String stored = encryptor.encrypt("Z1234567");
        char last = stored.charAt(stored.length() - 2);
        String tampered = stored.substring(0, stored.length() - 2) + (last == 'A' ? 'B' : 'A') + stored.charAt(stored.length() - 1);
        byte[] otherKey = new byte[32];
        otherKey[0] = 1;

        assertThatThrownBy(() -> encryptor.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new FieldEncryptor(Base64.getEncoder().encodeToString(otherKey)).decrypt(stored))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsKeysOfTheWrongSize() {
        assertThatThrownBy(() -> new FieldEncryptor(Base64.getEncoder().encodeToString(new byte[16])))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("32-byte");
        assertThatThrownBy(() -> new FieldEncryptor(""))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void nullsStayNull() {
        assertThat(encryptor.encrypt(null)).isNull();
        assertThat(encryptor.decrypt(null)).isNull();
    }
}
