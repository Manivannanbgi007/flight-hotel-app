package com.flighthotel.identity.service.impl;

import org.springframework.stereotype.Component;

import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.identity.config.IdentityProperties;

/**
 * Profile photos: validated and re-encoded by common-lib's {@link ImageProcessor} (format from the bytes,
 * decompression-bomb guard, metadata removed), resized to {@code identity.photo.max-dimension}.
 */
@Component
public class ProfilePhotoProcessor {

    private final ImageProcessor imageProcessor;
    private final IdentityProperties properties;

    public ProfilePhotoProcessor(ImageProcessor imageProcessor, IdentityProperties properties) {
        this.imageProcessor = imageProcessor;
        this.properties = properties;
    }

    /** @return the re-encoded JPEG */
    public byte[] process(byte[] content) {
        return imageProcessor.process(content, properties.photo().maxBytes(), properties.photo().maxDimension())
                .getFirst().jpeg();
    }
}
