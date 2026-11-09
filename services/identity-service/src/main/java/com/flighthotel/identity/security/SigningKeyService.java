package com.flighthotel.identity.security;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.crypto.FieldEncryptor;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;

/**
 * Manages the RSA keys that sign access tokens.
 * <ul>
 *   <li>Keys live in {@code signing_keys}; the private key is encrypted with {@code DATA_ENCRYPTION_KEY}, so every
 *       instance signs with the same key and tokens survive restarts.</li>
 *   <li>On first start one key is generated. A MySQL named lock stops two instances from both generating one.</li>
 *   <li>Retired keys stay published in the JWKS for a day, so tokens signed just before a rotation still verify.</li>
 * </ul>
 */
@Component
public class SigningKeyService implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(SigningKeyService.class);
    private static final String LOCK_NAME = "identity-signing-key";
    private static final Duration RETIRED_KEY_VISIBILITY = Duration.ofDays(1);

    private final JdbcClient jdbc;
    private final FieldEncryptor encryptor;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    private volatile RSAKey activeKey;
    private volatile List<JWK> publicKeys = List.of();

    public SigningKeyService(JdbcClient jdbc, FieldEncryptor encryptor, TransactionTemplate transactionTemplate,
            Clock clock) {
        this.jdbc = jdbc;
        this.encryptor = encryptor;
        this.transactionTemplate = transactionTemplate;
        this.clock = clock;
    }

    @Override
    public void afterPropertiesSet() {
        ensureActiveKey();
        reload();
    }

    /** Keys used to sign: only the active key, with its private part. */
    public JWKSource<SecurityContext> signingSource() {
        return (selector, context) -> selector.select(new JWKSet(activeKey));
    }

    /** Keys used to verify: every published public key. */
    public JWKSource<SecurityContext> verificationSource() {
        return (selector, context) -> selector.select(new JWKSet(publicKeys));
    }

    public String activeKeyId() {
        return activeKey.getKeyID();
    }

    /** Body of {@code /.well-known/jwks.json}: public keys only. */
    public Map<String, Object> publicJwks() {
        return new JWKSet(publicKeys).toJSONObject(true);
    }

    /** Picks up keys created or rotated by another instance. */
    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT5M")
    public void reload() {
        Instant visibleSince = clock.instant().minus(RETIRED_KEY_VISIBILITY);
        List<KeyRow> rows = jdbc.sql("""
                        SELECT kid, public_key, private_key_enc, status FROM signing_keys
                        WHERE status = 'ACTIVE' OR (status = 'RETIRED' AND retired_at > :since)
                        ORDER BY created_at DESC""")
                .param("since", Timestamp.from(visibleSince))
                .query((rs, i) -> new KeyRow(rs.getString("kid"), rs.getString("public_key"),
                        rs.getString("private_key_enc"), rs.getString("status")))
                .list();

        RSAKey newActive = null;
        List<JWK> newPublic = new ArrayList<>();
        for (KeyRow row : rows) {
            RSAPublicKey publicKey = decodePublic(row.publicKey());
            if ("ACTIVE".equals(row.status()) && newActive == null) {
                newActive = new RSAKey.Builder(publicKey)
                        .privateKey(decodePrivate(encryptor.decrypt(row.privateKeyEncrypted())))
                        .keyID(row.kid()).keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256)
                        .build();
            }
            newPublic.add(new RSAKey.Builder(publicKey)
                    .keyID(row.kid()).keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256)
                    .build());
        }
        if (newActive == null) {
            throw new IllegalStateException("No active signing key found");
        }
        this.activeKey = newActive;
        this.publicKeys = List.copyOf(newPublic);
    }

    private void ensureActiveKey() {
        transactionTemplate.executeWithoutResult(status -> {
            Integer locked = jdbc.sql("SELECT GET_LOCK(:name, 10)").param("name", LOCK_NAME).query(Integer.class).single();
            if (locked == null || locked != 1) {
                throw new IllegalStateException("Could not obtain signing key lock");
            }
            try {
                long active = jdbc.sql("SELECT COUNT(*) FROM signing_keys WHERE status = 'ACTIVE'")
                        .query(Long.class).single();
                if (active == 0) {
                    insertNewKey();
                }
            } finally {
                jdbc.sql("SELECT RELEASE_LOCK(:name)").param("name", LOCK_NAME).query(Integer.class).optional();
            }
        });
    }

    private void insertNewKey() {
        KeyPair keyPair = generateRsaKeyPair();
        String kid = UUID.randomUUID().toString();
        jdbc.sql("""
                        INSERT INTO signing_keys (kid, algorithm, public_key, private_key_enc, status, created_at)
                        VALUES (:kid, 'RS256', :publicKey, :privateKey, 'ACTIVE', :createdAt)""")
                .param("kid", kid)
                .param("publicKey", Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded()))
                .param("privateKey", encryptor.encrypt(Base64.getEncoder().encodeToString(keyPair.getPrivate().getEncoded())))
                .param("createdAt", Timestamp.from(clock.instant()))
                .update();
        log.info("Generated new token signing key kid={}", kid);
    }

    private static KeyPair generateRsaKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static RSAPublicKey decodePublic(String base64) {
        try {
            return (RSAPublicKey) KeyFactory.getInstance("RSA")
                    .generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(base64)));
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new IllegalStateException("Invalid public signing key", ex);
        }
    }

    private static RSAPrivateKey decodePrivate(String base64) {
        try {
            return (RSAPrivateKey) KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new IllegalStateException("Invalid private signing key", ex);
        }
    }

    private record KeyRow(String kid, String publicKey, String privateKeyEncrypted, String status) {
    }
}
