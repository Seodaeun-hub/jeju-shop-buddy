import type { CustomerNotice } from '../data/shop'

const suggestions = [
  {
    matches: /주차|주차장/,
    text: '주차는 [주차 위치]를 이용해 주세요. 주차장이 만차라면 직원에게 문의해 주세요.',
    placement: '매장 입구와 주차장 진입로',
  },
  {
    matches: /대기|웨이팅|기다리|줄을/,
    text: '자리가 없을 때는 [대기 등록 방법]으로 대기해 주세요. 예상 대기 시간은 직원에게 문의해 주세요.',
    placement: '매장 입구와 대기 등록대',
  },
  {
    matches: /주문.*(?:시간|가능|마감|오후|식사)|라스트.?오더|브레이크.?타임|(?:오전|오후|식사|점심|저녁|영업시간).*주문/,
    text: '식사 주문 가능 시간은 [주문 가능 시간]이며, 마지막 주문은 [마감 시간]까지예요.',
    placement: '매장 입구와 메뉴판 첫 장',
  },
  {
    matches: /알레르기|알러지|원재료|재료/,
    text: '알레르기가 있거나 피해야 할 재료가 있다면 주문 전에 직원에게 알려주세요.',
    placement: '메뉴판과 주문대',
  },
  {
    matches: /포장|픽업|수령/,
    text: '포장 주문은 [수령 위치]에서 받아 주세요. 주문 확인은 직원에게 문의해 주세요.',
    placement: '계산대와 포장 주문 수령대',
  },
]

export function suggestCustomerNotice(input: string): CustomerNotice | undefined {
  const concern = input.trim()
  if (!concern) return
  const match = suggestions.find(({ matches }) => matches.test(concern))
  return {
    concern,
    text: match?.text ?? '이용 중 궁금하거나 불편한 점이 있다면 직원에게 말씀해 주세요.',
    placement: match?.placement ?? '손님이 불편을 겪는 곳이나 계산대',
  }
}

export function CustomerNoticeDetails({ notice }: { notice: CustomerNotice }) {
  return <dl className="reason">
    <dt>안내 문구</dt><dd>{notice.text}</dd>
    <dt>붙일 곳</dt><dd>{notice.placement}</dd>
    {notice.text.includes('[') && <><dt>붙이기 전</dt><dd>대괄호 안을 매장 정보로 바꿔 주세요.</dd></>}
  </dl>
}
