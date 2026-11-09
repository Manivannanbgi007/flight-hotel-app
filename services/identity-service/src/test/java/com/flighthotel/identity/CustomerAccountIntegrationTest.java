package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

import com.jayway.jsonpath.JsonPath;

/** API_DOCUMENTATION.md §3: profile, photo, saved passengers, preferences, password change, logout everywhere. */
class CustomerAccountIntegrationTest extends IdentityIntegrationTest {

    private static final String FUTURE = LocalDate.now().plusYears(5).toString();

    @Test
    void updateProfile() throws Exception {
        Session session = newCustomer("profile");

        mockMvc.perform(put("/api/customers/profile").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName":"Asha ","lastName":"Rao-Iyer","phone":"+919876543210",
                                 "dateOfBirth":"1994-05-17","nationality":"IN"}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.firstName").value("Asha"))
                .andExpect(jsonPath("$.lastName").value("Rao-Iyer"))
                .andExpect(jsonPath("$.phone").value("+919876543210"))
                .andExpect(jsonPath("$.dateOfBirth").value("1994-05-17"))
                .andExpect(jsonPath("$.nationality").value("IN"))
                .andExpect(jsonPath("$.memberSince").exists());

        mockMvc.perform(put("/api/customers/profile").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"firstName\":\"Asha\",\"lastName\":\"Rao\",\"phone\":\"12ab\",\"nationality\":\"india\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[?(@.field == 'phone')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'nationality')]").exists());

        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'identity' "
                        + "AND aggregate_id = :id AND event_type LIKE '%UserProfileUpdated'")
                .param("id", session.userId()).query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void passengersAreMaskedEncryptedAndPrivate() throws Exception {
        Session owner = newCustomer("passengers");
        Session stranger = newCustomer("stranger");

        String body = mockMvc.perform(post("/api/customers/passengers").with(bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"passengerType":"ADULT","firstName":"Asha","lastName":"Rao","dateOfBirth":"1994-05-17",
                                 "gender":"FEMALE","nationality":"IN","passportNumber":"Z1234567",
                                 "passportExpiry":"%s","passportCountry":"IN"}""".formatted(FUTURE)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.hasPassport").value(true))
                .andExpect(jsonPath("$.passportNumberMasked").value("••••4567"))
                .andExpect(jsonPath("$.passportNumber").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");

        String stored = jdbcClient.sql("SELECT passport_number_enc FROM customer_passengers WHERE id = UUID_TO_BIN(:id)")
                .param("id", id).query(String.class).single();
        assertThat(stored).as("passport encrypted at rest").doesNotContain("Z1234567").startsWith("v1:");

        // Another customer cannot see, change or delete it (404, not 403: its existence is not revealed).
        mockMvc.perform(put("/api/customers/passengers/" + id).with(bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passengerType\":\"ADULT\",\"firstName\":\"X\",\"lastName\":\"Y\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PASSENGER_NOT_FOUND"));
        mockMvc.perform(delete("/api/customers/passengers/" + id).with(bearer(stranger)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/customers/passengers").with(bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // Update without a passport number keeps the stored passport.
        mockMvc.perform(put("/api/customers/passengers/" + id).with(bearer(owner)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passengerType\":\"ADULT\",\"firstName\":\"Asha\",\"lastName\":\"Rao Iyer\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastName").value("Rao Iyer"))
                .andExpect(jsonPath("$.passportNumberMasked").value("••••4567"));

        // removePassport deletes it.
        mockMvc.perform(put("/api/customers/passengers/" + id).with(bearer(owner)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passengerType\":\"ADULT\",\"firstName\":\"Asha\",\"lastName\":\"Rao\",\"removePassport\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasPassport").value(false))
                .andExpect(jsonPath("$.passportNumberMasked").doesNotExist());

        mockMvc.perform(delete("/api/customers/passengers/" + id).with(bearer(owner)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/customers/passengers").with(bearer(owner)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void passportDetailsMustBeComplete() throws Exception {
        Session session = newCustomer("passport");

        mockMvc.perform(post("/api/customers/passengers").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passengerType\":\"ADULT\",\"firstName\":\"Asha\",\"lastName\":\"Rao\",\"passportNumber\":\"Z1234567\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("PASSPORT_DETAILS_INCOMPLETE"));

        mockMvc.perform(post("/api/customers/passengers").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"passengerType":"ADULT","firstName":"Asha","lastName":"Rao","passportNumber":"z12-34",
                                 "passportExpiry":"2001-01-01","passportCountry":"IN"}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[?(@.field == 'passportNumber')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'passportExpiry')]").exists());
    }

    @Test
    void atMostTwentyPassengers() throws Exception {
        Session session = newCustomer("limit");
        for (int i = 0; i < 20; i++) {
            mockMvc.perform(post("/api/customers/passengers").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"passengerType\":\"CHILD\",\"firstName\":\"Kid\",\"lastName\":\"Rao\"}"))
                    .andExpect(status().isCreated());
        }
        mockMvc.perform(post("/api/customers/passengers").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passengerType\":\"CHILD\",\"firstName\":\"Kid\",\"lastName\":\"Rao\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("PASSENGER_LIMIT_REACHED"))
                .andExpect(jsonPath("$.details.limit").value(20));
    }

    @Test
    void travelPreferences() throws Exception {
        Session session = newCustomer("prefs");

        mockMvc.perform(get("/api/customers/preferences").with(bearer(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferredCurrency").value("INR"))
                .andExpect(jsonPath("$.newsletterOptIn").value(false));

        mockMvc.perform(put("/api/customers/preferences").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"preferredCabin":"BUSINESS","homeAirport":"BLR","seatPreference":"WINDOW",
                                 "mealPreference":"VEGETARIAN","preferredCurrency":"INR","newsletterOptIn":true}"""))
                .andExpect(status().isOk());
        // Saving twice updates the same row.
        mockMvc.perform(put("/api/customers/preferences").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"preferredCabin\":\"FIRST\",\"homeAirport\":\"DEL\",\"preferredCurrency\":\"INR\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/customers/preferences").with(bearer(session)))
                .andExpect(jsonPath("$.preferredCabin").value("FIRST"))
                .andExpect(jsonPath("$.homeAirport").value("DEL"))
                .andExpect(jsonPath("$.newsletterOptIn").value(false));

        mockMvc.perform(put("/api/customers/preferences").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"homeAirport\":\"bangalore\",\"preferredCurrency\":\"USD\",\"seatPreference\":\"ROOF\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void profilePhotoIsResizedReEncodedAndPrivate() throws Exception {
        Session session = newCustomer("photo");

        mockMvc.perform(multipart(HttpMethod.PUT, "/api/customers/profile/photo")
                        .file(new MockMultipartFile("file", "me.png", "image/png", png(1200, 600)))
                        .with(bearer(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasPhoto").value(true));

        byte[] stored = mockMvc.perform(get("/api/customers/profile/photo").with(bearer(session)))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_JPEG))
                .andReturn().getResponse().getContentAsByteArray();
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(stored));
        assertThat(image.getWidth()).isEqualTo(512);
        assertThat(image.getHeight()).isEqualTo(256);

        // A text file named .jpg is refused by content.
        mockMvc.perform(multipart(HttpMethod.PUT, "/api/customers/profile/photo")
                        .file(new MockMultipartFile("file", "evil.jpg", "image/jpeg", "<script>alert(1)</script>".getBytes()))
                        .with(bearer(session)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_IMAGE"));

        mockMvc.perform(delete("/api/customers/profile/photo").with(bearer(session)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/customers/profile/photo").with(bearer(session)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROFILE_PHOTO_NOT_FOUND"));
    }

    @Test
    void changePasswordKeepsThisSessionAndEndsTheOthers() throws Exception {
        Session laptop = newCustomer("change-password");
        Session phone = login(laptop.email(), PASSWORD);

        mockMvc.perform(post("/api/customers/security/change-password").with(bearer(laptop))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"Wrong2026Password\",\"newPassword\":\"Changed2026Pass\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("CURRENT_PASSWORD_INCORRECT"));

        String body = mockMvc.perform(post("/api/customers/security/change-password").with(bearer(laptop))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + PASSWORD + "\",\"newPassword\":\"Changed2026Pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").exists())
                .andReturn().getResponse().getContentAsString();
        String newToken = JsonPath.read(body, "$.accessToken");

        mockMvc.perform(get("/api/customers/profile").with(bearer(newToken))).andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(laptop.refreshCookie())).andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(phone.refreshCookie()))
                .andExpect(status().isUnauthorized());
        assertThat(lastEmail(laptop.email(), "PASSWORD_CHANGED")).isNotNull();
    }

    @Test
    void logoutEverywhere() throws Exception {
        Session laptop = newCustomer("logout-all");
        Session phone = login(laptop.email(), PASSWORD);

        mockMvc.perform(post("/api/customers/security/logout-all").with(bearer(laptop)))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/customers/profile").with(bearer(laptop))).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/customers/profile").with(bearer(phone))).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(phone.refreshCookie()))
                .andExpect(status().isUnauthorized());
    }

    private static byte[] png(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.ORANGE);
        graphics.fillRect(0, 0, width / 2, height);
        graphics.dispose();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return bytes.toByteArray();
    }
}
