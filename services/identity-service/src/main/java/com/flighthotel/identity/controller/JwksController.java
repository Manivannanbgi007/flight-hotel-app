package com.flighthotel.identity.controller;

import java.time.Duration;
import java.util.Map;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.identity.security.SigningKeyService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** Public keys that verify access tokens. Read by the gateway and every service (cached by them). */
@RestController
@Tag(name = "Authentication")
public class JwksController {

    private final SigningKeyService signingKeys;

    public JwksController(SigningKeyService signingKeys) {
        this.signingKeys = signingKeys;
    }

    @GetMapping("/.well-known/jwks.json")
    @Operation(summary = "JSON Web Key Set (public keys only)")
    public ResponseEntity<Map<String, Object>> jwks() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .body(signingKeys.publicJwks());
    }
}
