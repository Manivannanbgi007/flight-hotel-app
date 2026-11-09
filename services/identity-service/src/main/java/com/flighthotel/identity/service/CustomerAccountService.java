package com.flighthotel.identity.service;

import org.springframework.data.domain.Pageable;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.dto.CustomerDtos.LoginHistoryResponse;
import com.flighthotel.identity.dto.CustomerDtos.ProfileResponse;
import com.flighthotel.identity.dto.CustomerDtos.UpdateProfileRequest;

/** The logged-in user's own profile, photo and login history (API_DOCUMENTATION.md §3.1 and §3.4). */
public interface CustomerAccountService {

    ProfileResponse getProfile();

    ProfileResponse updateProfile(UpdateProfileRequest request);

    /** @param content the uploaded file; validated and re-encoded before it is stored */
    ProfileResponse updatePhoto(byte[] content);

    /** @return the stored JPEG */
    byte[] getPhoto();

    void deletePhoto();

    PageResponse<LoginHistoryResponse> loginHistory(Pageable pageable);
}
