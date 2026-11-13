package com.jejushopbuddy.analysis;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.IntFunction;
import java.util.regex.Pattern;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class ProductPosArchive {
    private static final long MAX_TOTAL = 9_007_199_254_740_991L;
    private static final Pattern DATE = Pattern.compile("(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})");
    private static final Pattern AMOUNT = Pattern.compile("(?:\\d+|\\d{1,3}(?:,\\d{3})+)");
    private static final Pattern REVENUE = Pattern.compile("실판매금액(?:\\(.+\\))?");
    private static final Charset KOREAN_CSV = Charset.forName("MS949");
    private static final int FILE_CACHE_SIZE = 8;
    static {
        ZipSecureFile.setMaxEntrySize(32L * 1024 * 1024);
        ZipSecureFile.setMaxFileCount(200);
    }
    private final JdbcClient jdbc;
    private final LinkedHashMap<UUID, Days> cache = new LinkedHashMap<>(16, .75f, true);

    ProductPosArchive(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<Days> load(UUID storeId) {
        return jdbc.sql("""
                SELECT id, lower(filename) LIKE '%.xlsx' AS workbook, coverage_start, coverage_end
                FROM store_pos_files WHERE store_id = :store AND (kind = 'PRODUCT' OR lower(filename) LIKE '%.xlsx')
                ORDER BY uploaded_at DESC, id DESC
                """).param("store", storeId)
                .query((rs, row) -> new FileRef(rs.getObject("id", UUID.class), rs.getBoolean("workbook"),
                        rs.getObject("coverage_start", LocalDate.class), rs.getObject("coverage_end", LocalDate.class)))
                .list().stream().map(this::read).toList();
    }

    private Days read(FileRef file) {
        synchronized (cache) {
            var cached = cache.get(file.id());
            if (cached != null) return cached;
        }
        byte[] content = jdbc.sql("SELECT content FROM store_pos_files WHERE id = :id")
                .param("id", file.id()).query(byte[].class).optional().orElse(null);
        Days days = parse(content, file.workbook(), file.start(), file.end());
        synchronized (cache) {
            cache.put(file.id(), days);
            if (cache.size() > FILE_CACHE_SIZE) cache.pollFirstEntry();
        }
        return days;
    }

    static Days parse(byte[] content, boolean workbook, LocalDate coverageStart, LocalDate coverageEnd) {
        if (content == null) return Days.EMPTY;
        var orders = new Orders();
        try {
            if (workbook) {
                try (var document = new XSSFWorkbook(new ByteArrayInputStream(content))) {
                    var sheet = document.getSheet("상품 주문");
                    if (sheet == null) return Days.EMPTY;
                    for (Row row : sheet) orders.row(row.getLastCellNum(), index -> excelValue(row, index));
                }
            } else {
                try (var csv = CSVParser.parse(csvText(content), CSVFormat.DEFAULT)) {
                    for (var row : csv) orders.row(row.size(), row::get);
                }
            }
        } catch (IOException | RuntimeException invalid) {
            return Days.EMPTY;
        }
        if (orders.columns == null) return Days.EMPTY;
        boolean declared = coverageStart != null && coverageEnd != null && orders.days.keySet().stream()
                .allMatch(day -> !day.isBefore(coverageStart) && !day.isAfter(coverageEnd));
        return new Days(orders.days, declared ? coverageStart : null, declared ? coverageEnd : null);
    }

    private static String csvText(byte[] content) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(content)).toString();
        } catch (CharacterCodingException invalid) {
            text = new String(content, KOREAN_CSV);
        }
        return text.startsWith("\uFEFF") ? text.substring(1) : text;
    }

    private static String excelValue(Row row, int index) {
        var cell = row.getCell(index);
        if (cell == null) return "";
        CellType type = cell.getCellType() == CellType.FORMULA ? cell.getCachedFormulaResultType() : cell.getCellType();
        return switch (type) {
            case STRING -> cell.getStringCellValue();
            case NUMERIC -> DateUtil.isCellDateFormatted(cell) ? cell.getLocalDateTimeCellValue().toLocalDate().toString()
                    : BigDecimal.valueOf(cell.getNumericCellValue()).stripTrailingZeros().toPlainString();
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            default -> "";
        };
    }

    static Summary summarize(List<Days> archive, String product, PromotionImpactController.Period period) {
        long quantity = 0;
        long amount = 0;
        int recordedDays = 0;
        LocalDate gapStart = null;
        for (LocalDate day = period.start(); !day.isAfter(period.end()); day = day.plusDays(1)) {
            Days file = null;
            for (Days entry : archive) {
                if (entry.covers(day)) {
                    file = entry;
                    break;
                }
            }
            var products = file == null ? null : file.orders().get(day);
            var item = products == null ? null : products.get(product);
            if (file == null || item != null && (item.quantity() < 0 || item.amount() < 0)) {
                if (gapStart == null) gapStart = day;
                continue;
            }
            if (gapStart != null) return new Summary(null, new PromotionImpactController.Period(gapStart, day.minusDays(1)));
            if (products != null) recordedDays++;
            if (item != null) {
                quantity += item.quantity();
                amount += item.amount();
                if (quantity > MAX_TOTAL || amount > MAX_TOTAL) {
                    return new Summary(null, period);
                }
            }
        }
        return gapStart == null
                ? new Summary(new PromotionImpactController.Totals(quantity, amount, recordedDays), null)
                : new Summary(null, new PromotionImpactController.Period(gapStart, period.end()));
    }

    static Long soldOn(List<Days> archive, String product, LocalDate day) {
        for (Days entry : archive) {
            if (!entry.covers(day)) continue;
            var products = entry.orders().get(day);
            if (products == null || products.values().stream().noneMatch(item -> item.quantity() > 0)) return null;
            var item = products.get(product);
            if (item != null && item.quantity() < 0) return null;
            return item == null ? 0L : item.quantity();
        }
        return null;
    }

    private static long total(String value) {
        if (!AMOUNT.matcher(value).matches()) return -1;
        try {
            long amount = Long.parseLong(value.replace(",", ""));
            return amount <= MAX_TOTAL ? amount : -1;
        } catch (NumberFormatException invalid) {
            return -1;
        }
    }

    private static long addTotal(long first, long second) {
        return first < 0 || second < 0 || first + second > MAX_TOTAL ? -1 : first + second;
    }

    private static final class Orders {
        private final Map<LocalDate, Map<String, Item>> days = new HashMap<>();
        private int[] columns;

        void row(int length, IntFunction<String> cell) {
            List<String> fields = java.util.stream.IntStream.range(0, length)
                    .mapToObj(i -> cell.apply(i).strip()).toList();
            if (fields.stream().allMatch(String::isEmpty)) return;
            if (columns == null) {
                var header = fields.stream().map(value -> value.replaceAll("(?U)\\s", "")).toList();
                int amount = 0;
                while (amount < header.size() && !REVENUE.matcher(header.get(amount)).matches()) amount++;
                columns = new int[] {header.indexOf("주문기준일자"), header.indexOf("결제상태"),
                        header.indexOf("상품명"), header.indexOf("수량"), amount < header.size() ? amount : -1};
                for (int index : columns) if (index < 0) throw new IllegalArgumentException("Invalid product POS header");
                return;
            }
            var date = DATE.matcher(value(fields, columns[0]));
            String state = value(fields, columns[1]);
            String name = value(fields, columns[2]);
            if (!date.matches() || name.isEmpty()) throw new IllegalArgumentException("Invalid product POS row");
            var day = LocalDate.of(Integer.parseInt(date.group(1)), Integer.parseInt(date.group(2)), Integer.parseInt(date.group(3)));
            var products = days.computeIfAbsent(day, ignored -> new HashMap<>());
            if (state.equals("취소") || state.equals("결제취소")) return;
            if (!state.equals("완료") && !state.equals("결제완료")) throw new IllegalArgumentException("Invalid payment state");
            long quantity = total(value(fields, columns[3]));
            long amount = total(value(fields, columns[4]));
            var previous = products.getOrDefault(name, new Item(0, 0));
            products.put(name, new Item(addTotal(previous.quantity(), quantity), addTotal(previous.amount(), amount)));
        }

        private static String value(List<String> fields, int index) {
            return index < fields.size() ? fields.get(index) : "";
        }
    }

    private record FileRef(UUID id, boolean workbook, LocalDate start, LocalDate end) {}
    record Item(long quantity, long amount) {}
    record Days(Map<LocalDate, Map<String, Item>> orders, LocalDate start, LocalDate end) {
        static final Days EMPTY = new Days(Map.of(), null, null);
        boolean covers(LocalDate day) {
            return orders.containsKey(day) || start != null && !day.isBefore(start) && !day.isAfter(end);
        }
    }
    record Summary(PromotionImpactController.Totals totals, PromotionImpactController.Period gap) {}
}
