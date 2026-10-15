export type InventoryItem = {
    id: string
    partName: string
    brand: string | null
    partNo: string | null
    itemType: string
    barcode: string | null
    unitCost: string
    unitSellPrice: string
    taxRate: string
    isActive: boolean
    notes: string | null
    unit?: {
        id: string
        name: string
        abbreviation: string
    }
}