package com.flighthotel.identity.service.impl;

import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.dto.CustomerDtos.LoginHistoryResponse;
import com.flighthotel.identity.dto.CustomerDtos.ProfileResponse;
import com.flighthotel.identity.dto.CustomerDtos.UpdateProfileRequest;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.exception.IdentityErrors.SessionExpiredException;
import com.flighthotel.identity.mapper.IdentityMapper;
import com.flighthotel.identity.messaging.IdentityEventPublisher;
import com.flighthotel.identity.repository.LoginHistoryRepository;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.service.CustomerAccountService;

@Service
public class CustomerAccountServiceImpl implements CustomerAccountService {

    private static final Logger log = LoggerFactory.getLogger(CustomerAccountServiceImpl.class);
    static final String PHOTO_FOLDER = "profile-photos";
    private static final int MAX_HISTORY_PAGE_SIZE = 50;

    private final UserRepository users;
    private final LoginHistoryRepository loginHistory;
    private final FileStorage fileStorage;
    private final ProfilePhotoProcessor photoProcessor;
    private final IdentityEventPublisher events;
    private final AuditPublisher audit;
    private final IdentityMapper mapper;

    public CustomerAccountServiceImpl(UserRepository users, LoginHistoryRepository loginHistory, FileStorage fileStorage,
            ProfilePhotoProcessor photoProcessor, IdentityEventPublisher events, AuditPublisher audit,
            IdentityMapper mapper) {
        this.users = users;
        this.loginHistory = loginHistory;
        this.fileStorage = fileStorage;
        this.photoProcessor = photoProcessor;
        this.events = events;
        this.audit = audit;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    public ProfileResponse getProfile() {
        return mapper.toProfile(currentUser());
    }

    @Override
    @Transactional
    public ProfileResponse updateProfile(UpdateProfileRequest request) {
        User user = currentUser();
        user.setFirstName(request.firstName().trim());
        user.setLastName(request.lastName().trim());
        user.setPhone(blankToNull(request.phone()));
        user.setDateOfBirth(request.dateOfBirth());
        user.setNationality(blankToNull(request.nationality()));
        users.saveAndFlush(user);
        events.profileUpdated(user);
        return mapper.toProfile(user);
    }

    @Override
    @Transactional
    public ProfileResponse updatePhoto(byte[] content) {
        byte[] jpeg = photoProcessor.process(content);
        User user = currentUser();
        String oldKey = user.getProfilePhotoKey();
        String newKey = fileStorage.store(PHOTO_FOLDER, "jpg", jpeg);
        // The database decides: keep the new file only if the change commits, and only then delete the old one.
        afterCompletion(newKey, oldKey);
        user.setProfilePhotoKey(newKey);
        users.saveAndFlush(user);
        audit.record("PROFILE_PHOTO_CHANGED", "USER", user.getId().toString(), Map.of());
        return mapper.toProfile(user);
    }

    @Override
    @Transactional(readOnly = true)
    public byte[] getPhoto() {
        User user = currentUser();
        if (user.getProfilePhotoKey() == null) {
            throw new ResourceNotFoundException("Profile photo", user.getId());
        }
        return fileStorage.load(user.getProfilePhotoKey())
                .orElseThrow(() -> new ResourceNotFoundException("Profile photo", user.getId()));
    }

    @Override
    @Transactional
    public void deletePhoto() {
        User user = currentUser();
        String oldKey = user.getProfilePhotoKey();
        if (oldKey == null) {
            return;
        }
        afterCompletion(null, oldKey);
        user.setProfilePhotoKey(null);
        users.saveAndFlush(user);
        audit.record("PROFILE_PHOTO_REMOVED", "USER", user.getId().toString(), Map.of());
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponse<LoginHistoryResponse> loginHistory(Pageable pageable) {
        Pageable page = PageRequest.of(pageable.getPageNumber(), Math.min(pageable.getPageSize(), MAX_HISTORY_PAGE_SIZE));
        return PageResponse.from(loginHistory.findByUserIdOrderByOccurredAtDesc(currentUserId(), page),
                mapper::toLoginHistory);
    }

    private User currentUser() {
        return users.findWithRolesById(currentUserId()).orElseThrow(SessionExpiredException::new);
    }

    private static UUID currentUserId() {
        return CurrentUser.require().id();
    }

    /**
     * Commit → delete the replaced file. Rollback → delete the file we just wrote. A failed delete only leaves an
     * orphaned file behind; it never breaks the request.
     */
    private void afterCompletion(String newKey, String oldKey) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                String obsolete = status == STATUS_COMMITTED ? oldKey : newKey;
                if (obsolete != null) {
                    try {
                        fileStorage.delete(obsolete);
                    } catch (RuntimeException ex) {
                        log.warn("Could not delete obsolete profile photo key={}", obsolete, ex);
                    }
                }
            }
        });
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
