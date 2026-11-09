package com.flighthotel.identity.service.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.identity.config.IdentityProperties;

class ProfilePhotoProcessorTest {

    private final ProfilePhotoProcessor processor = new ProfilePhotoProcessor(new ImageProcessor(), new IdentityProperties(null, null, null,
            null, new IdentityProperties.Photo(2 * 1024 * 1024, 512), null));

    @Test
    void smallImagesAreNotEnlargedAndTransparencyBecomesWhite() throws Exception {
        BufferedImage transparent = new BufferedImage(100, 80, BufferedImage.TYPE_INT_ARGB);
        BufferedImage result = ImageIO.read(new ByteArrayInputStream(processor.process(encode(transparent, "png"))));

        assertThat(result.getWidth()).isEqualTo(100);
        assertThat(result.getHeight()).isEqualTo(80);
        assertThat(result.getRGB(50, 40) & 0xFFFFFF).isGreaterThan(0xF0F0F0);
    }

    @Test
    void portraitIsScaledByItsHeight() throws Exception {
        byte[] jpeg = encode(new BufferedImage(600, 1200, BufferedImage.TYPE_INT_RGB), "jpg");
        BufferedImage result = ImageIO.read(new ByteArrayInputStream(processor.process(jpeg)));
        assertThat(result.getWidth()).isEqualTo(256);
        assertThat(result.getHeight()).isEqualTo(512);
    }

    @Test
    void formatIsDetectedFromTheBytes() {
        assertThat(ImageProcessor.detectFormat(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0})).isEqualTo("jpeg");
        assertThat(ImageProcessor.detectFormat("GIF89a....".getBytes())).isNull();
        assertThat(ImageProcessor.detectFormat("<svg xmlns=...>".getBytes())).isNull();
    }

    @Test
    void decompressionBombIsRejectedBeforeDecoding() throws Exception {
        // A PNG header that claims 50000 x 50000 pixels (2.5 gigapixels) in a few bytes.
        byte[] png = encode(new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), "png");
        writeInt(png, 16, 50_000);
        writeInt(png, 20, 50_000);

        ApiException error = catchThrowableOfType(ApiException.class, () -> processor.process(png));
        assertThat(error.getCode()).isEqualTo("INVALID_IMAGE");
    }

    @Test
    void tooLargeFilesAreRejected() {
        byte[] big = new byte[2 * 1024 * 1024 + 1];
        big[0] = (byte) 0xFF;
        ApiException error = catchThrowableOfType(ApiException.class, () -> processor.process(big));
        assertThat(error.getCode()).isEqualTo("FILE_TOO_LARGE");
        assertThat(error.getStatus().value()).isEqualTo(413);
    }

    private static byte[] encode(BufferedImage image, String format) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, format, bytes);
        return bytes.toByteArray();
    }

    private static void writeInt(byte[] bytes, int offset, int value) {
        bytes[offset] = (byte) (value >>> 24);
        bytes[offset + 1] = (byte) (value >>> 16);
        bytes[offset + 2] = (byte) (value >>> 8);
        bytes[offset + 3] = (byte) value;
    }
}
