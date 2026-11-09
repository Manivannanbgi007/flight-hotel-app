package com.flighthotel.identity.service;

import com.flighthotel.identity.dto.AuthDtos.AuthResponse;
import com.flighthotel.identity.dto.AuthDtos.LoginRequest;
import com.flighthotel.identity.dto.AuthDtos.RegisterRequest;
import com.flighthotel.identity.dto.AuthDtos.ResetPasswordRequest;
import com.flighthotel.identity.dto.CustomerDtos.ChangePasswordRequest;
import com.flighthotel.identity.service.impl.SessionService.NewRefreshToken;

/** Registration, login, sessions and password management (API_DOCUMENTATION.md §2 and §3.4). */
public interface AuthService {

    void register(RegisterRequest request);

    void verifyEmail(String token);

    void resendVerification(String email);

    AuthResult login(LoginRequest request);

    AuthResult refresh(String refreshToken);

    /** @param accessToken the caller's bearer token (may be expired or null); revoked if still valid */
    void logout(String refreshToken, String accessToken);

    void requestPasswordReset(String email);

    void resetPassword(ResetPasswordRequest request);

    AuthResult changePassword(ChangePasswordRequest request);

    void logoutEverywhere();

    /** @param refreshToken new refresh token to put in the cookie, or null to leave the cookie unchanged */
    record AuthResult(AuthResponse response, NewRefreshToken refreshToken) {
    }
}
