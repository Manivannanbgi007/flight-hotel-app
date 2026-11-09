package com.flighthotel.identity.controller;

import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.dto.AuthDtos.AuthResponse;
import com.flighthotel.identity.dto.CustomerDtos.ChangePasswordRequest;
import com.flighthotel.identity.dto.CustomerDtos.LoginHistoryResponse;
import com.flighthotel.identity.service.AuthService;
import com.flighthotel.identity.service.CustomerAccountService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/customers/security")
@Tag(name = "My account: Security")
public class CustomerSecurityController {

    private final AuthService authService;
    private final CustomerAccountService accountService;
    private final RefreshTokenCookies cookies;

    public CustomerSecurityController(AuthService authService, CustomerAccountService accountService,
            RefreshTokenCookies cookies) {
        this.authService = authService;
        this.accountService = accountService;
        this.cookies = cookies;
    }

    @PostMapping("/change-password")
    @Operation(summary = "Change my password; every other session is logged out, this one gets a new access token")
    public AuthResponse changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        return authService.changePassword(request).response();
    }

    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Log out on every device, including this one")
    public void logoutAll(HttpServletResponse response) {
        authService.logoutEverywhere();
        cookies.clear(response);
    }

    @GetMapping("/login-history")
    @Operation(summary = "My recent logins and failed login attempts, newest first")
    public PageResponse<LoginHistoryResponse> loginHistory(@PageableDefault(size = 10) Pageable pageable) {
        return accountService.loginHistory(pageable);
    }
}
