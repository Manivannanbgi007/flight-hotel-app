package com.flighthotel.notification.document;

import java.util.List;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.notification.document.DocumentService.Download;
import com.flighthotel.notification.document.DocumentService.DocumentView;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** PDF downloads through the API only: there are no public file URLs (requirement section 18). */
@RestController
@RequestMapping("/api/documents")
@Tag(name = "Documents", description = "Booking confirmations, e-tickets, invoices and receipts")
public class DocumentController {

    private final DocumentService documents;

    public DocumentController(DocumentService documents) {
        this.documents = documents;
    }

    @GetMapping
    @Operation(summary = "The documents of one of my bookings (staff: any booking)")
    public List<DocumentView> forBooking(@RequestParam UUID bookingId) {
        return documents.forBooking(bookingId);
    }

    @GetMapping("/{id}/download")
    @Operation(summary = "Download a PDF (owner or BOOKING_READ_ANY)")
    public ResponseEntity<byte[]> download(@PathVariable UUID id) {
        Download download = documents.download(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(download.contentType()))
                .contentLength(download.content().length)
                .cacheControl(CacheControl.noStore().cachePrivate())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(download.fileName()).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(download.content());
    }
}
