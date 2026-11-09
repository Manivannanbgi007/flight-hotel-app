package com.flighthotel.common.image;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;

/**
 * Makes an uploaded image safe to store and show (profile photos, hotel photos):
 * <ul>
 *   <li>the format is detected from the bytes (JPEG or PNG), never from the file name or Content-Type,</li>
 *   <li>the size is read from the header first, so a tiny "decompression bomb" cannot use up memory,</li>
 *   <li>every requested size is re-encoded as JPEG, which also removes hidden metadata (GPS location, camera data)
 *       and anything appended to the file.</li>
 * </ul>
 */
public class ImageProcessor {

    /** 40 megapixels: far above any phone camera; larger "images" are rejected before decoding. */
    private static final long MAX_SOURCE_PIXELS = 40_000_000L;
    private static final float JPEG_QUALITY = 0.85f;

    public ImageProcessor() {
        ImageIO.setUseCache(false);
    }

    /**
     * @param maxBytes      largest accepted upload
     * @param maxDimensions one output per value: the longer side is scaled down (never up) to it
     * @return the re-encoded JPEGs, in the order of {@code maxDimensions}
     */
    public List<ProcessedImage> process(byte[] content, int maxBytes, int... maxDimensions) {
        if (content == null || content.length == 0) {
            throw invalidImage();
        }
        if (content.length > maxBytes) {
            throw new ApiException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE",
                    "The image is too large. The maximum size is " + describeBytes(maxBytes) + ".");
        }
        String format = detectFormat(content);
        if (format == null) {
            throw invalidImage();
        }
        BufferedImage source = decode(content, format);
        List<ProcessedImage> results = new ArrayList<>(maxDimensions.length);
        for (int maxDimension : maxDimensions) {
            BufferedImage resized = resize(source, maxDimension);
            results.add(new ProcessedImage(encodeJpeg(resized), resized.getWidth(), resized.getHeight()));
        }
        return results;
    }

    /** "jpeg", "png" or null, from the file's magic bytes. */
    public static String detectFormat(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xD8 && (bytes[2] & 0xFF) == 0xFF) {
            return "jpeg";
        }
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
        if (bytes.length >= png.length) {
            for (int i = 0; i < png.length; i++) {
                if (bytes[i] != png[i]) {
                    return null;
                }
            }
            return "png";
        }
        return null;
    }

    /** Scales down (never up) keeping the aspect ratio; transparent areas become white. */
    public static BufferedImage resize(BufferedImage source, int maxDimension) {
        double scale = Math.min(1.0, (double) maxDimension / Math.max(source.getWidth(), source.getHeight()));
        int width = Math.max(1, (int) Math.round(source.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(source.getHeight() * scale));
        BufferedImage target = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = target.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, width, height);
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.drawImage(source, 0, 0, width, height, null);
        } finally {
            graphics.dispose();
        }
        return target;
    }

    public static byte[] encodeJpeg(BufferedImage image) {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ImageOutputStream output = ImageIO.createImageOutputStream(bytes)) {
            writer.setOutput(output);
            ImageWriteParam params = writer.getDefaultWriteParam();
            params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            params.setCompressionQuality(JPEG_QUALITY);
            writer.write(null, new IIOImage(image, null, null), params);
        } catch (IOException ex) {
            throw new IllegalStateException("Could not encode image", ex);
        } finally {
            writer.dispose();
        }
        return bytes.toByteArray();
    }

    private static BufferedImage decode(byte[] content, String format) {
        Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName(format);
        if (!readers.hasNext()) {
            throw new IllegalStateException("No image reader for " + format);
        }
        ImageReader reader = readers.next();
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(content))) {
            reader.setInput(input, true, true);
            long width = reader.getWidth(0);
            long height = reader.getHeight(0);
            if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
                throw invalidImage();
            }
            BufferedImage image = reader.read(0);
            if (image == null) {
                throw invalidImage();
            }
            return image;
        } catch (IOException | RuntimeException ex) {
            if (ex instanceof ApiException apiException) {
                throw apiException;
            }
            throw invalidImage();
        } finally {
            reader.dispose();
        }
    }

    private static String describeBytes(int bytes) {
        return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)) + " MB" : (bytes / 1024) + " KB";
    }

    private static BusinessRuleException invalidImage() {
        return new BusinessRuleException("INVALID_IMAGE", "Please upload a JPEG or PNG image.");
    }

    /** A re-encoded JPEG and its size in pixels. */
    public record ProcessedImage(byte[] jpeg, int width, int height) {
    }
}
