"""Build review-only submission/recording ZIPs from explicit sources; never export DB/env."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / 'demo/the-aewol-june-rehearsal'
DENIED_PARTS = {'.git', '.venv', 'venv', 'node_modules', 'target', 'dist', '__pycache__', '.aws', '.codex'}
SECRET = re.compile(rb'(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def copy(source: Path, target: Path):
    if not source.is_file() or source.is_symlink():
        raise ValueError(f'Missing or unsupported source: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def manifest(folder: Path, extra: dict):
    files = []
    for path in sorted(folder.rglob('*')):
        if path.is_file():
            content = path.read_bytes()
            if SECRET.search(content):
                raise ValueError(f'Potential secret pattern in {path.relative_to(folder)}')
            files.append({'path': path.relative_to(folder).as_posix(), 'bytes': len(content),
                          'sha256': hashlib.sha256(content).hexdigest()})
    write(folder / 'manifest.json', json.dumps({**extra, 'files': files}, ensure_ascii=False, indent=2))


def archive(folder: Path):
    target = folder.with_suffix('.zip')
    if target.exists():
        raise FileExistsError(target)
    with zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                output.write(path, (Path(folder.name) / path.relative_to(folder)).as_posix())
    with zipfile.ZipFile(target) as output:
        if output.testzip() is not None:
            raise ValueError('ZIP CRC check failed')
        for item in output.infolist():
            parts = PurePosixPath(item.filename).parts
            if '..' in parts or set(parts) & DENIED_PARTS or any(p == '.env' or p.startswith('.env.') for p in parts):
                raise ValueError(f'Unexpected ZIP path: {item.filename}')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New output directory; existing folders are never erased')
    parser.add_argument('--menu-assets', type=Path, required=True, help='Earlier generated 5-menu image directory')
    parser.add_argument('--verified-assets', type=Path, required=True, help='Observed Railway rename/QR captures directory')
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists():
        raise FileExistsError(f'Use a new output directory: {out}')
    image_root = args.menu_assets / 'images' if (args.menu_assets / 'images').is_dir() else args.menu_assets
    pictures = sorted(image_root.glob('*.png'))
    if len(pictures) != 5 or {p.name[:2] for p in pictures} != {'01', '02', '03', '04', '05'}:
        raise ValueError('Exactly the 5 numbered The Aewol AI images are required')
    for script in ['validate_demo.py', 'validate_follow_up.py']:
        subprocess.run([sys.executable, '-X', 'utf8', str(DEMO / script)], cwd=ROOT, check=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
    out.mkdir(parents=True)
    kit = out / '가게짝꿍_촬영자료'
    review = out / '가게짝꿍_최종결과물_검토본'
    kit.mkdir(); review.mkdir()
    instructions = (ROOT / 'demo/final-recording/README.md').read_text(encoding='utf-8')
    instructions = instructions.split('세부 참고:')[0] + '\n세부 입력표는 `05_참고표_업로드금지`의 두 Markdown 문서를 사용합니다.\n'
    write(kit / '00_전체시연순서.md', instructions)
    write(kit / '00_먼저읽기.txt', 'ZIP을 먼저 압축 해제하세요.\n01은 최초 분석용, 02는 홍보 결과 네 칸 순서, 03은 하루 판매 결과입니다.\n04는 AI 메뉴 사진, 05는 보면서 입력하는 표(업로드 금지), 06은 새 공개 메뉴판 QR입니다.\n모든 POS·원가·재고·실행 결과는 가상 자료입니다. 사진도 AI 예시입니다.\n로그인 정보·API 키는 이 묶음에 없습니다.\n')
    for month in ['04', '05']:
        for kind in ['payment', 'product']:
            name = f'SIMULATED-2021-{month}-{kind}.csv'
            copy(DEMO / name, kit / '01_매출분석_처음넣는CSV' / name)
    follow = DEMO / 'follow-up'
    before_after = [
        ('1_실행전_결제', DEMO / 'SIMULATED-2021-05-payment.csv'),
        ('2_실행전_상품주문', DEMO / 'SIMULATED-2021-05-product.csv'),
        ('3_실행후_결제', follow / 'SIMULATED-2021-06-01-14-payment.csv'),
        ('4_실행후_상품주문', follow / 'SIMULATED-2021-06-01-14-product.csv'),
    ]
    for label, source in before_after:
        copy(source, kit / '02_홍보결과_네칸순서' / label / source.name)
    copy(follow / 'SIMULATED-2021-06-01-14-product.csv', kit / '03_발주결과_하루판매/업로드용/SIMULATED-2021-06-01-14-product.csv')
    copy(follow / 'SIMULATED-2021-06-05-kimchi-allocated-stock.csv', kit / '03_발주결과_하루판매/입력참고용_업로드금지/SIMULATED-2021-06-05-kimchi-allocated-stock.csv')
    write(kit / '01_매출분석_처음넣는CSV/넣는순서.txt', '1:4월 payment→결제 / 2:4월 product→상품 주문 / 3:5월 payment→결제 / 4:5월 product→상품 주문. 각 월 전체 여부를 확인합니다.\n')
    write(kit / '02_홍보결과_네칸순서/README.txt', '홍보 계획 결과 확인의 네 입력칸에 1→2→3→4 순서로 넣습니다.\n전 기간 2021-05-18~31, 후 기간 2021-06-01~14, 김치찌개 선택. 각12영업일.\n김치찌개204→247, 오후2~5시48→72건을 확인하고 저장합니다.\n')
    write(kit / '03_발주결과_하루판매/README.txt', '하루 상품 주문 CSV로 판매량 채우기에는 업로드용의 product 파일만 선택합니다.\n날짜2021-06-05, 김치찌개23인분을 집계합니다. 저장된 예상20~24와 함께 봅니다.\n입력참고용의 stock CSV는 남은 재고를 보면서 입력하는 표입니다. POS로 업로드하지 않습니다.\n')
    photo_dir = kit / '04_메뉴사진_AI예시'
    for path in pictures:
        copy(path, photo_dir / path.name)
    prompt_source = args.menu_assets / 'prompts.json'
    if not prompt_source.is_file():
        prompt_source = args.menu_assets / 'AI사진생성프롬프트.json'
    copy(prompt_source, photo_dir / 'AI사진생성프롬프트.json')
    write(photo_dir / 'README.txt', '01 김치찌개 / 02 꽁치 김치찌개 / 03 파돈 두루치기 / 04 양돈 두루치기 / 05 문어사리.\n내 매장 → 메뉴 사진 관리에서 같은 이름의 메뉴에 한 장씩 등록합니다.\n모두 이 프로젝트의 AI 예시 이미지이며 실제 더애월 음식 사진이 아닙니다.\n')
    reference = kit / '05_참고표_업로드금지'
    for path in (DEMO / 'reference').glob('*.csv'):
        copy(path, reference / path.name)
    recipe = (DEMO / 'menu-ingredients.md').read_text(encoding='utf-8').replace('(README.md)', '(../00_전체시연순서.md)').replace('(reference/menu-prices.csv)', '(menu-prices.csv)')
    write(reference / '재료_원가_상세입력.md', recipe)
    copy(follow / 'README.md', reference / '실행결과_상세입력.md')
    copy(DEMO / 'expected-results.json', reference / '분석_예상집계_참고.json')
    copy(follow / 'expected-results.json', reference / '실행후_예상집계_참고.json')
    qr = kit / '06_QR_현재공개메뉴판'
    copy(args.verified_assets / 'the-aewol-menu-qr.png', qr / '더애월_새주소_공개메뉴판QR.png')
    write(qr / 'README.txt', '현재 공개 메뉴판: https://gage-jjakkung.up.railway.app/menu/91ede563-7057-49ba-b8f1-60086384b2af\n이 QR은 2026-11-18 확인한 공개 메뉴판으로 연결됩니다. 홈 예시 QR이 아닙니다.\n새 매장/계정을 만들거나 메뉴판을 삭제·공개 중지하면 앱에서 새 QR을 다시 받으세요.\n')
    write(kit / '07_녹화직전_확인.txt', '개인 참가 완료. 본편:6/1 기준→분석→발주→정상가 홍보→QR→6/15로 전환→결과.\nPC·아이폰 모두 새 HTTPS 주소. 로그인·권한은 먼저. API키·비밀번호는 녹화하지 않기.\n홈은 예시, POS·재고·원가는 가상, 사진은 AI, 결과는 실제 개선 성과 아님.\n영상 마지막에 대응 한눈에 보기. 기획서15쪽 이내와 결과ZIP 별도 필수.\n11/19 촬영·편집·검토 권장. 공식마감11/20 오전10시(KST).\n')
    meta = {'status': 'REVIEW_COPY_NOT_SUBMITTED', 'sourceCommit': commit, 'sourceWorkingTreeDirty': dirty,
            'classification': 'Synthetic POS/operations; AI example images; real public reference data',
            'validation': ['validate_demo.py passed', 'validate_follow_up.py passed'],
            'remaining': ['Final proposal <=15 pages', 'Tomorrow physical iPhone/video recording and edit', 'Evaluation API access arrangement', 'Final submit confirmation']}
    manifest(kit, meta)
    source_dir = review / '01_실행소스'
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    for name in filter(None, tracked):
        parts = PurePosixPath(name).parts
        if set(parts) & DENIED_PARTS or any(p == '.env' or p.startswith('.env.') for p in parts):
            continue
        copy(ROOT / name, source_dir / name)
    docs = review / '02_문서'
    for name in ['README.md', 'RUNBOOK.md', 'DATA_SPEC.md', 'AI_AND_OSS.md', 'RESULTS.md', 'environment.example']:
        content = (ROOT / 'submission' / name).read_text(encoding='utf-8')
        content = content.replace('(../demo/', '(../01_실행소스/demo/')
        write(docs / name, content)
    shutil.copytree(kit, review / '03_촬영자료')
    for name in ['railway-renamed-services.png', 'ai-question-new-address.jpg', 'guest-menu-new-address.jpg', 'guest-menu-mobile-new-address.jpg']:
        copy(args.verified_assets / name, review / '04_검증캡처' / name)
    write(review / '00_먼저읽기.md', '# 가게짝꿍 최종 결과물 · 제출 전 검토본\n\n[준비 상태](02_문서/README.md) · [실행 매뉴얼](02_문서/RUNBOOK.md) · [촬영 순서](03_촬영자료/00_전체시연순서.md)\n\n이 묶음을 만들었다고 대회 제출이 완료된 것은 아닙니다. 별도15쪽 이내 기획서, 촬영·편집, 평가용 API 이용 준비와 최종 제출 확인이 남아 있습니다. 실제 키·DB 덤프·로그인 비밀번호는 포함하지 않습니다.\n')
    write(review / 'package-validation.json', json.dumps(meta, ensure_ascii=False, indent=2))
    manifest(review, meta)
    archives = [archive(kit), archive(review)]
    print(json.dumps({'output': str(out), 'archives': [{'path': str(p), 'bytes': p.stat().st_size,
          'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in archives]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
