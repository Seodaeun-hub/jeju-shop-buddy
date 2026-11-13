package com.jejushopbuddy.store;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods = false)
class StoreSecurityConfiguration {
    static final StoreController.ApiError AUTH_REQUIRED = new StoreController.ApiError(
            "AUTH_REQUIRED", "로그인 후 매장을 등록해 주세요.", null);

    @Bean
    SecurityFilterChain storeSecurity(HttpSecurity http, ObjectMapper json, HttpSessionSecurityContextRepository sessions) throws Exception {
        AuthenticationEntryPoint unauthorized = (request, response, failure) -> {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            if (!"XMLHttpRequest".equals(request.getHeader("X-Requested-With"))) {
                response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Basic realm=\"Shop Buddy\"");
            }
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            String path = request.getRequestURI().substring(request.getContextPath().length());
            var error = AUTH_REQUIRED;
            if (path.endsWith("/results") && request.getMethod().equals("POST")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 결과를 저장해 주세요.", null);
            } else if (path.startsWith("/api/plans/") && request.getMethod().equals("DELETE")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 결과를 삭제해 주세요.", null);
            } else if (path.startsWith("/api/plans/") && request.getMethod().equals("PUT")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 결과를 수정해 주세요.", null);
            } else if (path.endsWith("/results") && request.getMethod().equals("GET")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 결과를 조회해 주세요.", null);
            } else if (path.startsWith("/api/plans/") && request.getMethod().equals("PATCH")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 체크리스트를 변경해 주세요.", null);
            } else if (path.startsWith("/api/plans/")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 계획을 조회해 주세요.", null);
            } else if (path.endsWith("/plans") && request.getMethod().equals("POST")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 실행 계획을 만들어 주세요.", null);
            } else if (path.endsWith("/strategies") && request.getMethod().equals("GET")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 대응 전략을 조회해 주세요.", null);
            } else if (path.endsWith("/time-series") && request.getMethod().equals("PUT")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 시간대별 자료를 저장해 주세요.", null);
            } else if (path.startsWith("/api/analyses/")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 매출 분석을 조회해 주세요.", null);
            } else if (path.endsWith("/analyses")) {
                error = new StoreController.ApiError("AUTH_REQUIRED", "로그인 후 매출 분석을 저장해 주세요.", null);
            }
            response.getWriter().write(json.writeValueAsString(error));
        };
        return http.securityMatcher("/api/session", "/api/session/signup", "/api/session/profile", "/api/session/password", "/api/stores", "/api/stores/{storeId}/analyses",
                        "/api/stores/{storeId}/menu-photos", "/api/stores/{storeId}/menu-costs", "/api/stores/{storeId}/promotion-tone",
                        "/api/stores/{storeId}/break-even", "/api/stores/{storeId}/menu-costs/receipt",
                        "/api/stores/{storeId}/pos-files", "/api/stores/{storeId}/pos-files/{fileId}",
                        "/api/stores/{storeId}/pos-files/toss", "/api/execution-reminders",
                        "/api/push/config", "/api/push/test", "/api/push/weekly-subscription", "/api/push/result-subscription",
                        "/api/analyses/{analysisId}", "/api/analyses/{analysisId}/time-series", "/api/analyses/{analysisId}/strategies", "/api/analyses/{analysisId}/plans",
                        "/api/analyses/{analysisId}/recommendations", "/api/analyses/{analysisId}/execution-guide",
                        "/api/analyses/{analysisId}/reviews", "/api/analyses/{analysisId}/review-plans",
                        "/api/analyses/{analysisId}/questions", "/api/analyses/{analysisId}/concern-check", "/api/analyses/{analysisId}/hourly-sales",
                        "/api/plans/{planId}", "/api/plans/{planId}/checklist/{itemId}", "/api/plans/{planId}/results",
                        "/api/plans/{planId}/results/{resultId}", "/api/plans/{planId}/inventory-review", "/api/plans/{planId}/inventory-review/forecast",
                        "/api/plans/{planId}/inventory-review/recipes", "/api/plans/{planId}/inventory-review/estimates",
                        "/api/plans/{planId}/inventory-review/estimate-note",
                        "/api/plans/{planId}/promotion-review", "/api/plans/{planId}/promotion-review/defaults", "/api/plans/{planId}/promotion-review-points", "/api/plans/{planId}/promotion-draft", "/api/plans/{planId}/promotion-draft/caption",
                        "/api/plans/{planId}/promotion-photo", "/api/plans/{planId}/store-notice", "/api/plans/{planId}/instagram-publication", "/api/plans/{planId}/promotion-impact",
                        "/api/plans/{planId}/promotion-impact/publication", "/api/plans/{planId}/promotion-impact/next-checklist", "/api/plans/{planId}/promotion-impact/next-explanation",
                        "/api/plans/{planId}/promotion-impact/actuals", "/api/plans/{planId}/promotion-impact/next-plan/{requestId}")
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, "/api/session/signup")
                        .access((authentication, context) -> new AuthorizationDecision(
                                "XMLHttpRequest".equals(context.getRequest().getHeader("X-Requested-With"))))
                        .anyRequest().access((authentication, context) -> {
                    var request = context.getRequest();
                    boolean read = request.getMethod().equals("GET") || request.getMethod().equals("HEAD");
                    boolean appRequest = "XMLHttpRequest".equals(request.getHeader("X-Requested-With"));
                    String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
                    boolean basic = authorization != null && authorization.regionMatches(true, 0, "Basic ", 0, 6);
                    boolean sessionEndpoint = request.getServletPath().startsWith("/api/session");
                    var user = authentication.get();
                    return new AuthorizationDecision(user != null && user.isAuthenticated()
                            && !(user instanceof org.springframework.security.authentication.AnonymousAuthenticationToken)
                            && (read || appRequest || (!sessionEndpoint && basic)));
                }))
                .securityContext(security -> security.securityContextRepository(sessions).requireExplicitSave(true))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .requestCache(cache -> cache.disable())
                .csrf(AbstractHttpConfigurer::disable)
                .exceptionHandling(errors -> errors.authenticationEntryPoint(unauthorized))
                .httpBasic(basic -> basic.authenticationEntryPoint(unauthorized))
                .build();
    }

    @Bean
    HttpSessionSecurityContextRepository ownerSessions() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    UserDetailsService storeOwners(JdbcClient jdbc) {
        return username -> jdbc.sql("SELECT email, password_hash FROM owners WHERE email = :email")
                .param("email", username.strip().toLowerCase(Locale.ROOT))
                .query((rs, row) -> User.withUsername(rs.getString("email"))
                        .password(rs.getString("password_hash")).roles("OWNER").build())
                .optional()
                .orElseThrow(() -> new UsernameNotFoundException("Owner account not found"));
    }

    @Bean
    PasswordEncoder ownerPasswordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
