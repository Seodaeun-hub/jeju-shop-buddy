export const menuLanguages = [
  { id: 'ko', label: '한국어', locale: 'ko-KR', heading: '메뉴', ask: '가격은 직원에게 문의해 주세요.' },
  { id: 'en', label: 'English', locale: 'en', heading: 'Menu', ask: 'Ask staff for the price.' },
  { id: 'zh', label: '简体中文', locale: 'zh-Hans', heading: '菜单', ask: '价格请咨询店员。' },
  { id: 'ja', label: '日本語', locale: 'ja', heading: 'メニュー', ask: '価格はスタッフにお尋ねください。' },
] as const

export const translationLanguages = [menuLanguages[1], menuLanguages[2], menuLanguages[3]]
export type MenuTranslation = { index: number; en: string; zh: string; ja: string }
export type MenuItem = { name: string; priceWon: number | null; photoDataUrl: string | null }
export type PublishedMenu = { publicId: string; version: string; translations: MenuTranslation[] }
export type MenuEditor = { storeName: string; version: string; items: MenuItem[]; published: PublishedMenu | null }
export type GuestMenu = {
  storeName: string
  version: string
  items: { name: string; priceWon: number | null; hasPhoto: boolean; translation: MenuTranslation }[]
}

export function guestMenuPath(id: string) {
  return '/api/public/menus/' + encodeURIComponent(id)
}
