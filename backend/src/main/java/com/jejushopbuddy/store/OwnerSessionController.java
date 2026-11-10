package com.jejushopbuddy.store;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/session")
class OwnerSessionController {
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private final HttpSessionSecurityContextRepository sessions;
    private final JdbcClient jdbc;
    private final PasswordEncoder passwords;

    OwnerSessionController(HttpSessionSecurityContextRepository sessions, JdbcClient jdbc, PasswordEncoder passwords) {
        this.sessions = sessions;
        this.jdbc = jdbc;
        this.passwords = passwords;
    }

    @PostMapping("/signup")
    ResponseEntity<?> signup(@RequestBody Signup input, HttpServletRequest request, HttpServletResponse response) {
        String name = input.name() == null ? "" : input.name().strip();
        String email = input.email() == null ? "" : input.email().strip().toLowerCase(Locale.ROOT);
        String password = input.password();
        if (!validName(name)) {
            return invalid("사장님 이름이나 별명을 1~30자로 입력해 주세요.", "name");
        }
        if (email.length() > 254 || email.codePoints().anyMatch(Character::isISOControl) || !EMAIL.matcher(email).matches()) {
            return invalid("이메일 주소를 확인해 주세요.", "email");
        }
        if (!validNewPassword(password)) {
            return invalid("비밀번호는 8자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.", "password");
        }

        String hash = passwords.encode(password);
        int inserted = jdbc.sql("""
                INSERT INTO owners (id, name, email, password_hash)
                VALUES (:id, :name, :email, :hash)
                ON CONFLICT (email) DO NOTHING
                """).param("id", UUID.randomUUID()).param("name", name)
                .param("email", email).param("hash", hash).update();
        if (inserted == 0) {
            return ResponseEntity.status(409).body(new StoreController.ApiError(
                    "EMAIL_ALREADY_REGISTERED", "이미 가입한 이메일이에요. 로그인해 주세요.", "email"));
        }

        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                email, null, AuthorityUtils.createAuthorityList("ROLE_OWNER")));
        SecurityContextHolder.setContext(context);
        saveSession(request, response);
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(new OwnerSession(email, name));
    }

    @PostMapping
    ResponseEntity<OwnerSession> login(Principal owner, HttpServletRequest request, HttpServletResponse response) {
        saveSession(request, response);
        return current(owner);
    }

    @GetMapping
    ResponseEntity<OwnerSession> current(Principal owner) {
        String email = owner.getName();
        return jdbc.sql("SELECT name FROM owners WHERE email = :email").param("email", email)
                .query(String.class).optional()
                .map(name -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new OwnerSession(email, name)))
                .orElseGet(() -> ResponseEntity.status(401).build());
    }

    @PatchMapping("/profile")
    ResponseEntity<?> updateProfile(@RequestBody ProfileInput input, Principal owner) {
        String name = input.name() == null ? "" : input.name().strip();
        if (!validName(name)) {
            return invalid("사장님 이름이나 별명을 1~30자로 입력해 주세요.", "name");
        }
        String email = owner.getName();
        int updated = jdbc.sql("UPDATE owners SET name = :name WHERE email = :email")
                .param("name", name).param("email", email).update();
        if (updated == 0) return ResponseEntity.status(401).build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new OwnerSession(email, name));
    }

    @PutMapping("/password")
    ResponseEntity<?> updatePassword(@RequestBody PasswordInput input, Principal owner,
                                     HttpServletRequest request, HttpServletResponse response) {
        if (!validNewPassword(input.newPassword())) {
            return invalid("새 비밀번호는 8자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.", "newPassword");
        }
        String current = input.currentPassword();
        String email = owner.getName();
        var previous = jdbc.sql("SELECT password_hash FROM owners WHERE email = :email")
                .param("email", email).query(String.class).optional();
        if (previous.isEmpty()) return ResponseEntity.status(401).build();
        if (current == null || current.getBytes(StandardCharsets.UTF_8).length > 72
                || !passwords.matches(current, previous.get())) {
            return invalid("현재 비밀번호가 일치하지 않아요.", "currentPassword");
        }
        if (current.equals(input.newPassword())) {
            return invalid("현재 비밀번호와 다른 비밀번호를 입력해 주세요.", "newPassword");
        }

        int updated = jdbc.sql("""
                UPDATE owners SET password_hash = :hash WHERE email = :email AND password_hash = :previous
                """).param("hash", passwords.encode(input.newPassword())).param("email", email)
                .param("previous", previous.get()).update();
        if (updated == 0) return ResponseEntity.status(409).body(new StoreController.ApiError(
                "PASSWORD_CHANGED", "비밀번호가 이미 변경됐어요. 현재 비밀번호를 다시 확인해 주세요.", "currentPassword"));
        saveSession(request, response);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    ResponseEntity<Void> logout(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }

    private void saveSession(HttpServletRequest request, HttpServletResponse response) {
        if (request.getSession(false) != null) request.changeSessionId();
        sessions.saveContext(SecurityContextHolder.getContext(), request, response);
    }

    private static boolean validName(String name) {
        return !name.isBlank() && name.length() <= 30 && name.codePoints().noneMatch(Character::isISOControl);
    }

    private static boolean validNewPassword(String password) {
        return password != null && !password.isBlank() && password.length() >= 8
                && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    private static ResponseEntity<StoreController.ApiError> invalid(String message, String field) {
        return ResponseEntity.badRequest().body(new StoreController.ApiError("INVALID_ACCOUNT_INPUT", message, field));
    }

    record Signup(String name, String email, String password) {}
    record ProfileInput(String name) {}
    record PasswordInput(String currentPassword, String newPassword) {}
    record OwnerSession(String email, String name) {}
}
