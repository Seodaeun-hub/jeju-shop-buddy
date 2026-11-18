package com.jejushopbuddy.analysis;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreDeletion {
    private final JdbcClient jdbc;

    public StoreDeletion(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public enum Status { DELETED, NOT_FOUND, PUBLICATION_PENDING }

    @Transactional
    public Status delete(UUID storeId, String ownerEmail) {
        var owned = jdbc.sql("""
                SELECT s.id FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email
                FOR UPDATE OF s
                """).param("store", storeId).param("email", ownerEmail).query(UUID.class).optional();
        if (owned.isEmpty()) return Status.NOT_FOUND;

        var analyses = jdbc.sql("""
                SELECT id FROM sales_analyses WHERE store_id = :store ORDER BY id FOR UPDATE
                """).param("store", storeId).query(UUID.class).list();
        var plans = jdbc.sql("""
                SELECT p.id, p.instagram_publication->>'state' AS publication_state
                FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
                WHERE a.store_id = :store ORDER BY p.id FOR UPDATE OF p
                """).param("store", storeId).query(ExecutionPlanWriter.LockedPlan.class).list();
        // Check every plan before deleting anything so a blocked deletion leaves all data intact.
        if (plans.stream().anyMatch(ExecutionPlanWriter.LockedPlan::publicationPending)) {
            return Status.PUBLICATION_PENDING;
        }

        ExecutionPlanWriter.deleteLockedPlans(jdbc, plans);
        if (!analyses.isEmpty()) {
            jdbc.sql("DELETE FROM analysis_monthly_sales WHERE analysis_id IN (:ids)").param("ids", analyses).update();
            jdbc.sql("DELETE FROM analysis_time_series WHERE analysis_id IN (:ids)").param("ids", analyses).update();
            jdbc.sql("DELETE FROM sales_analyses WHERE id IN (:ids)").param("ids", analyses).update();
        }
        jdbc.sql("DELETE FROM store_reviews WHERE store_id = :store").param("store", storeId).update();
        // Store settings, POS files, photos and the published QR menu use ON DELETE CASCADE.
        jdbc.sql("DELETE FROM stores WHERE id = :store").param("store", storeId).update();
        return Status.DELETED;
    }
}
