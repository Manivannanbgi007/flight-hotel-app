package com.flighthotel.identity.controller;

import java.io.IOException;
import java.io.UncheckedIOException;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.flighthotel.identity.dto.CustomerDtos.ProfileResponse;
import com.flighthotel.identity.dto.CustomerDtos.UpdateProfileRequest;
import com.flighthotel.identity.service.CustomerAccountService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/customers/profile")
@Tag(name = "My account: Profile")
public class CustomerProfileController {

    private final CustomerAccountService accountService;

    public CustomerProfileController(CustomerAccountService accountService) {
        this.accountService = accountService;
    }

    @GetMapping
    @Operation(summary = "My profile")
    public ProfileResponse get() {
        return accountService.getProfile();
    }

    @PutMapping
    @Operation(summary = "Update my name, phone, date of birth and nationality")
    public ProfileResponse update(@Valid @RequestBody UpdateProfileRequest request) {
        return accountService.updateProfile(request);
    }

    @PutMapping(path = "/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Upload a profile photo (JPEG or PNG, max 2 MB); it is resized and re-encoded")
    public ProfileResponse uploadPhoto(@RequestPart("file") MultipartFile file) {
        try {
            return accountService.updatePhoto(file.getBytes());
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not read upload", ex);
        }
    }

    @GetMapping(path = "/photo", produces = MediaType.IMAGE_JPEG_VALUE)
    @Operation(summary = "My profile photo (load with the bearer token as a blob)")
    public ResponseEntity<byte[]> photo() {
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.noCache().cachePrivate())
                .body(accountService.getPhoto());
    }

    @DeleteMapping("/photo")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove my profile photo")
    public void deletePhoto() {
        accountService.deletePhoto();
    }
}
