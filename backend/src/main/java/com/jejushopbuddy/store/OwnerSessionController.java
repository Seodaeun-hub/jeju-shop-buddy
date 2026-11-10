package com.jejushopbuddy.store;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.Principal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/session")
class OwnerSessionController {
    private final HttpSessionSecurityContextRepository sessions;

    OwnerSessionController(HttpSessionSecurityContextRepository sessions) {
        this.sessions = sessions;
    }

    @PostMapping
    ResponseEntity<OwnerSession> login(Principal owner, HttpServletRequest request, HttpServletResponse response) {
        if (request.getSession(false) != null) request.changeSessionId();
        sessions.saveContext(SecurityContextHolder.getContext(), request, response);
        return current(owner);
    }

    @GetMapping
    ResponseEntity<OwnerSession> current(Principal owner) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new OwnerSession(owner.getName()));
    }

    @DeleteMapping
    ResponseEntity<Void> logout(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }

    record OwnerSession(String email) {}
}
