package com.flighthotel.notification.email;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.events.identity.AuthEmailRequested;

class AccountEmailComposerTest {

    private static final Instant NOW = Instant.parse("2026-11-05T10:00:00Z");

    private final AccountEmailComposer composer = new AccountEmailComposer(templateEngine(), new SystemSettings(),
            new EmailProperties("no-reply@flighthotel.local", "https://app.example.test/"));

    @ParameterizedTest
    @CsvSource({
            "VERIFY_EMAIL,       Verify your email address,             https://app.example.test/verify-email?token=tok_123",
            "RESET_PASSWORD,     Reset your password,                   https://app.example.test/reset-password?token=tok_123",
            "ACCOUNT_INVITATION, Your FlightHotel account is ready,     https://app.example.test/reset-password?token=tok_123&invite=1"
    })
    void linkEmailsContainTheTokenLink(String type, String subject, String link) {
        EmailContent email = composer.compose(request(type, "tok_123", Duration.ofHours(24)));

        assertThat(email.subject()).isEqualTo(subject);
        assertThat(email.html()).contains("href=\"" + link.replace("&", "&amp;") + "\"");
        assertThat(email.text()).contains(link).contains("This link is valid for 24 hours.").startsWith("Hello Asha,");
    }

    /** Phase 11: a staff invitation leads to the sign-in of the role; an unknown value is left out. */
    @ParameterizedTest
    @CsvSource({
            "admin,         https://app.example.test/reset-password?token=tok_123&invite=1&portal=admin",
            "hotel-manager, https://app.example.test/reset-password?token=tok_123&invite=1&portal=hotel-manager",
            "support,       https://app.example.test/reset-password?token=tok_123&invite=1&portal=support",
            "'x\"><a',      https://app.example.test/reset-password?token=tok_123&invite=1"
    })
    void staffInvitationsLeadToTheirOwnSignIn(String portal, String link) {
        AuthEmailRequested request = request("ACCOUNT_INVITATION", "tok_123", Duration.ofHours(72));
        request.setPortal(portal);
        EmailContent email = composer.compose(request);

        assertThat(email.html()).contains("href=\"" + link.replace("&", "&amp;") + "\"");
        assertThat(email.text()).contains(link + "\n");
    }

    @ParameterizedTest
    @CsvSource({
            "PASSWORD_CHANGED, Your password was changed,               https://app.example.test/forgot-password",
            "ACCOUNT_EXISTS,   You already have a FlightHotel account,  https://app.example.test/login",
            "WELCOME,          Welcome to FlightHotel,                  https://app.example.test/"
    })
    void notificationEmailsHaveNoToken(String type, String subject, String link) {
        EmailContent email = composer.compose(request(type, null, null));

        assertThat(email.subject()).isEqualTo(subject);
        assertThat(email.html()).contains("href=\"" + link + "\"").doesNotContain("valid for");
    }

    @Test
    void userInputIsEscaped() {
        AuthEmailRequested request = request("WELCOME", null, null);
        request.setFirstName("<img src=x onerror=alert(1)>");

        assertThat(composer.compose(request).html()).doesNotContain("<img").contains("&lt;img src=x onerror=alert(1)&gt;");
    }

    @Test
    void linkEmailWithoutTokenIsAProgrammingError() {
        assertThatThrownBy(() -> composer.compose(request("RESET_PASSWORD", null, Duration.ofHours(1))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> composer.compose(request("NEWSLETTER", null, null)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void describesValidity() {
        assertThat(AccountEmailComposer.describe(Duration.ofHours(1))).isEqualTo("1 hour");
        assertThat(AccountEmailComposer.describe(Duration.ofMinutes(59).plusSeconds(59))).isEqualTo("1 hour");
        assertThat(AccountEmailComposer.describe(Duration.ofHours(24))).isEqualTo("24 hours");
        assertThat(AccountEmailComposer.describe(Duration.ofHours(72))).isEqualTo("3 days");
        assertThat(AccountEmailComposer.describe(Duration.ofMinutes(10))).isEqualTo("10 minutes");
    }

    private static AuthEmailRequested request(String type, String token, Duration validity) {
        return AuthEmailRequested.newBuilder()
                .setUserId("0192f0c4-8a7e-7c3a-9f1e-3b7f1c2d4e5a")
                .setEmail("asha@example.com")
                .setFirstName("Asha")
                .setEmailType(type)
                .setToken(token)
                .setExpiresAt(validity == null ? null : NOW.plus(validity))
                .setRequestedAt(NOW)
                .build();
    }

    private static SpringTemplateEngine templateEngine() {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding("UTF-8");
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(resolver);
        return engine;
    }
}
