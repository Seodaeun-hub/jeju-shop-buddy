package com.jejushopbuddy;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WebPageRoutesTest {
    @Configuration
    @EnableWebMvc
    @Import(WebPageRoutes.class)
    static class Config {}

    @Test
    void overviewDeepLinkAndReloadReachTheReactApplication() throws Exception {
        try (var context = new AnnotationConfigWebApplicationContext()) {
            context.setServletContext(new MockServletContext());
            context.register(Config.class);
            context.refresh();
            var mvc = MockMvcBuilders.webAppContextSetup(context).build();
            mvc.perform(get("/overview").queryParam("id", "saved-analysis"))
                    .andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        }
    }
}
