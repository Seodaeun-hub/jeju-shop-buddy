package com.jejushopbuddy.analysis;

import com.jejushopbuddy.time.BusinessDate;
import java.math.BigDecimal;
import java.security.Principal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** User-recorded execution evidence, separate from actual social publication receipts. */
@RestController
class ExecutionOutcomeController {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final BusinessDate dates;
    private static final String OWNED = """
            FROM execution_plans p JOIN sales_analyses a ON a.id = p.analysis_id
            JOIN stores s ON s.id = a.store_id JOIN owners o ON o.id = s.owner_id
            WHERE p.id = :id AND o.email = :email
            """;

    ExecutionOutcomeController(JdbcClient jdbc, ObjectMapper json, BusinessDate dates) {
        this.jdbc = jdbc;
        this.json = json;
        this.dates = dates;
    }

    @GetMapping("/api/plans/{id}/outcome")
    ResponseEntity<?> read(@PathVariable UUID id, Principal owner) {
        var row = jdbc.sql("SELECT p.execution_outcome " + OWNED).param("id", id).param("email", owner.getName())
                .query((rs, n) -> new Stored(rs.getString(1))).optional();
        if (row.isEmpty()) return missing();
        var outcome = row.get().value() == null ? null : json.readValue(row.get().value(), Outcome.class);
        LocalDate ready = outcome == null ? null : outcome.executedOn();
        if (outcome != null && outcome.comparison() != null && outcome.comparison().after().end().plusDays(1).isAfter(ready)) {
            ready = outcome.comparison().after().end().plusDays(1);
        }
        if (outcome != null && outcome.inventory() != null && outcome.inventory().date().plusDays(1).isAfter(ready)) {
            ready = outcome.inventory().date().plusDays(1);
        }
        boolean pending = ready != null && ready.isAfter(dates.today());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Envelope(pending ? null : outcome, pending ? ready : null));
    }

    @PutMapping("/api/plans/{id}/outcome")
    ResponseEntity<?> save(@PathVariable UUID id, @RequestBody Outcome input, Principal owner) {
        if (!valid(input, dates.today())) return ResponseEntity.badRequest().body(Map.of("message",
                "실행일·비교 기간·수치·자료 출처를 확인해 주세요. 실행 후 자료는 기준일보다 앞서야 하고 가상 파일은 가상 자료로 표시해야 해요."));
        int changed = jdbc.sql("""
                UPDATE execution_plans SET execution_outcome = CAST(:value AS jsonb)
                WHERE id IN (SELECT p.id
                """ + OWNED + ")").param("value", json.writeValueAsString(input))
                .param("id", id).param("email", owner.getName()).update();
        if (changed == 0) return missing();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Envelope(input, null));
    }

    static boolean valid(Outcome o, LocalDate today) {
        if (o == null || o.simulated() == null || !day(o.executedOn()) || o.executedOn().isAfter(today)
                || !text(o.action(), 1000) || !optionalText(o.note(), 2000)
                || o.reviewedCount() != null && (o.reviewedCount() < 0 || o.reviewedCount() > 10000)
                || !optionalText(o.reviewSource(), 2000)
                || o.reviewedCount() != null && !text(o.reviewSource(), 2000)) return false;
        var c = o.comparison();
        if (c != null) {
            if (!text(c.product(), 255) || !period(c.before()) || !period(c.after())
                    || !c.before().end().isBefore(c.after().start()) || !c.after().end().isBefore(today)
                    || o.executedOn().isAfter(c.after().end()) || o.executedOn().isBefore(c.after().start())
                    || c.sources() == null || c.sources().size() != 4) return false;
            for (var s : c.sources()) {
                if (s == null || !text(s.name(), 255) || s.sha256() == null || !s.sha256().matches("[a-f0-9]{64}")
                        || !o.simulated() && s.name().toUpperCase(java.util.Locale.ROOT).contains("SIMULATED")) return false;
            }
        }
        var inventory = o.inventory();
        if (inventory != null) {
            if (!day(inventory.date()) || !inventory.date().isBefore(today) || !inventory.date().equals(o.executedOn()) || !text(inventory.product(), 255)
                    || inventory.actualQuantity() != null && !whole(inventory.actualQuantity())
                    || inventory.remaining() == null || inventory.remaining().size() > 500) return false;
            for (var r : inventory.remaining()) if (r == null || !text(r.name(), 255) || !text(r.unit(), 20)
                    || r.quantity() == null || r.quantity().signum() < 0 || r.quantity().scale() > 3
                    || r.quantity().compareTo(BigDecimal.valueOf(1_000_000_000)) > 0) return false;
        }
        return true;
    }

    private static boolean period(Period p) {
        if (p == null || !day(p.start()) || !day(p.end()) || p.end().isBefore(p.start())) return false;
        return p.days() != null && p.days() >= 1 && p.days() <= ChronoUnit.DAYS.between(p.start(), p.end()) + 1
                && whole(p.amount()) && whole(p.count()) && whole(p.afternoonCount()) && whole(p.quantity())
                && whole(p.productAmount()) && p.afternoonCount() <= p.count() && p.productAmount() <= p.amount();
    }
    private static boolean whole(Long n) { return n != null && n >= 0 && n <= 9_007_199_254_740_991L; }
    private static boolean day(LocalDate d) { return d != null && d.getYear() >= 1900 && d.getYear() <= 9999; }
    private static boolean text(String s, int max) { return s != null && !s.isBlank() && optionalText(s, max); }
    private static boolean optionalText(String s, int max) { return s == null || s.length() <= max && s.indexOf('\0') < 0; }
    private static ResponseEntity<?> missing() { return ResponseEntity.status(404).body(Map.of("message", "실행 계획을 찾을 수 없어요.")); }

    record Stored(String value) {}
    record Envelope(Outcome outcome, LocalDate pendingUntil) {}
    record Outcome(Boolean simulated, LocalDate executedOn, String action, String note, Integer reviewedCount,
                   String reviewSource, Comparison comparison, Inventory inventory) {}
    record Source(String name, String sha256) {}
    record Period(LocalDate start, LocalDate end, Integer days, Long amount, Long count, Long afternoonCount,
                  Long quantity, Long productAmount) {}
    record Comparison(String product, Period before, Period after, List<Source> sources) {}
    record Inventory(LocalDate date, String product, Long actualQuantity, List<Remaining> remaining) {}
    record Remaining(String name, String unit, BigDecimal quantity) {}
}
