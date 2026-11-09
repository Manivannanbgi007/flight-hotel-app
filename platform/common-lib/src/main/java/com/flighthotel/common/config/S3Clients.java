package com.flighthotel.common.config;

import java.net.URI;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;

/** Builds the S3 client of {@code S3FileStorage} from {@code travel.storage.s3.*}. */
public final class S3Clients {

    private S3Clients() {
    }

    public static S3Client create(CommonProperties.S3 settings) {
        S3ClientBuilder builder = S3Client.builder()
                .region(Region.of(settings.region()))
                .httpClient(UrlConnectionHttpClient.create())
                .forcePathStyle(settings.pathStyle());
        if (settings.endpoint() != null && !settings.endpoint().isBlank()) {
            builder.endpointOverride(URI.create(settings.endpoint()));
        }
        if (settings.accessKey() != null && !settings.accessKey().isBlank()) {
            builder.credentialsProvider(StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(settings.accessKey(), settings.secretKey())));
        } else {
            builder.credentialsProvider(DefaultCredentialsProvider.builder().build());
        }
        return builder.build();
    }
}
