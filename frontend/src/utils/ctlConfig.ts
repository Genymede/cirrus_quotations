
export const CTL_CONFIG = {
  vatRate: 0.07,

  work: {
    hoursPerDay: 8,
    defaultDays: 1,
  },

  consum: {
    ratePerPersonPerDay: 300,
  },

  labour: {
    rates: [
      { key: 'staff400', label: 'Staff x 400', rate: 400 },
      { key: 'staff500', label: 'Staff x 500', rate: 500 },
      { key: 'normalStaff600', label: 'Normal Staff x 600', rate: 600 },
      { key: 'teamLeader800', label: 'Team Leader x 800', rate: 800 },
    ],
  },

  gas: {
    ratesByLocation: {
      'Boat Lagoon': 0,
      'Royal Phuket Marina': 0,
      'Ao Po Grand Marina': 500,
      'Ao Yon': 400,
      Chalong: 500,
      'Laem Sai Pier': 500,
      'Nai Harn': 400,
      Patong: 400,
      'Premier Shipyard': 600,
      Ratsada: 300,
      Rattanachai: 500,
      'Yacht Haven': 600,
      'Ocean Marina Pattaya': 7000,
    },
  },
} as const;

export type LabourStaffCounts = Record<
  (typeof CTL_CONFIG.labour.rates)[number]['key'],
  number
>;

export const DEFAULT_LABOUR_STAFF: LabourStaffCounts = {
  staff400: 0,
  staff500: 0,
  normalStaff600: 0,
  teamLeader800: 0,
};
