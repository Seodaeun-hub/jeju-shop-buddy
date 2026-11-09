export function parseCsv(input: string): string[][] {
  const csv = input.replace(/^\uFEFF/, '')
  const cell = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))[ \t]*(,|\r\n|\r|\n|$)/gy
  const records: string[][] = []
  let record: string[] = []
  let more = true
  while (more) {
    const match = cell.exec(csv)
    if (!match) throw new Error('CSV의 쉼표 또는 따옴표 형식을 확인해 주세요.')
    const [, quoted, plain, separator] = match
    record.push((quoted === undefined ? plain : quoted.replaceAll('""', '"')).trim())
    if (separator !== ',') {
      records.push(record)
      record = []
      more = separator !== '' && cell.lastIndex < csv.length
    }
  }

  return records
}
