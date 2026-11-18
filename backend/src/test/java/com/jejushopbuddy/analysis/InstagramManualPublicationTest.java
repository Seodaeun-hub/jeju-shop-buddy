package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class InstagramManualPublicationTest {
    @Test
    void rejectsAutomaticPublishingWithoutReadingOrWritingAnyStoreData() {
        var controller = new InstagramPublicationController(null, null);
        var result = controller.publish(UUID.randomUUID());
        assertThat(result.getStatusCode().value()).isEqualTo(410);
        assertThat(JsonMapper.builder().build().writeValueAsString(result.getBody()))
                .contains("INSTAGRAM_AUTOMATIC_PUBLICATION_REMOVED", "직접 게시");
    }

    @Test
    void retiresTheScheduleMutationAndTemporaryMediaRoutes() {
        var controller = new InstagramPublicationController(null, null);
        assertThat(controller.cancel(UUID.randomUUID()).getStatusCode().value()).isEqualTo(410);
        assertThat(controller.image(UUID.randomUUID()).getStatusCode().value()).isEqualTo(410);
    }
}
