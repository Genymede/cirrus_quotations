import { useState } from 'react'

type SourceType =
	| 'import'
	| 'local_supplier'
	| 'local_purchase'

type ExternalPart = {
	brand: string
	partName: string
	partNo: string
	qty: number
	unit: string
	unitPrice: number
	sourceType: SourceType
	sourceName: string
	shippingIncluded: boolean
	estimatedDelivery: string
	importDutyIncluded: boolean
	customsClearanceIncluded: boolean
	installationIncluded: boolean
	warranty: string
}

type Props = {
	open: boolean
	onClose: () => void
	onSubmit: (part: ExternalPart) => void
}

function ExternalPartForm({
	open,
	onClose,
	onSubmit,
}: Props) {
	const [brand, setBrand] = useState('')
	const [partName, setPartName] = useState('')
	const [partNo, setPartNo] = useState('')
	const [qty, setQty] = useState(1)
	const [unit, setUnit] = useState('ea')
	const [unitPrice, setUnitPrice] = useState(0)

	const [sourceType, setSourceType] =
		useState<SourceType>('import')
	const [sourceName, setSourceName] = useState('')
	const [shippingIncluded, setShippingIncluded] = useState(true)
	const [estimatedDelivery, setEstimatedDelivery] = useState('')
	const [importDutyIncluded, setImportDutyIncluded] =
		useState(true)
	const [customsClearanceIncluded, setCustomsClearanceIncluded] =
		useState(false)
	const [installationIncluded, setInstallationIncluded] =
		useState(false)
	const [warranty, setWarranty] = useState(
		"Manufacturer's Terms"
	)

	if (!open) return null

	const total = qty * unitPrice

	const handleSourceTypeChange = (
		value: SourceType
	) => {
		setSourceType(value)

		if (value === 'import') {
			setImportDutyIncluded(true)
			setCustomsClearanceIncluded(false)
			setWarranty("Manufacturer's Terms")
		}

		if (value === 'local_supplier') {
			setImportDutyIncluded(false)
			setCustomsClearanceIncluded(false)
			setWarranty("Supplier's Terms")
		}

		if (value === 'local_purchase') {
			setImportDutyIncluded(false)
			setCustomsClearanceIncluded(false)
			setShippingIncluded(false)
			setWarranty('')
		}
	}

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault()

		if (!partName.trim()) {
			return
		}

		onSubmit({
			brand: brand.trim(),
			partName: partName.trim(),
			partNo: partNo.trim(),
			qty,
			unit,
			unitPrice,
			sourceType,
			sourceName: sourceName.trim(),
			shippingIncluded,
			estimatedDelivery: estimatedDelivery.trim(),
			importDutyIncluded,
			customsClearanceIncluded,
			installationIncluded,
			warranty: warranty.trim(),
		})

		setBrand('')
		setPartName('')
		setPartNo('')
		setQty(1)
		setUnit('ea')
		setUnitPrice(0)
		setSourceType('import')
		setSourceName('')
		setShippingIncluded(true)
		setEstimatedDelivery('')
		setImportDutyIncluded(true)
		setCustomsClearanceIncluded(false)
		setInstallationIncluded(false)
		setWarranty("Manufacturer's Terms")
	}

	return (
		<div className="modal-backdrop">
			<div className="external-form">
				<div className="modal-header">
					<div>
						<h2>Add External Part</h2>
						<p>Add a part that is not currently in stock</p>
					</div>

					<button
						type="button"
						className="modal-close"
						onClick={onClose}
					>
						×
					</button>
				</div>

				<form onSubmit={handleSubmit}>
					<div className="external-form-body">
						<div className="form-group">
							<label>Brand</label>
							<input
								value={brand}
								onChange={(event) =>
									setBrand(event.target.value)
								}
								placeholder="e.g. Dometic"
							/>
						</div>

						<div className="form-group">
							<label>Product Name *</label>
							<input
								value={partName}
								onChange={(event) =>
									setPartName(event.target.value)
								}
								placeholder="Enter product name"
								required
							/>
						</div>

						<div className="form-group">
							<label>Part No.</label>
							<input
								value={partNo}
								onChange={(event) =>
									setPartNo(event.target.value)
								}
								placeholder="Enter part number"
							/>
						</div>

						<div className="form-group">
							<label>Source Type</label>
							<select
								value={sourceType}
								onChange={(event) =>
									handleSourceTypeChange(
										event.target.value as SourceType
									)
								}
							>
								<option value="import">
									Import
								</option>
								<option value="local_supplier">
									Local Supplier
								</option>
								<option value="local_purchase">
									Local Purchase
								</option>
							</select>
						</div>

						<div className="form-group">
							<label>
								{sourceType === 'local_purchase'
									? 'Purchase Location'
									: 'Supplier / Source'}
							</label>

							<input
								value={sourceName}
								onChange={(event) =>
									setSourceName(event.target.value)
								}
								placeholder={
									sourceType === 'import'
										? 'e.g. Vitrifrigo Italy'
										: sourceType === 'local_supplier'
											? 'e.g. ABC Marine'
											: 'e.g. Phuket Marine Store'
								}
							/>
						</div>

						<div className="form-row">
							<div className="form-group">
								<label>Qty</label>
								<input
									type="number"
									min="1"
									value={qty}
									onChange={(event) =>
										setQty(
											Math.max(
												1,
												Number(event.target.value)
											)
										)
									}
								/>
							</div>

							<div className="form-group">
								<label>Unit</label>
								<input
									value={unit}
									onChange={(event) =>
										setUnit(event.target.value)
									}
								/>
							</div>
						</div>

						<div className="form-group">
							<label>Price THB / Unit</label>
							<input
								type="number"
								min="0"
								step="0.01"
								value={unitPrice}
								onChange={(event) =>
									setUnitPrice(
										Math.max(
											0,
											Number(event.target.value)
										)
									)
								}
							/>
						</div>

						<div className="form-row">
							<div className="form-group">
								<label>Shipping</label>
								<select
									value={
										shippingIncluded
											? 'included'
											: 'excluded'
									}
									onChange={(event) =>
										setShippingIncluded(
											event.target.value === 'included'
										)
									}
								>
									<option value="included">
										Included
									</option>
									<option value="excluded">
										Excluded
									</option>
								</select>
							</div>

							<div className="form-group">
								<label>Estimated Delivery</label>
								<input
									value={estimatedDelivery}
									onChange={(event) =>
										setEstimatedDelivery(
											event.target.value
										)
									}
									placeholder="e.g. 8 Weeks"
								/>
							</div>
						</div>

						{sourceType === 'import' && (
							<div className="form-row">
								<div className="form-group">
									<label>Import Duty</label>
									<select
										value={
											importDutyIncluded
												? 'included'
												: 'excluded'
										}
										onChange={(event) =>
											setImportDutyIncluded(
												event.target.value ===
												'included'
											)
										}
									>
										<option value="included">
											Included
										</option>
										<option value="excluded">
											Excluded
										</option>
									</select>
								</div>

								<div className="form-group">
									<label>Customs Clearance</label>
									<select
										value={
											customsClearanceIncluded
												? 'included'
												: 'excluded'
										}
										onChange={(event) =>
											setCustomsClearanceIncluded(
												event.target.value ===
												'included'
											)
										}
									>
										<option value="included">
											Included
										</option>
										<option value="excluded">
											Excluded
										</option>
									</select>
								</div>
							</div>
						)}

						<div className="form-row">
							<div className="form-group">
								<label>Installation</label>
								<select
									value={
										installationIncluded
											? 'included'
											: 'excluded'
									}
									onChange={(event) =>
										setInstallationIncluded(
											event.target.value === 'included'
										)
									}
								>
									<option value="included">
										Included
									</option>
									<option value="excluded">
										Excluded
									</option>
								</select>
							</div>

							<div className="form-group">
								<label>Warranty</label>
								<input
									value={warranty}
									onChange={(event) =>
										setWarranty(event.target.value)
									}
									placeholder="e.g. Manufacturer's Terms"
								/>
							</div>
						</div>

						<div className="external-total">
							<span>Total</span>
							<strong>
								฿ {total.toFixed(2)}
							</strong>
						</div>
					</div>

					<div className="modal-footer">
						<button
							type="button"
							className="btn btn-outline"
							onClick={onClose}
						>
							Cancel
						</button>

						<button
							type="submit"
							className="btn btn-primary"
						>
							Add Part
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}

export default ExternalPartForm
