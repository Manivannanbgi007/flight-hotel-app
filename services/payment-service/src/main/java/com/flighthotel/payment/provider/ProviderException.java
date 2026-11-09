package com.flighthotel.payment.provider;

/**
 * The provider could not be asked, or it refused. {@code rejected} = the provider understood the request and said
 * no (a 4xx answer): retrying the same request will not help. Otherwise it was a network problem or a provider
 * outage and a retry is fine.
 */
public class ProviderException extends RuntimeException {

    private final boolean rejected;

    public ProviderException(String message, boolean rejected, Throwable cause) {
        super(message, cause);
        this.rejected = rejected;
    }

    public ProviderException(String message, boolean rejected) {
        this(message, rejected, null);
    }

    public boolean isRejected() {
        return rejected;
    }
}
