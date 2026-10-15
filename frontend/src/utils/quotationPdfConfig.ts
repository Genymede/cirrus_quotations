// ============================================================
// PDF LAYOUT & COMPANY / BANK CONFIGURATION
// ============================================================

export const COMPANY = {
  companies: [
    'AIR CONDITIONING & REFRIGERATION CO. LTD.',
    'CONSTRUCTION & COMMUNICATIONS CO. LTD.',
    'MARINE CO. LTD.',
    'MARINE SERVICES CO. LTD.',
  ],
  address: 'Phuket, Thailand',
  tel: '+66 (0)76 XXX XXX',
  email: 'info@cirrusmarine.com',
  website: 'www.cirrusmarine.com',
}

export const BANKS = {
  CA: {
    bankName: 'Bangkok Bank Public Company Limited',
    branch: 'Phuket Branch',
    bankAddress: '22 Phangnga Rd, Tambon Talat Yai, Mueang Phuket District, Phuket 83000',
    accountName: 'CIRRUS AIR CONDITIONING & REFRIGERATION CO., LTD.',
    accountNo: '264-4-50133-6',
    swift: 'BKKBTHBK',
    address: '58/23 Moo.6, Thepkasattri Rd., Tombon Ratsada, Muang Phuket 83000',
    tel: '+66 76-601-184, +66 76-601-185',
    taxId: '',
  },
  CM: {
    bankName: 'Bangkok Bank Public Company Limited',
    branch: 'Phuket Branch',
    bankAddress: '22 Phangnga Rd, Tambon Talat Yai, Mueang Phuket District, Phuket 83000',
    accountName: 'Cirrus Marine Co., Ltd.',
    accountNo: '264-4-50132-8',
    swift: 'BKKBTHBK',
    address: '58/24 Moo.6, Thepkasattri Rd., Tombon Ratsada, Muang Phuket 83000',
    tel: '+66 76-601-184, +66 76-601-185',
    taxId: '0835550008982',
  },
  CS: {
    bankName: 'Siam Commercial Bank Plc.',
    branch: 'Phuket Boat Lagoon Sub Branch',
    bankAddress: '14/1 Moo.2, Thepkasatri Rd., Tombon Koh Kaew, Muang Phuket 83000',
    accountName: 'Cirrus Marine Services Co., Ltd.',
    accountNo: '886-217160-5',
    swift: 'SICOTHBK',
    address: '58/24 Moo.6, Thepkasattri Rd., Tombon Ratsada, Muang Phuket 83000',
    tel: '+66 76-601-184, +66 76-601-185',
    taxId: '0835560018123',
  },
} as const

export type CompanyCode = keyof typeof BANKS

export const PDF_LAYOUT = {
  page: {
    margin: 10,
    contentBottom: 80,
    notesBottom: 55,
    paymentBottom: 78,
    bankBottom: 10,
  },

  header: {
    top: 14,
    logoHeight: 15,
    jobBarHeight: 7,
    jobBoxHeight: 10,
  },

  table: {
    headerHeight: 5,
    sectionHeight: 5,
    itemMinHeight: 5,
    itemLineHeight: 2,
    itemPadding: 2,
    shippingHeight: 5,
    importTaxHeight: 5,
    discountHeight: 5,
  },

  columns: {
    qty: 13,
    unit: 14,
    price: 31,
    total: 31,
  },

  ctl: {
    headerHeight: 5,
    itemHeight: 5,
    noteMinHeight: 4,
    noteLineHeight: 3,
    notePadding: 1.5,
    totalHeight: 6,
    highlightHeight: 4,
  },

  notes: {
    lineHeight: 3,
    paddingVertical: 4,
    paddingHorizontal: 4,
    bottomSpacing: 4,
  },

  summary: {
    rowHeight: 5,
    totalHeight: 5,
    bottomSpacing: 5,
  },

  shipping: {
    show: true,
    label: 'Shipping Cost is included.',
    deliveryLabel: 'Estimated delivery time is',
    textColor: [255, 0, 0] as [number, number, number],
    gapAfter: 0,
    paddingHorizontal: 4,
    paddingVertical: 1,
    lineHeight: 3,
    backgroundColor: 255,
  },

  typography: {
    tableHeader: 8,
    tableText: 7.5,
    section: 7.5,
    small: 7.5,
    note: 7.5,
    summary: 9,
    total: 8,
  },

  bank: {
    boxHeight: 30,
    paddingHorizontal: 2,
    paddingTop: 5,
    titleSpacing: 5,
    lineHeight: 3.5,
  },

  signature: {
    width: 60,
    lineWidth: 42,
    topSpacing: 18,
  },

  footer: {
    height: 90,
    bottomMargin: 8,
  },
}

// ---- CTL ----
export const CTL_MARKUP = 0.07

