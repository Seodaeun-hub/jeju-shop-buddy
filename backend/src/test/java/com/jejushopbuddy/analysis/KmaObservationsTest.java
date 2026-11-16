package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.net.SocketTimeoutException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KmaObservationsTest {
    private static final String OBSERVATIONS = "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList";
    private static final LocalDate DAY = LocalDate.of(2021, 5, 29);
    private static final KmaObservations.Station JEJU = new KmaObservations.Station(184, "제주", 33.51411, 126.52969);
    private final RestClient.Builder http = RestClient.builder();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(http).build();
    private final KmaObservations observations = new KmaObservations(http, "test-key");

    @Test
    void recoversObservationsAfterTemporaryProviderFailure() {
        server.expect(requestTo(startsWith(OBSERVATIONS))).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        server.expect(requestTo(startsWith(OBSERVATIONS))).andRespond(withSuccess("""
                {"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[
                    {"stnId":"184","tm":"2021-05-29","sumRn":"","iscs":"","avgTa":"19.3"}
                ]}}}}
                """, MediaType.APPLICATION_JSON));

        assertThat(observations.rainfall(JEJU, DAY, DAY))
                .containsEntry(DAY, new KmaObservations.Observation(null, false));
        server.verify();
    }

    @Test
    void returnsEmptyAfterTwoTimeouts() {
        server.expect(requestTo(startsWith(OBSERVATIONS))).andRespond(withException(new SocketTimeoutException()));
        server.expect(requestTo(startsWith(OBSERVATIONS))).andRespond(withException(new SocketTimeoutException()));

        assertThat(observations.rainfall(JEJU, DAY, DAY)).isEmpty();
        server.verify();
    }

    @Test
    void doesNotRetryAnInvalidRequest() {
        server.expect(requestTo(startsWith(OBSERVATIONS))).andRespond(withStatus(HttpStatus.BAD_REQUEST));

        assertThat(observations.rainfall(JEJU, DAY, DAY)).isEmpty();
        server.verify();
    }
}
