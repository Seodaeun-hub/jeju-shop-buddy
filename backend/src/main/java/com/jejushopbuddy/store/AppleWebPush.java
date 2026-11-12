package com.jejushopbuddy.store;

import com.interaso.webpush.VapidKeys;
import com.interaso.webpush.WebPush;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
class AppleWebPush {
    private final ObjectMapper json;
    private final String publicKey;
    private final WebPush push;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private VapidToken vapidToken;

    AppleWebPush(ObjectMapper json,
                 @Value("${SHOP_BUDDY_WEB_PUSH_PUBLIC_KEY:}") String publicKey,
                 @Value("${SHOP_BUDDY_WEB_PUSH_PRIVATE_KEY:}") String privateKey,
                 @Value("${SHOP_BUDDY_WEB_PUSH_SUBJECT:}") String subject) {
        this.json = json;
        this.publicKey = publicKey;
        this.push = publicKey.isBlank() || privateKey.isBlank() || subject.isBlank()
                ? null : new WebPush(subject, VapidKeys.fromUncompressedBytes(publicKey, privateKey));
    }

    String publicKey() {
        return push == null ? null : publicKey;
    }

    HttpRequest prepare(Subscription subscription, Message message, int ttlSeconds) {
        URI endpoint = appleEndpoint(subscription.endpoint());
        byte[] key = decodeKey(subscription.keys().p256dh(), 65);
        byte[] auth = decodeKey(subscription.keys().auth(), 16);
        if (endpoint == null || key == null || auth == null) {
            throw new IllegalArgumentException("Invalid Web Push subscription");
        }
        byte[] payload = push.getBody(json.writeValueAsBytes(message), key, auth);
        var builder = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload));
        push.getHeadersWithToken(tokenFor(endpoint), ttlSeconds, null, WebPush.Urgency.High)
                .forEach(builder::header);
        return builder.build();
    }

    int deliver(HttpRequest request) throws IOException, InterruptedException {
        return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    private synchronized String tokenFor(URI endpoint) {
        String audience = push.getAudience(endpoint.toASCIIString());
        Instant now = Instant.now();
        if (vapidToken == null || !vapidToken.audience().equals(audience) || !now.isBefore(vapidToken.refreshAt())) {
            vapidToken = new VapidToken(audience, now.plus(Duration.ofHours(1)), push.getToken(audience, 7200));
        }
        return vapidToken.value();
    }

    static boolean valid(Subscription subscription) {
        return subscription != null && subscription.keys() != null && appleEndpoint(subscription.endpoint()) != null
                && decodeKey(subscription.keys().p256dh(), 65) != null
                && decodeKey(subscription.keys().auth(), 16) != null;
    }

    private static URI appleEndpoint(String raw) {
        if (raw == null || raw.length() > 2048) return null;
        try {
            URI endpoint = URI.create(raw);
            String host = endpoint.getHost();
            if (!"https".equals(endpoint.getScheme()) || host == null
                    || !host.toLowerCase(Locale.ROOT).endsWith(".push.apple.com")
                    || endpoint.getPort() != -1 || endpoint.getRawUserInfo() != null
                    || endpoint.getRawFragment() != null || endpoint.getRawPath().length() < 2) return null;
            return endpoint;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static byte[] decodeKey(String value, int bytes) {
        if (value == null || value.length() > 88) return null;
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            return decoded.length == bytes ? decoded : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    record Subscription(String endpoint, Keys keys) {}
    record Keys(String p256dh, String auth) {}
    record Message(String path, String kind) {}
    private record VapidToken(String audience, Instant refreshAt, String value) {}
}
