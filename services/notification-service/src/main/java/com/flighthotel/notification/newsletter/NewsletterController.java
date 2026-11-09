package com.flighthotel.notification.newsletter;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.notification.newsletter.NewsletterService.Result;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Public newsletter endpoints (no login; rate limited at the gateway). */
@RestController
@RequestMapping("/api/newsletter")
@Tag(name = "Newsletter", description = "Subscribe (double opt-in), confirm, unsubscribe")
public class NewsletterController {

    static final String SENT = "If this address can receive our newsletter, we have sent it a confirmation link.";

    private final NewsletterService newsletter;

    public NewsletterController(NewsletterService newsletter) {
        this.newsletter = newsletter;
    }

    public record SubscribeRequest(@NotBlank @Email @Size(max = 254) String email) {
    }

    public record TokenRequest(@NotBlank @Size(max = 200) String token) {
    }

    @PostMapping("/subscribe")
    @Operation(summary = "Ask for the newsletter: a confirmation link is e-mailed (same answer for every address)")
    public ResponseEntity<Map<String, String>> subscribe(@Valid @RequestBody SubscribeRequest request) {
        newsletter.subscribe(request.email());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("message", SENT));
    }

    @PostMapping("/confirm")
    @Operation(summary = "Confirm with the token of the e-mailed link")
    public Result confirm(@Valid @RequestBody TokenRequest request) {
        return newsletter.confirm(request.token());
    }

    @PostMapping("/unsubscribe")
    @Operation(summary = "Unsubscribe with the token of the link in every newsletter e-mail")
    public Result unsubscribe(@Valid @RequestBody TokenRequest request) {
        return newsletter.unsubscribe(request.token());
    }
}
