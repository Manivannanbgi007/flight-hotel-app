package com.flighthotel.common.crypto;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * JPA converter that stores a String column encrypted: {@code @Convert(converter = EncryptedStringConverter.class)}.
 * <p>
 * Hibernate creates it through Spring, so the {@link FieldEncryptor} bean is injected. A service that uses it must
 * set {@code DATA_ENCRYPTION_KEY}, otherwise it fails at startup (on purpose: never store sensitive data in plain text).
 */
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    private final FieldEncryptor encryptor;

    public EncryptedStringConverter(FieldEncryptor encryptor) {
        this.encryptor = encryptor;
    }

    @Override
    public String convertToDatabaseColumn(String attribute) {
        return encryptor.encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        return encryptor.decrypt(dbData);
    }
}
