package com.flighthotel.identity.controller;

import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.dto.AdminUserDtos.AdminUserResponse;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserRolesRequest;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserStatusRequest;
import com.flighthotel.identity.dto.AdminUserDtos.CreateStaffUserRequest;
import com.flighthotel.identity.entity.UserStatus;
import com.flighthotel.identity.service.AdminUserService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/admin/users")
@Tag(name = "Admin: Users")
public class AdminUserController {

    private final AdminUserService adminUserService;

    public AdminUserController(AdminUserService adminUserService) {
        this.adminUserService = adminUserService;
    }

    @GetMapping
    @Operation(summary = "Search users by email/name, role and status (ADMIN)")
    public PageResponse<AdminUserResponse> search(@RequestParam(required = false) String search,
            @RequestParam(required = false) String role, @RequestParam(required = false) UserStatus status,
            @PageableDefault(size = 20) Pageable pageable) {
        return adminUserService.search(search, role, status, pageable);
    }

    @GetMapping("/{id}")
    @Operation(summary = "One user (ADMIN)")
    public AdminUserResponse get(@PathVariable UUID id) {
        return adminUserService.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a staff account; the person receives a 'set your password' email (ADMIN)")
    public AdminUserResponse create(@Valid @RequestBody CreateStaffUserRequest request) {
        return adminUserService.create(request);
    }

    @PatchMapping("/{id}/status")
    @Operation(summary = "Activate or deactivate a user; deactivation ends all sessions immediately (ADMIN)")
    public AdminUserResponse changeStatus(@PathVariable UUID id, @Valid @RequestBody ChangeUserStatusRequest request) {
        return adminUserService.changeStatus(id, request);
    }

    @PutMapping("/{id}/roles")
    @Operation(summary = "Replace a user's roles (ADMIN)")
    public AdminUserResponse changeRoles(@PathVariable UUID id, @Valid @RequestBody ChangeUserRolesRequest request) {
        return adminUserService.changeRoles(id, request);
    }
}
