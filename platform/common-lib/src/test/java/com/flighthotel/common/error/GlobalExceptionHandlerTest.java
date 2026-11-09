package com.flighthotel.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new TestController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void notFoundHasStableCode() throws Exception {
        mockMvc.perform(get("/things/42"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_FOUND"))
                .andExpect(jsonPath("$.details.id").value("42"))
                .andExpect(jsonPath("$.timestamp").exists());
    }

    @Test
    void validationErrorsListEveryField() throws Exception {
        mockMvc.perform(post("/things").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("name"));
    }

    @Test
    void malformedJsonKeepsStandardFormat() throws Exception {
        mockMvc.perform(post("/things").contentType(MediaType.APPLICATION_JSON).content("{oops"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void unexpectedErrorsHideInternalDetails() throws Exception {
        mockMvc.perform(get("/boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.detail").value("Something went wrong. Please try again later."));
    }

    @RestController
    static class TestController {

        @GetMapping("/things/{id}")
        String find(@PathVariable String id) {
            throw new ResourceNotFoundException("Booking", id);
        }

        @PostMapping("/things")
        String create(@Valid @RequestBody CreateThing request) {
            return "ok";
        }

        @GetMapping("/boom")
        String boom() {
            throw new IllegalStateException("database password is hunter2");
        }
    }

    record CreateThing(@NotBlank String name) {
    }
}
