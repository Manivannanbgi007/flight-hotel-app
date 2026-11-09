package com.flighthotel.identity.controller;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.identity.dto.AuthDtos.AuthResponse;
import com.flighthotel.identity.dto.AuthDtos.EmailRequest;
import com.flighthotel.identity.dto.AuthDtos.LoginRequest;
import com.flighthotel.identity.dto.AuthDtos.MessageResponse;
import com.flighthotel.identity.dto.AuthDtos.RegisterRequest;
import com.flighthotel.identity.dto.AuthDtos.ResetPasswordRequest;
import com.flighthotel.identity.dto.AuthDtos.TokenRequest;
import com.flighthotel.identity.exception.IdentityErrors.SessionExpiredException;
import com.flighthotel.identity.service.AuthService;
import com.flighthotel.identity.service.AuthService.AuthResult;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

/**
 * Public authentication endpoints (API_DOCUMENTATION.md §2). Answers that could reveal whether an email is registered
 * are always the same.
 */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "Authentication", description = "Registration, login, sessions and password reset (public)")
public class AuthController {

    static final MessageResponse REGISTERED =
            new MessageResponse("If this email can be used, we have sent a verification link to it.");
    static final MessageResponse VERIFIED = new MessageResponse("Email verified. You can log in now.");
    static final MessageResponse VERIFICATION_RESENT =
            new MessageResponse("If this account is waiting for verification, we have sent a new link.");
    static final MessageResponse RESET_REQUESTED =
            new MessageResponse("If an account exists for this email, we have sent a password reset link.");
    static final MessageResponse PASSWORD_RESET = new MessageResponse("Password changed. Please log in.");

    private static final String BEARER_PREFIX = "Bearer ";

    private final AuthService authService;
    private final RefreshTokenCookies cookies;

    public AuthController(AuthService authService, RefreshTokenCookies cookies) {
        this.authService = authService;
        this.cookies = cookies;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Create a customer account and send a verification email")
    public MessageResponse register(@Valid @RequestBody RegisterRequest request) {
        authService.register(request);
        return REGISTERED;
    }

    @PostMapping("/verify-email")
    @Operation(summary = "Confirm the email address with the token from the verification link")
    public MessageResponse verifyEmail(@Valid @RequestBody TokenRequest request) {
        authService.verifyEmail(request.token());
        return VERIFIED;
    }

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Send a new verification link (at most one per minute)")
    public MessageResponse resendVerification(@Valid @RequestBody EmailRequest request) {
        authService.resendVerification(request.email());
        return VERIFICATION_RESENT;
    }

    @PostMapping("/login")
    @Operation(summary = "Log in; returns an access token and sets the refresh-token cookie")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletResponse response) {
        AuthResult result = authService.login(request);
        cookies.write(response, result.refreshToken());
        return result.response();
    }

    @PostMapping("/refresh")
    @Operation(summary = "Exchange the refresh-token cookie for a new access token (rotates the cookie)",
            description = "Requires header X-Requested-With: XMLHttpRequest.")
    public AuthResponse refresh(HttpServletRequest request, HttpServletResponse response) {
        cookies.requireCsrfHeader(request);
        try {
            AuthResult result = authService.refresh(cookies.read(request));
            if (result.refreshToken() != null) {
                cookies.write(response, result.refreshToken());
            }
            return result.response();
        } catch (SessionExpiredException ex) {
            cookies.clear(response);
            throw ex;
        }
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "End this session and revoke the access token",
            description = "Requires header X-Requested-With: XMLHttpRequest.")
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        cookies.requireCsrfHeader(request);
        authService.logout(cookies.read(request), bearerToken(request));
        cookies.clear(response);
    }

    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Email a password reset link (if the account exists and is active)")
    public MessageResponse forgotPassword(@Valid @RequestBody EmailRequest request) {
        authService.requestPasswordReset(request.email());
        return RESET_REQUESTED;
    }

    @PostMapping("/reset-password")
    @Operation(summary = "Set a new password with a reset or invitation token; ends every session")
    public MessageResponse resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        authService.resetPassword(request);
        return PASSWORD_RESET;
    }

    /** Read here because the bearer-token filter ignores /api/auth/** (an expired token must not block logout). */
    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return header.substring(BEARER_PREFIX.length()).trim();
        }
        return null;
    }
}
