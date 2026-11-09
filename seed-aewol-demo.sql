-- 개발용 가상 데이터. schema.sql, seed-jeju-areas.sql 다음에 실행한다.
-- openapi-store.yaml의 매장, 시간대별 분석, 실행 계획, 결과 예시를 사용한다.
-- 가상 사업주: aewol-demo@example.test / AewolDemo-2026! (bcrypt)
-- 동일 PK가 이미 있으면 보존하므로 수정한 시연 데이터를 초기화하지 않는다.

BEGIN;

INSERT INTO owners (id, name, email, password_hash, created_at)
VALUES (
    'f9a4d689-56f9-4a7e-9ed6-8fb68360ad9e',
    '애월 가상 사업주',
    'aewol-demo@example.test',
    '$2b$12$gXdyZ5uOpGORhWymRPHcqOa4lawWlQti7ClptAsGJfTc0umla.b/2',
    '2026-11-09T09:55:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stores (
    id, owner_id, area_code, name, address, address_detail, address_source, industry_code, created_at
)
VALUES (
    '84c0376e-741f-4e88-b26c-9451c9f515da',
    'f9a4d689-56f9-4a7e-9ed6-8fb68360ad9e',
    'JEJU_AEWOL',
    '애월 가상 한식당',
    '제주특별자치도 제주시 애월읍 예시로 12',
    '1층',
    'MANUAL',
    'KOREAN_RESTAURANT',
    '2026-11-09T10:00:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_analyses (id, store_id, concern, before_month, after_month, created_at)
VALUES (
    '94c5750d-6811-46eb-a6cf-8b36d4149982',
    '84c0376e-741f-4e88-b26c-9451c9f515da',
    '평일 오후에 손님이 줄었어요.',
    '2021-04-01',
    '2021-05-01',
    '2026-11-09T10:10:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analysis_monthly_sales (analysis_id, sales_month, amount)
VALUES
    ('94c5750d-6811-46eb-a6cf-8b36d4149982', '2021-04-01', 32379500),
    ('94c5750d-6811-46eb-a6cf-8b36d4149982', '2021-05-01', 29581000)
ON CONFLICT (analysis_id, sales_month) DO NOTHING;

-- 이미 시간대 자료를 저장한 분석에는 초기 구간을 다시 추가하지 않는다.
WITH seeded_series AS (
    INSERT INTO analysis_time_series (analysis_id, metric)
    VALUES ('94c5750d-6811-46eb-a6cf-8b36d4149982', 'COUNT')
    ON CONFLICT (analysis_id) DO NOTHING
    RETURNING analysis_id
)
INSERT INTO analysis_time_series_rows (analysis_id, label, sort_order, before_value, after_value)
SELECT series.analysis_id, demo.label, demo.sort_order, demo.before_value, demo.after_value
FROM seeded_series AS series
CROSS JOIN (
    VALUES
        ('오후 2시 전', 1, 248, 228),
        ('오후 2~5시', 2, 233, 69),
        ('오후 5시 이후', 3, 185, 165)
) AS demo(label, sort_order, before_value, after_value);

INSERT INTO execution_plans (
    id, analysis_id, strategy_code, strategy_snapshot, duration_weeks,
    budget_won, channel, start_date, end_date, created_at
)
VALUES (
    '5be69032-6db8-4211-b7fc-72aa1c339c3d',
    '94c5750d-6811-46eb-a6cf-8b36d4149982',
    'OUTREACH',
    '{
      "title": "오후 주문 안내 점검하기",
      "status": "RECOMMENDED",
      "reason": "오후 2~5시 결제 건수가 줄어든 구간부터 실제 주문 가능 시간과 매장 안내가 일치하는지 확인해 보세요.",
      "evidence": [{"source":"TIME_SERIES","metric":"COUNT","label":"오후 2~5시","before":233,"after":69}],
      "missingInputs": [],
      "followUp": "안내를 수정했다면 같은 요일·시간대의 하루 평균 결제 건수를 비교해요."
    }'::jsonb,
    2, 0, 'STORE_NOTICE', '2026-11-09', '2026-11-22', '2026-11-09T10:20:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO execution_checklist_items (id, plan_id, title, due_date, sort_order, completed)
VALUES
    ('9f74a089-fb9d-4a48-9576-fc81764a8777', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
     '오후 식사 주문 가능 시간과 현재 매장 안내 확인', '2026-11-09', 1, TRUE),
    ('a1838b79-3869-4fc9-83d3-bf8bc7453b8b', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
     '안내가 다르면 수정할 문구 정리', '2026-11-10', 2, FALSE),
    ('0441cbfd-6ee0-4e51-b06d-8735aaf2d070', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
     '필요한 경우 매장 입구의 주문 안내 수정', '2026-11-11', 3, FALSE),
    ('6734bda1-d639-4c80-a331-851c93594ea6', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
     '안내를 수정했다면 오후 결제 건수 전후 비교', '2026-11-22', 4, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 분석 월은 2021년이며, 실행 전후 비교 기간은 Swagger 시연 일정인 2026년이다.
-- 매출 결과를 먼저 등록하고 결제 건수 결과를 다음에 등록한다.
INSERT INTO execution_results (
    id, plan_id, scope, before_start, before_end, before_days, before_amount,
    after_start, after_end, after_days, after_amount, comparison, created_at
)
VALUES (
    '14b7aa16-b282-4dc1-9a3d-86ae1782c60d', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
    '수~일 오후 2~5시',
    '2026-11-04', '2026-11-08', 5, 740000,
    '2026-11-11', '2026-11-15', 5, 860000,
    '{"amount":{"beforeDailyAverage":148000,"afterDailyAverage":172000,"changeRatePercent":16.22}}'::jsonb,
    '2026-11-16T10:20:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO execution_results (
    id, plan_id, scope, before_start, before_end, before_days, before_count,
    after_start, after_end, after_days, after_count, comparison, created_at
)
VALUES (
    '16cf2a57-39c8-40eb-b8db-ed75a2c8f1b0', '5be69032-6db8-4211-b7fc-72aa1c339c3d',
    '수~일 오후 2~5시',
    '2026-11-04', '2026-11-08', 5, 25,
    '2026-11-11', '2026-11-15', 5, 32,
    '{"count":{"beforeDailyAverage":5,"afterDailyAverage":6.4,"changeRatePercent":28}}'::jsonb,
    '2026-11-16T10:25:00+09:00'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
