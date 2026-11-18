"""Rebuild explicitly simulated POS files. No production API, credentials or real sales data."""
from __future__ import annotations

import calendar
import csv
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = "https://fantasticade.tistory.com/386"
MENUS = [
    ("김치찌개", "흑돈 김치찌개+찰솥밥", 8000, "찰솥밥 포함으로 기재됨"),
    ("꽁치 김치찌개", "꽁치 김치찌개+찰솥밥", 8000, "찰솥밥 포함으로 기재됨"),
    ("파돈 두루치기", "파돈 두루치기", 9500, "1인분 가격; 시연 주문은 2인분 이상"),
    ("양돈 두루치기", "양돈 두루치기", 9500, "1인분 가격; 시연 주문은 2인분 이상"),
    ("문어사리", "문어사리 (1-2인)", 13000, "사리 한 단위 가격; 시연에서는 두루치기에만 추가"),
]
PRICE = {name: price for name, _, price, _ in MENUS}
# These quantities are invented for the scenario; they are not observations of the restaurant.
SATURDAY_KIMCHI = {
    "2021-04-03": 34, "2021-04-10": 32, "2021-04-17": 30, "2021-04-24": 30,
    "2021-05-01": 32, "2021-05-08": 28, "2021-05-15": 22, "2021-05-22": 24, "2021-05-29": 20,
}
COMMON_STEW = [
    ("김치", "kg", ".15", "4000"), ("두부", "kg", ".08", "2500"),
    ("양파", "kg", ".03", "2000"), ("완성 기본육수", "L", ".3", "1000"),
    ("쌀", "kg", ".09", "3000"), ("기본 반찬", "인분", "1", "300"),
    ("찌개 양념", "인분", "1", "170"),
]
# All recipe quantities and unit costs below are assumptions, not the restaurant's recipe.
RECIPES = {
    "김치찌개": [("돼지고기(원육)", "kg", ".1", "12000"), *COMMON_STEW],
    "꽁치 김치찌개": [("꽁치(가식부)", "kg", ".12", "10000"), *COMMON_STEW],
    "파돈 두루치기": [
        ("돼지고기(원육)", "kg", ".18", "12000"), ("대파", "kg", ".08", "3000"),
        ("양파", "kg", ".03", "2000"), ("김치", "kg", ".08", "4000"),
        ("콩나물", "kg", ".05", "2000"), ("간장 양념", "인분", "1", "200"),
        ("식용유", "L", ".01", "4000"), ("기본 반찬", "인분", "1", "300"),
    ],
    "양돈 두루치기": [
        ("돼지고기(원육)", "kg", ".18", "12000"), ("양파", "kg", ".1", "2000"),
        ("대파", "kg", ".03", "3000"), ("김치", "kg", ".08", "4000"),
        ("콩나물", "kg", ".05", "2000"), ("고추장 양념", "인분", "1", "250"),
        ("식용유", "L", ".01", "4000"), ("기본 반찬", "인분", "1", "300"),
    ],
    "문어사리": [("문어(가식부)", "kg", ".18", "22000"), ("간장 양념", "인분", ".5", "200")],
}
STOCK = [
    ("돼지고기(원육)", "1", ".5", "1"), ("김치", "2", "1", "1"),
    ("두부", "1", ".5", ".5"), ("양파", ".5", ".2", ".1"),
    ("완성 기본육수", "4", "2", "2"), ("쌀", "2", "0", ".5"),
    ("기본 반찬", "10", "10", "5"), ("찌개 양념", "20", "0", "5"),
]


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)


def number(value: Decimal) -> str:
    return format(value.normalize(), "f")


