type IdPrefix = 'DEC' | 'ASM' | 'SPK'

function mintId(prefix: IdPrefix, year: string, existingIds: readonly string[]): string {
  const regex = new RegExp(`^${prefix}-${year}-(\\d{3})$`)
  let max = 0
  for (const id of existingIds) {
    const match = id.match(regex)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > max) max = num
    }
  }
  const next = (max + 1).toString().padStart(3, '0')
  return `${prefix}-${year}-${next}`
}

export function mintDecisionId(year: string, existingIds: readonly string[]): string {
  return mintId('DEC', year, existingIds)
}

export function mintAssumptionId(year: string, existingIds: readonly string[]): string {
  return mintId('ASM', year, existingIds)
}

export function mintSpikeId(year: string, existingIds: readonly string[]): string {
  return mintId('SPK', year, existingIds)
}
