package com.jejushopbuddy.store;

import java.security.Principal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stores/{storeId}/pos-files/toss")
class TossPosImportController {
    private final JdbcClient jdbc;
    private final TossPlacePosClient toss;
    private final String linkedStore;

    TossPosImportController(JdbcClient jdbc, TossPlacePosClient toss,
                            @Value("${SHOP_BUDDY_TOSS_STORE_ID:}") String linkedStore) {
        this.jdbc = jdbc;
        this.toss = toss;
        this.linkedStore = linkedStore.strip();
    }

    @GetMapping
    ResponseEntity<?> config(@PathVariable UUID storeId, Principal owner) {
        if (!owns(storeId, owner)) return missingStore();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(Map.of("enabled", enabled(storeId)));
    }

    @PostMapping
    @Transactional
    ResponseEntity<?> importMonth(@PathVariable UUID storeId, @RequestBody ImportRequest input, Principal owner) {
        if (!owns(storeId, owner)) return missingStore();
        if (!enabled(storeId)) {
            return error(HttpStatus.CONFLICT, "TOSS_NOT_LINKED", "이 매장에 토스포스 연결이 설정되지 않았어요.");
        }
        var now = Instant.now();
        LocalDate today = now.atZone(TossPlacePosClient.SEOUL).toLocalDate();
        YearMonth current = YearMonth.from(today);
        YearMonth month;
        try {
            month = YearMonth.parse(input.month() == null ? "" : input.month());
        } catch (DateTimeParseException invalid) {
            return invalidMonth();
        }
        if (month.getYear() < 1900 || month.isAfter(current)) return invalidMonth();

        // One import per linked store at a time, including across app instances.
        boolean locked = jdbc.sql("SELECT pg_try_advisory_xact_lock(hashtextextended(:key, 0))")
                .param("key", "toss-pos:" + storeId).query(Boolean.class).single();
        if (!locked) return error(HttpStatus.CONFLICT, "TOSS_IMPORT_RUNNING", "이미 토스포스 자료를 불러오는 중이에요.");
        var snapshot = toss.fetch(month, now);
        boolean existing = jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM store_pos_files WHERE store_id = :store AND toss_month = :month)
                """).param("store", storeId).param("month", month.atDay(1)).query(Boolean.class).single();
        boolean saved = existing || snapshot.paymentCount() > 0;
        if (saved) {
            LocalDate lastDay = month.equals(current) ? today : month.atEndOfMonth();
            // The in-progress month is not considered a complete monthly export.
            LocalDate coverageStart = month.equals(current) ? null : month.atDay(1);
            LocalDate coverageEnd = month.equals(current) ? null : lastDay;
            save(storeId, month, "PAYMENT", "결제", snapshot.payments(), coverageStart, coverageEnd, lastDay);
            save(storeId, month, "PRODUCT", "상품 주문", snapshot.products(), coverageStart, coverageEnd, lastDay);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ImportResult(
                saved, snapshot.orderCount(), snapshot.paymentCount(), snapshot.revenue(), snapshot.incompleteProductRevenue()));
    }

    private void save(UUID storeId, YearMonth month, String kind, String label, byte[] content,
                      LocalDate coverageStart, LocalDate coverageEnd, LocalDate calendarDate) {
        jdbc.sql("""
                INSERT INTO store_pos_files (id, store_id, kind, filename, content,
                    coverage_start, coverage_end, calendar_date, toss_month)
                VALUES (:id, :store, :kind, :filename, :content, :start, :end, :day, :month)
                ON CONFLICT (store_id, kind, toss_month) DO UPDATE
                SET id = EXCLUDED.id, content = EXCLUDED.content, uploaded_at = EXCLUDED.uploaded_at,
                    coverage_start = EXCLUDED.coverage_start, coverage_end = EXCLUDED.coverage_end,
                    calendar_date = EXCLUDED.calendar_date
                WHERE (store_pos_files.content, store_pos_files.coverage_start, store_pos_files.coverage_end,
                    store_pos_files.calendar_date) IS DISTINCT FROM (EXCLUDED.content, EXCLUDED.coverage_start,
                    EXCLUDED.coverage_end, EXCLUDED.calendar_date)
                """).param("id", UUID.randomUUID()).param("store", storeId).param("kind", kind)
                .param("filename", "토스포스 " + month + " " + label + ".csv").param("content", content)
                .param("start", coverageStart).param("end", coverageEnd).param("day", calendarDate)
                .param("month", month.atDay(1)).update();
    }

    private boolean enabled(UUID storeId) {
        return toss.configured() && storeId.toString().equalsIgnoreCase(linkedStore);
    }

    private boolean owns(UUID storeId, Principal owner) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email)
                """).param("store", storeId).param("email", owner.getName()).query(Boolean.class).single();
    }

    @ExceptionHandler(TossPlacePosClient.ImportFailure.class)
    ResponseEntity<?> tossUnavailable(TossPlacePosClient.ImportFailure failure) {
        return error(HttpStatus.BAD_GATEWAY, "TOSS_IMPORT_UNAVAILABLE", failure.getMessage());
    }

    private static ResponseEntity<?> missingStore() {
        return error(HttpStatus.NOT_FOUND, "STORE_NOT_FOUND", "매장을 찾을 수 없어요.");
    }

    private static ResponseEntity<?> invalidMonth() {
        return error(HttpStatus.BAD_REQUEST, "INVALID_TOSS_MONTH", "불러올 연도와 월을 확인해 주세요.");
    }

    private static ResponseEntity<?> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                .body(new StoreController.ApiError(code, message, null));
    }

    record ImportRequest(String month) {}
    record ImportResult(boolean saved, int orderCount, int paymentCount, long revenue, int incompleteProductRevenue) {}
}
