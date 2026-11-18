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
  { id: 'sales', label: '매출·상권', eyebrow: '01 매출·상권 비교', title: '우리 가게 매출을\n동네 상권과 비교하세요.',
    description: 'POS 파일을 올리면 월별 매출과 상권 카드 이용액을 비교할 수 있어요. 같은 기간, 같은 지역·업종의 변화를 확인하세요.',
    evidence: '실제 상권 카드 이용액 +7.34% · 가상 매장 매출 −11.23%' },
  { id: 'evidence', label: 'AI 매출 질문', eyebrow: '02 AI 매출 질문', title: '궁금한 매출은\nAI에게 물어보세요.',
    description: '메뉴별 판매량과 시간대별 결제 변화를 물어보세요. 음성으로 입력하고, 질문을 고쳐 보낼 수도 있어요.',
    evidence: '가상 POS · 김치찌개 610→462인분 · 오후 2~5시 208→104건' },
  { id: 'inventory', label: '발주 검토', eyebrow: '03 발주 검토', title: '발주 전에\n필요한 양부터 확인하세요.',
    description: '지난 판매 기록으로 예상 판매량을 확인하세요. 메뉴별 재료 사용량에 현재 재고와 입고 예정량을 반영해 추가 준비량을 계산해요.',
    evidence: '가상 발주 검토 · 6월 5일 김치찌개 20~24인분 · 돼지고기 추가 준비 0.5~0.9kg' },
  { id: 'promotion', label: '세 채널 홍보', eyebrow: '04 홍보물 제작', title: '메뉴 사진으로\n세 채널 홍보물을 만드세요.',
    description: '후기와 지역 소식을 참고해 인스타그램·네이버 플레이스·당근용 초안을 만들어요. 문구와 사진을 확인한 뒤 복사·저장해 직접 올리세요.',
    evidence: '실제 공개 후기·2021년 전시 정보 참고 · 홍보 문구와 사진은 시연 예시' },
  { id: 'menu', label: '다국어 QR', eyebrow: '05 다국어 QR 메뉴판', title: '메뉴판 하나로\n네 언어를 안내하세요.',
    description: '메뉴·가격·사진을 불러와 번역 초안을 만들어요. 확인 후 공개하면 손님은 로그인 없이 QR로 메뉴판을 볼 수 있어요.',
    evidence: 'AI 예시 사진·번역 · 아래 언어 버튼으로 메뉴판 예시를 바꿔보세요.' },
  { id: 'outcome', label: '실행 결과', eyebrow: '06 실행 결과 확인', title: '실행 전후에\n달라진 점을 확인하세요.',
    description: '홍보 전후 판매량과 발주 예상·판매 기록을 비교하세요. 실행 내용과 결과를 저장해 다음 계획에 참고할 수 있어요.',
    evidence: '가상 실행 결과 · 실제 매장 개선 성과나 홍보의 인과 효과가 아니에요.' },
] as const
