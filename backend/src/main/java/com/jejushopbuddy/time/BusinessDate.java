package com.jejushopbuddy.time;

import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.stereotype.Service;

@Service
public class BusinessDate {
    private final JdbcClient jdbc;

    public BusinessDate(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public static LocalDate actualToday() {
        return LocalDate.now(ZoneId.of("Asia/Seoul"));
    }

    public LocalDate today() {
        var owner = SecurityContextHolder.getContext().getAuthentication();
        if (owner == null || !owner.isAuthenticated() || owner instanceof AnonymousAuthenticationToken) {
            return actualToday();
        }
        return jdbc.sql("SELECT rehearsal_date FROM owners WHERE email = :email AND rehearsal_date IS NOT NULL")
                .param("email", owner.getName()).query(LocalDate.class).optional().orElseGet(BusinessDate::actualToday);
    }

    public boolean rehearsing() {
        var owner = SecurityContextHolder.getContext().getAuthentication();
        return owner != null && owner.isAuthenticated() && !(owner instanceof AnonymousAuthenticationToken)
                && jdbc.sql("SELECT EXISTS (SELECT 1 FROM owners WHERE email = :email AND rehearsal_date IS NOT NULL)")
                    .param("email", owner.getName()).query(Boolean.class).single();
    }
}
