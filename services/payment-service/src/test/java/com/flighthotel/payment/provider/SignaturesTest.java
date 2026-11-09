package com.flighthotel.payment.provider;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

/** HMAC-SHA256 signatures as Razorpay (and the demo provider) use them for checkout callbacks and webhooks. */
class SignaturesTest {

    private static final byte[] BODY = "{\"event\":\"payment.captured\"}".getBytes(StandardCharsets.UTF_8);

    @Test
    void producesTheStandardHmacSha256() {
        // The well-known HMAC-SHA256 example value.
        assertThat(Signatures.hmacSha256Hex("The quick brown fox jumps over the lazy dog", "key"))
                .isEqualTo("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    }

    @Test
    void acceptsTheRightSignatureWrittenAnyWay() {
        String signature = Signatures.hmacSha256Hex(BODY, "webhook-secret");
        assertThat(Signatures.matches(BODY, "webhook-secret", signature)).isTrue();
        assertThat(Signatures.matches(BODY, "webhook-secret", signature.toUpperCase())).isTrue();
        assertThat(Signatures.matches(BODY, "webhook-secret", "  " + signature + "\n")).isTrue();
    }

    @Test
    void refusesEveryOtherSignature() {
        String signature = Signatures.hmacSha256Hex(BODY, "webhook-secret");
        assertThat(Signatures.matches(BODY, "other-secret", signature)).isFalse();
        assertThat(Signatures.matches("{\"event\":\"payment.failed\"}".getBytes(StandardCharsets.UTF_8),
                "webhook-secret", signature)).isFalse();
        assertThat(Signatures.matches(BODY, "webhook-secret", signature.substring(0, 63))).isFalse();
        assertThat(Signatures.matches(BODY, "webhook-secret", signature + "0")).isFalse();
        assertThat(Signatures.matches(BODY, "webhook-secret", "")).isFalse();
        assertThat(Signatures.matches(BODY, "webhook-secret", null)).isFalse();
    }

    @Test
    void withoutASecretNothingIsEverAccepted() {
        // A missing webhook secret in the configuration must never open the door.
        String signature = Signatures.hmacSha256Hex(BODY, "webhook-secret");
        assertThat(Signatures.matches(BODY, "", signature)).isFalse();
        assertThat(Signatures.matches(BODY, "   ", signature)).isFalse();
        assertThat(Signatures.matches(BODY, null, signature)).isFalse();
    }
}
