package com.flighthotel.identity.service.impl;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.dto.AuthDtos.AuthResponse;
import com.flighthotel.identity.dto.AuthDtos.LoginRequest;
import com.flighthotel.identity.dto.AuthDtos.RegisterRequest;
import com.flighthotel.identity.dto.AuthDtos.ResetPasswordRequest;
import com.flighthotel.identity.dto.CustomerDtos.ChangePasswordRequest;
import com.flighthotel.identity.entity.EmailVerificationToken;
import com.flighthotel.identity.entity.PasswordResetToken;
import com.flighthotel.identity.entity.ResetTokenPurpose;
import com.flighthotel.identity.entity.RevokeReason;
import com.flighthotel.identity.entity.Role;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.entity.UserStatus;
import com.flighthotel.identity.exception.IdentityErrors;
import com.flighthotel.identity.exception.IdentityErrors.SessionExpiredException;
import com.flighthotel.identity.mapper.IdentityMapper;
import com.flighthotel.identity.messaging.IdentityEventPublisher;
import com.flighthotel.identity.messaging.IdentityEventPublisher.AuthEmailType;
import com.flighthotel.identity.repository.EmailVerificationTokenRepository;
import com.flighthotel.identity.repository.PasswordResetTokenRepository;
import com.flighthotel.identity.repository.RoleRepository;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.security.AccessTokenService;
import com.flighthotel.identity.security.AccessTokenService.IssuedAccessToken;
import com.flighthotel.identity.security.PasswordPolicy;
import com.flighthotel.identity.security.Portal;
import com.flighthotel.identity.security.SecureTokens;
import com.flighthotel.identity.service.AuthService;
import com.flighthotel.identity.service.impl.SessionService.NewRefreshToken;
import com.flighthotel.identity.service.impl.SessionService.RefreshOutcome;

