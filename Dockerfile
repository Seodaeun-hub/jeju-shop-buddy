FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /build
COPY backend/pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY backend/src/main ./src/main
COPY --from=frontend /build/dist ./src/main/resources/static
RUN mvn -B -q -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --user-group --no-create-home shopbuddy
WORKDIR /app
COPY --from=backend /build/target/jeju-shop-buddy-backend-0.1.0-SNAPSHOT.jar ./app.jar
COPY schema.sql migration-store-reviews.sql seed-jeju-areas.sql deploy/init-db.sql deploy/start-web.sh ./
USER shopbuddy
ENV SERVER_SERVLET_SESSION_COOKIE_SECURE=true
CMD ["/bin/sh", "/app/start-web.sh"]
