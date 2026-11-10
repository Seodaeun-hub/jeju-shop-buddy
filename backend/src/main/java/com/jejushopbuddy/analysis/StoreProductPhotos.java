package com.jejushopbuddy.analysis;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class StoreProductPhotos {
    private static final String JPEG = "data:image/jpeg;base64,";
    private final JdbcClient jdbc;

    StoreProductPhotos(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    String find(UUID storeId, String name) {
        return jdbc.sql("SELECT photo_data_url FROM store_product_photos WHERE store_id=:store AND product_name=:name")
                .param("store", storeId).param("name", name).query(String.class).optional().orElse(null);
    }

    void save(UUID storeId, String name, String photo) {
        if (photo == null) {
            jdbc.sql("DELETE FROM store_product_photos WHERE store_id=:store AND product_name=:name")
                    .param("store", storeId).param("name", name).update();
            return;
        }
        jdbc.sql("""
                INSERT INTO store_product_photos (store_id, product_name, photo_data_url) VALUES (:store,:name,:photo)
                ON CONFLICT (store_id, product_name) DO UPDATE SET photo_data_url=EXCLUDED.photo_data_url
                """).param("store", storeId).param("name", name).param("photo", photo).update();
    }

    static boolean valid(String photo) {
        if (photo == null) return true;
        if (!photo.startsWith(JPEG) || photo.length() > 450_000) return false;
        try {
            byte[] bytes = Base64.getDecoder().decode(photo.substring(JPEG.length()));
            try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                if (stream == null) return false;
                var readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) return false;
                var reader = readers.next();
                try {
                    if (!"JPEG".equalsIgnoreCase(reader.getFormatName())) return false;
                    reader.setInput(stream);
                    return reader.getWidth(0) <= 900 && reader.getHeight(0) <= 900 && reader.read(0) != null;
                } finally {
                    reader.dispose();
                }
            }
        } catch (IllegalArgumentException | IOException failure) {
            return false;
        }
    }
}
