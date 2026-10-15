import { useState } from 'react'

export type ComboOption = {
	id: string
	label: string
	// Quotations client picker: company name shown in smaller text next to
	// the client's own name, when it differs -- optional, so every other
	// existing caller (project/items pickers) is unaffected.
	sublabel?: string
}

type ComboInputProps = {
	value: string
	onChange: (text: string) => void
	options: ComboOption[]
	onSelect?: (opt: ComboOption) => void
	placeholder?: string
	disabled?: boolean
	className?: string
}

export default function ComboInput({
	value,
	onChange,
	options,
	onSelect,
	placeholder,
	disabled,
	className,
}: ComboInputProps) {
	const [open, setOpen] = useState(false)

	const filtered = options.filter((o) =>
		o.label.toLowerCase().includes(value.trim().toLowerCase())
	)

	return (
		<div className={`combo ${className ?? ''}`} style={{ position: 'relative' }}>
			<input
				type="text"
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				autoComplete="off"
				onChange={(e) => {
					onChange(e.target.value)
					setOpen(true)
				}}
				onFocus={() => setOpen(true)}
				onBlur={() => {
					setTimeout(() => setOpen(false), 150)
				}}
			/>

			{open && !disabled && filtered.length > 0 && (
				<ul
					className="combo-menu"
					style={{
						position: 'absolute',
						zIndex: 30,
						left: 0,
						right: 0,
						margin: 0,
						padding: 0,
						listStyle: 'none',
						maxHeight: 220,
						overflowY: 'auto',
						background: '#fff',
						border: '1px solid #ddd',
						borderRadius: 6,
						boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
					}}
				>
					{filtered.map((opt) => (
						<li key={opt.id}>
							<button
								type="button"
								style={{
									display: 'block',
									width: '100%',
									textAlign: 'left',
									padding: '8px 12px',
									border: 0,
									background: 'transparent',
									cursor: 'pointer',
								}}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									onChange(opt.label)
									onSelect?.(opt)
									setOpen(false)
								}}
							>
								{opt.label}
								{opt.sublabel && (
									<span style={{ fontSize: '0.85em', color: '#888', marginLeft: 6 }}>
										{opt.sublabel}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}