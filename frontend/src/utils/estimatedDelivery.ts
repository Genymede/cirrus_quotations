import type { ExternalGroup, DeliveryUnit } from './externalPartsAllocation'

const DAYS_PER_UNIT: Record<DeliveryUnit, number> = {
    days: 1,
    weeks: 7,
    months: 30,
    years: 365,
}

const WEEK_THRESHOLD_DAYS = 14

export type EstimatedDeliveryResult = {
    averageDays: number
    maxDays: number
    minValue: number
    maxValue: number
    unit: 'days' | 'weeks'
    text: string
}

export function parseEstimatedDelivery(value: string): {
    amount: number
    unit: DeliveryUnit
} | null {
    const match = value.trim().match(/^(\d+)\s+(days?|weeks?|months?|years?)$/i)

    if (!match) return null

    const amount = Number(match[1])
    const rawUnit = match[2].toLowerCase()

    const unitMap: Record<string, DeliveryUnit> = {
        day: 'days',
        days: 'days',
        week: 'weeks',
        weeks: 'weeks',
        month: 'months',
        months: 'months',
        year: 'years',
        years: 'years',
    }

    const unit = unitMap[rawUnit]

    if (!unit || amount <= 0) return null

    return { amount, unit }
}

export function convertDeliveryToDays(value: string): number | null {
    const parsed = parseEstimatedDelivery(value)

    if (!parsed) return null

    return parsed.amount * DAYS_PER_UNIT[parsed.unit]
}

export function calculateEstimatedDelivery(
    groups: ExternalGroup[]
): EstimatedDeliveryResult | null {
    const deliveryDays = groups
        .map((group) => convertDeliveryToDays(group.estimatedDelivery))
        .filter((days): days is number => days !== null)

    if (deliveryDays.length === 0) return null

    const maxDays = Math.max(...deliveryDays)

    if (deliveryDays.length === 1) {
        const days = deliveryDays[0]

        if (days < WEEK_THRESHOLD_DAYS) {
            const value = Math.ceil(days)

            return {
                averageDays: days,
                maxDays: days,
                minValue: value,
                maxValue: value,
                unit: 'days',
                text: `${value} days`,
            }
        }

        const weeks = Math.ceil(days / 7)

        return {
            averageDays: days,
            maxDays: days,
            minValue: weeks,
            maxValue: weeks,
            unit: 'weeks',
            text: `${weeks} weeks`,
        }
    }

    const averageDays = deliveryDays.reduce((sum, days) => sum + days, 0) / deliveryDays.length

    if (maxDays < WEEK_THRESHOLD_DAYS) {
        const average = Math.ceil(averageDays)
        const max = Math.ceil(maxDays)

        return {
            averageDays,
            maxDays,
            minValue: average,
            maxValue: max,
            unit: 'days',
            text: `${average} - ${max} days`,
        }
    }

    const averageWeeks = Math.ceil(averageDays / 7)
    const maxWeeks = Math.ceil(maxDays / 7)

    return {
        averageDays,
        maxDays,
        minValue: averageWeeks,
        maxValue: maxWeeks,
        unit: 'weeks',
        text: `${averageWeeks} - ${maxWeeks} weeks`,
    }
}