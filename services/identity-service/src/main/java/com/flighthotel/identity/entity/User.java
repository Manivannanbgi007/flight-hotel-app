package com.flighthotel.identity.entity;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A person who can log in. Business rules about the account live in the methods below, so services cannot put
 * the entity into an invalid state by setting fields one by one.
 */
@Getter
@Entity
@Table(name = "users")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    private UUID id;

    @Column(nullable = false, unique = true, length = 254)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Setter
    @Column(name = "first_name", nullable = false, length = 80)
    private String firstName;

    @Setter
    @Column(name = "last_name", nullable = false, length = 80)
    private String lastName;

    @Setter
    @Column(length = 20)
    private String phone;

    @Setter
    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Setter
    @Column(length = 2)
    private String nationality;

    @Setter
    @Column(name = "profile_photo_key")
    private String profilePhotoKey;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 30)
    private UserStatus status;

    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    @Column(name = "failed_login_count", nullable = false)
    private int failedLoginCount;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "password_changed_at", nullable = false)
    private Instant passwordChangedAt;

    @BatchSize(size = 50)
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "user_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    private Set<Role> roles = new HashSet<>();

    @Version
    private Long version;

    public User(String email, String passwordHash, String firstName, String lastName, String phone,
            UserStatus status, Set<Role> roles, Instant now) {
        this.email = normalizeEmail(email);
        this.passwordHash = passwordHash;
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.status = status;
        this.roles = new HashSet<>(roles);
        this.passwordChangedAt = now;
        if (status == UserStatus.ACTIVE) {
            this.emailVerifiedAt = now;
        }
    }

    public static String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(java.util.Locale.ROOT);
    }

    public boolean isLocked(Instant now) {
        return lockedUntil != null && now.isBefore(lockedUntil);
    }

    /** @return true if this failure locked the account */
    public boolean recordFailedLogin(int maxAttempts, Duration lockoutDuration, Instant now) {
        failedLoginCount++;
        if (failedLoginCount >= maxAttempts) {
            lockedUntil = now.plus(lockoutDuration);
            failedLoginCount = 0;
            return true;
        }
        return false;
    }

    public void recordSuccessfulLogin(Instant now) {
        failedLoginCount = 0;
        lockedUntil = null;
        lastLoginAt = now;
    }

    public void verifyEmail(Instant now) {
        if (emailVerifiedAt == null) {
            emailVerifiedAt = now;
        }
        if (status == UserStatus.PENDING_VERIFICATION) {
            status = UserStatus.ACTIVE;
        }
    }

    public void changePassword(String newPasswordHash, Instant now) {
        this.passwordHash = newPasswordHash;
        this.passwordChangedAt = now;
        this.failedLoginCount = 0;
        this.lockedUntil = null;
    }

    /** Re-hash with stronger settings without changing the password (done after a successful login). */
    public void upgradePasswordHash(String newPasswordHash) {
        this.passwordHash = newPasswordHash;
    }

    public void deactivate() {
        status = UserStatus.DEACTIVATED;
    }

    /** Reactivated accounts that never verified their email stay "pending verification". */
    public void activate() {
        status = emailVerifiedAt != null ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION;
        failedLoginCount = 0;
        lockedUntil = null;
    }

    public void replaceRoles(Set<Role> newRoles) {
        roles.clear();
        roles.addAll(newRoles);
    }

    public boolean isEmailVerified() {
        return emailVerifiedAt != null;
    }

    public Set<String> roleNames() {
        Set<String> names = new TreeSet<>();
        roles.forEach(role -> names.add(role.getName()));
        return names;
    }

    public Set<String> permissionCodes() {
        Set<String> codes = new TreeSet<>();
        roles.forEach(role -> role.getPermissions().forEach(permission -> codes.add(permission.getCode())));
        return codes;
    }
}
