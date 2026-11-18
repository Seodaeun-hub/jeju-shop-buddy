// The authenticated account supplies this value; never share a browser-stored date across accounts.
let selectedDate: string | null = null

export const rehearsalDate = () => selectedDate
export function setRehearsalDate(date?: string | null) {
  selectedDate = date ?? null
}
