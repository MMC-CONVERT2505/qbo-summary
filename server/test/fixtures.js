/**
 * Trimmed-down copies of real QBO report payloads, kept as fixtures so the
 * report parser can be exercised without a live Intuit connection.
 */

export const profitAndLoss = {
  Header: { ReportName: 'ProfitAndLoss', Currency: 'USD', ReportBasis: 'Accrual' },
  Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Income',
        Header: { ColData: [{ value: 'Income' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Design income', id: '82' }, { value: '2250.00' }] },
            { type: 'Data', ColData: [{ value: 'Services', id: '1' }, { value: '503.55' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '2753.55' }] },
      },
      {
        type: 'Section',
        group: 'COGS',
        Summary: { ColData: [{ value: 'Total Cost of Goods Sold' }, { value: '405.00' }] },
      },
      {
        type: 'Section',
        group: 'GrossProfit',
        Summary: { ColData: [{ value: 'Gross Profit' }, { value: '2348.55' }] },
      },
      {
        type: 'Section',
        group: 'Expenses',
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Advertising', id: '7' }, { value: '74.86' }] },
            { type: 'Data', ColData: [{ value: 'Rent or Lease', id: '15' }, { value: '900.00' }] },
            { type: 'Data', ColData: [{ value: 'Utilities', id: '25' }, { value: '113.75' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '1088.61' }] },
      },
      {
        type: 'Section',
        group: 'NetOperatingIncome',
        Summary: { ColData: [{ value: 'Net Operating Income' }, { value: '1259.94' }] },
      },
      {
        type: 'Section',
        group: 'NetIncome',
        Summary: { ColData: [{ value: 'Net Income' }, { value: '1259.94' }] },
      },
    ],
  },
};

export const balanceSheet = {
  Header: { ReportName: 'BalanceSheet', Currency: 'USD' },
  Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'TotalAssets',
        Header: { ColData: [{ value: 'ASSETS' }] },
        Rows: {
          Row: [
            {
              type: 'Section',
              group: 'TotalCurrentAssets',
              Rows: {
                Row: [
                  {
                    type: 'Section',
                    group: 'TotalBankAccounts',
                    Summary: { ColData: [{ value: 'Total Bank Accounts' }, { value: '3183.51' }] },
                  },
                  {
                    type: 'Section',
                    group: 'TotalAR',
                    Summary: {
                      ColData: [{ value: 'Total Accounts Receivable' }, { value: '5281.52' }],
                    },
                  },
                ],
              },
              Summary: { ColData: [{ value: 'Total Current Assets' }, { value: '8465.03' }] },
            },
          ],
        },
        Summary: { ColData: [{ value: 'TOTAL ASSETS' }, { value: '8465.03' }] },
      },
      {
        type: 'Section',
        group: 'TotalLiabilitiesAndEquity',
        Rows: {
          Row: [
            {
              type: 'Section',
              group: 'TotalLiabilities',
              Rows: {
                Row: [
                  {
                    type: 'Section',
                    group: 'TotalCurrentLiabilities',
                    Rows: {
                      Row: [
                        {
                          type: 'Section',
                          group: 'TotalAP',
                          Summary: {
                            ColData: [{ value: 'Total Accounts Payable' }, { value: '1602.67' }],
                          },
                        },
                      ],
                    },
                    Summary: {
                      ColData: [{ value: 'Total Current Liabilities' }, { value: '1802.67' }],
                    },
                  },
                ],
              },
              Summary: { ColData: [{ value: 'Total Liabilities' }, { value: '1802.67' }] },
            },
            {
              type: 'Section',
              group: 'TotalEquity',
              Summary: { ColData: [{ value: 'Total Equity' }, { value: '6662.36' }] },
            },
          ],
        },
        Summary: {
          ColData: [{ value: 'TOTAL LIABILITIES AND EQUITY' }, { value: '8465.03' }],
        },
      },
    ],
  },
};

export const agedReceivables = {
  Header: { ReportName: 'AgedReceivables' },
  Columns: {
    Column: [
      { ColTitle: '' },
      { ColTitle: 'Current' },
      { ColTitle: '1 - 30' },
      { ColTitle: '31 - 60' },
      { ColTitle: '61 - 90' },
      { ColTitle: '91 and over' },
      { ColTitle: 'Total' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Rows: {
          Row: [
            {
              type: 'Data',
              ColData: [
                { value: 'Amy Lauterbach', id: '10' },
                { value: '0.00' }, { value: '100.00' }, { value: '0.00' },
                { value: '0.00' }, { value: '0.00' }, { value: '100.00' },
              ],
            },
          ],
        },
        Summary: {
          ColData: [
            { value: 'TOTAL' },
            { value: '1250.00' }, { value: '2100.75' }, { value: '810.00' },
            { value: '0.00' }, { value: '1120.77' }, { value: '5281.52' },
          ],
        },
      },
    ],
  },
};

export const companyInfo = {
  CompanyName: 'Craig\u2019s Design and Landscaping',
  LegalName: 'Craig\u2019s Design and Landscaping Services',
  Country: 'US',
  FiscalYearStartMonth: 'January',
  Email: { Address: 'books@craigsdesign.example' },
  MetaData: { CreateTime: '2021-03-04T10:12:00-08:00' },
};
