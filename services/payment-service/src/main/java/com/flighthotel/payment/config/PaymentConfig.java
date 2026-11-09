package com.flighthotel.payment.config;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.flighthotel.payment.provider.DemoPaymentProvider;
import com.flighthotel.payment.provider.PaymentProvider;
import com.flighthotel.payment.provider.RazorpayPaymentProvider;

import tools.jackson.databind.json.JsonMapper;

@Configuration
@EnableConfigurationProperties(PaymentProperties.class)
public class PaymentConfig {

    @Bean
    PaymentProviders paymentProviders(PaymentProperties properties, JsonMapper jsonMapper) {
        Map<String, PaymentProvider> available = new LinkedHashMap<>();
        if (properties.razorpay().configured()) {
            PaymentProperties.Razorpay razorpay = properties.razorpay();
            available.put(RazorpayPaymentProvider.CODE, new RazorpayPaymentProvider(razorpay.keyId(),
                    razorpay.keySecret(), razorpay.webhookSecret(), razorpay.apiUrl(), razorpay.timeout(), jsonMapper));
        }
        if (properties.demo().enabled()) {
            available.put(DemoPaymentProvider.CODE, new DemoPaymentProvider(properties.demo().secret()));
        }
        String active = properties.provider().toUpperCase(java.util.Locale.ROOT);
        if (!available.containsKey(active)) {
            throw new IllegalStateException("PAYMENT_PROVIDER=" + properties.provider() + " is not usable: "
                    + ("RAZORPAY".equals(active) ? "set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"
                            : "the DEMO provider is disabled (payment.demo.enabled=false)"));
        }
        return new PaymentProviders(available, active);
    }
}
