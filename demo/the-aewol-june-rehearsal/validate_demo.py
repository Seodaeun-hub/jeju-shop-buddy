"""Independent reconciliation of the saved CSV files; no external services or DB writes."""
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def rows(name):
    with (ROOT / name).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


expected = json.loads((ROOT / "expected-results.json").read_text(encoding="utf-8"))
prices = {r["앱 메뉴명"]: int(r["가격_원"]) for r in rows("reference/menu-prices.csv")}
assert len(prices) == 5
for month in ("2021-04", "2021-05"):
    payments, products = rows(f"SIMULATED-{month}-payment.csv"), rows(f"SIMULATED-{month}-product.csv")
    receipts, line_totals, line_groups = {}, Counter(), defaultdict(list)
    daily, quantities, revenues = defaultdict(Counter), Counter(), Counter()
    for r in payments:
        key = (r["결제기준일자"], r["결제시각"])
        assert key not in receipts and key[0].startswith(month)
        assert datetime.fromisoformat(key[0]).weekday() != 6
        assert r["결제상태"] == "완료" and int(r["결제건수"]) == 1
        receipts[key] = int(r["결제금액"])
    for r in products:
        name, quantity = r["상품명"], int(r["수량"])
        assert name in prices and int(r["상품가격"]) == prices[name]
        assert r["결제상태"] == "완료" and quantity >= (1 if name == "문어사리" else 2)
        assert int(r["실판매금액"]) == prices[name] * quantity
        ordered = datetime.fromisoformat(r["주문기준일자"] + "T" + r["주문시각"])
        paid = ordered + timedelta(minutes=9)
        key = (paid.date().isoformat(), paid.strftime("%H:%M:%S"))
        assert key in receipts
        line_totals[key] += int(r["실판매금액"])
        line_groups[key].append(name)
        quantities[name] += quantity
        revenues[name] += int(r["실판매금액"])
        daily[r["주문기준일자"]][name] += quantity
    assert dict(line_totals) == receipts, "Every payment must reconcile to its item lines"
    for names in line_groups.values():
        if "문어사리" in names:
            assert any("두루치기" in name for name in names), "Add-on must accompany a main dish"
    assert len(daily) == 26
    assert sum(receipts.values()) == expected["months"][month]["amount"]
    assert dict(quantities) == expected["months"][month]["quantities"]
    assert dict(revenues) == expected["months"][month]["productRevenue"]
    for day, quantity in expected["kimchiSaturdayTarget"].items():
        if day.startswith(month):
            assert daily[day]["김치찌개"] == quantity
costs, units = Counter(), {}
for r in rows("reference/SIMULATED-menu-ingredients.csv"):
    assert r["구분"] == "가상 시연 가정" and r["메뉴명"] in prices
    cost = Decimal(r["한 개당 사용량"]) * Decimal(r["단위당 단가_원"])
    assert cost == Decimal(r["재료비_원"])
    costs[r["메뉴명"]] += cost
    key = r["재료명"]
    assert units.setdefault(key, r["단위"]) == r["단위"]
assert dict(costs) == expected["recipeCostsWon"]
for r in rows("reference/SIMULATED-inventory-inputs.csv"):
    ready = Decimal(r["현재 재고"]) + Decimal(r["기존 입고 예정량"])
    for bound in ("하한", "상한"):
        assert max(Decimal(0), Decimal(r["예상 사용량 " + bound]) - ready) == Decimal(r["추가 준비량 " + bound])
    assert Decimal(r["최종 추가 발주량 예시"]) >= Decimal(r["추가 준비량 상한"])
print("Verified: payment-to-item reconciliation for every ticket, 5 menu prices, 26 days per month, add-on rules, daily demand, recipe costs and inventory arithmetic.")
