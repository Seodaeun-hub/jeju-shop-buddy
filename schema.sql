-- 가게짝꿍 PostgreSQL 초기 스키마
-- db-table-spec.md 기준. 애플리케이션용 빈 데이터베이스에서 실행한다.
-- UUID는 서버가 생성하며, 제주 읍·면·동 기준 데이터는 별도로 등록한다.
-- 월별 매출 최소 건수, 체크리스트 최소 건수, 소유권은 서버에서 검증한다.

BEGIN;

CREATE TABLE owners (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_owners_email UNIQUE (email),
    CONSTRAINT ck_owners_name_not_blank CHECK (name ~ '[^[:space:]]'),
    CONSTRAINT ck_owners_email_normalized CHECK (
        email ~ '[^[:space:]]'
        AND email !~ '^[[:space:]]|[[:space:]]$'
        AND email = lower(email)
    ),
    CONSTRAINT ck_owners_password_hash_not_blank CHECK (password_hash ~ '[^[:space:]]')
);

CREATE TABLE jeju_areas (
    code VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,

    CONSTRAINT ck_jeju_areas_code CHECK (code ~ '^[A-Z0-9_]+$'),
    CONSTRAINT ck_jeju_areas_name_not_blank CHECK (name ~ '[^[:space:]]')
);

CREATE TABLE stores (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    area_code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL,
    address_detail VARCHAR(100),
    address_source VARCHAR(6) NOT NULL,
    industry_code VARCHAR(32) NOT NULL,
    custom_industry_name VARCHAR(100),
    promotion_tone VARCHAR(16) CHECK (promotion_tone IN ('PLAIN', 'FRIENDLY', 'SHORT')),
    promotion_avoid_phrases VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_stores_owner FOREIGN KEY (owner_id)
        REFERENCES owners (id) ON DELETE RESTRICT,
    CONSTRAINT fk_stores_area FOREIGN KEY (area_code)
        REFERENCES jeju_areas (code) ON DELETE RESTRICT,
    CONSTRAINT ck_stores_name_not_blank CHECK (name ~ '[^[:space:]]'),
    CONSTRAINT ck_stores_address_not_blank CHECK (address ~ '[^[:space:]]'),
    CONSTRAINT ck_stores_address_detail_not_blank CHECK (
        address_detail IS NULL OR address_detail ~ '[^[:space:]]'
    ),
    CONSTRAINT ck_stores_address_source CHECK (address_source IN ('SEARCH', 'MANUAL')),
    CONSTRAINT ck_stores_industry_code CHECK (industry_code ~ '^[A-Z0-9_]+$'),
    CONSTRAINT ck_stores_custom_industry CHECK (
        (industry_code = 'OTHER'
            AND custom_industry_name IS NOT NULL
            AND custom_industry_name ~ '[^[:space:]]')
        OR (industry_code <> 'OTHER' AND custom_industry_name IS NULL)
    )
);

CREATE TABLE store_inventory_recipes (
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    ingredient_name VARCHAR(50) NOT NULL CHECK (ingredient_name ~ '[^[:space:]]'),
    unit VARCHAR(12) NOT NULL CHECK (unit ~ '[^[:space:]]'),
    amount NUMERIC(13, 3) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
    PRIMARY KEY (store_id, product_name, ingredient_name, unit)
);

CREATE TABLE store_pos_files (
    id UUID PRIMARY KEY,
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    kind VARCHAR(7) NOT NULL CHECK (kind IN ('PAYMENT', 'PRODUCT')),
    filename VARCHAR(255) NOT NULL CHECK (filename ~ '[^[:space:]]'),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 10485760),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    coverage_start DATE,
    coverage_end DATE,
    calendar_date DATE,
    CONSTRAINT ck_store_pos_files_coverage CHECK (
        (coverage_start IS NULL AND coverage_end IS NULL) OR
        (coverage_start IS NOT NULL AND coverage_end IS NOT NULL AND coverage_start <= coverage_end)
    )
);

CREATE INDEX ix_store_pos_files_store_uploaded ON store_pos_files (store_id, uploaded_at DESC, id DESC);

CREATE TABLE sales_analyses (
    id UUID PRIMARY KEY,
    store_id UUID NOT NULL,
    name VARCHAR(100),
    concern TEXT,
    hourly_sales JSONB,
    before_month DATE NOT NULL,
    after_month DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sales_analyses_store FOREIGN KEY (store_id)
        REFERENCES stores (id) ON DELETE RESTRICT,
    CONSTRAINT ck_sales_analyses_months CHECK (
        isfinite(before_month)
        AND isfinite(after_month)
        AND EXTRACT(DAY FROM before_month) = 1
        AND EXTRACT(DAY FROM after_month) = 1
        AND after_month > before_month
    )
);

