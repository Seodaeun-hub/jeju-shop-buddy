import type { PromotionDraft } from './shop'

const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif'

function drawPhotoPost(context: CanvasRenderingContext2D, draft: PromotionDraft, photo?: HTMLImageElement) {
  const size = 1080
  context.fillStyle = '#342b24'
  context.fillRect(0, 0, size, size)
  if (photo) {
    const scale = Math.max(size / photo.naturalWidth, size / photo.naturalHeight)
    const width = photo.naturalWidth * scale
    const height = photo.naturalHeight * scale
    context.drawImage(photo, (size - width) / 2, (size - height) / 2, width, height)
  } else {
    context.textAlign = 'center'
    context.fillStyle = '#fff8ec'
    context.font = `500 42px ${font}`
    context.fillText('메뉴 사진을 등록해 주세요', 540, 400, 940)
  }

  const shade = context.createLinearGradient(0, 520, 0, size)
  shade.addColorStop(0, 'rgba(25, 17, 12, 0)')
  shade.addColorStop(.53, 'rgba(25, 17, 12, .52)')
  shade.addColorStop(1, 'rgba(25, 17, 12, .92)')
  context.fillStyle = shade
  context.fillRect(0, 520, size, 560)

  context.textAlign = 'left'
  context.fillStyle = '#fff8ec'
  context.font = `700 76px ${font}`
  context.fillText(draft.headline, 70, 848, 940)

  context.font = `700 61px ${font}`
  const price = draft.discountedPrice
  context.fillText(price, 70, 934, 490)
  const priceWidth = Math.min(context.measureText(price).width, 490)
  context.font = `600 39px ${font}`
  context.fillStyle = '#f5debb'
  context.fillText('·  ' + draft.feature, 70 + priceWidth + 25, 934, 915 - priceWidth)

  context.fillStyle = '#fff1da'
  context.font = `400 34px ${font}`
  context.fillText(draft.storeName, 72, 1009, 936)
}

export function drawPromotionCard(context: CanvasRenderingContext2D, draft: PromotionDraft, photo?: HTMLImageElement) {
  if (draft.templateVersion >= 3) {
    drawPhotoPost(context, draft, photo)
    return
  }
  const { storeName, headline, feature, discountedPrice, detail } = draft
  const photoHeight = 680
  context.fillStyle = '#f8efdc'
  context.fillRect(0, 0, 1080, 1080)

  context.fillStyle = '#28493b'
  context.fillRect(0, 0, 1080, photoHeight)
  if (photo) {
    const scale = Math.max(1080 / photo.naturalWidth, photoHeight / photo.naturalHeight)
    const width = photo.naturalWidth * scale
    const height = photo.naturalHeight * scale
    context.save()
    context.beginPath()
    context.rect(0, 0, 1080, photoHeight)
    context.clip()
    context.drawImage(photo, (1080 - width) / 2, (photoHeight - height) / 2, width, height)
    context.restore()
  } else {
    context.textAlign = 'center'
    context.fillStyle = '#f8efdc'
    context.font = `700 43px ${font}`
    context.fillText('메뉴 사진을 등록해 주세요', 540, 337, 928)
  }

  const shade = context.createLinearGradient(0, 0, 0, 210)
  shade.addColorStop(0, 'rgba(18, 27, 21, .7)')
  shade.addColorStop(1, 'rgba(18, 27, 21, 0)')
  context.fillStyle = shade
  context.fillRect(0, 0, 1080, 210)
  context.textAlign = 'left'
  context.fillStyle = '#fffaf1'
  context.font = `700 43px ${font}`
  context.fillText(storeName, 58, 99, 964)

  context.fillStyle = '#294638'
  context.font = `700 74px ${font}`
  context.fillText(headline, 58, 766, 964)
  context.font = `800 121px ${font}`
  context.fillText(discountedPrice, 52, 924, 548)

  context.fillStyle = '#a73f19'
  context.beginPath()
  context.roundRect(632, 820, 390, 108, 54)
  context.fill()
  context.textAlign = 'center'
  context.fillStyle = '#fffaf1'
  context.font = `700 56px ${font}`
  context.fillText(feature, 827, 895, 334)

  context.textAlign = 'left'
  context.fillStyle = '#544c3e'
  context.font = `700 38px ${font}`
  context.fillText('행사 기간  ' + detail, 58, 1018, 964)
}
