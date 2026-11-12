package com.jejushopbuddy.analysis;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class PromotionArchivePush {
    private final PromotionImpactController impacts;
    private final ProductPosArchive archive;
    private final ObjectMapper json;

    PromotionArchivePush(PromotionImpactController impacts, ProductPosArchive archive, ObjectMapper json) {
        this.impacts = impacts;
        this.archive = archive;
        this.json = json;
    }

    public Status reconcile(UUID planId, UUID storeId, String email, LocalDate today) {
        var status = impacts.reconcileArchivedPos(planId, email, today, () -> archive.load(storeId));
        if (status == null) return null;
        var gap = status.gap();
        return new Status(json.writeValueAsString(status.basis()), gap == null ? null : gap.start(), gap == null ? null : gap.end());
    }

    public record Status(String basis, LocalDate gapStart, LocalDate gapEnd) {}
}
