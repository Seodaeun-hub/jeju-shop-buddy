"""Independent reconciliation of the invented follow-up kit (stdlib only)."""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'follow-up'


def read(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


expected = json.loads((OUT / 'expected-results.json').read_text(encoding='utf-8'))
for filename, digest in expected['preservedAprilMayHashes'].items():
    content = (ROOT / filename).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    assert hashlib.sha256(content).hexdigest() == digest, filename
prices = {'김치찌개': 8000, '꽁치 김치찌개': 8000, '파돈 두루치기': 9500, '양돈 두루치기': 9500, '문어사리': 13000}
for phase, folder, prefix in [('before', ROOT, 'SIMULATED-2021-05'), ('after', OUT, 'SIMULATED-2021-06-01-14')]:
    period = expected[phase]
    payments = [r for r in read(folder / (prefix + '-payment.csv')) if period['start'] <= r['결제기준일자'] <= period['end']]
    products = [r for r in read(folder / (prefix + '-product.csv')) if period['start'] <= r['주문기준일자'] <= period['end']]
    paid, ordered = defaultdict(int), defaultdict(int)
    weekdays = Counter()
    for r in payments:
        assert r['결제상태'] == '완료'
        paid[r['결제기준일자']] += int(r['결제금액'])
    for r in products:
        assert r['상품명'] in prices
        assert int(r['상품가격']) == prices[r['상품명']]
        assert int(r['실판매금액']) == int(r['수량']) * prices[r['상품명']]
        ordered[r['주문기준일자']] += int(r['실판매금액'])
        if '두루치기' in r['상품명']:
            assert int(r['수량']) >= 2
    assert paid == ordered
    for day in paid:
        weekdays[date.fromisoformat(day).weekday()] += 1
    assert weekdays == Counter({0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2})
    actual = dict(days=len(paid), amount=sum(paid.values()), count=len(payments),
                  afternoonCount=sum('14:00' <= r['결제시각'] < '17:00' for r in payments),
                  quantity=sum(int(r['수량']) for r in products if r['상품명'] == '김치찌개'),
                  productAmount=sum(int(r['실판매금액']) for r in products if r['상품명'] == '김치찌개'))
    assert all(actual[key] == period[key] for key in actual), (phase, actual)
    if phase == 'after':
        assert sum(int(r['수량']) for r in products if r['주문기준일자'] == '2021-06-05' and r['상품명'] == '김치찌개') == 23
for r in read(OUT / 'SIMULATED-2021-06-05-kimchi-allocated-stock.csv'):
    assert Decimal(r['시연판매량']) == 23
    assert Decimal(r['인분당사용량']) * 23 == Decimal(r['계산상사용량'])
    assert Decimal(r['현재재고']) + Decimal(r['기존입고예정량']) + Decimal(r['추가발주입고량']) - Decimal(r['계산상사용량']) == Decimal(r['남은재고'])
    assert Decimal(r['남은재고']) >= 0
print('PASS: April/May preserved; five menus; 12 matched weekdays; payments reconcile to products; June 5 = 23; allocated stock balances.')
