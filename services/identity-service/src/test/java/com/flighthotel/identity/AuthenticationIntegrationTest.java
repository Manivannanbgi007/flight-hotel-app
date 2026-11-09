package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;

import com.flighthotel.events.identity.AuthEmailRequested;
import com.jayway.jsonpath.JsonPath;

import jakarta.servlet.http.Cookie;

/** API_DOCUMENTATION.md §2: registration, verification, login, refresh rotation, logout, password reset. */
class AuthenticationIntegrationTest extends IdentityIntegrationTest {

    @Test
    void registerVerifyAndLogIn() throws Exception {
        String email = uniqueEmail("asha");
        register(email, PASSWORD);

        // Not verified yet: the right password gets a clear message, but no session.
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));

        AuthEmailRequested verification = lastEmail(email, "VERIFY_EMAIL");
        assertThat(verification.getToken()).hasSize(43);
        assertThat(Duration.between(verification.getRequestedAt(), verification.getExpiresAt()))
                .isCloseTo(Duration.ofHours(24), Duration.ofSeconds(5));
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM email_verification_tokens WHERE token_hash = :raw")
                .param("raw", verification.getToken()).query(Long.class).single())
                .as("only the hash is stored").isZero();

        verify(verification.getToken());
        verify(verification.getToken()); // clicking the link twice is fine
        assertThat(lastEmail(email, "WELCOME")).isNotNull();

        MockHttpServletResponse response = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email.toUpperCase() + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.email").value(email))
                .andExpect(jsonPath("$.user.roles[0]").value("CUSTOMER"))
                .andExpect(jsonPath("$.user.emailVerified").value(true))
                .andReturn().getResponse();

        String setCookie = response.getHeader(HttpHeaders.SET_COOKIE);
        assertThat(setCookie).contains("fh_refresh=", "HttpOnly", "SameSite=Strict", "Path=/api/auth");
        assertThat(setCookie).as("no remember-me → session cookie").doesNotContain("Max-Age");

        String accessToken = JsonPath.read(response.getContentAsString(), "$.accessToken");
        mockMvc.perform(get("/api/customers/profile").with(bearer(accessToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.firstName").value("Asha"));
    }

    @Test
    void registeringAnExistingEmailLooksTheSameButWarnsTheOwner() throws Exception {
        Session existing = newCustomer("existing");

        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                        {"email":"%s","password":"Another2026Pass","firstName":"Eve","lastName":"X","acceptTerms":true}
                        """.formatted(existing.email())))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.message").value("If this email can be used, we have sent a verification link to it."));

        assertThat(lastEmail(existing.email(), "ACCOUNT_EXISTS")).isNotNull();
        // The original password still works; the attempt changed nothing.
        login(existing.email(), PASSWORD);
    }

    @Test
    void registrationIsValidated() throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                        {"email":"not-an-email","password":"short","firstName":"1nvalid","lastName":"","acceptTerms":false}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[?(@.field == 'email')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'password')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'firstName')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'acceptTerms')]").exists());

        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("""
                        {"email":"%s","password":"onlyletters","firstName":"Asha","lastName":"Rao","acceptTerms":true}
                        """.formatted(uniqueEmail("weak"))))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("WEAK_PASSWORD"))
                .andExpect(jsonPath("$.details.rules[0]").value("DIGIT"));
    }

    @Test
    void wrongPasswordAndUnknownEmailGiveTheSameAnswer() throws Exception {
        Session session = newCustomer("same-answer");

        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + session.email() + "\",\"password\":\"Wrong2026Password\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.detail").value("Wrong email or password"));

        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody-" + System.nanoTime() + "@example.com\",\"password\":\"Wrong2026Password\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.detail").value("Wrong email or password"));
    }

    @Test
    void fiveFailedLoginsLockTheAccount() throws Exception {
        Session session = newCustomer("lockout");
        for (int attempt = 1; attempt <= 4; attempt++) {
            mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"email\":\"" + session.email() + "\",\"password\":\"Wrong2026Password\"}"))
                    .andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + session.email() + "\",\"password\":\"Wrong2026Password\"}"))
                .andExpect(status().isLocked())
                .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
                .andExpect(jsonPath("$.details.lockedUntil").exists());

        // Even the right password is refused while locked.
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + session.email() + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isLocked());

        // Every attempt is in the login history the user can see.
        mockMvc.perform(get("/api/customers/security/login-history?size=20").with(bearer(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(7))
                .andExpect(jsonPath("$.content[0].success").value(false))
                .andExpect(jsonPath("$.content[0].failureReason").value("ACCOUNT_LOCKED"));
    }

    @Test
    void refreshNeedsTheAntiCsrfHeaderAndRotatesTheCookie() throws Exception {
        Session session = newCustomer("refresh");

        mockMvc.perform(post("/api/auth/refresh").cookie(session.refreshCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_CHECK_FAILED"));

        MockHttpServletResponse response = mockMvc.perform(post("/api/auth/refresh").with(xhr())
                        .cookie(session.refreshCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(session.email()))
                .andReturn().getResponse();
        Cookie rotated = response.getCookie(REFRESH_COOKIE);
        assertThat(rotated).isNotNull();
        assertThat(rotated.getValue()).isNotEqualTo(session.refreshCookie().getValue());
        assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).as("remember me: 30 days").contains("Max-Age=2592000");

        String newAccessToken = JsonPath.read(response.getContentAsString(), "$.accessToken");
        mockMvc.perform(get("/api/customers/profile").with(bearer(newAccessToken))).andExpect(status().isOk());
    }

    @Test
    void secondTabRefreshingAtTheSameTimeIsAllowed() throws Exception {
        Session session = newCustomer("two-tabs");
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(session.refreshCookie()))
                .andExpect(status().isOk());

        // The other tab still sends the old cookie a moment later: it gets an access token but no new cookie.
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(session.refreshCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").exists())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
    }

    @Test
    void reusingARotatedRefreshTokenEndsTheWholeSession() throws Exception {
        Session session = newCustomer("reuse");
        Cookie stolen = session.refreshCookie();
        Cookie current = mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(stolen))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie(REFRESH_COOKIE);

        Thread.sleep(2_200); // past the 2 s grace period of the test configuration

        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(stolen))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("SESSION_EXPIRED"))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));

        // The legitimate user's newest token was revoked with the family.
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(current))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("SESSION_EXPIRED"));
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM refresh_tokens WHERE revoke_reason = 'REUSE_DETECTED' "
                        + "AND user_id = UUID_TO_BIN(:userId)")
                .param("userId", session.userId()).query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void logoutEndsTheSessionAndRevokesTheAccessToken() throws Exception {
        Session session = newCustomer("logout");

        mockMvc.perform(post("/api/auth/logout").with(xhr()).with(bearer(session)).cookie(session.refreshCookie()))
                .andExpect(status().isNoContent())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));

        mockMvc.perform(get("/api/customers/profile").with(bearer(session)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(session.refreshCookie()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void forgotAndResetPassword() throws Exception {
        Session session = newCustomer("reset");

        mockMvc.perform(post("/api/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + session.email() + "\"}"))
                .andExpect(status().isAccepted());
        // Unknown emails get the same answer and no email.
        mockMvc.perform(post("/api/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ghost-" + System.nanoTime() + "@example.com\"}"))
                .andExpect(status().isAccepted());

        AuthEmailRequested reset = lastEmail(session.email(), "RESET_PASSWORD");
        assertThat(Duration.between(reset.getRequestedAt(), reset.getExpiresAt()))
                .isCloseTo(Duration.ofHours(1), Duration.ofSeconds(5));

        mockMvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + reset.getToken() + "\",\"newPassword\":\"password1234\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("WEAK_PASSWORD"));

        mockMvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + reset.getToken() + "\",\"newPassword\":\"Brand2026NewPass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Password changed. Please log in."));

        // The link works once, every old session is gone, and only the new password works.
        mockMvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + reset.getToken() + "\",\"newPassword\":\"Another2026Pass\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_OR_EXPIRED_TOKEN"));
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(session.refreshCookie()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/customers/profile").with(bearer(session)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + session.email() + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isUnauthorized());
        login(session.email(), "Brand2026NewPass");
        assertThat(lastEmail(session.email(), "PASSWORD_CHANGED")).isNotNull();
    }

    @Test
    void invalidVerificationTokenIsRejected() throws Exception {
        mockMvc.perform(post("/api/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"not-a-real-token\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_OR_EXPIRED_TOKEN"));
    }

    @Test
    void jwksPublishesTheKeyThatSignsAccessTokens() throws Exception {
        Session session = newCustomer("jwks");
        String header = new String(Base64.getUrlDecoder().decode(session.accessToken().split("\\.")[0]));
        String kid = JsonPath.read(header, "$.kid");

        mockMvc.perform(get("/.well-known/jwks.json"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.keys[?(@.kid == '" + kid + "')].alg").value("RS256"))
                .andExpect(jsonPath("$.keys[0].d").doesNotExist());

        String claims = new String(Base64.getUrlDecoder().decode(session.accessToken().split("\\.")[1]));
        assertThat((String) JsonPath.read(claims, "$.iss")).isEqualTo("flight-hotel-identity");
        assertThat((String) JsonPath.read(claims, "$.sid")).isNotBlank();
        assertThat((java.util.List<String>) JsonPath.read(claims, "$.roles")).containsExactly("CUSTOMER");
    }

    @Test
    void protectedEndpointsNeedAValidToken() throws Exception {
        mockMvc.perform(get("/api/customers/profile"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(get("/api/customers/profile").with(bearer("eyJhbGciOiJSUzI1NiJ9.e30.c2lnbmF0dXJl")))
                .andExpect(status().isUnauthorized());
    }
}
