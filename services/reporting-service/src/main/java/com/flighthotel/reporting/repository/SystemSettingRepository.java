package com.flighthotel.reporting.repository;

import java.util.List;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import com.flighthotel.reporting.entity.SystemSetting;

public interface SystemSettingRepository extends JpaRepository<SystemSetting, String> {

    List<SystemSetting> findAllByOrderByKeyAsc();

    List<SystemSetting> findByPublicSettingTrueOrderByKeyAsc();

    /** Locked, so two instances starting at the same time do not both publish the same change. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from SystemSetting s where s.publishedVersion < s.version")
    List<SystemSetting> findUnpublishedForUpdate();
}
