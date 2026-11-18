// Public landing illustration. These are documented fixtures, never a visitor's account data.
export const landingDemo = {
  store: '더애월 본점', beforeMonth: '2021-04', afterMonth: '2021-05',
  sales: [16_342_500, 14_508_000],
  market: [2_049_456_994, 2_199_885_864],
  product: { name: '김치찌개', quantities: [610, 462], revenue: [4_880_000, 3_696_000], price: 8000 },
  afternoon: [208, 104],
  inventory: { date: '2021-06-05', forecast: [20, 24], actual: 23, porkPerServing: .1, stock: 1, incoming: .5, preparation: [.5, .9] },
  outcome: { before: ['2021-05-18', '2021-05-31'], after: ['2021-06-01', '2021-06-14'],
    days: [12, 12], quantities: [204, 247], afternoon: [48, 72] },
  sources: {
    market: 'https://data.edmgr.kr/dataView.do?id=jejudatahub-net-748',
    menuReview: 'https://fantasticade.tistory.com/386',
    event: 'https://ganaatelier.com/152',
  },
} as const

export const landingSteps = [
  { id: 'sales', label: '매출·상권', eyebrow: '01 / COMPARE', title: '우리 가게만\n줄어든 걸까요?',
    description: 'POS를 올리면 같은 기간의 제주 상권과 나란히 비교해요. 지역은 성장했는데 우리 가게는 줄었다면, 매장 안에서 달라진 지점을 살펴봐요.',
    evidence: '실제 상권 카드 이용액 +7.34% · 가상 매장 매출 −11.23%' },
  { id: 'evidence', label: 'AI 근거', eyebrow: '02 / UNDERSTAND', title: '어떤 메뉴,\n어느 시간대일까요?',
    description: '말하거나 입력해서 물어보세요. 짝꿍이 매출이 줄어든 메뉴와 시간대의 수치를 출처와 함께 설명해요.',
    evidence: '가상 POS · 김치찌개 610→462인분 · 오후 2~5시 208→104건' },
  { id: 'inventory', label: '발주 검토', eyebrow: '03 / PREPARE', title: '다음 하루의 준비량을\n근거 있게 정해요.',
    description: '같은 요일의 판매량과 최근 추세로 기본 수요를 보고, 자료가 충분하면 날씨를 참고해요. 저장한 재료 사용량에 현재 재고와 입고 예정량을 반영해요.',
    evidence: '가상 발주 검토 · 6월 5일 김치찌개 20~24인분 · 돼지고기 추가 준비 0.5~0.9kg' },
  { id: 'promotion', label: '세 채널 홍보', eyebrow: '04 / SHARE', title: '가게의 이야기를\n세 채널에 맞게.',
    description: '공개 후기의 메뉴 특징과 당시 지역 소식을 참고해 인스타그램·네이버 플레이스·당근 초안을 만들어요. 사장님이 확인하고 복사·저장해 직접 게시해요.',
    evidence: '실제 공개 후기·2021년 전시 정보 참고 · 홍보 문구와 사진은 시연 예시' },
  { id: 'menu', label: '다국어 QR', eyebrow: '05 / WELCOME', title: '같은 메뉴를\n네 언어로 만나요.',
    description: '저장한 메뉴·가격·사진으로 번역 초안을 만들어요. 사장님이 확인해 공개한 메뉴판은 손님이 로그인 없이 QR로 열 수 있어요.',
    evidence: 'AI 예시 사진·번역 · 아래 언어 버튼으로 메뉴판 예시를 바꿔보세요.' },
  { id: 'outcome', label: '실행 결과', eyebrow: '06 / LEARN', title: '실행한 뒤에도\n함께 확인해요.',
    description: '홍보 전후의 POS와 발주 예상·판매 기록을 다시 비교해요. 무엇을 실행했고 어떤 자료를 확인했는지 남겨 다음 판단에 활용해요.',
    evidence: '가상 실행 결과 · 실제 매장 개선 성과나 홍보의 인과 효과가 아니에요.' },
] as const
