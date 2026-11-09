package com.flighthotel.identity.service.impl;

import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.dto.AdminUserDtos.AdminUserResponse;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserRolesRequest;
import com.flighthotel.identity.dto.AdminUserDtos.ChangeUserStatusRequest;
import com.flighthotel.identity.dto.AdminUserDtos.CreateStaffUserRequest;
import com.flighthotel.identity.entity.PasswordResetToken;
import com.flighthotel.identity.entity.ResetTokenPurpose;
import com.flighthotel.identity.entity.RevokeReason;
import com.flighthotel.identity.entity.Role;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.entity.UserStatus;
import com.flighthotel.identity.mapper.IdentityMapper;
import com.flighthotel.identity.messaging.IdentityEventPublisher;
import com.flighthotel.identity.messaging.IdentityEventPublisher.AuthEmailType;
import com.flighthotel.identity.repository.PasswordResetTokenRepository;
import com.flighthotel.identity.repository.RoleRepository;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.repository.UserSpecifications;
import com.flighthotel.identity.security.SecureTokens;
import com.flighthotel.identity.service.AdminUserService;

@Service
@PreAuthorize("hasRole('ADMIN')")
public class AdminUserServiceImpl implements AdminUserService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.desc("createdAt"));
    private static final Set<String> SORTABLE = Set.of("createdAt", "email", "firstName", "lastName", "lastLoginAt",
            "status");
    private static final Set<String> KNOWN_ROLES = Set.of(Roles.CUSTOMER, Roles.ADMIN, Roles.HOTEL_MANAGER,
            Roles.SUPPORT_AGENT);

    private final UserRepository users;
    private final RoleRepository roles;
    private final PasswordResetTokenRepository resetTokens;
    private final PasswordEncoder passwordEncoder;
    private final SessionService sessions;
    private final IdentityEventPublisher events;
    private final AuditPublisher audit;
    private final IdentityMapper mapper;
    private final IdentityProperties properties;
    private final Clock clock;

    public AdminUserServiceImpl(UserRepository users, RoleRepository roles, PasswordResetTokenRepository resetTokens,
            PasswordEncoder passwordEncoder, SessionService sessions, IdentityEventPublisher events,
            AuditPublisher audit, IdentityMapper mapper, IdentityProperties properties, Clock clock) {
        this.users = users;
        this.roles = roles;
        this.resetTokens = resetTokens;
        this.passwordEncoder = passwordEncoder;
        this.sessions = sessions;
        this.events = events;
        this.audit = audit;
        this.mapper = mapper;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponse<AdminUserResponse> search(String search, String role, UserStatus status, Pageable pageable) {
        Specification<User> filter = Specification.allOf(
                UserSpecifications.matchesSearch(search),
                UserSpecifications.hasRole(role),
                UserSpecifications.hasStatus(status));
        return PageResponse.from(users.findAll(filter, safePage(pageable)), mapper::toAdminUser);
    }

    @Override
    @Transactional(readOnly = true)
    public AdminUserResponse get(UUID id) {
        return mapper.toAdminUser(find(id));
    }

    @Override
    @Transactional
    public AdminUserResponse create(CreateStaffUserRequest request) {
        String email = User.normalizeEmail(request.email());
        if (users.existsByEmail(email)) {
            throw new ConflictException("EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
        }
        Instant now = clock.instant();
        // Nobody knows this password; the person chooses their own through the invitation link.
        User user = new User(email, passwordEncoder.encode(SecureTokens.generate()), request.firstName().trim(),
                request.lastName().trim(), null, UserStatus.PENDING_VERIFICATION, resolveRoles(request.roles()), now);
        users.saveAndFlush(user);

        String rawToken = SecureTokens.generate();
        Instant expiresAt = now.plus(properties.tokens().invitationTtl());
        resetTokens.save(new PasswordResetToken(user.getId(), SecureTokens.sha256Hex(rawToken),
                ResetTokenPurpose.ACCOUNT_INVITATION, expiresAt, now));

        events.userRegistered(user);
        events.requestEmail(user, AuthEmailType.ACCOUNT_INVITATION, rawToken, expiresAt);
        audit.record("USER_CREATED", "USER", user.getId().toString(), Map.of("roles", String.join(",", user.roleNames())));
        return mapper.toAdminUser(user);
    }

    @Override
    @Transactional
    public AdminUserResponse changeStatus(UUID id, ChangeUserStatusRequest request) {
        if (request.status() == UserStatus.PENDING_VERIFICATION) {
            throw new BusinessRuleException("INVALID_STATUS", "The status can only be set to ACTIVE or DEACTIVATED");
        }
        AuthenticatedUser admin = CurrentUser.require();
        if (admin.id().equals(id)) {
            throw cannotChangeOwnAccount();
        }
        User user = find(id);
        UserStatus before = user.getStatus();
        if (request.status() == UserStatus.DEACTIVATED) {
            if (before == UserStatus.DEACTIVATED) {
                return mapper.toAdminUser(user);
            }
            user.deactivate();
            sessions.endAll(user.getId(), RevokeReason.DEACTIVATED);
        } else {
            if (before != UserStatus.DEACTIVATED) {
                return mapper.toAdminUser(user);
            }
            user.activate();
        }
        users.saveAndFlush(user);

        String reason = request.reason() == null ? "" : request.reason().trim();
        events.statusChanged(user, reason.isEmpty() ? null : reason, admin.id().toString());
        Map<String, String> details = new LinkedHashMap<>();
        details.put("from", before.name());
        details.put("to", user.getStatus().name());
        if (!reason.isEmpty()) {
            details.put("reason", reason);
        }
        audit.record(user.getStatus() == UserStatus.DEACTIVATED ? "USER_DEACTIVATED" : "USER_ACTIVATED", "USER",
                user.getId().toString(), details);
        return mapper.toAdminUser(user);
    }

    @Override
    @Transactional
    public AdminUserResponse changeRoles(UUID id, ChangeUserRolesRequest request) {
        AuthenticatedUser admin = CurrentUser.require();
        Set<Role> newRoles = resolveRoles(request.roles());
        if (admin.id().equals(id) && newRoles.stream().noneMatch(role -> Roles.ADMIN.equals(role.getName()))) {
            throw cannotChangeOwnAccount();
        }
        User user = find(id);
        Set<String> before = user.roleNames();
        user.replaceRoles(newRoles);
        if (before.equals(user.roleNames())) {
            return mapper.toAdminUser(user);
        }
        users.saveAndFlush(user);
        // Tokens still carry the old roles; make the browser refresh to get new ones.
        sessions.invalidateAccessTokens(user.getId());
        events.rolesChanged(user, admin.id().toString());
        audit.record("USER_ROLES_CHANGED", "USER", user.getId().toString(),
                Map.of("from", String.join(",", before), "to", String.join(",", user.roleNames())));
        return mapper.toAdminUser(user);
    }

    private User find(UUID id) {
        return users.findWithRolesById(id).orElseThrow(() -> new ResourceNotFoundException("User", id));
    }

    private Set<Role> resolveRoles(Set<String> names) {
        Set<String> requested = new TreeSet<>();
        names.forEach(name -> requested.add(name.trim().toUpperCase(java.util.Locale.ROOT)));
        List<String> unknown = requested.stream().filter(name -> !KNOWN_ROLES.contains(name)).toList();
        if (!unknown.isEmpty()) {
            throw new BusinessRuleException("UNKNOWN_ROLE", "Unknown role: " + String.join(", ", unknown),
                    Map.of("allowed", List.copyOf(new TreeSet<>(KNOWN_ROLES))));
        }
        return new HashSet<>(roles.findByNameIn(requested));
    }

    /** Only whitelisted sort fields (an arbitrary property name would be a 500, or worse, a data leak). */
    private static Pageable safePage(Pageable pageable) {
        Sort sort = Sort.by(pageable.getSort().stream().filter(order -> SORTABLE.contains(order.getProperty())).toList());
        return PageRequest.of(pageable.getPageNumber(), Math.min(Math.max(pageable.getPageSize(), 1), MAX_PAGE_SIZE),
                sort.isSorted() ? sort : DEFAULT_SORT);
    }

    private static BusinessRuleException cannotChangeOwnAccount() {
        return new BusinessRuleException("CANNOT_CHANGE_OWN_ACCOUNT",
                "You cannot deactivate your own account or remove your own ADMIN role.");
    }
}
