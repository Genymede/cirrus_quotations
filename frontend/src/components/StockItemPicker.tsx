import { useEffect, useMemo, useState } from 'react'
import {
	getInventoryItems,
} from '../services/inventoryApi'
import type { InventoryItem } from '../types/inventory'

type Props = {
	open: boolean
	onClose: () => void
	onSelect: (item: InventoryItem) => void
}

function StockItemPicker({ open, onClose, onSelect }: Props) {
	const [items, setItems] = useState<InventoryItem[]>([])
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	useEffect(() => {
		if (!open) return

		setSearch('')
		setError('')
		setLoading(true)

		getInventoryItems()
			.then(setItems)
			.catch(() => {
				setError('Unable to load inventory')
			})
			.finally(() => {
				setLoading(false)
			})
	}, [open])

	const filteredItems = useMemo(() => {
		const keyword = search.trim().toLowerCase()

		if (!keyword) return items

		return items.filter((item) =>
			[
				item.partName,
				item.partNo,
				item.barcode,
			]
				.filter(Boolean)
				.some((value) =>
					String(value).toLowerCase().includes(keyword)
				)
		)
	}, [items, search])

	if (!open) return null

	return (
		<div className="modal-backdrop">
			<div className="stock-picker">
				<div className="modal-header">
					<div>
						<h2>Add from Stock</h2>
						<p>Select an item from Cirrus inventory</p>
					</div>

					<button
						className="modal-close"
						onClick={onClose}
					>
						×
					</button>
				</div>

				<div className="stock-search">
					<input
						autoFocus
						value={search}
						onChange={(event) =>
							setSearch(event.target.value)
						}
						placeholder="Search part name, part no. or barcode..."
					/>
				</div>

				<div className="stock-list">
					{loading && (
						<div className="picker-state">
							Loading inventory...
						</div>
					)}

					{error && (
						<div className="picker-state error">
							{error}
						</div>
					)}

					{!loading &&
						!error &&
						filteredItems.length === 0 && (
							<div className="picker-state">
								No inventory items found
							</div>
						)}

					{!loading &&
						!error &&
						filteredItems.map((item) => (
							<button
								key={item.id}
								className="stock-item"
								onClick={() => onSelect(item)}
							>
								<div className="stock-item-main">
									<strong>{item.partName}</strong>

									<span>
										{item.partNo || 'No part number'}
									</span>
								</div>

								<div className="stock-item-meta">
									<span>
										{item.unit?.abbreviation || '-'}
									</span>

									<strong>
										฿ {Number(item.unitSellPrice).toFixed(2)}
									</strong>
								</div>
							</button>
						))}
				</div>
			</div>
		</div>
	)
}

export default StockItemPicker