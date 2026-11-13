package com.jejushopbuddy.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/stores/{storeId}/pos-files")
class StorePosFileController {
    private static final int MAX_SIZE = 10 * 1024 * 1024;
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final JdbcClient jdbc;

    StorePosFileController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    ResponseEntity<?> list(@PathVariable UUID storeId, Principal owner) {
        if (!owns(storeId, owner)) {
            return error(HttpStatus.NOT_FOUND, "STORE_NOT_FOUND", "매장을 찾을 수 없어요.");
        }
        var files = jdbc.sql("""
                SELECT id, kind, filename, octet_length(content) AS size, uploaded_at, coverage_start, coverage_end, calendar_date
                FROM store_pos_files WHERE store_id = :store
                ORDER BY uploaded_at DESC, id DESC
                """).param("store", storeId).query(StorePosFileController::metadata).list();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(files);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<?> upload(@PathVariable UUID storeId, @RequestParam String kind,
                             @RequestParam MultipartFile file, @RequestParam(required = false) LocalDate coverageStart,
                             @RequestParam(required = false) LocalDate coverageEnd,
                             @RequestParam(required = false) LocalDate calendarDate, Principal owner) {
        String originalName = file.getOriginalFilename();
        String filename = originalName == null ? "" : originalName.replace('\\', '/');
        filename = filename.substring(filename.lastIndexOf('/') + 1).strip();
        String extension = filename.toLowerCase(Locale.ROOT);
        boolean allowedType = switch (kind) {
            case "PAYMENT" -> extension.endsWith(".csv") || extension.endsWith(".xlsx");
            case "PRODUCT" -> extension.endsWith(".csv");
            default -> false;
        };
        if (!allowedType || filename.length() > 255 || filename.codePoints().anyMatch(Character::isISOControl)
                || file.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "INVALID_POS_FILE", "파일 종류와 이름을 확인해 주세요. 결제 내역은 엑셀·CSV, 상품 주문은 CSV를 올릴 수 있어요.");
        }
        if (file.getSize() > MAX_SIZE) {
            return tooLarge();
        }
        LocalDate today = LocalDate.now(SEOUL);
        if (calendarDate != null && (calendarDate.getYear() < 1900 || calendarDate.isAfter(today))) {
            return error(HttpStatus.BAD_REQUEST, "INVALID_POS_CALENDAR_DATE", "POS를 기록할 날짜를 확인해 주세요.");
        }
        if ((coverageStart != null || coverageEnd != null) && !validCoverage(coverageStart, coverageEnd, today)) {
            return invalidCoverage();
        }
        byte[] content;
        try {
            content = file.getBytes();
        } catch (IOException failure) {
            return error(HttpStatus.BAD_REQUEST, "UNREADABLE_POS_FILE", "파일을 읽을 수 없어요. 다시 선택해 주세요.");
        }
        var saved = jdbc.sql("""
                INSERT INTO store_pos_files (id, store_id, kind, filename, content, coverage_start, coverage_end, calendar_date)
                SELECT :id, s.id, :kind, :filename, :content, :coverageStart, :coverageEnd, :calendarDate
                FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email
                RETURNING id, kind, filename, octet_length(content) AS size, uploaded_at, coverage_start, coverage_end, calendar_date
                """).param("id", UUID.randomUUID()).param("kind", kind).param("filename", filename)
                .param("content", content).param("store", storeId).param("email", owner.getName())
                .param("coverageStart", coverageStart).param("coverageEnd", coverageEnd).param("calendarDate", calendarDate)
                .query(StorePosFileController::metadata).optional();
        if (saved.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "STORE_NOT_FOUND", "매장을 찾을 수 없어요.");
        }
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(saved.get());
    }

    @GetMapping("/{fileId}")
    ResponseEntity<?> read(@PathVariable UUID storeId, @PathVariable UUID fileId, Principal owner) {
        var file = jdbc.sql("""
                SELECT f.filename, f.content FROM store_pos_files f
                JOIN stores s ON s.id = f.store_id JOIN owners o ON o.id = s.owner_id
                WHERE f.id = :file AND f.store_id = :store AND o.email = :email
                """).param("file", fileId).param("store", storeId).param("email", owner.getName())
                .query((rs, row) -> new StoredFile(rs.getString("filename"), rs.getBytes("content"))).optional();
        if (file.isEmpty()) {
            return missingFile();
        }
        StoredFile stored = file.get();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(stored.filename(), StandardCharsets.UTF_8).build().toString())
                .body(stored.content());
    }

    @PatchMapping(path = "/{fileId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<?> updateCoverage(@PathVariable UUID storeId, @PathVariable UUID fileId,
                                     @RequestBody Coverage coverage, Principal owner) {
        if (coverage == null || !validCoverage(coverage.coverageStart(), coverage.coverageEnd(), LocalDate.now(SEOUL))) {
            return invalidCoverage();
        }
        var saved = jdbc.sql("""
                UPDATE store_pos_files f SET coverage_start = :start, coverage_end = :end
                FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE f.id = :file AND f.store_id = :store AND s.id = f.store_id AND o.email = :email
                RETURNING f.id, f.kind, f.filename, octet_length(f.content) AS size, f.uploaded_at,
                          f.coverage_start, f.coverage_end, f.calendar_date
                """).param("file", fileId).param("store", storeId).param("email", owner.getName())
                .param("start", coverage.coverageStart()).param("end", coverage.coverageEnd())
                .query(StorePosFileController::metadata).optional();
        return saved.isEmpty() ? missingFile() : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(saved.get());
    }

    @DeleteMapping("/{fileId}")
    ResponseEntity<?> delete(@PathVariable UUID storeId, @PathVariable UUID fileId, Principal owner) {
        int deleted = jdbc.sql("""
                DELETE FROM store_pos_files f USING stores s, owners o
                WHERE f.id = :file AND f.store_id = :store AND s.id = f.store_id
                    AND o.id = s.owner_id AND o.email = :email
                """).param("file", fileId).param("store", storeId).param("email", owner.getName()).update();
        return deleted == 0 ? missingFile() : ResponseEntity.noContent().build();
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<?> tooLarge() {
        return error(HttpStatus.PAYLOAD_TOO_LARGE, "POS_FILE_TOO_LARGE", "10MB 이하의 파일을 선택해 주세요.");
    }

    private boolean owns(UUID storeId, Principal owner) {
        return jdbc.sql("""
                SELECT s.id FROM stores s JOIN owners o ON o.id = s.owner_id
                WHERE s.id = :store AND o.email = :email
                """).param("store", storeId).param("email", owner.getName()).query(UUID.class).optional().isPresent();
    }

    private static PosFile metadata(ResultSet rs, int row) throws SQLException {
        return new PosFile(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("filename"),
                rs.getInt("size"), rs.getObject("uploaded_at", OffsetDateTime.class),
                rs.getObject("coverage_start", LocalDate.class), rs.getObject("coverage_end", LocalDate.class),
                rs.getObject("calendar_date", LocalDate.class));
    }

    private static ResponseEntity<?> missingFile() {
        return error(HttpStatus.NOT_FOUND, "POS_FILE_NOT_FOUND", "저장된 파일을 찾을 수 없어요. 파일 목록을 다시 확인해 주세요.");
    }

    private static boolean validCoverage(LocalDate start, LocalDate end, LocalDate today) {
        return start != null && end != null && start.getYear() >= 1900 && !start.isAfter(end) && !end.isAfter(today);
    }

    private static ResponseEntity<?> invalidCoverage() {
        return error(HttpStatus.BAD_REQUEST, "INVALID_POS_COVERAGE", "POS를 내보낸 시작일과 종료일을 확인해 주세요.");
    }

    private static ResponseEntity<?> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                .body(new StoreController.ApiError(code, message, null));
    }

    private record PosFile(UUID id, String kind, String filename, int size, OffsetDateTime uploadedAt,
                           LocalDate coverageStart, LocalDate coverageEnd, LocalDate calendarDate) {}
    private record Coverage(LocalDate coverageStart, LocalDate coverageEnd) {}
    private record StoredFile(String filename, byte[] content) {}
}
