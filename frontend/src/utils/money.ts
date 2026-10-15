// src/utils/money.ts

/**
 * ปัดเงินให้เหลือ 2 ตำแหน่งทศนิยม (แบบมาตรฐาน)
 */
export const roundMoney = (value: number): number =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100

/**
 * ปัดขึ้น 2 ตำแหน่งทศนิยม
 */
export const ceilMoney = (value: number): number =>
    Math.ceil((Number(value) - Number.EPSILON) * 100) / 100