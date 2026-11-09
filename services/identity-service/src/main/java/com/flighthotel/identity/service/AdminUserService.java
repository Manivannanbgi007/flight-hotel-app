package com.flighthotel.identity.service;

import java.util.UUID;

import org.springframework.data.domain.Pageable;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.dto.AdminUserDtos.AdminUserResponse;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserRolesRequest;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserStatusRequest;
import com.flighthotel.identity.dto.AdminUserDtos.CreateStaffUserRequest;
import com.flighthotel.identity.entity.UserStatus;

/** User administration (API_DOCUMENTATION.md §4). Role ADMIN only. */
public interface AdminUserService {

    PageResponse<AdminUserResponse> search(String search, String role, UserStatus status, Pageable pageable);

    AdminUserResponse get(UUID id);

    /** Creates the account and emails a "set your password" invitation. */
    AdminUserResponse create(CreateStaffUserRequest request);

    AdminUserResponse changeStatus(UUID id, ChangeUserStatusRequest request);

    AdminUserResponse changeRoles(UUID id, ChangeUserRolesRequest request);
}