CREATE TABLE analysis_monthly_sales (
    analysis_id UUID NOT NULL,
    sales_month DATE NOT NULL,
    amount BIGINT NOT NULL,

    CONSTRAINT pk_analysis_monthly_sales PRIMARY KEY (analysis_id, sales_month),
    CONSTRAINT fk_analysis_monthly_sales_analysis FOREIGN KEY (analysis_id)
        REFERENCES sales_analyses (id) ON DELETE RESTRICT,
    CONSTRAINT ck_analysis_monthly_sales_month CHECK (
        isfinite(sales_month) AND EXTRACT(DAY FROM sales_month) = 1
    ),
    CONSTRAINT ck_analysis_monthly_sales_amount CHECK (amount BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE analysis_time_series (
    analysis_id UUID PRIMARY KEY,
    metric VARCHAR(6) NOT NULL,

    CONSTRAINT fk_analysis_time_series_analysis FOREIGN KEY (analysis_id)
        REFERENCES sales_analyses (id) ON DELETE RESTRICT,
    CONSTRAINT ck_analysis_time_series_metric CHECK (metric IN ('AMOUNT', 'COUNT'))
);

CREATE TABLE analysis_time_series_rows (
    analysis_id UUID NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    before_value BIGINT NOT NULL,
    after_value BIGINT NOT NULL,

    CONSTRAINT pk_analysis_time_series_rows PRIMARY KEY (analysis_id, label),
    CONSTRAINT uq_analysis_time_series_rows_order UNIQUE (analysis_id, sort_order),
    CONSTRAINT fk_analysis_time_series_rows_series FOREIGN KEY (analysis_id)
        REFERENCES analysis_time_series (analysis_id) ON DELETE CASCADE,
    CONSTRAINT ck_analysis_time_series_rows_label CHECK (
        label ~ '[^[:space:]]' AND label !~ '^[[:space:]]|[[:space:]]$'
    ),
    CONSTRAINT ck_analysis_time_series_rows_order CHECK (sort_order >= 1),
    CONSTRAINT ck_analysis_time_series_rows_values CHECK (
        before_value BETWEEN 0 AND 9007199254740991
        AND after_value BETWEEN 0 AND 9007199254740991
    )
);

CREATE TABLE strategy_recommendations (
    id UUID PRIMARY KEY,
    analysis_id UUID NOT NULL REFERENCES sales_analyses (id) ON DELETE CASCADE,
    input_fingerprint VARCHAR(64) NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE execution_guide_snapshots (
    id UUID PRIMARY KEY,
    analysis_id UUID NOT NULL REFERENCES sales_analyses (id) ON DELETE CASCADE,
    recommendation_id UUID REFERENCES strategy_recommendations (id) ON DELETE CASCADE,
    strategy_code VARCHAR(16) NOT NULL CHECK (strategy_code = 'OUTREACH'),
    input_fingerprint VARCHAR(64) NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE execution_plans (
    id UUID PRIMARY KEY,
    analysis_id UUID NOT NULL,
    strategy_code VARCHAR(16) NOT NULL,
    strategy_snapshot JSONB NOT NULL,
    inventory_review JSONB CHECK (inventory_review IS NULL OR (strategy_code = 'INVENTORY' AND jsonb_typeof(inventory_review) = 'array')),
    promotion_review_saved_at timestamptz,
    promotion_review JSONB CHECK (promotion_review IS NULL OR (strategy_code = 'PROMOTION' AND jsonb_typeof(promotion_review) = 'object')),
    promotion_impact JSONB CONSTRAINT ck_execution_plans_promotion_impact CHECK (promotion_impact IS NULL OR (
        jsonb_typeof(promotion_impact) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    )),
    manual_promotion_publication JSONB CONSTRAINT ck_execution_plans_manual_promotion_publication CHECK (manual_promotion_publication IS NULL OR (
        jsonb_typeof(manual_promotion_publication) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    )),
    instagram_scheduled_at TIMESTAMPTZ,
    instagram_publication_started_at TIMESTAMPTZ,
    instagram_publication JSONB CONSTRAINT ck_execution_plans_instagram_publication CHECK (instagram_publication IS NULL OR (
        jsonb_typeof(instagram_publication) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    )),
    promotion_review_research JSONB,
    promotion_draft JSONB CONSTRAINT ck_execution_plans_promotion_draft CHECK (promotion_draft IS NULL OR (
        jsonb_typeof(promotion_draft) = 'object'
        AND (strategy_code = 'PROMOTION' OR (strategy_code = 'CUSTOM' AND strategy_snapshot @> '{"marketing": true}'))
    )),
    duration_weeks SMALLINT NOT NULL,
    budget_won BIGINT,
    channel VARCHAR(16),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_execution_plans_analysis FOREIGN KEY (analysis_id)
        REFERENCES sales_analyses (id) ON DELETE RESTRICT,
    CONSTRAINT ck_execution_plans_strategy_code CHECK (
        strategy_code IN ('OUTREACH', 'PROMOTION', 'INVENTORY', 'CUSTOM')
    ),
    CONSTRAINT ck_execution_plans_strategy_snapshot CHECK (
        jsonb_typeof(strategy_snapshot) = 'object'
    ),
    CONSTRAINT ck_execution_plans_duration CHECK (duration_weeks IN (1, 2, 4)),
    CONSTRAINT ck_execution_plans_budget CHECK (budget_won BETWEEN 0 AND 9007199254740991),
    CONSTRAINT ck_execution_plans_channel CHECK (channel IN ('INSTAGRAM', 'STORE_NOTICE')),
    CONSTRAINT ck_execution_plans_strategy_conditions CHECK (
        (strategy_code IN ('OUTREACH', 'PROMOTION') AND budget_won IS NOT NULL AND channel IS NOT NULL)
        OR (strategy_code IN ('INVENTORY', 'CUSTOM') AND budget_won IS NULL AND channel IS NULL)
    ),
    CONSTRAINT ck_execution_plans_dates CHECK (
        isfinite(start_date)
        AND isfinite(end_date)
        AND end_date = start_date + (duration_weeks * 7 - 1)
    )
);

CREATE TABLE inventory_demand_snapshots (
    plan_id UUID NOT NULL REFERENCES execution_plans (id) ON DELETE CASCADE,
    target_date DATE NOT NULL CHECK (isfinite(target_date)),
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    low BIGINT NOT NULL CHECK (low >= 0),
    high BIGINT NOT NULL CHECK (high >= low AND high <= 9007199254740991),
    basis VARCHAR(16) NOT NULL CHECK (basis IN ('WEATHER', 'WEEKDAY')),
    excluded_dates JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excluded_dates) = 'array'),
    saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, target_date, product_name)
);

CREATE TABLE inventory_demand_notes (
    store_id UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
    target_date DATE NOT NULL CHECK (isfinite(target_date)),
    product_name VARCHAR(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    note VARCHAR(200) NOT NULL CHECK (note ~ '[^[:space:]]' AND note !~ '[[:cntrl:]]'),
    PRIMARY KEY (store_id, target_date, product_name)
);

CREATE TABLE execution_checklist_items (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    sort_order INTEGER NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT fk_execution_checklist_items_plan FOREIGN KEY (plan_id)
        REFERENCES execution_plans (id) ON DELETE RESTRICT,
    CONSTRAINT uq_execution_checklist_items_order UNIQUE (plan_id, sort_order),
    CONSTRAINT ck_execution_checklist_items_title_not_blank CHECK (title ~ '[^[:space:]]'),
    CONSTRAINT ck_execution_checklist_items_due_date CHECK (isfinite(due_date)),
    CONSTRAINT ck_execution_checklist_items_order CHECK (sort_order >= 1)
);

CREATE TABLE execution_results (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL,
    registration_no BIGINT GENERATED ALWAYS AS IDENTITY,
    scope VARCHAR(100) NOT NULL,
    before_start DATE NOT NULL,
    before_end DATE NOT NULL,
    before_days INTEGER NOT NULL,
    before_amount BIGINT,
    before_count BIGINT,
    after_start DATE NOT NULL,
    after_end DATE NOT NULL,
    after_days INTEGER NOT NULL,
    after_amount BIGINT,
    after_count BIGINT,
    comparison JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_execution_results_plan FOREIGN KEY (plan_id)
        REFERENCES execution_plans (id) ON DELETE RESTRICT,
    CONSTRAINT uq_execution_results_registration_no UNIQUE (registration_no),
    CONSTRAINT ck_execution_results_scope_not_blank CHECK (scope ~ '[^[:space:]]'),
    CONSTRAINT ck_execution_results_periods CHECK (
        isfinite(before_start) AND isfinite(before_end)
        AND isfinite(after_start) AND isfinite(after_end)
        AND before_start <= before_end
        AND before_end < after_start
        AND after_start <= after_end
    ),
    CONSTRAINT ck_execution_results_before_days CHECK (
        before_days >= 1 AND before_days - 1 <= before_end - before_start
    ),
    CONSTRAINT ck_execution_results_after_days CHECK (
        after_days >= 1 AND after_days - 1 <= after_end - after_start
    ),
    CONSTRAINT ck_execution_results_value_ranges CHECK (
        before_amount BETWEEN 0 AND 9007199254740991
        AND after_amount BETWEEN 0 AND 9007199254740991
        AND before_count BETWEEN 0 AND 9007199254740991
        AND after_count BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT ck_execution_results_metric_pairs CHECK (
        (before_amount IS NULL) = (after_amount IS NULL)
        AND (before_count IS NULL) = (after_count IS NULL)
        AND (before_amount IS NOT NULL OR before_count IS NOT NULL)
    ),
    CONSTRAINT ck_execution_results_comparison CHECK (jsonb_typeof(comparison) = 'object')
);

-- PK와 UNIQUE가 이미 지원하는 조회에는 인덱스를 중복 생성하지 않는다.
CREATE INDEX ix_stores_owner_id ON stores (owner_id);
CREATE INDEX ix_stores_area_code ON stores (area_code);
CREATE INDEX ix_sales_analyses_store_id ON sales_analyses (store_id);
CREATE INDEX ix_execution_plans_analysis_id ON execution_plans (analysis_id);
CREATE INDEX ix_execution_plans_instagram_due ON execution_plans (instagram_scheduled_at) WHERE instagram_scheduled_at IS NOT NULL;
CREATE INDEX ix_execution_plans_instagram_publishing ON execution_plans (instagram_publication_started_at)
    WHERE instagram_publication->>'state'='PUBLISHING';
CREATE INDEX ix_execution_results_latest ON execution_results (plan_id, registration_no DESC);

CREATE TABLE chart_question_conversations (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL UNIQUE REFERENCES sales_analyses(id) ON DELETE CASCADE
);

CREATE TABLE chart_question_turns (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES chart_question_conversations(id) ON DELETE CASCADE,
    client_message_id uuid NOT NULL,
    sequence_no bigint GENERATED ALWAYS AS IDENTITY,
    question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
    chart text NOT NULL CHECK (chart IN ('MONTHLY_SALES', 'MARKET_CARD_SALES', 'JEJU_BSI', 'TIME_SERIES')),
    requested_plan_id uuid,
    answer jsonb NOT NULL,
    UNIQUE (conversation_id, client_message_id)
);

CREATE INDEX chart_question_turns_history_idx
    ON chart_question_turns (conversation_id, sequence_no);

CREATE TABLE analysis_product_sales (
    analysis_id uuid NOT NULL REFERENCES sales_analyses(id) ON DELETE CASCADE,
    product_name varchar(255) NOT NULL CHECK (product_name ~ '[^[:space:]]'),
    before_quantity bigint NOT NULL CHECK (before_quantity BETWEEN 0 AND 9007199254740991),
    after_quantity bigint NOT NULL CHECK (after_quantity BETWEEN 0 AND 9007199254740991),
    price_won bigint CHECK (price_won BETWEEN 1 AND 9007199254740991),
    before_revenue bigint CHECK (before_revenue BETWEEN 0 AND 9007199254740991),
    after_revenue bigint CHECK (after_revenue BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (analysis_id, product_name)
);

CREATE TABLE store_product_photos (
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name varchar(255) NOT NULL,
    photo_data_url text NOT NULL CHECK (length(photo_data_url) <= 450000),
    PRIMARY KEY (store_id, product_name)
);

CREATE TABLE weekly_pos_push_subscriptions (
    owner_id UUID PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    endpoint VARCHAR(2048) NOT NULL UNIQUE,
    p256dh VARCHAR(88) NOT NULL,
    auth_secret VARCHAR(88) NOT NULL,
    weekly_enabled BOOLEAN NOT NULL DEFAULT true,
    result_enabled_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weekly_pos_push_deliveries (
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome VARCHAR(8) NOT NULL DEFAULT 'CLAIMED'
        CHECK (outcome IN ('CLAIMED', 'SENT', 'EXPIRED', 'FAILED')),
    PRIMARY KEY (owner_id, week_start)
);

CREATE TABLE execution_result_push_deliveries (
    plan_id UUID NOT NULL REFERENCES execution_plans(id) ON DELETE CASCADE,
    notice_key TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome VARCHAR(8) NOT NULL DEFAULT 'CLAIMED'
        CHECK (outcome IN ('CLAIMED', 'SENT', 'EXPIRED', 'FAILED')),
    PRIMARY KEY (plan_id, notice_key)
);

COMMIT;
