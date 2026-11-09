package com.flighthotel.common.error;

import java.util.List;

import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Turns every exception into a consistent Problem Details JSON response.
 * <p>
 * Rule: clients get a stable {@code code} and a safe message. Stack traces and internal details only go to
 * the server log, together with the correlation ID so support can find them.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> handleApiException(ApiException ex) {
        if (ex.getStatus().is5xxServerError()) {
            log.error("Request failed: code={}", ex.getCode(), ex);
        } else {
            log.info("Request rejected: status={} code={}", ex.getStatus().value(), ex.getCode());
        }
        ProblemDetail problem = ProblemDetails.of(ex.getStatus(), ex.getCode(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(ProblemDetails.withDetails(problem, ex.getDetails()));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ProblemDetail> handleConstraintViolation(ConstraintViolationException ex) {
        List<ProblemDetails.FieldError> errors = ex.getConstraintViolations().stream()
                .map(v -> new ProblemDetails.FieldError(lastNode(v.getPropertyPath().toString()), v.getMessage()))
                .toList();
        return validationProblem(errors);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ProblemDetails.of(HttpStatus.FORBIDDEN, "FORBIDDEN", "You are not allowed to perform this action"));
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ProblemDetail> handleOptimisticLock(OptimisticLockingFailureException ex) {
        log.info("Concurrent modification detected: {}", ex.getClass().getSimpleName());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ProblemDetails.of(HttpStatus.CONFLICT,
                "CONCURRENT_MODIFICATION", "This record was changed by someone else. Reload and try again."));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ProblemDetail> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation", ex);
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ProblemDetails.of(HttpStatus.CONFLICT,
                "DATA_CONFLICT", "The request conflicts with existing data"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(Exception ex) {
        log.error("Unexpected error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ProblemDetails.of(
                HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "Something went wrong. Please try again later."));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return toObjectResponse(validationProblem(fieldErrors(ex)));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode statusCode, WebRequest request) {
        // Framework exceptions (bad JSON, wrong method, missing parameter, ...): keep Spring's status and
        // message, add our standard fields.
        if (ex instanceof BindException bindException) {
            return toObjectResponse(validationProblem(fieldErrors(bindException)));
        }
        if (ex instanceof MaxUploadSizeExceededException) {
            return ResponseEntity.status(statusCode).headers(headers).body(ProblemDetails.of(statusCode,
                    "FILE_TOO_LARGE", "The file is too large"));
        }
        ProblemDetail problem = body instanceof ProblemDetail pd ? pd
                : ProblemDetail.forStatusAndDetail(statusCode, "Request could not be processed");
        ProblemDetail result = ProblemDetails.of(statusCode, codeFor(statusCode), problem.getDetail());
        return ResponseEntity.status(statusCode).headers(headers).body(result);
    }

    private static List<ProblemDetails.FieldError> fieldErrors(BindException ex) {
        return ex.getBindingResult().getFieldErrors().stream()
                .map(e -> new ProblemDetails.FieldError(e.getField(), e.getDefaultMessage()))
                .toList();
    }

    private static ResponseEntity<ProblemDetail> validationProblem(List<ProblemDetails.FieldError> errors) {
        ProblemDetail problem = ProblemDetails.of(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                "Some fields are invalid");
        return ResponseEntity.badRequest().body(ProblemDetails.withFieldErrors(problem, errors));
    }

    private static ResponseEntity<Object> toObjectResponse(ResponseEntity<ProblemDetail> response) {
        return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
    }

    private static String codeFor(HttpStatusCode status) {
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved == null ? "HTTP_" + status.value() : resolved.name();
    }

    private static String lastNode(String propertyPath) {
        int dot = propertyPath.indexOf('.');
        return dot >= 0 ? propertyPath.substring(dot + 1) : propertyPath;
    }
}
