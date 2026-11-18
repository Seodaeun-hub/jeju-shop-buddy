"""Create invented follow-up records; never modifies April/May files or calls a service."""
import csv
import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from build_demo import PRICE, RECIPES, STOCK, tickets_for, write_csv

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "follow-up"


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def summarize(payments, products, start, end):
    payments = [r for r in payments if start <= r['결제기준일자'] <= end]
    products = [r for r in products if start <= r['주문기준일자'] <= end]
    return dict(start=start, end=end, days=len({r['결제기준일자'] for r in payments}),
                amount=sum(int(r['결제금액']) for r in payments), count=len(payments),
                afternoonCount=sum('14:' <= r['결제시각'] < '17:' for r in payments),
                quantity=sum(int(r['수량']) for r in products if r['상품명'] == '김치찌개'),
                productAmount=sum(int(r['실판매금액']) for r in products if r['상품명'] == '김치찌개'))


def build():
    original_bytes = {p.name: p.read_bytes() for p in ROOT.glob('SIMULATED-*.csv')}
    # Git may check text files out with LF on Linux and CRLF on Windows.
    original = {name: hashlib.sha256(content.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')).hexdigest()
                for name, content in original_bytes.items()}
    payments, products = [], []
    for number in range(1, 15):
        day = date(2021, 6, number)
        if day.weekday() == 6:
            continue  # Assumed Sunday closure, not the restaurant's actual opening calendar.
        tickets = tickets_for(day)
        # Two invented extra afternoon orders, normal prices. No claimed promotion causality.
        for minute in (35, 55):
            ordered = tickets[0]['ordered'].replace(hour=15, minute=minute)
            tickets.append(dict(ordered=ordered, paid=ordered + timedelta(minutes=9), lines=[['김치찌개', 2]]))
        if day.weekday() == 5:
            target = 23 if number == 5 else 24
            tickets[0]['lines'][0][1] += target - 20
        for ticket in tickets:
            amount = sum(PRICE[name] * qty for name, qty in ticket['lines'])
            payments.append(dict(zip(['결제기준일자', '결제시각', '결제건수', '결제금액', '결제상태'],
                                     [day.isoformat(), ticket['paid'].strftime('%H:%M:%S'), 1, amount, '완료'])))
            for name, qty in ticket['lines']:
                products.append(dict(zip(['주문기준일자', '주문시각', '결제상태', '상품명', '수량', '상품가격', '실판매금액'],
                                         [day.isoformat(), ticket['ordered'].strftime('%H:%M:%S'), '완료', name, qty, PRICE[name], PRICE[name] * qty])))
    OUT.mkdir(exist_ok=True)
    write_csv(OUT / 'SIMULATED-2021-06-01-14-payment.csv', list(payments[0]), payments)
    write_csv(OUT / 'SIMULATED-2021-06-01-14-product.csv', list(products[0]), products)
    before = summarize(rows(ROOT / 'SIMULATED-2021-05-payment.csv'), rows(ROOT / 'SIMULATED-2021-05-product.csv'), '2021-05-18', '2021-05-31')
    after = summarize(payments, products, '2021-06-01', '2021-06-14')
    inventory = []
    for (name, unit, per_serving, _), (_, stock, incoming, ordered) in zip(RECIPES['김치찌개'], STOCK):
        used = Decimal(per_serving) * 23
        remaining = Decimal(stock) + Decimal(incoming) + Decimal(ordered) - used
        inventory.append(dict(품목명=name, 단위=unit, 현재재고=stock, 기존입고예정량=incoming,
                              추가발주입고량=ordered, 인분당사용량=per_serving, 시연판매량='23',
                              계산상사용량=str(used), 남은재고=str(remaining)))
    write_csv(OUT / 'SIMULATED-2021-06-05-kimchi-allocated-stock.csv', list(inventory[0]), inventory)
    summary = dict(simulated=True, restaurantParticipated=False, before=before, after=after,
                   inventory=dict(date='2021-06-05', product='김치찌개', forecast=[20, 24], actual=23,
                                  scope='김치찌개에 배정한 재료만, 다른 메뉴 사용·폐기·이동 없음, 예정량과 추가발주 모두 당일 입고 가정'),
                   limitations=['실제 후기나 실매출 개선 결과 아님', '전후 차이로 홍보의 인과 효과를 입증할 수 없음'],
                   hashNewlineNormalization='CRLF', preservedAprilMayHashes=original)
    (OUT / 'expected-results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert original_bytes == {p.name: p.read_bytes() for p in ROOT.glob('SIMULATED-*.csv')}
    print(json.dumps(dict(before=before, after=after, actualJune5=23), ensure_ascii=False))


if __name__ == '__main__':
    build()