export type CtlItemKey =
  | 'consumable'
  | 'traveling'
  | 'gasoline'
  | 'labour'

export const CTL_ITEM_DEFS: {
  key: CtlItemKey
  label: string
  hasNote?: boolean
  notePlaceholder?: string
}[] = [
    {
      key: 'consumable',
      label: 'Consumable / Material / Protection',
    },
    {
      key: 'traveling',
      label: 'Traveling time / Depreciation',
      hasNote: true,
      notePlaceholder: 'e.g. Project location: Boat Lagoon',
    },
    {
      key: 'gasoline',
      label: 'Gasoline / Depreciation / Vehicles',
    },
    {
      key: 'labour',
      label: 'Labour Cost Estimation',
      hasNote: true,
      notePlaceholder:
        'e.g. 1 Day / 1 Technicians: Delay Timer Repair, Replacement of Components & Reinstallation',
    },
  ]

export const computeCtlTotal = (price: number) =>
  Math.ceil(price * (1 + CTL_MARKUP) * 100) / 100

export type BankInfo = {
  bankName: string
  bankAddress: string
  accountName: string
  accountNo: string
  swift: string
  accountType: string
  address: string
  tel: string
}

export type CompanyInfo = {
  id: string
  code: 'CA' | 'CM' | 'CS'
  name: string
  address: string
  headOffice: string
  taxId: string
  tel: string
  email: string
  website: string
  bank: BankInfo
}

const COMMON_TEL = '+66 76-601-184, +66 76-601-185'
const COMMON_EMAIL = 'info@cirrusmarine.com'
const COMMON_WEBSITE = 'www.cirrusmarine.com'
const COMMON_ADDRESS = '58/24 Moo.6, Thepkasattri Rd., Tambon Ratsada, Mueang Phuket, Phuket 83000'

export const COMPANY_CONFIGS: Record<string, CompanyInfo> = {
  CA: {
    id: 'CA',
    code: 'CA',
    name: 'CIRRUS AIR CONDITIONING & REFRIGERATION CO., LTD.',
    address: '58/23 Moo.6, Thepkasattri Rd., Tambon Ratsada, Mueang Phuket, Phuket 83000',
    headOffice: 'Head Office',
    taxId: '',
    tel: COMMON_TEL,
    email: COMMON_EMAIL,
    website: COMMON_WEBSITE,
    bank: {
      bankName: 'Bangkok Bank Public Company Limited',
      bankAddress: '22 Phangnga Rd., Tambon Talat Yai, Mueang Phuket District, Phuket 83000',
      accountName: 'CIRRUS AIR CONDITIONING & REFRIGERATION CO., LTD.',
      accountNo: '264-4-50133-6',
      swift: 'BKKBTHBK',
      accountType: 'Savings Account',
      address: '58/23 Moo.6, Thepkasattri Rd., Tambon Ratsada, Mueang Phuket, Phuket 83000',
      tel: COMMON_TEL,
    },
  },
  CM: {
    id: 'CM',
    code: 'CM',
    name: 'CIRRUS MARINE CO., LTD.',
    address: COMMON_ADDRESS,
    headOffice: 'Head Office',
    taxId: '0835550008982',
    tel: COMMON_TEL,
    email: COMMON_EMAIL,
    website: COMMON_WEBSITE,
    bank: {
      bankName: 'Bangkok Bank Public Company Limited',
      bankAddress: '22 Phangnga Rd., Tambon Talat Yai, Mueang Phuket District, Phuket 83000',
      accountName: 'Cirrus Marine Co., Ltd.',
      accountNo: '264-4-50132-8',
      swift: 'BKKBTHBK',
      accountType: 'Savings Account',
      address: COMMON_ADDRESS,
      tel: COMMON_TEL,
    },
  },
  CS: {
    id: 'CS',
    code: 'CS',
    name: 'CIRRUS MARINE SERVICES CO., LTD.',
    address: COMMON_ADDRESS,
    headOffice: 'Head Office',
    taxId: '0835560018123',
    tel: COMMON_TEL,
    email: COMMON_EMAIL,
    website: COMMON_WEBSITE,
    bank: {
      bankName: 'Siam Commercial Bank Plc.',
      bankAddress: '14/1 Moo.2, Thepkasattri Rd., Tambon Koh Kaew, Mueang Phuket, Phuket 83000',
      accountName: 'Cirrus Marine Services Co., Ltd.',
      accountNo: '886-217160-5',
      swift: 'SICOTHBK',
      accountType: 'Savings Account',
      address: COMMON_ADDRESS,
      tel: COMMON_TEL,
    },
  },
}

export const getCompanyConfig = (companyId?: string): CompanyInfo => {
  const company = companyId ? COMPANY_CONFIGS[companyId] : undefined

  if (!company) {
    throw new Error(`Company information not found for companyId: ${companyId ?? 'undefined'}`)
  }

  return company
}