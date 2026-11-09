package com.jejushopbuddy.analysis;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class StoreReviewService {
    private static final Pattern AFTERNOON = Pattern.compile("오후|점심\\s*이후");
    private static final Pattern ORDER = Pattern.compile("식사|주문");
    private static final Pattern UNCLEAR = Pattern.compile("헷갈|몰랐|몰라|알기\\s*어려|안내가\\s*없");

    private final JdbcClient jdbc;

    StoreReviewService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Insight insight(UUID storeId) {
        var reviews = jdbc.sql("""
                SELECT id, reviewed_on, body FROM store_reviews WHERE store_id = :storeId
                ORDER BY reviewed_on DESC, id
                """)
                .param("storeId", storeId)
                .query((rs, row) -> new Review(rs.getObject("id", UUID.class),
                        rs.getObject("reviewed_on", LocalDate.class), rs.getString("body")))
                .list();
        var evidence = reviews.stream().filter(review -> unclearAfternoonOrders(review.text())).toList();
        return new Insight(reviews.size(), evidence, evidence.size() >= 2);
    }

    @Transactional
    Review add(UUID storeId, LocalDate date, String text) {
        var review = new Review(UUID.randomUUID(), date, text);
        jdbc.sql("""
                INSERT INTO store_reviews (id, store_id, reviewed_on, body)
                VALUES (:id, :storeId, :date, :text)
                """)
                .param("id", review.id())
                .param("storeId", storeId)
                .param("date", date)
                .param("text", text)
                .update();
        return review;
    }

    private static boolean unclearAfternoonOrders(String text) {
        for (String sentence : text.split("[.!?\\r\\n]+")) {
            if (AFTERNOON.matcher(sentence).find() && ORDER.matcher(sentence).find()
                    && UNCLEAR.matcher(sentence).find()) return true;
        }
        return false;
    }

    record Review(UUID id, LocalDate date, String text) {}

    record Insight(int total, List<Review> evidence, boolean repeated) {}
}
