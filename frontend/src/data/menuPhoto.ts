export async function prepareMenuPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('10MB 이하의 JPG, PNG 또는 WebP 사진을 선택해 주세요.')
  }
  const image = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 900 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('사진을 준비할 수 없어요.')
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.65, 0.45]) {
      const photo = canvas.toDataURL('image/jpeg', quality)
      if (photo.length <= 450_000) return photo
    }
    throw new Error('더 작은 사진을 선택해 주세요.')
  } finally {
    image.close()
  }
}
