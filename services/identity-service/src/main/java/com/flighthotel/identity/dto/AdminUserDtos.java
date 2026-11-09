package com.flighthotel.identity.dto;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.flighthotel.identity.entity.UserStatus;

/** Request and response bodies of /api/admin/users (see API_DOCUMENTATION.md §4). */
public final class AdminUserDtos {

    private AdminUserDtos() {
    }

    public record AdminUserResponse(UUID id, String email, String firstName, String lastName, UserStatus status,
                                    Set<String> roles, boolean emailVerified, Instant lastLoginAt, Instant createdAt) {
    }

    public record CreateStaffUserRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String firstName,
            @NotBlank @Pattern(regexp = AuthDtos.NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String lastName,
            @NotEmpty Set<@NotBlank String> roles) {
    }

    public record ChangeUserStatusRequest(@NotNull UserStatus status, @Size(max = 255) String reason) {
    }

    public record ChangeUserRolesRequest(@NotEmpty Set<@NotBlank String> roles) {
    }
}
