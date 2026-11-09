package com.jejushopbuddy.analysis;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
class StoreReviewService {
    private final JdbcClient jdbc;
    private final ReviewTopicModel model;

    StoreReviewService(JdbcClient jdbc, ReviewTopicModel model) {
        this.jdbc = jdbc;
        this.model = model;
    }

    Insight insight(UUID storeId) {
        var reviews = jdbc.sql("""
                SELECT id, reviewed_on, body, model_topics FROM store_reviews WHERE store_id = :storeId
                ORDER BY reviewed_on DESC, id
                """)
                .param("storeId", storeId)
                .query((rs, row) -> new ClassifiedReview(new Review(rs.getObject("id", UUID.class),
                        rs.getObject("reviewed_on", LocalDate.class), rs.getString("body")), rs.getString("model_topics")))
                .list();
        var grouped = new EnumMap<ReviewTopic, List<Review>>(ReviewTopic.class);
        for (var entry : reviews) {
            for (var topic : entry.topics()) {
                grouped.computeIfAbsent(topic, ignored -> new ArrayList<>()).add(entry.review());
            }
        }
        var afternoon = grouped.getOrDefault(ReviewTopic.AFTERNOON_ORDER, List.of());
        var topics = grouped.entrySet().stream().filter(entry -> entry.getValue().size() >= 2)
                .map(entry -> TopicInsight.from(entry.getKey(), entry.getValue())).toList();
        return new Insight(reviews.size(), afternoon, afternoon.size() >= 2, topics);
    }

    Review add(UUID storeId, LocalDate date, String text) {
        var review = new Review(UUID.randomUUID(), date, text);
        var topics = model.classify(text).map(result -> result.stream().map(Enum::name)
                .collect(Collectors.joining(","))).orElse(null);
        jdbc.sql("""
                INSERT INTO store_reviews (id, store_id, reviewed_on, body, model_topics)
                VALUES (:id, :storeId, :date, :text, :topics)
                """)
                .param("id", review.id())
                .param("storeId", storeId)
                .param("date", date)
                .param("text", text)
                .param("topics", topics)
                .update();
        return review;
    }

    private record ClassifiedReview(Review review, String modelTopics) {
        List<ReviewTopic> topics() {
            if (modelTopics == null) {
                return Arrays.stream(ReviewTopic.values()).filter(topic -> topic.matches(review.text())).toList();
            }
            if (modelTopics.isEmpty()) return List.of();
            return Arrays.stream(modelTopics.split(",")).map(ReviewTopic::valueOf).toList();
        }
    }

    record Review(UUID id, LocalDate date, String text) {}

    record Insight(int total, List<Review> evidence, boolean repeated, List<TopicInsight> topics) {}

    record TopicInsight(ReviewTopic topic, String label, String title, String action, String confirmation, List<Review> evidence) {
        static TopicInsight from(ReviewTopic topic, List<Review> evidence) {
            return new TopicInsight(topic, topic.label, topic.title, topic.action, topic.confirmation, List.copyOf(evidence));
        }
    }
}
