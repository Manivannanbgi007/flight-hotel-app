package com.flighthotel.common.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings shared by all business services, under the {@code travel.*} prefix.
 *
 * @param security JWT validation and public endpoints
 * @param kafka    Avro / Schema Registry and consumer error handling
 * @param outbox   outbox table housekeeping
 * @param realtime realtime (auto refresh) publishing
 * @param logging  service call logging
 */
@ConfigurationProperties("travel")
public record CommonProperties(
        @DefaultValue Security security,
        @DefaultValue Kafka kafka,
        @DefaultValue Outbox outbox,
        @DefaultValue Realtime realtime,
        @DefaultValue Logging logging,
        @DefaultValue Storage storage) {

    /**
     * @param jwkSetUri              where identity-service publishes its public keys
     * @param issuer                 expected {@code iss} claim
     * @param publicPaths            endpoints that need no token; optional HTTP method prefix, e.g. {@code "GET /api/hotels/**"}
     * @param maxAccessTokenLifetime longest possible access token lifetime (how long revocations must be remembered)
     * @param dataEncryptionKey      base64 AES-256 key for {@code EncryptedStringConverter}; only set in services that
     *                               store encrypted fields
     */
    public record Security(
            @DefaultValue("http://localhost:8101/.well-known/jwks.json") String jwkSetUri,
            @DefaultValue("flight-hotel-identity") String issuer,
            @DefaultValue List<String> publicPaths,
            @DefaultValue("15m") Duration maxAccessTokenLifetime,
            String dataEncryptionKey) {
    }

    /**
     * @param type      {@code local} (development, Docker) or {@code s3} (production)
     * @param localRoot folder for {@code LocalFileStorage}
     * @param s3        bucket settings for {@code S3FileStorage}
     */
    public record Storage(
            @DefaultValue("local") String type,
            @DefaultValue("./storage") String localRoot,
            @DefaultValue S3 s3) {
    }

    /**
     * @param bucket    private bucket (no public access)
     * @param region    e.g. {@code ap-south-1}
     * @param prefix    key prefix inside the bucket, e.g. the service name
     * @param endpoint  only for S3-compatible stores (MinIO in tests); empty = AWS
     * @param pathStyle path-style URLs (MinIO); AWS uses virtual-hosted style
     * @param accessKey static credentials (tests, MinIO); empty = the AWS default chain (ECS task role)
     * @param secretKey see {@code accessKey}
     */
    public record S3(String bucket, @DefaultValue("ap-south-1") String region, String prefix, String endpoint,
            @DefaultValue("false") boolean pathStyle, String accessKey, String secretKey) {
    }

    /**
     * @param schemaRegistryUrl   Confluent Schema Registry URL ({@code mock://...} in unit tests)
     * @param autoRegisterSchemas register new schema versions automatically (true locally, false in production
     *                            where CI registers schemas)
     * @param maxRetries          retries before a message goes to the dead-letter topic
     * @param retryBackoff        first retry delay (doubles each time)
     */
    public record Kafka(
            @DefaultValue("http://localhost:8081") String schemaRegistryUrl,
            @DefaultValue("true") boolean autoRegisterSchemas,
            @DefaultValue("3") int maxRetries,
            @DefaultValue("1s") Duration retryBackoff) {
    }

    /** @param retention published outbox rows older than this are deleted by the daily cleanup job */
    public record Outbox(
            @DefaultValue("7d") Duration retention,
            @DefaultValue("0 30 3 * * *") String cleanupCron) {
    }

    /** @param channel Redis Pub/Sub channel read by the realtime hub */
    public record Realtime(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("realtime:messages") String channel) {
    }

    /** @param slowServiceCall service calls slower than this are logged at WARN */
    public record Logging(@DefaultValue("1s") Duration slowServiceCall) {
    }
}
