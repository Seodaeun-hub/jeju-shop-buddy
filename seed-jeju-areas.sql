-- schema.sql을 실행한 PostgreSQL 데이터베이스에서 실행한다.
-- 행정 읍·면·동 기준: 제주시 26곳, 서귀포시 17곳.
-- 제주시 목록: https://www.jeju.go.kr/move/index.htm
-- 서귀포시 목록: https://www.seogwipo.go.kr/# (읍면동 홈페이지)
-- code는 가게짝꿍 내부 코드이며, name은 Swagger의 areaName 표시 형식이다.
-- 기존 애월읍 코드는 JEJU_AEWOL을 사용한다.

BEGIN;

INSERT INTO jeju_areas (code, name)
VALUES
    -- 제주시
    ('JEJU_HALLIM', '제주시 한림읍'),
    ('JEJU_AEWOL', '제주시 애월읍'),
    ('JEJU_GUJWA', '제주시 구좌읍'),
    ('JEJU_JOCHEON', '제주시 조천읍'),
    ('JEJU_HANGYEONG', '제주시 한경면'),
    ('JEJU_CHUJA', '제주시 추자면'),
    ('JEJU_UDO', '제주시 우도면'),
    ('JEJU_ILDO_1', '제주시 일도1동'),
    ('JEJU_ILDO_2', '제주시 일도2동'),
    ('JEJU_IDO_1', '제주시 이도1동'),
    ('JEJU_IDO_2', '제주시 이도2동'),
    ('JEJU_SAMDO_1', '제주시 삼도1동'),
    ('JEJU_SAMDO_2', '제주시 삼도2동'),
    ('JEJU_YONGDAM_1', '제주시 용담1동'),
    ('JEJU_YONGDAM_2', '제주시 용담2동'),
    ('JEJU_GEONIP', '제주시 건입동'),
    ('JEJU_HWABUK', '제주시 화북동'),
    ('JEJU_SAMYANG', '제주시 삼양동'),
    ('JEJU_BONGGAE', '제주시 봉개동'),
    ('JEJU_ARA', '제주시 아라동'),
    ('JEJU_ORA', '제주시 오라동'),
    ('JEJU_YEON', '제주시 연동'),
    ('JEJU_NOHYEONG', '제주시 노형동'),
    ('JEJU_OEDO', '제주시 외도동'),
    ('JEJU_IHO', '제주시 이호동'),
    ('JEJU_DODU', '제주시 도두동'),

    -- 서귀포시
    ('JEJU_DAEJEONG', '서귀포시 대정읍'),
    ('JEJU_NAMWON', '서귀포시 남원읍'),
    ('JEJU_SEONGSAN', '서귀포시 성산읍'),
    ('JEJU_ANDEOK', '서귀포시 안덕면'),
    ('JEJU_PYOSEON', '서귀포시 표선면'),
    ('JEJU_SONGSAN', '서귀포시 송산동'),
    ('JEJU_JEONGBANG', '서귀포시 정방동'),
    ('JEJU_JUNGANG', '서귀포시 중앙동'),
    ('JEJU_CHEONJI', '서귀포시 천지동'),
    ('JEJU_HYODON', '서귀포시 효돈동'),
    ('JEJU_YEONGCHEON', '서귀포시 영천동'),
    ('JEJU_DONGHONG', '서귀포시 동홍동'),
    ('JEJU_SEOHONG', '서귀포시 서홍동'),
    ('JEJU_DAERYUN', '서귀포시 대륜동'),
    ('JEJU_DAECHEON', '서귀포시 대천동'),
    ('JEJU_JUNGMUN', '서귀포시 중문동'),
    ('JEJU_YERAE', '서귀포시 예래동')
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name
    WHERE jeju_areas.name IS DISTINCT FROM EXCLUDED.name;

COMMIT;