@Service
public class AuthServiceImpl implements AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthServiceImpl.class);

    private final UserRepository users;
    private final RoleRepository roles;
    private final EmailVerificationTokenRepository verificationTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final AccessTokenService accessTokens;
    private final SessionService sessions;
    private final LoginAttemptRecorder loginAttempts;
    private final IdentityEventPublisher events;
    private final AuditPublisher audit;
    private final IdentityMapper mapper;
    private final JwtDecoder jwtDecoder;
    private final IdentityProperties properties;
    private final Clock clock;
    /** Compared against when the email is unknown, so "no such user" takes as long as "wrong password". */
    private final String dummyPasswordHash;

    public AuthServiceImpl(UserRepository users, RoleRepository roles, EmailVerificationTokenRepository verificationTokens,
            PasswordResetTokenRepository resetTokens, PasswordEncoder passwordEncoder, PasswordPolicy passwordPolicy,
            AccessTokenService accessTokens, SessionService sessions, LoginAttemptRecorder loginAttempts,
            IdentityEventPublisher events, AuditPublisher audit, IdentityMapper mapper, JwtDecoder jwtDecoder,
            IdentityProperties properties, Clock clock) {
        this.users = users;
        this.roles = roles;
        this.verificationTokens = verificationTokens;
        this.resetTokens = resetTokens;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.accessTokens = accessTokens;
        this.sessions = sessions;
        this.loginAttempts = loginAttempts;
        this.events = events;
        this.audit = audit;
        this.mapper = mapper;
        this.jwtDecoder = jwtDecoder;
        this.properties = properties;
        this.clock = clock;
        this.dummyPasswordHash = passwordEncoder.encode(SecureTokens.generate());
    }

    // ---------------------------------------------------------------- registration & verification

    @Override
    @Transactional
    public void register(RegisterRequest request) {
        passwordPolicy.check(request.password(), request.email());
        String email = User.normalizeEmail(request.email());
        Optional<User> existing = users.findWithRolesByEmail(email);
        if (existing.isPresent()) {
            // Same response as a new registration; the account owner gets an email instead.
            User user = existing.get();
            if (user.getStatus() == UserStatus.PENDING_VERIFICATION) {
                sendVerificationEmail(user);
            } else if (user.getStatus() == UserStatus.ACTIVE) {
                events.requestEmail(user, AuthEmailType.ACCOUNT_EXISTS, null, null);
            }
            return;
        }
        Role customer = roles.findByName(Roles.CUSTOMER).orElseThrow();
        User user = new User(email, passwordEncoder.encode(request.password()), request.firstName().trim(),
                request.lastName().trim(), blankToNull(request.phone()), UserStatus.PENDING_VERIFICATION,
                Set.of(customer), clock.instant());
        users.saveAndFlush(user);
        events.userRegistered(user);
        sendVerificationEmail(user);
    }

    @Override
    @Transactional
    public void verifyEmail(String rawToken) {
        Instant now = clock.instant();
        EmailVerificationToken token = verificationTokens.findByTokenHash(SecureTokens.sha256Hex(rawToken))
                .orElseThrow(IdentityErrors::invalidOrExpiredToken);
        User user = users.findById(token.getUserId()).orElseThrow(IdentityErrors::invalidOrExpiredToken);
        if (!token.isUsable(now)) {
            // Clicking the link twice is fine once the account is verified.
            if (token.getUsedAt() != null && user.isEmailVerified()) {
                return;
            }
            throw IdentityErrors.invalidOrExpiredToken();
        }
        boolean firstVerification = !user.isEmailVerified();
        user.verifyEmail(now);
        verificationTokens.invalidateAllForUser(user.getId(), now);
        token.markUsed(now);
        if (firstVerification) {
            events.emailVerified(user);
            events.requestEmail(user, AuthEmailType.WELCOME, null, null);
        }
    }

    @Override
    @Transactional
    public void resendVerification(String email) {
        users.findWithRolesByEmail(User.normalizeEmail(email))
                .filter(user -> user.getStatus() == UserStatus.PENDING_VERIFICATION)
                .ifPresent(this::sendVerificationEmail);
    }

    // ---------------------------------------------------------------- login & sessions

    @Override
    @Transactional
    public AuthResult login(LoginRequest request) {
        Instant now = clock.instant();
        Optional<User> found = users.findWithRolesByEmail(User.normalizeEmail(request.email()));
        if (found.isEmpty()) {
            passwordEncoder.matches(request.password(), dummyPasswordHash);
            throw IdentityErrors.invalidCredentials();
        }
        User user = found.get();
        if (user.isLocked(now)) {
            loginAttempts.recordFailure(user.getId(), "ACCOUNT_LOCKED", false);
            throw IdentityErrors.accountLocked(user.getLockedUntil());
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            Instant lockedUntil = loginAttempts.recordFailure(user.getId(), "BAD_PASSWORD", true);
            if (lockedUntil != null) {
                log.warn("Account locked after repeated failed logins userId={}", user.getId());
                throw IdentityErrors.accountLocked(lockedUntil);
            }
            throw IdentityErrors.invalidCredentials();
        }
        // The account status is only revealed to someone who knows the password.
        if (user.getStatus() == UserStatus.PENDING_VERIFICATION) {
            loginAttempts.recordFailure(user.getId(), "EMAIL_NOT_VERIFIED", false);
            throw IdentityErrors.emailNotVerified();
        }
        if (user.getStatus() == UserStatus.DEACTIVATED) {
            loginAttempts.recordFailure(user.getId(), "ACCOUNT_DISABLED", false);
            throw IdentityErrors.accountDisabled();
        }
        // Phase 11: the sign-in page of another role. No session, no failed attempt; history and audit only.
        if (request.portal() != null) {
            Portal portal = Portal.valueOf(request.portal());
            if (!portal.admits(user.roleNames())) {
                loginAttempts.recordPortalRefused(user, portal.name());
                log.info("Sign-in refused at the {} portal userId={}", portal, user.getId());
                throw IdentityErrors.portalNotAllowed(
                        Portal.forRoles(user.roleNames()).stream().map(Portal::name).toList());
            }
        }
        if (passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.upgradePasswordHash(passwordEncoder.encode(request.password()));
        }
        loginAttempts.recordSuccess(user);
        NewRefreshToken refreshToken = sessions.start(user.getId(), request.rememberMe());
        return new AuthResult(authResponse(user, refreshToken.familyId()), refreshToken);
    }

    @Override
    @Transactional(noRollbackFor = SessionExpiredException.class)
    public AuthResult refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new SessionExpiredException();
        }
        RefreshOutcome outcome = sessions.rotate(refreshToken);
        User user = users.findWithRolesById(outcome.userId()).orElseThrow(SessionExpiredException::new);
        if (user.getStatus() != UserStatus.ACTIVE) {
            sessions.endAll(user.getId(), RevokeReason.DEACTIVATED);
            throw new SessionExpiredException();
        }
        return new AuthResult(authResponse(user, outcome.familyId()), outcome.newToken());
    }

    @Override
    public void logout(String refreshToken, String accessToken) {
        if (refreshToken != null && !refreshToken.isBlank()) {
            sessions.end(refreshToken);
        }
        if (accessToken != null && !accessToken.isBlank()) {
            try {
                Jwt jwt = jwtDecoder.decode(accessToken);
                sessions.revokeAccessToken(jwt.getId(), jwt.getExpiresAt());
            } catch (JwtException ex) {
                // Expired or invalid: nothing left to revoke.
            }
        }
    }

    @Override
    @Transactional
    public void logoutEverywhere() {
        UUID userId = CurrentUser.require().id();
        sessions.endAll(userId, RevokeReason.LOGOUT_ALL);
        audit.record("LOGOUT_ALL_SESSIONS", "USER", userId.toString(), Map.of());
    }

    // ---------------------------------------------------------------- passwords

    @Override
    @Transactional
    public void requestPasswordReset(String email) {
        users.findWithRolesByEmail(User.normalizeEmail(email))
                .filter(user -> user.getStatus() == UserStatus.ACTIVE)
                .filter(user -> !recentlyRequested(resetTokens.findFirstByUserIdOrderByCreatedAtDesc(user.getId())
                        .map(PasswordResetToken::getCreatedAt)))
                .ifPresent(user -> {
                    String raw = SecureTokens.generate();
                    Instant expiresAt = clock.instant().plus(properties.tokens().passwordResetTtl());
                    resetTokens.save(new PasswordResetToken(user.getId(), SecureTokens.sha256Hex(raw),
                            ResetTokenPurpose.RESET_PASSWORD, expiresAt, clock.instant()));
                    events.requestEmail(user, AuthEmailType.RESET_PASSWORD, raw, expiresAt);
                });
    }

    @Override
    @Transactional
    public void resetPassword(ResetPasswordRequest request) {
        Instant now = clock.instant();
        PasswordResetToken token = resetTokens.findByTokenHash(SecureTokens.sha256Hex(request.token()))
                .filter(t -> t.isUsable(now))
                .orElseThrow(IdentityErrors::invalidOrExpiredToken);
        User user = users.findWithRolesById(token.getUserId()).orElseThrow(IdentityErrors::invalidOrExpiredToken);
        if (user.getStatus() == UserStatus.DEACTIVATED) {
            throw IdentityErrors.invalidOrExpiredToken();
        }
        passwordPolicy.check(request.newPassword(), user.getEmail());

        user.changePassword(passwordEncoder.encode(request.newPassword()), now);
        if (token.getPurpose() == ResetTokenPurpose.ACCOUNT_INVITATION) {
            // The invitation link went to this mailbox, which proves the email address.
            boolean firstVerification = !user.isEmailVerified();
            user.verifyEmail(now);
            if (firstVerification) {
                events.emailVerified(user);
            }
        }
        resetTokens.invalidateAllForUser(user.getId(), now);
        token.markUsed(now);
        sessions.endAll(user.getId(), RevokeReason.PASSWORD_RESET);
        events.requestEmail(user, AuthEmailType.PASSWORD_CHANGED, null, null);
        audit.record(token.getPurpose() == ResetTokenPurpose.ACCOUNT_INVITATION ? "INVITATION_ACCEPTED" : "PASSWORD_RESET",
                "USER", user.getId().toString(), Map.of());
    }

    @Override
    @Transactional
    public AuthResult changePassword(ChangePasswordRequest request) {
        AuthenticatedUser current = CurrentUser.require();
        User user = users.findWithRolesById(current.id()).orElseThrow(SessionExpiredException::new);
        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw new BusinessRuleException("CURRENT_PASSWORD_INCORRECT", "The current password is not correct");
        }
        if (request.currentPassword().equals(request.newPassword())) {
            throw new BusinessRuleException("PASSWORD_UNCHANGED", "The new password must be different");
        }
        passwordPolicy.check(request.newPassword(), user.getEmail());

        Instant now = clock.instant();
        user.changePassword(passwordEncoder.encode(request.newPassword()), now);
        UUID sessionId = currentSessionId();
        sessions.endAllExcept(user.getId(), sessionId, RevokeReason.PASSWORD_CHANGED);
        events.requestEmail(user, AuthEmailType.PASSWORD_CHANGED, null, null);
        audit.record("PASSWORD_CHANGED", "USER", user.getId().toString(), Map.of());
        return new AuthResult(authResponse(user, sessionId), null);
    }

    // ---------------------------------------------------------------- helpers

    private AuthResponse authResponse(User user, UUID sessionId) {
        IssuedAccessToken token = accessTokens.issue(user, sessionId);
        return AuthResponse.bearer(token.value(), token.expiresInSeconds(), mapper.toAuthUser(user));
    }

    private void sendVerificationEmail(User user) {
        boolean recent = recentlyRequested(verificationTokens.findFirstByUserIdOrderByCreatedAtDesc(user.getId())
                .map(EmailVerificationToken::getCreatedAt));
        if (recent) {
            return;
        }
        String raw = SecureTokens.generate();
        Instant expiresAt = clock.instant().plus(properties.tokens().emailVerificationTtl());
        verificationTokens.save(new EmailVerificationToken(user.getId(), SecureTokens.sha256Hex(raw), expiresAt,
                clock.instant()));
        events.requestEmail(user, AuthEmailType.VERIFY_EMAIL, raw, expiresAt);
    }

    /** Throttles verification/reset emails per account (protects the mailbox and our email reputation). */
    private boolean recentlyRequested(Optional<Instant> lastCreatedAt) {
        return lastCreatedAt
                .map(created -> clock.instant().isBefore(created.plus(properties.tokens().emailResendInterval())))
                .orElse(false);
    }

    /** The session (refresh-token family) of the current access token, from its {@code sid} claim. */
    private static UUID currentSessionId() {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken jwtAuth) {
            String sid = jwtAuth.getToken().getClaimAsString(AccessTokenService.SESSION_CLAIM);
            if (sid != null) {
                return UUID.fromString(sid);
            }
        }
        throw new SessionExpiredException();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
