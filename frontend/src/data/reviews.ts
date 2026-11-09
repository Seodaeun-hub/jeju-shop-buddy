export type ReviewTopic = 'AFTERNOON_ORDER' | 'PARKING' | 'WAIT_TIME'

export type Review = { id: string; date: string; text: string }

export const exampleReviews: Review[] = [
  { id: 'ay-01', date: '2021-04-04', text: '국이 따뜻하고 반찬이 맛있었어요.' },
  { id: 'ay-02', date: '2021-04-10', text: '주차장 입구를 찾기 조금 어려웠어요.' },
  { id: 'ay-03', date: '2021-04-16', text: '점심에 방문했는데 주문이 빨리 나왔어요.' },
  { id: 'ay-04', date: '2021-04-25', text: '아이와 함께 먹기 편했어요.' },
  { id: 'ay-05', date: '2021-05-03', text: '오후에 식사 주문이 되는지 안내가 없어 헷갈렸어요.' },
  { id: 'ay-06', date: '2021-05-08', text: '제주 여행 중 들렀는데 직원분이 친절했어요.' },
  { id: 'ay-07', date: '2021-05-14', text: '오후에도 주문할 수 있다고 입구에 써 있어서 편했어요.' },
  { id: 'ay-08', date: '2021-05-19', text: '오후 3시에 갔는데 식사 주문이 가능한지 몰라서 돌아갔어요.' },
  { id: 'ay-09', date: '2021-05-26', text: '제육볶음이 맛있어서 또 오고 싶어요.' },
]

export const incomingExampleReview: Review = {
  id: 'ay-10',
  date: '2021-05-31',
  text: '오후에도 식사 주문이 되는지 몰랐어요. 입구에서 바로 확인할 수 있으면 좋겠어요.',
}

export function findAfternoonOrderComplaints(reviews: Review[]) {
  return reviews.filter(({ text }) => text.split(/[.!?]/).some((sentence) =>
    /오후|점심\s*이후/.test(sentence)
    && /식사|주문/.test(sentence)
    && /헷갈|몰랐|몰라|알기\s*어려|안내가\s*없/.test(sentence),
  ))
}
