package com.flighthotel.identity.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.identity.entity.User;

import jakarta.persistence.LockModeType;

public interface UserRepository extends JpaRepository<User, UUID>, JpaSpecificationExecutor<User> {

    /** Loads roles and permissions too, because they go into the access token. */
    @EntityGraph(attributePaths = {"roles", "roles.permissions"})
    Optional<User> findWithRolesByEmail(String email);

    @EntityGraph(attributePaths = {"roles", "roles.permissions"})
    Optional<User> findWithRolesById(UUID id);

    boolean existsByEmail(String email);

    /** Keyset pages over all accounts (the snapshot backfill). */
    @Query("select u.id from User u order by u.id")
    List<UUID> findIdsOrderById(Pageable page);

    @Query("select u.id from User u where u.id > :after order by u.id")
    List<UUID> findIdsAfter(@Param("after") UUID after, Pageable page);

    /** Locks the user row until the transaction ends; serializes per-user limit checks (e.g. saved passengers). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id")
    Optional<User> lockById(@Param("id") UUID id);
}
