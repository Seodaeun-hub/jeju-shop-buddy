package com.jejushopbuddy.analysis;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jejushopbuddy.analysis.SalesAnalysisController.AnalysisResponse;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

class ChartQuestionTranscriptionTest {
    @Test
    void convertsOwnedAudioWithoutWritingAConversation() throws Exception {
        var analysisId = UUID.randomUUID();
        var reader = mock(SalesAnalysisReader.class);
        var jdbc = mock(JdbcClient.class);
        var agent = mock(StrategyAgentClient.class);
        when(reader.find(analysisId, "owner@example.test")).thenReturn(Optional.of(mock(AnalysisResponse.class)));
        when(agent.transcribeQuestion(any())).thenReturn(Optional.of(new ChartQuestionController.Transcript("고기국수 판매량")));
        var mvc = MockMvcBuilders.standaloneSetup(new ChartQuestionController(
                jdbc, new JsonMapper(), reader, mock(ChartQuestionEvidence.class), agent)).build();

        mvc.perform(post("/api/analyses/{id}/questions/transcription", analysisId)
                        .principal(() -> "owner@example.test").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mediaType":"audio/mp4","audio":"AQID"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("고기국수 판매량"));

        mvc.perform(post("/api/analyses/{id}/questions/transcription", analysisId)
                        .principal(() -> "owner@example.test").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mediaType":"text/plain","audio":"AQID"}
                                """))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/analyses/{id}/questions/transcription", analysisId)
                        .principal(() -> "other@example.test").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mediaType":"audio/mp4","audio":"AQID"}
                                """))
                .andExpect(status().isNotFound());
        verifyNoInteractions(jdbc);
    }
}
