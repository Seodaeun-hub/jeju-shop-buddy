package com.jejushopbuddy;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
class WebPageRoutes implements WebMvcConfigurer {
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        for (String path : new String[] {"/login", "/signup", "/my-page", "/stores", "/stores/new",
                "/sales", "/analysis", "/strategy", "/execution", "/results", "/menu/{publicId}"}) {
            registry.addViewController(path).setViewName("forward:/index.html");
        }
    }
}