def tickets_for(day: date) -> list[dict]:
    lunch = ["김치찌개"] * 4 + ["꽁치 김치찌개"] * 2 + ["파돈 두루치기"] * 3 + ["양돈 두루치기"] * 3
    afternoon = (["김치찌개"] * 4 + ["꽁치 김치찌개", "파돈 두루치기"] + ["양돈 두루치기"] * 2
                 if day.month == 4 else ["김치찌개", "꽁치 김치찌개", "파돈 두루치기", "양돈 두루치기"])
    evening = ["김치찌개"] * 3 + ["꽁치 김치찌개"] * 2 + ["파돈 두루치기"] * 3 + ["양돈 두루치기"] * 2
    tickets = []
    for slot, (names, hour, minute, interval) in enumerate([
        (lunch, 11, 15, 12), (afternoon, 14, 10, 18), (evening, 17, 10, 12),
    ]):
        for index, name in enumerate(names):
            ordered = datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute) + timedelta(minutes=index * interval)
            quantity = 2 if name == "김치찌개" else 2 + int((day.day + index + slot) % 5 == 0)
            lines = [[name, quantity]]
            if "두루치기" in name and (day.toordinal() + index + slot) % 3 == 0:
                lines.append(["문어사리", 1])
            tickets.append({"ordered": ordered, "paid": ordered + timedelta(minutes=9), "lines": lines})
    kimchi_lines = [ticket["lines"][0] for ticket in tickets if ticket["lines"][0][0] == "김치찌개"]
    target = SATURDAY_KIMCHI.get(day.isoformat(), 2 * len(kimchi_lines))
    extra = target - 2 * len(kimchi_lines)
    assert 0 <= extra <= 2 * len(kimchi_lines)
    for index in range(extra):
        kimchi_lines[index % len(kimchi_lines)][1] += 1
    return tickets


