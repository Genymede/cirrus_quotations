import type { InventoryItem } from '../types/inventory'
import { api } from './api'

// Phase 4: routed through the shared api module (src/services/api.ts) --
// same two exported functions, same signatures, so StockItemPicker.tsx
// (the only real caller) needs no changes at all. Previously built its own
// URL from the stray VITE_API_URL env var directly; that is no longer read
// here (see Phase 4's report for what happened to the old `.env` value).
export async function getInventoryItems(): Promise<InventoryItem[]> {
    return api.listItems() as Promise<InventoryItem[]>
}

export async function getInventoryItem(
    id: string
): Promise<InventoryItem> {
    return api.getItem(id) as Promise<InventoryItem>
}