def build() -> None:
    totals = {}
    for month in (4, 5):
        payments, products = [], []
        sold, revenue, hourly = Counter(), Counter(), [dict(amount=0, count=0) for _ in range(24)]
        daily = defaultdict(Counter)
        for day_number in range(1, calendar.monthrange(2021, month)[1] + 1):
            day = date(2021, month, day_number)
            if day.weekday() == 6:  # A scenario assumption; not a claim about actual operating days.
                continue
            for ticket in tickets_for(day):
                amount = sum(PRICE[name] * quantity for name, quantity in ticket["lines"])
                payments.append(dict(zip(
                    ["결제기준일자", "결제시각", "결제건수", "결제금액", "결제상태"],
                    [day.isoformat(), ticket["paid"].strftime("%H:%M:%S"), 1, amount, "완료"],
                )))
                hourly[ticket["paid"].hour]["amount"] += amount
                hourly[ticket["paid"].hour]["count"] += 1
                for name, quantity in ticket["lines"]:
                    products.append(dict(zip(
                        ["주문기준일자", "주문시각", "결제상태", "상품명", "수량", "상품가격", "실판매금액"],
                        [day.isoformat(), ticket["ordered"].strftime("%H:%M:%S"), "완료", name, quantity, PRICE[name], PRICE[name] * quantity],
                    )))
                    sold[name] += quantity
                    revenue[name] += PRICE[name] * quantity
                    daily[day.isoformat()][name] += quantity
        label = f"2021-{month:02}"
        write_csv(ROOT / f"SIMULATED-{label}-payment.csv", list(payments[0]), payments)
        write_csv(ROOT / f"SIMULATED-{label}-product.csv", list(products[0]), products)
        totals[label] = dict(amount=sum(x["결제금액"] for x in payments), paymentCount=len(payments),
                             transactionDays=len(daily), productRows=len(products), quantities=dict(sold),
                             productRevenue=dict(revenue), hourlySales=hourly, dailyQuantities=dict(daily),
                             timeCounts=[sum(x["count"] for x in hourly[a:b]) for a, b in [(0, 14), (14, 17), (17, 24)]])
    write_csv(ROOT / "reference" / "menu-prices.csv",
              ["앱 메뉴명", "공개자료 메뉴명", "가격_원", "가격 단위·구성", "자료 작성일", "출처"],
              [dict(zip(["앱 메뉴명", "공개자료 메뉴명", "가격_원", "가격 단위·구성", "자료 작성일", "출처"],
                        [name, public, price, note, "2021-02-14", SOURCE])) for name, public, price, note in MENUS])
    ingredient_rows, costs = [], {}
    for menu, recipe in RECIPES.items():
        cost = Decimal(0)
        for name, unit, amount, unit_price in recipe:
            item_cost = Decimal(amount) * Decimal(unit_price)
            cost += item_cost
            ingredient_rows.append(dict(zip(["구분", "메뉴명", "재료명", "단위", "한 개당 사용량", "단위당 단가_원", "재료비_원"],
                                            ["가상 시연 가정", menu, name, unit, number(Decimal(amount)), unit_price, number(item_cost)])))
        costs[menu] = int(cost)
    write_csv(ROOT / "reference" / "SIMULATED-menu-ingredients.csv", list(ingredient_rows[0]), ingredient_rows)
    recipe = {name: (unit, Decimal(amount)) for name, unit, amount, _ in RECIPES["김치찌개"]}
    inventory = []
    for name, stock, incoming, final in STOCK:
        unit, usage = recipe[name]
        lo, hi = usage * 20, usage * 24
        ready = Decimal(stock) + Decimal(incoming)
        shortage_lo, shortage_hi = max(Decimal(0), lo-ready), max(Decimal(0), hi-ready)
        inventory.append(dict(zip(["구분", "메뉴명", "재료명", "단위", "현재 재고", "기존 입고 예정량", "예상 사용량 하한", "예상 사용량 상한", "추가 준비량 하한", "추가 준비량 상한", "최종 추가 발주량 예시"],
                                  ["가상 시연 가정", "김치찌개", name, unit, stock, incoming, number(lo), number(hi), number(shortage_lo), number(shortage_hi), final])))
    write_csv(ROOT / "reference" / "SIMULATED-inventory-inputs.csv", list(inventory[0]), inventory)
    guide = [
        "# 더애월 참고 시연의 가상 재료·원가 입력표", "",
        "**메뉴명·정상가는 공개 자료를 참고했지만 아래 모든 레시피·단가·재고·입고·추가 발주량은 시연 가정입니다.** 실제 더애월의 조리법·원가·매입가가 아닙니다.", "",
        "[전체 시연 순서](README.md) · [메뉴·가격 출처표](reference/menu-prices.csv)", "",
        "## 입력 방법", "",
        "**내 매장 → 더애월 본점 → 메뉴 재료·원가 → 메뉴 선택 → 재료 추가**에서 재료명·단위·한 개당 사용량·단가를 입력하고 **재료·원가 저장**을 누릅니다. 참고 CSV 자체를 POS로 업로드하지 않습니다.", "",
        "사용량은 POS 수량 1단위 기준입니다. 찌개·두루치기는 1인분, 문어사리는 1~2인용 추가 한 단위입니다. 돼지고기는 조리 전 원육, 생선·문어는 가식부 중량으로 가정합니다. 솥밥은 생쌀 90g으로 가정하고, 누룽지는 같은 밥에서 만들어 별도 쌀을 중복 계산하지 않습니다. 두루치기에는 밥을 포함하지 않습니다. 간장·고추장·찌개 양념과 기본 반찬은 이미 소분한 중간재이며 같은 원료를 다시 더하지 않습니다.", "",
        "CSV 재료 단위는 kg·L·인분으로 입력합니다. 100g은 0.1kg입니다. 메뉴의 정상 판매가와 재료비를 뺀 차액은 인건비·임대료 등이 빠지기 전이므로 순이익이 아닙니다.", "",
    ]
    for menu, recipe in RECIPES.items():
        guide.extend([f"## {menu}", "", f"공개 자료 참고 정상가 **{PRICE[menu]:,}원**, 가상 합산 재료비 **{costs[menu]:,}원**.", "",
                      "| 재료명 | 단위 | 한 개당 사용량 | 단위당 단가 (원) | 재료비 (원) |", "|---|---|---:|---:|---:|"])
        for name, unit, amount, unit_price in recipe:
            guide.append(f"| {name} | {unit} | {number(Decimal(amount))} | {int(unit_price):,} | {int(Decimal(amount)*Decimal(unit_price)):,} |")
        guide.append("")
    guide.extend([
        "## 김치찌개 발주 입력값", "",
        "시연 날짜 **2021-06-05**, 메뉴 **김치찌개**에서 최근 토요일 수요 **20~24인분**을 확인한 후 아래를 입력합니다. 이 표는 하루치이며 다음 입고일까지 여러 날을 합산한 값이 아닙니다.", "",
        "| 재료 | 단위 | 현재 재고 | 기존 입고 | 예상 사용량 | 추가 준비량 | 최종 추가 발주 예시 |",
        "|---|---|---:|---:|---|---|---:|",
    ])
    for row in inventory:
        guide.append(f'| {row["재료명"]} | {row["단위"]} | {number(Decimal(row["현재 재고"]))} | {number(Decimal(row["기존 입고 예정량"]))} | '
                     f'{row["예상 사용량 하한"]}~{row["예상 사용량 상한"]} | {row["추가 준비량 하한"]}~{row["추가 준비량 상한"]} | '
                     f'{number(Decimal(row["최종 추가 발주량 예시"]))} |')
    guide.extend(["",
                  "**예상 사용량 = 인분 범위 × 한 인분 사용량**, **추가 준비량 = max(0, 예상 사용량 − 현재 재고 − 기존 입고)**입니다. 표의 최종 발주량은 가정한 구매 단위를 고려해 상한을 충족하도록 정한 예시이며 시스템이 자동 주문하지 않습니다.", "",
                  "현재 재고·기존 입고를 입력한 뒤 **발주 검토표 저장**을 누릅니다. 검토표는 사용량 상한과 재고·입고·선택한 최종 추가 발주량을 기록합니다. **실행 결과 확인 →**에서 이를 확인하고, 실제로 사용하지 않은 상태에서는 ‘실행 후 남은 재고’를 채우지 않습니다.", "",
                  "이 계산은 김치찌개 한 메뉴의 준비량입니다. 여러 메뉴가 같은 돼지고기·김치 등을 공유하므로 매장 전체 주문에서는 다른 메뉴의 수요와 공통 재고를 함께 검토해야 합니다.", "",
                  "## 홍보에서 원가 재사용", "",
                  "**프로모션 검토**에서 김치찌개 정상가 **8,000원**, 합산 원가 **3,100원**을 확인하고 할인액 **1,000원**, 예산 **30,000원**을 입력합니다. 할인 후 가격 **7,000원**, 최대 **30개**, 재료비 차감 후 **3,900원**을 확인합니다. 과거에 저장한 검토는 레시피 변경만으로 바뀌지 않을 수 있으므로 원가를 확인한 뒤 검토를 다시 저장합니다.", "",
                  "다른 메뉴의 가상 재료비는 꽁치 김치찌개 **3,100원**, 파돈 두루치기 **3,420원**, 양돈 두루치기 **3,460원**, 문어사리 **4,060원**입니다. 실제 원가로 인용하지 않습니다.", ""])
    (ROOT / "menu-ingredients.md").write_text("\n".join(guide), encoding="utf-8")
    summary = {
        "classification": "All POS, recipe, stock and promotion conditions are synthetic scenario inputs, not actual restaurant operations.",
        "referenceDate": "2021-06-01", "months": totals, "recipeCostsWon": costs,
        "kimchiSaturdayTarget": SATURDAY_KIMCHI,
        "demand": {"date": "2021-06-05", "product": "김치찌개", "previous3": [30, 32, 28], "recent3": [22, 24, 20],
                   "baselineAverage": 26, "previousAverage": 30, "recentAverage": 22, "changePercent": -26.67,
                   "weekdayLow": 20, "weekdayHigh": 24},
    }
    (ROOT / "expected-results.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({m: {k: v for k, v in row.items() if k not in ("dailyQuantities", "hourlySales")} for m, row in totals.items()}, ensure_ascii=False, indent=2))
    print("Simulated recipe costs:", costs)


if __name__ == "__main__":
    build()
