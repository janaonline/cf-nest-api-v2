import { LineItemKey, LineItemsMap } from './entities/data-collection.schema';

type FormulaRule = {
  type: 'formula';
  operation: 'sum' | 'diff';
  operands: string[];
};

type ComparisonRule = {
  type: 'comparison';
  operator: '<=' | '>=' | '===' | '<' | '>';
  value: number;
};

export type Rule = FormulaRule | ComparisonRule;
export type LineItemRules = Partial<Record<LineItemKey, Rule[]>>;
export type DatacollectionRes = {
  ulbId: string;
  yearId: string;
  success: boolean;
  errors: ValidationErr[];
  lineItems: LineItemsMap;
};
export type ValidationErr = {
  cfCode: LineItemKey;
  value: number | null;
  message: string;
};

export type LineItemsTemplate = {
  cfCode: string;
  nmamCode?: string;
  name: string;
  desc: string;
  rules?: Rule[];
};

// Sample template - data from DB?
export const lineItems: LineItemsTemplate[] = [
  {
    cfCode: '1',
    name: 'Tax Revenue',
    desc: 'Tax Revenue shall include Property Tax, Water tax, Drainage tax, Sewerage tax, Professional tax, Entertainment tax, Advertisement tax, Education Tax, Vehicle Tax, Tax on Animals, Pilgrimage Tax, Octroi and Toll Tax, Cess, Tax Remission & Refund, All other tax revenues (combined).',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '1_1',
          '1_2',
          '1_3',
          '1_4',
          '1_5',
          '1_6',
          '1_7',
          '1_8',
          '1_9',
          '1_10',
          '1_11',
          '1_12',
          '1_13',
          '1_14',
          '1_15',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_1',
    name: 'Property Tax',
    desc: 'Property Tax shall include General Tax, Vacant Land Tax, Industrial Tax, State Government Properties, Central Government Properties, Service Charges in Lieu of property tax from Central Government Properties, Service Charges in Lieu of property tax from Railway authorities, Tax on Agriculture Lands, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_1_1', '1_1_2', '1_1_3', '1_1_4', '1_1_5', '1_1_6', '1_1_7', '1_1_8', '1_1_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_1_1',
    name: 'General Tax',
    desc: 'General Tax shall include Residential, Non Residential, Commercial Tax.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_1_1_1', '1_1_1_2', '1_1_1_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_1_1_1',
    name: 'Residential',
    desc: '',
  },
  {
    cfCode: '1_1_1_2',
    name: 'Non Residential',
    desc: '',
  },
  {
    cfCode: '1_1_1_3',
    name: 'Commercial Tax',
    desc: '',
  },
  {
    cfCode: '1_1_2',
    name: 'Vacant Land Tax',
    desc: '',
  },
  {
    cfCode: '1_1_3',
    name: 'Industrial Tax',
    desc: '',
  },
  {
    cfCode: '1_1_4',
    name: 'State Government Properties',
    desc: '',
  },
  {
    cfCode: '1_1_5',
    name: 'Central Government Properties',
    desc: '',
  },
  {
    cfCode: '1_1_6',
    name: 'Service Charges in Lieu of property tax from Central Government Properties',
    desc: '',
  },
  {
    cfCode: '1_1_7',
    name: 'Service Charges in Lieu of property tax from Railway authorities',
    desc: '',
  },
  {
    cfCode: '1_1_8',
    name: 'Tax on Agriculture Lands',
    desc: '',
  },
  {
    cfCode: '1_1_9',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_2',
    name: 'Water tax',
    desc: 'Water tax shall include Water Supply Tax from Residential, Water Supply Tax from Non Residential, Water Supply Tax from Commercial, Water Supply Tax from Vacant, Water Supply Tax from Industries, Water Supply Tax from State Governement Properties, Water Supply Tax from Central Governement Properties, Water Supply Tax from Agricultural Lands, Water Supply Tax from others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_2_1', '1_2_2', '1_2_3', '1_2_4', '1_2_5', '1_2_6', '1_2_7', '1_2_8', '1_2_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_2_1',
    name: 'Water Supply Tax from Residential',
    desc: '',
  },
  {
    cfCode: '1_2_2',
    name: 'Water Supply Tax from Non Residential',
    desc: '',
  },
  {
    cfCode: '1_2_3',
    name: 'Water Supply Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1_2_4',
    name: 'Water Supply Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1_2_5',
    name: 'Water Supply Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1_2_6',
    name: 'Water Supply Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_2_7',
    name: 'Water Supply Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_2_8',
    name: 'Water Supply Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1_2_9',
    name: 'Water Supply Tax from others',
    desc: '',
  },
  {
    cfCode: '1_3',
    name: 'Drainage tax',
    desc: 'Drainage tax shall include Drainage  from Residential, Drainage  from Non Residential, Drainage Tax from Commercial, Drainage Tax from Vacant, Drainage Tax from Industries, Drainage Tax from State Governement Properties, Drainage Tax from Central Governement Properties, Drainage Tax from Agricultural Lands, Drainage Tax from others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_3_1', '1_3_2', '1_3_3', '1_3_4', '1_3_5', '1_3_6', '1_3_7', '1_3_8', '1_3_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_3_1',
    name: 'Drainage  from Residential',
    desc: '',
  },
  {
    cfCode: '1_3_2',
    name: 'Drainage  from Non Residential',
    desc: '',
  },
  {
    cfCode: '1_3_3',
    name: 'Drainage Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1_3_4',
    name: 'Drainage Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1_3_5',
    name: 'Drainage Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1_3_6',
    name: 'Drainage Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_3_7',
    name: 'Drainage Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_3_8',
    name: 'Drainage Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1_3_9',
    name: 'Drainage Tax from others',
    desc: '',
  },
  {
    cfCode: '1_4',
    name: 'Sewerage tax',
    desc: 'Sewerage tax shall include Sewerage  from Residential, Sewerage  from Non Residential, Sewerage Tax from Commercial, Sewerage Tax from Vacant, Sewerage Tax from Industries, Sewerage Tax from State Governement Properties, Sewerage Tax from Central Governement Properties, Sewerage Tax from Agricultural Lands, Sewerage Tax from others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_4_1', '1_4_2', '1_4_3', '1_4_4', '1_4_5', '1_4_6', '1_4_7', '1_4_8', '1_4_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_4_1',
    name: 'Sewerage  from Residential',
    desc: '',
  },
  {
    cfCode: '1_4_2',
    name: 'Sewerage  from Non Residential',
    desc: '',
  },
  {
    cfCode: '1_4_3',
    name: 'Sewerage Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1_4_4',
    name: 'Sewerage Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1_4_5',
    name: 'Sewerage Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1_4_6',
    name: 'Sewerage Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_4_7',
    name: 'Sewerage Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1_4_8',
    name: 'Sewerage Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1_4_9',
    name: 'Sewerage Tax from others',
    desc: '',
  },
  {
    cfCode: '1_5',
    name: 'Professional tax',
    desc: '',
  },
  {
    cfCode: '1_6',
    name: 'Entertainment tax',
    desc: '',
  },
  {
    cfCode: '1_7',
    name: 'Advertisement tax',
    desc: 'Advertisement tax shall include Tax on Digital Hoadings, Tax on Normal Hoadings, Cinema Houses, Hoardings on Vehicles, Public Screens, Cable Operators, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_7_1', '1_7_2', '1_7_3', '1_7_4', '1_7_5', '1_7_6', '1_7_7'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_7_1',
    name: 'Tax on Digital Hoadings',
    desc: '',
  },
  {
    cfCode: '1_7_2',
    name: 'Tax on Normal Hoadings',
    desc: '',
  },
  {
    cfCode: '1_7_3',
    name: 'Cinema Houses',
    desc: '',
  },
  {
    cfCode: '1_7_4',
    name: 'Hoardings on Vehicles',
    desc: '',
  },
  {
    cfCode: '1_7_5',
    name: 'Public Screens',
    desc: '',
  },
  {
    cfCode: '1_7_6',
    name: 'Cable Operators',
    desc: '',
  },
  {
    cfCode: '1_7_7',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_8',
    name: 'Education Tax',
    desc: '',
  },
  {
    cfCode: '1_9',
    name: 'Vehicle Tax',
    desc: 'Vehicle Tax shall include Tax on Carriage, Tax on Carts, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_9_1', '1_9_2', '1_9_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_9_1',
    name: 'Tax on Carriage',
    desc: '',
  },
  {
    cfCode: '1_9_2',
    name: 'Tax on Carts',
    desc: '',
  },
  {
    cfCode: '1_9_3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_10',
    name: 'Tax on Animals',
    desc: '',
  },
  {
    cfCode: '1_11',
    name: 'Pilgrimage Tax',
    desc: '',
  },
  {
    cfCode: '1_12',
    name: 'Octroi and Toll Tax',
    desc: 'Octroi and Toll Tax shall include Octroi and Toll, Entry Fees, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_12_1', '1_12_2', '1_12_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_12_1',
    name: 'Octroi and Toll',
    desc: '',
  },
  {
    cfCode: '1_12_2',
    name: 'Entry Fees',
    desc: '',
  },
  {
    cfCode: '1_12_3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_13',
    name: 'Cess',
    desc: 'Cess shall include Stamp Duty, Cess, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_13_1', '1_13_2', '1_13_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_13_1',
    name: 'Stamp Duty',
    desc: '',
  },
  {
    cfCode: '1_13_2',
    name: 'Cess',
    desc: '',
  },
  {
    cfCode: '1_13_3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_14',
    name: 'Tax Remission & Refund',
    desc: 'Tax Remission & Refund shall include Vacancy Remission, Tax Remission, Tax Refunds, Early Payment Rebate, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1_14_1', '1_14_2', '1_14_3', '1_14_4', '1_14_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '1_14_1',
    name: 'Vacancy Remission',
    desc: '',
  },
  {
    cfCode: '1_14_2',
    name: 'Tax Remission',
    desc: '',
  },
  {
    cfCode: '1_14_3',
    name: 'Tax Refunds',
    desc: '',
  },
  {
    cfCode: '1_14_4',
    name: 'Early Payment Rebate',
    desc: '',
  },
  {
    cfCode: '1_14_5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1_15',
    name: 'All other tax revenues (combined)',
    desc: '',
  },
  {
    cfCode: '2',
    name: 'Fees & User charges',
    desc: 'Fees & User charges shall include Empanelment & Registration Charges, Liciensing Fees, Fees for Grant of Permit, Fees for Certificate or Extract, Development Charges, Regularisation Fees, Penalties and Fines, Other Fees, User Charges, Entry Fees, Service/ Administrative Charges, Other Charges, Fees Remission and Refund.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_1', '2_2', '2_3', '2_4', '2_5', '2_6', '2_7', '2_8', '2_9', '2_10', '2_11', '2_12', '2_13'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_1',
    name: 'Empanelment & Registration Charges',
    desc: 'Empanelment & Registration Charges shall include Contractors, Suppliers, Licensed Surveyors, Plumbers, Others(Carts, Patience, PW contractors, Cess registrations).',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_1_1', '2_1_2', '2_1_3', '2_1_4', '2_1_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_1_1',
    name: 'Contractors',
    desc: '',
  },
  {
    cfCode: '2_1_2',
    name: 'Suppliers',
    desc: '',
  },
  {
    cfCode: '2_1_3',
    name: 'Licensed Surveyors',
    desc: '',
  },
  {
    cfCode: '2_1_4',
    name: 'Plumbers',
    desc: '',
  },
  {
    cfCode: '2_1_5',
    name: 'Others(Carts, Patience, PW contractors, Cess registrations)',
    desc: '',
  },
  {
    cfCode: '2_2',
    name: 'Liciensing Fees',
    desc: 'Liciensing Fees shall include Trade Licence Fees, Licence Fees under Prevention of Food Alteration (PFA) Act, Building Licence Fees, Fees for Slaughter Houses, Cattle pounding, Butchers & traders of Meat, Licensing of animals, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_2_1', '2_2_2', '2_2_3', '2_2_4', '2_2_5', '2_2_6', '2_2_8', '2_2_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_2_1',
    name: 'Trade Licence Fees',
    desc: '',
  },
  {
    cfCode: '2_2_2',
    name: 'Licence Fees under Prevention of Food Alteration (PFA) Act',
    desc: '',
  },
  {
    cfCode: '2_2_3',
    name: 'Building Licence Fees',
    desc: '',
  },
  {
    cfCode: '2_2_4',
    name: 'Fees for Slaughter Houses',
    desc: '',
  },
  {
    cfCode: '2_2_5',
    name: 'Cattle pounding',
    desc: '',
  },
  {
    cfCode: '2_2_6',
    name: 'Butchers & traders of Meat',
    desc: '',
  },
  {
    cfCode: '2_2_8',
    name: 'Licensing of animals',
    desc: '',
  },
  {
    cfCode: '2_2_9',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '2_3',
    name: 'Fees for Grant of Permit',
    desc: 'Fees for Grant of Permit shall include Fees for Fishery Rights, Fees under Place of Public Resorts Act, Licensing fee from bazaar & shops, Building Permit/License Fee, Fees for permit of Digging Well/ Borewell, Fee for Film Shooting in Parks, Fee for installing Machinery, Fee for Festivals and Fairs, Fee for Private Markets, Fee for Public Markets, Animal Slaughtering Fee, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '2_3_1',
          '2_3_2',
          '2_3_3',
          '2_3_4',
          '2_3_5',
          '2_3_6',
          '2_3_7',
          '2_3_8',
          '2_3_9',
          '2_3_10',
          '2_3_11',
          '2_3_12',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_3_1',
    name: 'Fees for Fishery Rights',
    desc: '',
  },
  {
    cfCode: '2_3_2',
    name: 'Fees under Place of Public Resorts Act',
    desc: '',
  },
  {
    cfCode: '2_3_3',
    name: 'Licensing fee from bazaar & shops',
    desc: '',
  },
  {
    cfCode: '2_3_4',
    name: 'Building Permit/License Fee',
    desc: '',
  },
  {
    cfCode: '2_3_5',
    name: 'Fees for permit of Digging Well/ Borewell',
    desc: '',
  },
  {
    cfCode: '2_3_6',
    name: 'Fee for Film Shooting in Parks',
    desc: '',
  },
  {
    cfCode: '2_3_7',
    name: 'Fee for installing Machinery',
    desc: '',
  },
  {
    cfCode: '2_3_8',
    name: 'Fee for Festivals and Fairs',
    desc: '',
  },
  {
    cfCode: '2_3_9',
    name: 'Fee for Private Markets',
    desc: '',
  },
  {
    cfCode: '2_3_10',
    name: 'Fee for Public Markets',
    desc: '',
  },
  {
    cfCode: '2_3_11',
    name: 'Animal Slaughtering Fee',
    desc: '',
  },
  {
    cfCode: '2_3_12',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '2_4',
    name: 'Fees for Certificate or Extract',
    desc: 'Fees for Certificate or Extract shall include Copy Application Fees, Birth or Death Certificates Fees, Other Certificate Fees.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_4_1', '2_4_2', '2_4_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_4_1',
    name: 'Copy Application Fees',
    desc: '',
  },
  {
    cfCode: '2_4_2',
    name: 'Birth or Death Certificates Fees',
    desc: '',
  },
  {
    cfCode: '2_4_3',
    name: 'Other Certificate Fees',
    desc: '',
  },
  {
    cfCode: '2_5',
    name: 'Development Charges',
    desc: 'Development Charges shall include Road Formation Charges, Building Development Charges, Betterment Charges, Special Development Contribution, Layout subdivision fee, Impact Fee, Unapproved Layout - Development charges, Un-Authorised Colony Improvement Contribution, Centage charges, Open Space Contribution, Parking Contribution, Postage & Advertisement Charges, Other Town Planning Receipts, Other Development Charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '2_5_1',
          '2_5_2',
          '2_5_3',
          '2_5_4',
          '2_5_5',
          '2_5_6',
          '2_5_7',
          '2_5_8',
          '2_5_9',
          '2_5_10',
          '2_5_11',
          '2_5_12',
          '2_5_13',
          '2_5_14',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_5_1',
    name: 'Road Formation Charges',
    desc: '',
  },
  {
    cfCode: '2_5_2',
    name: 'Building Development Charges',
    desc: '',
  },
  {
    cfCode: '2_5_3',
    name: 'Betterment Charges',
    desc: '',
  },
  {
    cfCode: '2_5_4',
    name: 'Special Development Contribution',
    desc: '',
  },
  {
    cfCode: '2_5_5',
    name: 'Layout subdivision fee',
    desc: '',
  },
  {
    cfCode: '2_5_6',
    name: 'Impact Fee',
    desc: '',
  },
  {
    cfCode: '2_5_7',
    name: 'Unapproved Layout - Development charges',
    desc: '',
  },
  {
    cfCode: '2_5_8',
    name: 'Un-Authorised Colony Improvement Contribution',
    desc: '',
  },
  {
    cfCode: '2_5_9',
    name: 'Centage charges',
    desc: '',
  },
  {
    cfCode: '2_5_10',
    name: 'Open Space Contribution',
    desc: '',
  },
  {
    cfCode: '2_5_11',
    name: 'Parking Contribution',
    desc: '',
  },
  {
    cfCode: '2_5_12',
    name: 'Postage & Advertisement Charges',
    desc: '',
  },
  {
    cfCode: '2_5_13',
    name: 'Other Town Planning Receipts',
    desc: '',
  },
  {
    cfCode: '2_5_14',
    name: 'Other Development Charges',
    desc: '',
  },
  {
    cfCode: '2_6',
    name: 'Regularisation Fees',
    desc: 'Regularisation Fees shall include Building Regularization, Encroachment Fee, Demolition Charges, Building Service Charges, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_6_1', '2_6_2', '2_6_3', '2_6_4', '2_6_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_6_1',
    name: 'Building Regularization',
    desc: '',
  },
  {
    cfCode: '2_6_2',
    name: 'Encroachment Fee',
    desc: '',
  },
  {
    cfCode: '2_6_3',
    name: 'Demolition Charges',
    desc: '',
  },
  {
    cfCode: '2_6_4',
    name: 'Building Service Charges',
    desc: '',
  },
  {
    cfCode: '2_6_5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '2_7',
    name: 'Penalties and Fines',
    desc: 'Penalties and Fines shall include Penalty and Bank Charges for Dishonoured Cheques, Magisterial Fines, Penalty on Unauthorized Water Connections, Spot fines, Penalty on Unauthorized Sewerage Connections, Other Penalties.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_7_1', '2_7_2', '2_7_3', '2_7_4', '2_7_5', '2_7_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_7_1',
    name: 'Penalty and Bank Charges for Dishonoured Cheques',
    desc: '',
  },
  {
    cfCode: '2_7_2',
    name: 'Magisterial Fines',
    desc: '',
  },
  {
    cfCode: '2_7_3',
    name: 'Penalty on Unauthorized Water Connections',
    desc: '',
  },
  {
    cfCode: '2_7_4',
    name: 'Spot fines',
    desc: '',
  },
  {
    cfCode: '2_7_5',
    name: 'Penalty on Unauthorized Sewerage Connections',
    desc: '',
  },
  {
    cfCode: '2_7_6',
    name: 'Other Penalties',
    desc: '',
  },
  {
    cfCode: '2_8',
    name: 'Other Fees',
    desc: 'Other Fees shall include Advertisement fees, Survey Fees, Income from fairs and festivals, library fees, sports fee, admission fees, notice fees, warrant & distraint fees, Property transfer charges, Mutation fees, Connection/Disconnection charges (Water Supply), Connection/Disconnection charges (Sewerage), Other Fees.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '2_8_1',
          '2_8_2',
          '2_8_3',
          '2_8_4',
          '2_8_5',
          '2_8_6',
          '2_8_7',
          '2_8_8',
          '2_8_9',
          '2_8_10',
          '2_8_11',
          '2_8_12',
          '2_8_13',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_8_1',
    name: 'Advertisement fees',
    desc: '',
  },
  {
    cfCode: '2_8_2',
    name: 'Survey Fees',
    desc: '',
  },
  {
    cfCode: '2_8_3',
    name: 'Income from fairs and festivals',
    desc: '',
  },
  {
    cfCode: '2_8_4',
    name: 'library fees',
    desc: '',
  },
  {
    cfCode: '2_8_5',
    name: 'sports fee',
    desc: '',
  },
  {
    cfCode: '2_8_6',
    name: 'admission fees',
    desc: '',
  },
  {
    cfCode: '2_8_7',
    name: 'notice fees',
    desc: '',
  },
  {
    cfCode: '2_8_8',
    name: 'warrant & distraint fees',
    desc: '',
  },
  {
    cfCode: '2_8_9',
    name: 'Property transfer charges',
    desc: '',
  },
  {
    cfCode: '2_8_10',
    name: 'Mutation fees',
    desc: '',
  },
  {
    cfCode: '2_8_11',
    name: 'Connection/Disconnection charges (Water Supply)',
    desc: '',
  },
  {
    cfCode: '2_8_12',
    name: 'Connection/Disconnection charges (Sewerage)',
    desc: '',
  },
  {
    cfCode: '2_8_13',
    name: 'Other Fees',
    desc: '',
  },
  {
    cfCode: '2_9',
    name: 'User Charges',
    desc: 'User Charges shall include Receipts from Hospital and Dispensaries, Under ground drainage Montly Charges, Drainage Fees from Building/ Flat promoters, Metered/ Tao Rate Water Chargers, Charges for Water Supply through Tankers/lorries, Septic Tank Cleaning Charges, Burning/Burial Ground Charges, Garbage/Debris Collection, Sewerage Charges, Other User Charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_9_1', '2_9_2', '2_9_3', '2_9_4', '2_9_5', '2_9_6', '2_9_7', '2_9_8', '2_9_9', '2_9_10'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_9_1',
    name: 'Receipts from Hospital and Dispensaries',
    desc: '',
  },
  {
    cfCode: '2_9_2',
    name: 'Under ground drainage Montly Charges',
    desc: '',
  },
  {
    cfCode: '2_9_3',
    name: 'Drainage Fees from Building/ Flat promoters',
    desc: '',
  },
  {
    cfCode: '2_9_4',
    name: 'Metered/ Tao Rate Water Chargers',
    desc: '',
  },
  {
    cfCode: '2_9_5',
    name: 'Charges for Water Supply through Tankers/lorries',
    desc: '',
  },
  {
    cfCode: '2_9_6',
    name: 'Septic Tank Cleaning Charges',
    desc: '',
  },
  {
    cfCode: '2_9_7',
    name: 'Burning/Burial Ground Charges',
    desc: '',
  },
  {
    cfCode: '2_9_8',
    name: 'Garbage/Debris Collection',
    desc: '',
  },
  {
    cfCode: '2_9_9',
    name: 'Sewerage Charges',
    desc: '',
  },
  {
    cfCode: '2_9_10',
    name: 'Other User Charges',
    desc: '',
  },
  {
    cfCode: '2_10',
    name: 'Entry Fees',
    desc: 'Entry Fees shall include Garden/Parks Receipts, Amusement Fees, Swimming Pool Receipts, Library Receipts, Sport Complex Fees, Other Entry Fees.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_10_1', '2_10_2', '2_10_3', '2_10_4', '2_10_5', '2_10_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_10_1',
    name: 'Garden/Parks Receipts',
    desc: '',
  },
  {
    cfCode: '2_10_2',
    name: 'Amusement Fees',
    desc: '',
  },
  {
    cfCode: '2_10_3',
    name: 'Swimming Pool Receipts',
    desc: '',
  },
  {
    cfCode: '2_10_4',
    name: 'Library Receipts',
    desc: '',
  },
  {
    cfCode: '2_10_5',
    name: 'Sport Complex Fees',
    desc: '',
  },
  {
    cfCode: '2_10_6',
    name: 'Other Entry Fees',
    desc: '',
  },
  {
    cfCode: '2_11',
    name: 'Service/ Administrative Charges',
    desc: 'Service/ Administrative Charges shall include Road cut/Restoration charges, Initial amount for new water supply connections, Initial amount for Drainage connections, Initial amount for Sewerageconnections, Water Supply connection charges, Sewerage connection charges, Water Supply disconnection charges, Sewerage disconnection charges, Income from Road Margins, Cartage Charges, Other service/administrative charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '2_11_1',
          '2_11_2',
          '2_11_3',
          '2_11_4',
          '2_11_5',
          '2_11_6',
          '2_11_7',
          '2_11_8',
          '2_11_9',
          '2_11_10',
          '2_11_11',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_11_1',
    name: 'Road cut/Restoration charges',
    desc: '',
  },
  {
    cfCode: '2_11_2',
    name: 'Initial amount for new water supply connections',
    desc: '',
  },
  {
    cfCode: '2_11_3',
    name: 'Initial amount for Drainage connections',
    desc: '',
  },
  {
    cfCode: '2_11_4',
    name: 'Initial amount for Sewerageconnections',
    desc: '',
  },
  {
    cfCode: '2_11_5',
    name: 'Water Supply connection charges',
    desc: '',
  },
  {
    cfCode: '2_11_6',
    name: 'Sewerage connection charges',
    desc: '',
  },
  {
    cfCode: '2_11_7',
    name: 'Water Supply disconnection charges',
    desc: '',
  },
  {
    cfCode: '2_11_8',
    name: 'Sewerage disconnection charges',
    desc: '',
  },
  {
    cfCode: '2_11_9',
    name: 'Income from Road Margins',
    desc: '',
  },
  {
    cfCode: '2_11_10',
    name: 'Cartage Charges',
    desc: '',
  },
  {
    cfCode: '2_11_11',
    name: 'Other service/administrative charges',
    desc: '',
  },
  {
    cfCode: '2_12',
    name: 'Other Charges',
    desc: 'Other Charges shall include Law charges and court cost recoveries, Pension and leave salary contributions, Miscellaneous Recoveries.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_12_1', '2_12_2', '2_12_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_12_1',
    name: 'Law charges and court cost recoveries',
    desc: '',
  },
  {
    cfCode: '2_12_2',
    name: 'Pension and leave salary contributions',
    desc: '',
  },
  {
    cfCode: '2_12_3',
    name: 'Miscellaneous Recoveries',
    desc: '',
  },
  {
    cfCode: '2_13',
    name: 'Fees Remission and Refund',
    desc: 'Fees Remission and Refund shall include Remission Fees, Refund Fees.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['2_13_1', '2_13_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '2_13_1',
    name: 'Remission Fees',
    desc: '',
  },
  {
    cfCode: '2_13_2',
    name: 'Refund Fees',
    desc: '',
  },
  {
    cfCode: '3',
    name: 'Rental Income from Municipal Properties',
    desc: 'Rental Income from Municipal Properties shall include Rent from Civic Amenities, Rent from Office Buildings, Rent from Guest Houses, Rent from lease of Lands, Other Rents, Rent remission and refund.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['3_1', '3_2', '3_3', '3_4', '3_5', '3_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '3_1',
    name: 'Rent from Civic Amenities',
    desc: 'Rent from Civic Amenities shall include Rent from shopping complex/ markets, Auditorium, art galleries, playgrounds, nurseries, marriage halls, Rent from Community Hall, Market fees- Daily market, Market fees- weekly market, Private market fees, Fees for Bays in Bus Stand, Cart Stand/Lorry Stand/Taxi Stand/ Cycle stand fees, Avenue Receipts.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['3_1_1', '3_1_2', '3_1_3', '3_1_4', '3_1_5', '3_1_6', '3_1_7', '3_1_8'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '3_1_1',
    name: 'Rent from shopping complex/ markets, Auditorium, art galleries, playgrounds, nurseries, marriage halls',
    desc: '',
  },
  {
    cfCode: '3_1_2',
    name: 'Rent from Community Hall',
    desc: '',
  },
  {
    cfCode: '3_1_3',
    name: 'Market fees- Daily market',
    desc: '',
  },
  {
    cfCode: '3_1_4',
    name: 'Market fees- weekly market',
    desc: '',
  },
  {
    cfCode: '3_1_5',
    name: 'Private market fees',
    desc: '',
  },
  {
    cfCode: '3_1_6',
    name: 'Fees for Bays in Bus Stand',
    desc: '',
  },
  {
    cfCode: '3_1_7',
    name: 'Cart Stand/Lorry Stand/Taxi Stand/ Cycle stand fees',
    desc: '',
  },
  {
    cfCode: '3_1_8',
    name: 'Avenue Receipts',
    desc: '',
  },
  {
    cfCode: '3_2',
    name: 'Rent from Office Buildings',
    desc: '',
  },
  {
    cfCode: '3_3',
    name: 'Rent from Guest Houses',
    desc: '',
  },
  {
    cfCode: '3_4',
    name: 'Rent from lease of Lands',
    desc: '',
  },
  {
    cfCode: '3_5',
    name: 'Other Rents',
    desc: 'Other Rents shall include Rent on Bunk Stalls, Cable TV rent, Parking fees, Income from Ferries, Fees for pay and use Toilets, Cinema Theatre -Income, Track Rent.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['3_5_1', '3_5_2', '3_5_3', '3_5_4', '3_5_5', '3_5_6', '3_5_7'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '3_5_1',
    name: 'Rent on Bunk Stalls',
    desc: '',
  },
  {
    cfCode: '3_5_2',
    name: 'Cable TV rent',
    desc: '',
  },
  {
    cfCode: '3_5_3',
    name: 'Parking fees',
    desc: '',
  },
  {
    cfCode: '3_5_4',
    name: 'Income from Ferries',
    desc: '',
  },
  {
    cfCode: '3_5_5',
    name: 'Fees for pay and use Toilets',
    desc: '',
  },
  {
    cfCode: '3_5_6',
    name: 'Cinema Theatre -Income',
    desc: '',
  },
  {
    cfCode: '3_5_7',
    name: 'Track Rent',
    desc: '',
  },
  {
    cfCode: '3_6',
    name: 'Rent remission and refund',
    desc: '',
  },
  {
    cfCode: '4',
    name: 'Assigned Revenues & Compensation',
    desc: 'Assigned Revenues & Compensation shall include Taxes and duties collected by others, Compesation in lieu of taxes/duties, Compensation in lieu of Conscessions.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['4_1', '4_2', '4_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '4_1',
    name: 'Taxes and duties collected by others',
    desc: 'Taxes and duties collected by others shall include Duty on transfer of property, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['4_1_1', '4_1_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '4_1_1',
    name: 'Duty on transfer of property',
    desc: '',
  },
  {
    cfCode: '4_1_2',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '4_2',
    name: 'Compesation in lieu of taxes/duties',
    desc: 'Compesation in lieu of taxes/duties shall include Compensation for toll, Compensation in lieu of Octroi, Octroi in lieu of Electricity, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['4_2_1', '4_2_2', '4_2_3', '4_2_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '4_2_1',
    name: 'Compensation for toll',
    desc: '',
  },
  {
    cfCode: '4_2_2',
    name: 'Compensation in lieu of Octroi',
    desc: '',
  },
  {
    cfCode: '4_2_3',
    name: 'Octroi in lieu of Electricity',
    desc: '',
  },
  {
    cfCode: '4_2_4',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '4_3',
    name: 'Compensation in lieu of Conscessions',
    desc: 'Compensation in lieu of Conscessions shall include property tax compensations due to concessions certain set of tax payers.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['4_3_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '4_3_1',
    name: 'property tax compensations due to concessions certain set of tax payers',
    desc: '',
  },
  {
    cfCode: '5',
    name: 'Revenue Grants, Contributions & Subsidies',
    desc: 'Revenue Grants, Contributions & Subsidies shall include Revenue Grant, Re-imbursement of expenses, Contribution towards schemes.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_1', '5_2', '5_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_1',
    name: 'Revenue Grant',
    desc: 'Revenue Grant shall include Specific Maintenance Grant-Contribution for water supply and Drainage, Grant for natural calamities, Grants from State Government, Devolution Fund (including State Finance Commission Fund), M.P. Fund, M.L.A. Fund, Grants in kind, Grants from Central Government, Central Schemes Grant.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_1_1', '5_1_2', '5_1_3', '5_1_4', '5_1_5', '5_1_6', '5_1_7', '5_1_8', '5_1_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_1_1',
    name: 'Specific Maintenance Grant-Contribution for water supply and Drainage',
    desc: '',
  },
  {
    cfCode: '5_1_2',
    name: 'Grant for natural calamities',
    desc: '',
  },
  {
    cfCode: '5_1_3',
    name: 'Grants from State Government',
    desc: '',
  },
  {
    cfCode: '5_1_4',
    name: 'Devolution Fund (including State Finance Commission Fund)',
    desc: '',
  },
  {
    cfCode: '5_1_5',
    name: 'M.P. Fund',
    desc: '',
  },
  {
    cfCode: '5_1_6',
    name: 'M.L.A. Fund',
    desc: '',
  },
  {
    cfCode: '5_1_7',
    name: 'Grants in kind',
    desc: '',
  },
  {
    cfCode: '5_1_8',
    name: 'Grants from Central Government',
    desc: 'Grants from Central Government shall include 14th Finance Commssion, 15th Finance Commssion.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_1_8_1', '5_1_8_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_1_8_1',
    name: '14th Finance Commssion',
    desc: '',
  },
  {
    cfCode: '5_1_8_2',
    name: '15th Finance Commssion',
    desc: '',
  },
  {
    cfCode: '5_1_9',
    name: 'Central Schemes Grant',
    desc: 'Central Schemes Grant shall include Amrut, Solid Waste Management, NULM, PMAY, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_1_9_1', '5_1_9_2', '5_1_9_3', '5_1_9_4', '5_1_9_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_1_9_1',
    name: 'Amrut',
    desc: '',
  },
  {
    cfCode: '5_1_9_2',
    name: 'Solid Waste Management',
    desc: '',
  },
  {
    cfCode: '5_1_9_3',
    name: 'NULM',
    desc: '',
  },
  {
    cfCode: '5_1_9_4',
    name: 'PMAY',
    desc: '',
  },
  {
    cfCode: '5_1_9_5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '5_2',
    name: 'Re-imbursement of expenses',
    desc: 'Re-imbursement of expenses shall include Election expenses, External aided projects, Family Planning Centre Expenses, Family planning incentives, Anti-malaria expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_2_1', '5_2_2', '5_2_3', '5_2_4', '5_2_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_2_1',
    name: 'Election expenses',
    desc: '',
  },
  {
    cfCode: '5_2_2',
    name: 'External aided projects',
    desc: '',
  },
  {
    cfCode: '5_2_3',
    name: 'Family Planning Centre Expenses',
    desc: '',
  },
  {
    cfCode: '5_2_4',
    name: 'Family planning incentives',
    desc: '',
  },
  {
    cfCode: '5_2_5',
    name: 'Anti-malaria expenses',
    desc: '',
  },
  {
    cfCode: '5_3',
    name: 'Contribution towards schemes',
    desc: 'Contribution towards schemes shall include Swarna Jayanthi Shari Rojgar Yojana, National Slum Development Project, Integrated Development of Small and Medium Towns, Integrated Low Cost Saitatiion, Water Supply - Donation, Sewerage Donation, Scheme Grants.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['5_3_1', '5_3_2', '5_3_3', '5_3_4', '5_3_5', '5_3_6', '5_3_7'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '5_3_1',
    name: 'Swarna Jayanthi Shari Rojgar Yojana',
    desc: '',
  },
  {
    cfCode: '5_3_2',
    name: 'National Slum Development Project',
    desc: '',
  },
  {
    cfCode: '5_3_3',
    name: 'Integrated Development of Small and Medium Towns',
    desc: '',
  },
  {
    cfCode: '5_3_4',
    name: 'Integrated Low Cost Saitatiion',
    desc: '',
  },
  {
    cfCode: '5_3_5',
    name: 'Water Supply - Donation',
    desc: '',
  },
  {
    cfCode: '5_3_6',
    name: 'Sewerage Donation',
    desc: '',
  },
  {
    cfCode: '5_3_7',
    name: 'Scheme Grants',
    desc: '',
  },
  {
    cfCode: '6',
    name: 'Sales & Hire Charges',
    desc: 'Sales & Hire Charges shall include Sale of Products, Sale of Forms and Publications, Sale of stores & scrap, Sale of others, Hire charges for vehicles, Hire Charges for equipments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['6_1', '6_2', '6_3', '6_4', '6_5', '6_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '6_1',
    name: 'Sale of Products',
    desc: 'Sale of Products shall include Sale of Rubbish/ Debris/ Silt, Sale of Compost/Manure/Grass/Unsufructs.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['6_1_1', '6_1_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '6_1_1',
    name: 'Sale of Rubbish/ Debris/ Silt',
    desc: '',
  },
  {
    cfCode: '6_1_2',
    name: 'Sale of Compost/Manure/Grass/Unsufructs',
    desc: '',
  },
  {
    cfCode: '6_2',
    name: 'Sale of Forms and Publications',
    desc: 'Sale of Forms and Publications shall include Sale of tender forms /other publications.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['6_2_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '6_2_1',
    name: 'Sale of tender forms /other publications',
    desc: '',
  },
  {
    cfCode: '6_3',
    name: 'Sale of stores & scrap',
    desc: 'Sale of stores & scrap shall include Sale of Stock & stores, Sale of Scrap.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['6_3_1', '6_3_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '6_3_1',
    name: 'Sale of Stock & stores',
    desc: '',
  },
  {
    cfCode: '6_3_2',
    name: 'Sale of Scrap',
    desc: '',
  },
  {
    cfCode: '6_4',
    name: 'Sale of others',
    desc: '',
  },
  {
    cfCode: '6_5',
    name: 'Hire charges for vehicles',
    desc: '',
  },
  {
    cfCode: '6_6',
    name: 'Hire Charges for equipments',
    desc: '',
  },
  {
    cfCode: '7',
    name: 'Income from investment',
    desc: 'Income from investment shall include Interest on Investment/Fixed Deposits, Dividend on Shares, Income from projects taken up on commercial basis, Profit in Sale of Investments, Municipal Bonds, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['7_1', '7_2', '7_3', '7_4', '7_5', '7_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '7_1',
    name: 'Interest on Investment/Fixed Deposits',
    desc: '',
  },
  {
    cfCode: '7_2',
    name: 'Dividend on Shares',
    desc: '',
  },
  {
    cfCode: '7_3',
    name: 'Income from projects taken up on commercial basis',
    desc: '',
  },
  {
    cfCode: '7_4',
    name: 'Profit in Sale of Investments',
    desc: '',
  },
  {
    cfCode: '7_5',
    name: 'Municipal Bonds',
    desc: '',
  },
  {
    cfCode: '7_6',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '8',
    name: 'Interest Earned',
    desc: 'Interest Earned shall include Interest from Bank Accounts, Interest on Loans and advances to Employees, Interest on loans to others, Other Interest.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['8_1', '8_2', '8_3', '8_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '8_1',
    name: 'Interest from Bank Accounts',
    desc: '',
  },
  {
    cfCode: '8_2',
    name: 'Interest on Loans and advances to Employees',
    desc: '',
  },
  {
    cfCode: '8_3',
    name: 'Interest on loans to others',
    desc: '',
  },
  {
    cfCode: '8_4',
    name: 'Other Interest',
    desc: '',
  },
  {
    cfCode: '9',
    name: 'Other Income',
    desc: 'Other Income shall include Deposits Forfeited, Lapsed Deposits, Insurance Claim Recovery, Profit on Disposal of Fixed Assets, Recovery from employees, Uncliamed Refund Payable/Liabilities Written Back, Excess Provisions written back, Miscellaneous Income.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['9_1', '9_2', '9_3', '9_4', '9_5', '9_6', '9_7', '9_8'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '9_1',
    name: 'Deposits Forfeited',
    desc: '',
  },
  {
    cfCode: '9_2',
    name: 'Lapsed Deposits',
    desc: '',
  },
  {
    cfCode: '9_3',
    name: 'Insurance Claim Recovery',
    desc: '',
  },
  {
    cfCode: '9_4',
    name: 'Profit on Disposal of Fixed Assets',
    desc: 'Profit on Disposal of Fixed Assets shall include Profit on Sales of Assets, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['9_4_1', '9_4_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '9_4_1',
    name: 'Profit on Sales of Assets',
    desc: '',
  },
  {
    cfCode: '9_4_2',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '9_5',
    name: 'Recovery from employees',
    desc: '',
  },
  {
    cfCode: '9_6',
    name: 'Uncliamed Refund Payable/Liabilities Written Back',
    desc: 'Uncliamed Refund Payable/Liabilities Written Back shall include Sale Cheques.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['9_6_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '9_6_1',
    name: 'Sale Cheques',
    desc: '',
  },
  {
    cfCode: '9_7',
    name: 'Excess Provisions written back',
    desc: 'Excess Provisions written back shall include Excess Provisions written back - Property tax, Excess Provisions written back - Others(Octroi cess, water supply, advertisement tax, rent).',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['9_7_1', '9_7_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '9_7_1',
    name: 'Excess Provisions written back - Property tax',
    desc: '',
  },
  {
    cfCode: '9_7_2',
    name: 'Excess Provisions written back - Others(Octroi cess, water supply, advertisement tax, rent)',
    desc: '',
  },
  {
    cfCode: '9_8',
    name: 'Miscellaneous Income',
    desc: '',
  },
  {
    cfCode: '10',
    name: 'TOTAL INCOME  (sum of 1 to 9)',
    desc: '',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '11',
    name: 'Establishment Expenses',
    desc: 'Establishment Expenses shall include Salaries, Wages and Bonus, Benefits and Allowances, Pension.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['11_1', '11_2', '11_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '11_1',
    name: 'Salaries, Wages and Bonus',
    desc: 'Salaries, Wages and Bonus shall include Pay, Grade Pay, Dearness Allowance, Hearness Allowance, House Rent Allowance, City Comp. Allowance, Medical Allowance, Other Allowance, Wage - NMR, Wage - Others, Bonus, Exgratia, Performance Bonus, Interim Relief, Survey Charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '11_1_1',
          '11_1_2',
          '11_1_3',
          '11_1_4',
          '11_1_5',
          '11_1_6',
          '11_1_7',
          '11_1_8',
          '11_1_9',
          '11_1_10',
          '11_1_11',
          '11_1_12',
          '11_1_13',
          '11_1_14',
          '11_1_15',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '11_1_1',
    name: 'Pay',
    desc: '',
  },
  {
    cfCode: '11_1_2',
    name: 'Grade Pay',
    desc: '',
  },
  {
    cfCode: '11_1_3',
    name: 'Dearness Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_4',
    name: 'Hearness Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_5',
    name: 'House Rent Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_6',
    name: 'City Comp. Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_7',
    name: 'Medical Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_8',
    name: 'Other Allowance',
    desc: '',
  },
  {
    cfCode: '11_1_9',
    name: 'Wage - NMR',
    desc: '',
  },
  {
    cfCode: '11_1_10',
    name: 'Wage - Others',
    desc: '',
  },
  {
    cfCode: '11_1_11',
    name: 'Bonus',
    desc: '',
  },
  {
    cfCode: '11_1_12',
    name: 'Exgratia',
    desc: '',
  },
  {
    cfCode: '11_1_13',
    name: 'Performance Bonus',
    desc: '',
  },
  {
    cfCode: '11_1_14',
    name: 'Interim Relief',
    desc: '',
  },
  {
    cfCode: '11_1_15',
    name: 'Survey Charges',
    desc: '',
  },
  {
    cfCode: '11_2',
    name: 'Benefits and Allowances',
    desc: 'Benefits and Allowances shall include Medical Reimbursement, Leave Travel Concession, Overtime Allowance, Supply of Uniforms, Hospital Stoppages, Training Programme Expenses, Staff Welfare Expenses, Other miscellaneous benefits, Work men compensation, Health Insurance Local Body contribution, Labour Welfare fund contributuion, Reimbursement of tution fees (All India Service), Special Provident Fund cum Gratuity scheme, Group Insurance scheme - Management contribution, CPF Management Contribution.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '11_2_1',
          '11_2_2',
          '11_2_3',
          '11_2_4',
          '11_2_5',
          '11_2_6',
          '11_2_7',
          '11_2_8',
          '11_2_9',
          '11_2_10',
          '11_2_11',
          '11_2_12',
          '11_2_13',
          '11_2_14',
          '11_2_15',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '11_2_1',
    name: 'Medical Reimbursement',
    desc: '',
  },
  {
    cfCode: '11_2_2',
    name: 'Leave Travel Concession',
    desc: '',
  },
  {
    cfCode: '11_2_3',
    name: 'Overtime Allowance',
    desc: '',
  },
  {
    cfCode: '11_2_4',
    name: 'Supply of Uniforms',
    desc: '',
  },
  {
    cfCode: '11_2_5',
    name: 'Hospital Stoppages',
    desc: '',
  },
  {
    cfCode: '11_2_6',
    name: 'Training Programme Expenses',
    desc: '',
  },
  {
    cfCode: '11_2_7',
    name: 'Staff Welfare Expenses',
    desc: '',
  },
  {
    cfCode: '11_2_8',
    name: 'Other miscellaneous benefits',
    desc: '',
  },
  {
    cfCode: '11_2_9',
    name: 'Work men compensation',
    desc: '',
  },
  {
    cfCode: '11_2_10',
    name: 'Health Insurance Local Body contribution',
    desc: '',
  },
  {
    cfCode: '11_2_11',
    name: 'Labour Welfare fund contributuion',
    desc: '',
  },
  {
    cfCode: '11_2_12',
    name: 'Reimbursement of tution fees (All India Service)',
    desc: '',
  },
  {
    cfCode: '11_2_13',
    name: 'Special Provident Fund cum Gratuity scheme',
    desc: '',
  },
  {
    cfCode: '11_2_14',
    name: 'Group Insurance scheme - Management contribution',
    desc: '',
  },
  {
    cfCode: '11_2_15',
    name: 'CPF Management Contribution',
    desc: '',
  },
  {
    cfCode: '11_3',
    name: 'Pension',
    desc: "Pension shall include Family Pension, Ad hoc Pension, Commuted Value of Pension, Pension Contributions - Deputationists, Other Terminal & Retirement Benefits, Leave Encahsment, Death-Cum-Retirement Gratuity, Leave salary contribution, Pensioner's Medical Aids.",
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['11_3_1', '11_3_2', '11_3_3', '11_3_4', '11_3_5', '11_3_6', '11_3_7', '11_3_8', '11_3_9'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '11_3_1',
    name: 'Family Pension',
    desc: '',
  },
  {
    cfCode: '11_3_2',
    name: 'Ad hoc Pension',
    desc: '',
  },
  {
    cfCode: '11_3_3',
    name: 'Commuted Value of Pension',
    desc: '',
  },
  {
    cfCode: '11_3_4',
    name: 'Pension Contributions - Deputationists',
    desc: '',
  },
  {
    cfCode: '11_3_5',
    name: 'Other Terminal & Retirement Benefits',
    desc: '',
  },
  {
    cfCode: '11_3_6',
    name: 'Leave Encahsment',
    desc: '',
  },
  {
    cfCode: '11_3_7',
    name: 'Death-Cum-Retirement Gratuity',
    desc: '',
  },
  {
    cfCode: '11_3_8',
    name: 'Leave salary contribution',
    desc: '',
  },
  {
    cfCode: '11_3_9',
    name: "Pensioner's Medical Aids",
    desc: '',
  },
  {
    cfCode: '12',
    name: 'Administrative Expenses',
    desc: 'Administrative Expenses shall include Rent, Rates and Taxes, Office maintenance, Communication Expenses, Books & Periodicals, Printing and stationeery, Travelling & Conveyance, Insurance, Audit Fees, Legal Expenses, Professional and other fees, Advertisement and Publicity, Membership & Subscriptions, Others.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '12_1',
          '12_2',
          '12_3',
          '12_4',
          '12_5',
          '12_6',
          '12_7',
          '12_8',
          '12_9',
          '12_10',
          '12_11',
          '12_12',
          '12_13',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_1',
    name: 'Rent, Rates and Taxes',
    desc: 'Rent, Rates and Taxes shall include Rent for Buildings, Royalty, Excise Duty, Motor Vehicle Tax, Water Cess, Stamp duty expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_1_1', '12_1_2', '12_1_3', '12_1_4', '12_1_5', '12_1_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_1_1',
    name: 'Rent for Buildings',
    desc: '',
  },
  {
    cfCode: '12_1_2',
    name: 'Royalty',
    desc: '',
  },
  {
    cfCode: '12_1_3',
    name: 'Excise Duty',
    desc: '',
  },
  {
    cfCode: '12_1_4',
    name: 'Motor Vehicle Tax',
    desc: '',
  },
  {
    cfCode: '12_1_5',
    name: 'Water Cess',
    desc: '',
  },
  {
    cfCode: '12_1_6',
    name: 'Stamp duty expenses',
    desc: '',
  },
  {
    cfCode: '12_2',
    name: 'Office maintenance',
    desc: 'Office maintenance shall include Electricity Consumption charges for office buildings, Water cahrges, Security Charges, Fire Protection & Control.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_2_1', '12_2_2', '12_2_3', '12_2_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_2_1',
    name: 'Electricity Consumption charges for office buildings',
    desc: '',
  },
  {
    cfCode: '12_2_2',
    name: 'Water cahrges',
    desc: '',
  },
  {
    cfCode: '12_2_3',
    name: 'Security Charges',
    desc: '',
  },
  {
    cfCode: '12_2_4',
    name: 'Fire Protection & Control',
    desc: '',
  },
  {
    cfCode: '12_3',
    name: 'Communication Expenses',
    desc: 'Communication Expenses shall include Telephone charges, Internet Charges, Postage and Telegram and Fax charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_3_1', '12_3_2', '12_3_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_3_1',
    name: 'Telephone charges',
    desc: '',
  },
  {
    cfCode: '12_3_2',
    name: 'Internet Charges',
    desc: '',
  },
  {
    cfCode: '12_3_3',
    name: 'Postage and Telegram and Fax charges',
    desc: '',
  },
  {
    cfCode: '12_4',
    name: 'Books & Periodicals',
    desc: 'Books & Periodicals shall include Books & Periodicals Magazines.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_4_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_4_1',
    name: 'Books & Periodicals Magazines',
    desc: '',
  },
  {
    cfCode: '12_5',
    name: 'Printing and stationeery',
    desc: 'Printing and stationeery shall include Stationery and Printing.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_5_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_5_1',
    name: 'Stationery and Printing',
    desc: '',
  },
  {
    cfCode: '12_6',
    name: 'Travelling & Conveyance',
    desc: 'Travelling & Conveyance shall include Travel Expenses, Conveyance Charges, Transfer Travel Expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_6_1', '12_6_2', '12_6_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_6_1',
    name: 'Travel Expenses',
    desc: '',
  },
  {
    cfCode: '12_6_2',
    name: 'Conveyance Charges',
    desc: '',
  },
  {
    cfCode: '12_6_3',
    name: 'Transfer Travel Expenses',
    desc: '',
  },
  {
    cfCode: '12_7',
    name: 'Insurance',
    desc: 'Insurance shall include Vehicle Insurance, Machinery, Tools and Equipment Insurance, Stores & Stocks Insurance.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_7_1', '12_7_2', '12_7_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_7_1',
    name: 'Vehicle Insurance',
    desc: '',
  },
  {
    cfCode: '12_7_2',
    name: 'Machinery, Tools and Equipment Insurance',
    desc: '',
  },
  {
    cfCode: '12_7_3',
    name: 'Stores & Stocks Insurance',
    desc: '',
  },
  {
    cfCode: '12_8',
    name: 'Audit Fees',
    desc: 'Audit Fees shall include Statutory Audit Fees, Internal Audit Fees.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_8_1', '12_8_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_8_1',
    name: 'Statutory Audit Fees',
    desc: '',
  },
  {
    cfCode: '12_8_2',
    name: 'Internal Audit Fees',
    desc: '',
  },
  {
    cfCode: '12_9',
    name: 'Legal Expenses',
    desc: 'Legal Expenses shall include Retainer Fees, Court Fees, Arbitrator Fees, Legal & Aribitration Expenses, Execution of Courts Orders.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_9_1', '12_9_2', '12_9_3', '12_9_4', '12_9_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_9_1',
    name: 'Retainer Fees',
    desc: '',
  },
  {
    cfCode: '12_9_2',
    name: 'Court Fees',
    desc: '',
  },
  {
    cfCode: '12_9_3',
    name: 'Arbitrator Fees',
    desc: '',
  },
  {
    cfCode: '12_9_4',
    name: 'Legal & Aribitration Expenses',
    desc: '',
  },
  {
    cfCode: '12_9_5',
    name: 'Execution of Courts Orders',
    desc: '',
  },
  {
    cfCode: '12_10',
    name: 'Professional and other fees',
    desc: 'Professional and other fees shall include Architect Chagres, Engineering Consultancy, Other Proffesional Charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_10_1', '12_10_2', '12_10_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_10_1',
    name: 'Architect Chagres',
    desc: '',
  },
  {
    cfCode: '12_10_2',
    name: 'Engineering Consultancy',
    desc: '',
  },
  {
    cfCode: '12_10_3',
    name: 'Other Proffesional Charges',
    desc: '',
  },
  {
    cfCode: '12_11',
    name: 'Advertisement and Publicity',
    desc: 'Advertisement and Publicity shall include Advertisement charges, Expenses on Hospitality/Entertainemnt, Exhibitions, Organisation of Festivals, functions.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_11_1', '12_11_2', '12_11_3', '12_11_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_11_1',
    name: 'Advertisement charges',
    desc: '',
  },
  {
    cfCode: '12_11_2',
    name: 'Expenses on Hospitality/Entertainemnt',
    desc: '',
  },
  {
    cfCode: '12_11_3',
    name: 'Exhibitions',
    desc: '',
  },
  {
    cfCode: '12_11_4',
    name: 'Organisation of Festivals, functions',
    desc: '',
  },
  {
    cfCode: '12_12',
    name: 'Membership & Subscriptions',
    desc: 'Membership & Subscriptions shall include Chamber of Municipal Chairmen, All India Council of Mayors, Membership & Subscriptions.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_12_1', '12_12_2', '12_12_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_12_1',
    name: 'Chamber of Municipal Chairmen',
    desc: '',
  },
  {
    cfCode: '12_12_2',
    name: 'All India Council of Mayors',
    desc: '',
  },
  {
    cfCode: '12_12_3',
    name: 'Membership & Subscriptions',
    desc: '',
  },
  {
    cfCode: '12_13',
    name: 'Others',
    desc: 'Others shall include Cash Awards & Prizes, Enquiry Expenses, Other Expenses, Sitting Fees/Honorarium for the councillors and meeting expenses, E-governance expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['12_13_1', '12_13_2', '12_13_3', '12_13_4', '12_13_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '12_13_1',
    name: 'Cash Awards & Prizes',
    desc: '',
  },
  {
    cfCode: '12_13_2',
    name: 'Enquiry Expenses',
    desc: '',
  },
  {
    cfCode: '12_13_3',
    name: 'Other Expenses',
    desc: '',
  },
  {
    cfCode: '12_13_4',
    name: 'Sitting Fees/Honorarium for the councillors and meeting expenses',
    desc: '',
  },
  {
    cfCode: '12_13_5',
    name: 'E-governance expenses',
    desc: '',
  },
  {
    cfCode: '13',
    name: 'Operations & Maintenance',
    desc: 'Operations & Maintenance shall include Power & Fuel, Bulk Purchases, Consumption of Stores, Hire Charges, Repairs & maintenenace-infrastructure Assets, Reapirs & maintenance - Civic Amenities, Repairs & maintenance - Buildings, Repairs & maintenace of vehicles, Repairs & Miantenance - Others, Other operating & maintenance expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_1', '13_2', '13_3', '13_4', '13_5', '13_6', '13_7', '13_8', '13_9', '13_10'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_1',
    name: 'Power & Fuel',
    desc: 'Power & Fuel shall include Power cahrges for Sewerage system/Pumping Stations, Power Charges for Water Head Works/ Pumping Stations/Booster Stations, Power Charges for Street Lights.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_1_1', '13_1_2', '13_1_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_1_1',
    name: 'Power cahrges for Sewerage system/Pumping Stations',
    desc: '',
  },
  {
    cfCode: '13_1_2',
    name: 'Power Charges for Water Head Works/ Pumping Stations/Booster Stations',
    desc: '',
  },
  {
    cfCode: '13_1_3',
    name: 'Power Charges for Street Lights',
    desc: '',
  },
  {
    cfCode: '13_2',
    name: 'Bulk Purchases',
    desc: '',
  },
  {
    cfCode: '13_3',
    name: 'Consumption of Stores',
    desc: 'Consumption of Stores shall include Petrol, Diesel, Oil/Lubricants, Medicines and Hospital needs, Sanitary Materials, Fodder(Animal Feed).',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_3_1', '13_3_2', '13_3_3', '13_3_4', '13_3_5', '13_3_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_3_1',
    name: 'Petrol',
    desc: '',
  },
  {
    cfCode: '13_3_2',
    name: 'Diesel',
    desc: '',
  },
  {
    cfCode: '13_3_3',
    name: 'Oil/Lubricants',
    desc: '',
  },
  {
    cfCode: '13_3_4',
    name: 'Medicines and Hospital needs',
    desc: '',
  },
  {
    cfCode: '13_3_5',
    name: 'Sanitary Materials',
    desc: '',
  },
  {
    cfCode: '13_3_6',
    name: 'Fodder(Animal Feed)',
    desc: '',
  },
  {
    cfCode: '13_4',
    name: 'Hire Charges',
    desc: 'Hire Charges shall include Hire chrges for supply of water through Private Lorries/Tankers, Hire Charges for Machineries/Equipments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_4_1', '13_4_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_4_1',
    name: 'Hire chrges for supply of water through Private Lorries/Tankers',
    desc: '',
  },
  {
    cfCode: '13_4_2',
    name: 'Hire Charges for Machineries/Equipments',
    desc: '',
  },
  {
    cfCode: '13_5',
    name: 'Repairs & maintenenace-infrastructure Assets',
    desc: 'Repairs & maintenenace-infrastructure Assets shall include Repairs and maintenance- Roads & Pavements - Black Topping and Asphalts, Repairs and maintenance Subways and Causeways, Repairs and maintenance Bridges and Flyovers, Repairs and Maintenecae Storm Water Drains, Open Drains and culverts, Maintenance Expenses for street lights, Improvement to compost yard/transfer stations, Maintenace expenses - Water  Supply, Maintenance Expenses- Sewarage Works, Maintenace Charges to TWAD Board/Metro Water Board, Water cess to PCB, Restoration of Roads Cuts.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '13_5_1',
          '13_5_2',
          '13_5_3',
          '13_5_4',
          '13_5_5',
          '13_5_6',
          '13_5_7',
          '13_5_8',
          '13_5_9',
          '13_5_10',
          '13_5_11',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_5_1',
    name: 'Repairs and maintenance- Roads & Pavements - Black Topping and Asphalts',
    desc: '',
  },
  {
    cfCode: '13_5_2',
    name: 'Repairs and maintenance Subways and Causeways',
    desc: '',
  },
  {
    cfCode: '13_5_3',
    name: 'Repairs and maintenance Bridges and Flyovers',
    desc: '',
  },
  {
    cfCode: '13_5_4',
    name: 'Repairs and Maintenecae Storm Water Drains, Open Drains and culverts',
    desc: '',
  },
  {
    cfCode: '13_5_5',
    name: 'Maintenance Expenses for street lights',
    desc: '',
  },
  {
    cfCode: '13_5_6',
    name: 'Improvement to compost yard/transfer stations',
    desc: '',
  },
  {
    cfCode: '13_5_7',
    name: 'Maintenace expenses - Water  Supply',
    desc: '',
  },
  {
    cfCode: '13_5_8',
    name: 'Maintenance Expenses- Sewarage Works',
    desc: '',
  },
  {
    cfCode: '13_5_9',
    name: 'Maintenace Charges to TWAD Board/Metro Water Board',
    desc: '',
  },
  {
    cfCode: '13_5_10',
    name: 'Water cess to PCB',
    desc: '',
  },
  {
    cfCode: '13_5_11',
    name: 'Restoration of Roads Cuts',
    desc: '',
  },
  {
    cfCode: '13_6',
    name: 'Reapirs & maintenance - Civic Amenities',
    desc: 'Reapirs & maintenance - Civic Amenities shall include Maintenance of Gardens/ Parks/ Swimming Pools, Maintenance of Playgrounds, Plants, Manure, Implements etc., Sanitary/Conservancy Expenses, Zoological Garden Maintenance, Maintenance of Community Halls, Town Hall, Maintenance of Nutritious Meal Centres, Maintenance of Hspitals, Dispensarioes, Miantenance expenses - Schools, Maintenance of Burial Grounds, Crematoria.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_6_1', '13_6_2', '13_6_3', '13_6_4', '13_6_5', '13_6_6', '13_6_7', '13_6_8', '13_6_9', '13_6_10'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_6_1',
    name: 'Maintenance of Gardens/ Parks/ Swimming Pools',
    desc: '',
  },
  {
    cfCode: '13_6_2',
    name: 'Maintenance of Playgrounds',
    desc: '',
  },
  {
    cfCode: '13_6_3',
    name: 'Plants, Manure, Implements etc.',
    desc: '',
  },
  {
    cfCode: '13_6_4',
    name: 'Sanitary/Conservancy Expenses',
    desc: '',
  },
  {
    cfCode: '13_6_5',
    name: 'Zoological Garden Maintenance',
    desc: '',
  },
  {
    cfCode: '13_6_6',
    name: 'Maintenance of Community Halls, Town Hall',
    desc: '',
  },
  {
    cfCode: '13_6_7',
    name: 'Maintenance of Nutritious Meal Centres',
    desc: '',
  },
  {
    cfCode: '13_6_8',
    name: 'Maintenance of Hspitals, Dispensarioes',
    desc: '',
  },
  {
    cfCode: '13_6_9',
    name: 'Miantenance expenses - Schools',
    desc: '',
  },
  {
    cfCode: '13_6_10',
    name: 'Maintenance of Burial Grounds, Crematoria',
    desc: '',
  },
  {
    cfCode: '13_7',
    name: 'Repairs & maintenance - Buildings',
    desc: 'Repairs & maintenance - Buildings shall include Office Building - Maintenance, Repairs and maintenance - Buildings, Maintenance of Lodging Houses, Rest Houses,, Cinema Theatre Maintenance, Maintenance of markets & shopping complexes, Maintenance of staff qurters.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_7_1', '13_7_2', '13_7_3', '13_7_4', '13_7_5', '13_7_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_7_1',
    name: 'Office Building - Maintenance',
    desc: '',
  },
  {
    cfCode: '13_7_2',
    name: 'Repairs and maintenance - Buildings',
    desc: '',
  },
  {
    cfCode: '13_7_3',
    name: 'Maintenance of Lodging Houses, Rest Houses,',
    desc: '',
  },
  {
    cfCode: '13_7_4',
    name: 'Cinema Theatre Maintenance',
    desc: '',
  },
  {
    cfCode: '13_7_5',
    name: 'Maintenance of markets & shopping complexes',
    desc: '',
  },
  {
    cfCode: '13_7_6',
    name: 'Maintenance of staff qurters',
    desc: '',
  },
  {
    cfCode: '13_8',
    name: 'Repairs & maintenace of vehicles',
    desc: 'Repairs & maintenace of vehicles shall include Light Vehicles - Maintenance, Heavy vehicles - Maintenance, Other Vehicles - Maintenance.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_8_1', '13_8_2', '13_8_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_8_1',
    name: 'Light Vehicles - Maintenance',
    desc: '',
  },
  {
    cfCode: '13_8_2',
    name: 'Heavy vehicles - Maintenance',
    desc: '',
  },
  {
    cfCode: '13_8_3',
    name: 'Other Vehicles - Maintenance',
    desc: '',
  },
  {
    cfCode: '13_9',
    name: 'Repairs & Miantenance - Others',
    desc: 'Repairs & Miantenance - Others shall include Repairs and maintenance of office furniture etc., Repairs and maintenance of - Intruments, Plants 7 machinery, Repairs & maintenance - Electrical Fittings, Repairs & maintenance of Office Equipments, Repairs & maintenance of Other Equipments, Repairs & maintenance of - Computers.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['13_9_1', '13_9_2', '13_9_3', '13_9_4', '13_9_5', '13_9_6'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_9_1',
    name: 'Repairs and maintenance of office furniture etc.',
    desc: '',
  },
  {
    cfCode: '13_9_2',
    name: 'Repairs and maintenance of - Intruments, Plants 7 machinery',
    desc: '',
  },
  {
    cfCode: '13_9_3',
    name: 'Repairs & maintenance - Electrical Fittings',
    desc: '',
  },
  {
    cfCode: '13_9_4',
    name: 'Repairs & maintenance of Office Equipments',
    desc: '',
  },
  {
    cfCode: '13_9_5',
    name: 'Repairs & maintenance of Other Equipments',
    desc: '',
  },
  {
    cfCode: '13_9_6',
    name: 'Repairs & maintenance of - Computers',
    desc: '',
  },
  {
    cfCode: '13_10',
    name: 'Other operating & maintenance expenses',
    desc: 'Other operating & maintenance expenses shall include Expenses on food sampling, Maintenance for improvements to Slum areas, Removal of Debris, Fairs and Festivals, Hospital expenses, Exhibition expenses, Expenses on Opening Ceremonies, Running of Libraries / Reading Rooms, Garbage Clearance, Running of Slaughter Houses, Running expenses of schools, Running expenses of Crematoria, Animal Birth Control, Natural Calamities, Testing & Inspection Charges, Lapsed Deposit.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '13_10_1',
          '13_10_2',
          '13_10_3',
          '13_10_4',
          '13_10_5',
          '13_10_6',
          '13_10_7',
          '13_10_8',
          '13_10_9',
          '13_10_10',
          '13_10_11',
          '13_10_12',
          '13_10_13',
          '13_10_14',
          '13_10_15',
          '13_10_16',
        ],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '13_10_1',
    name: 'Expenses on food sampling',
    desc: '',
  },
  {
    cfCode: '13_10_2',
    name: 'Maintenance for improvements to Slum areas',
    desc: '',
  },
  {
    cfCode: '13_10_3',
    name: 'Removal of Debris',
    desc: '',
  },
  {
    cfCode: '13_10_4',
    name: 'Fairs and Festivals',
    desc: '',
  },
  {
    cfCode: '13_10_5',
    name: 'Hospital expenses',
    desc: '',
  },
  {
    cfCode: '13_10_6',
    name: 'Exhibition expenses',
    desc: '',
  },
  {
    cfCode: '13_10_7',
    name: 'Expenses on Opening Ceremonies',
    desc: '',
  },
  {
    cfCode: '13_10_8',
    name: 'Running of Libraries / Reading Rooms',
    desc: '',
  },
  {
    cfCode: '13_10_9',
    name: 'Garbage Clearance',
    desc: '',
  },
  {
    cfCode: '13_10_10',
    name: 'Running of Slaughter Houses',
    desc: '',
  },
  {
    cfCode: '13_10_11',
    name: 'Running expenses of schools',
    desc: '',
  },
  {
    cfCode: '13_10_12',
    name: 'Running expenses of Crematoria',
    desc: '',
  },
  {
    cfCode: '13_10_13',
    name: 'Animal Birth Control',
    desc: '',
  },
  {
    cfCode: '13_10_14',
    name: 'Natural Calamities',
    desc: '',
  },
  {
    cfCode: '13_10_15',
    name: 'Testing & Inspection Charges',
    desc: '',
  },
  {
    cfCode: '13_10_16',
    name: 'Lapsed Deposit',
    desc: '',
  },
  {
    cfCode: '14',
    name: 'Interest & Finance Expenses',
    desc: 'Interest & Finance Expenses shall include Interest on Loans from Central Government, Interest on Loans from State Government, Interest on Loans from Government Bodies & associations, Interest on Loans from International Agencies, Interest on Loans from Banks & other financial instituions, Other interests, Bank Charges, Other financial expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_1', '14_2', '14_3', '14_4', '14_5', '14_6', '14_7', '14_8'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_1',
    name: 'Interest on Loans from Central Government',
    desc: 'Interest on Loans from Central Government shall include Interest on JNNURM Loans - GOI share, Interest on Loans from Central Government.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_1_1', '14_1_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_1_1',
    name: 'Interest on JNNURM Loans - GOI share',
    desc: '',
  },
  {
    cfCode: '14_1_2',
    name: 'Interest on Loans from Central Government',
    desc: '',
  },
  {
    cfCode: '14_2',
    name: 'Interest on Loans from State Government',
    desc: 'Interest on Loans from State Government shall include Interest on JNNURM Loans - State share, Interest on Loans from State Government.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_2_1', '14_2_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_2_1',
    name: 'Interest on JNNURM Loans - State share',
    desc: '',
  },
  {
    cfCode: '14_2_2',
    name: 'Interest on Loans from State Government',
    desc: '',
  },
  {
    cfCode: '14_3',
    name: 'Interest on Loans from Government Bodies & associations',
    desc: 'Interest on Loans from Government Bodies & associations shall include Interest on Loans from TNUFIDCO (Tamil Nadu Urban Financce and Infrastructure Development Corporation), Interest on Loans from MUDF (Municipal Urban Development Fund), Interest on Loans from TNUIFSL (Tamil Nadu Urban Infrastructure Financial Services Limited), Interest on Loans from HUDCO.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_3_1', '14_3_2', '14_3_3', '14_3_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_3_1',
    name: 'Interest on Loans from TNUFIDCO (Tamil Nadu Urban Financce and Infrastructure Development Corporation)',
    desc: '',
  },
  {
    cfCode: '14_3_2',
    name: 'Interest on Loans from MUDF (Municipal Urban Development Fund)',
    desc: '',
  },
  {
    cfCode: '14_3_3',
    name: 'Interest on Loans from TNUIFSL (Tamil Nadu Urban Infrastructure Financial Services Limited)',
    desc: '',
  },
  {
    cfCode: '14_3_4',
    name: 'Interest on Loans from HUDCO',
    desc: '',
  },
  {
    cfCode: '14_4',
    name: 'Interest on Loans from International Agencies',
    desc: 'Interest on Loans from International Agencies shall include Interest on Loans from World Bank, Interest on Loans from ADB, Interest on Loans from IBRD, Interest on Loans from International Agencies.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_4_1', '14_4_2', '14_4_3', '14_4_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_4_1',
    name: 'Interest on Loans from World Bank',
    desc: '',
  },
  {
    cfCode: '14_4_2',
    name: 'Interest on Loans from ADB',
    desc: '',
  },
  {
    cfCode: '14_4_3',
    name: 'Interest on Loans from IBRD',
    desc: '',
  },
  {
    cfCode: '14_4_4',
    name: 'Interest on Loans from International Agencies',
    desc: '',
  },
  {
    cfCode: '14_5',
    name: 'Interest on Loans from Banks & other financial instituions',
    desc: 'Interest on Loans from Banks & other financial instituions shall include Interest Charged by the Bank.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_5_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_5_1',
    name: 'Interest Charged by the Bank',
    desc: '',
  },
  {
    cfCode: '14_6',
    name: 'Other interests',
    desc: 'Other interests shall include Interest on Loans / Ways & Means Advance / Overdraft.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_6_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_6_1',
    name: 'Interest on Loans / Ways & Means Advance / Overdraft',
    desc: '',
  },
  {
    cfCode: '14_7',
    name: 'Bank Charges',
    desc: 'Bank Charges shall include Bank charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_7_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_7_1',
    name: 'Bank charges',
    desc: '',
  },
  {
    cfCode: '14_8',
    name: 'Other financial expenses',
    desc: 'Other financial expenses shall include Commitment charges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['14_8_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '14_8_1',
    name: 'Commitment charges',
    desc: '',
  },
  {
    cfCode: '15',
    name: 'Programme Expenses',
    desc: 'Programme Expenses shall include Election Expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['15_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '15_1',
    name: 'Election Expenses',
    desc: 'Election Expenses shall include Election Expenses, Own Programme, Family welfare programme, Mass immunisation programme, AIDS control programme.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['15_1_1', '15_1_2', '15_1_3', '15_1_4', '15_1_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '15_1_1',
    name: 'Election Expenses',
    desc: '',
  },
  {
    cfCode: '15_1_2',
    name: 'Own Programme',
    desc: '',
  },
  {
    cfCode: '15_1_3',
    name: 'Family welfare programme',
    desc: '',
  },
  {
    cfCode: '15_1_4',
    name: 'Mass immunisation programme',
    desc: '',
  },
  {
    cfCode: '15_1_5',
    name: 'AIDS control programme',
    desc: '',
  },
  {
    cfCode: '16',
    name: 'Grants, Contribution and subsidies',
    desc: 'Grants, Contribution and subsidies shall include Grants, Contributions, Subsidies.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['16_1', '16_2', '16_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '16_1',
    name: 'Grants',
    desc: 'Grants shall include Family welfare programme - Grant, PTMGR Noon Meal scheme - Grant (Puratchi Thalaivar M.G.R. Nutritious Meal Programme).',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['16_1_1', '16_1_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '16_1_1',
    name: 'Family welfare programme - Grant',
    desc: '',
  },
  {
    cfCode: '16_1_2',
    name: 'PTMGR Noon Meal scheme - Grant (Puratchi Thalaivar M.G.R. Nutritious Meal Programme)',
    desc: '',
  },
  {
    cfCode: '16_2',
    name: 'Contributions',
    desc: 'Contributions shall include Family welfare programme - CMDA (Chennai Metropolitan Development Authority), LPA (Local Planning Authority), TNIUS (Tamil Nadu Institute of Urban Studies), Railways, Municipal Contribution.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['16_2_1', '16_2_2', '16_2_3', '16_2_4', '16_2_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '16_2_1',
    name: 'Family welfare programme - CMDA (Chennai Metropolitan Development Authority)',
    desc: '',
  },
  {
    cfCode: '16_2_2',
    name: 'LPA (Local Planning Authority)',
    desc: '',
  },
  {
    cfCode: '16_2_3',
    name: 'TNIUS (Tamil Nadu Institute of Urban Studies)',
    desc: '',
  },
  {
    cfCode: '16_2_4',
    name: 'Railways',
    desc: '',
  },
  {
    cfCode: '16_2_5',
    name: 'Municipal Contribution',
    desc: '',
  },
  {
    cfCode: '16_3',
    name: 'Subsidies',
    desc: '',
  },
  {
    cfCode: '17',
    name: 'Provisions and Write off',
    desc: 'Provisions and Write off shall include Provisions for Doubtful recievables, Provision for other assets, Revenues written off, Assets written off, Miscellaneous Expenses writtem off.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['17_1', '17_2', '17_3', '17_4', '17_5'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '17_1',
    name: 'Provisions for Doubtful recievables',
    desc: 'Provisions for Doubtful recievables shall include Provision for Doubtful Collection of Revenue items - Taxes, Provision for Doubtful Collection of Revenue items - Other revenues.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['17_1_1', '17_1_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '17_1_1',
    name: 'Provision for Doubtful Collection of Revenue items - Taxes',
    desc: '',
  },
  {
    cfCode: '17_1_2',
    name: 'Provision for Doubtful Collection of Revenue items - Other revenues',
    desc: '',
  },
  {
    cfCode: '17_2',
    name: 'Provision for other assets',
    desc: 'Provision for other assets shall include Stores, Fixed Assets, Investments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['17_2_1', '17_2_2', '17_2_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '17_2_1',
    name: 'Stores',
    desc: '',
  },
  {
    cfCode: '17_2_2',
    name: 'Fixed Assets',
    desc: '',
  },
  {
    cfCode: '17_2_3',
    name: 'Investments',
    desc: '',
  },
  {
    cfCode: '17_3',
    name: 'Revenues written off',
    desc: 'Revenues written off shall include Irrecoverable Revenue Items Written off - Taxes, Irrecoverable Revenue Items Written off - Other revenues.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['17_3_1', '17_3_2'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '17_3_1',
    name: 'Irrecoverable Revenue Items Written off - Taxes',
    desc: '',
  },
  {
    cfCode: '17_3_2',
    name: 'Irrecoverable Revenue Items Written off - Other revenues',
    desc: '',
  },
  {
    cfCode: '17_4',
    name: 'Assets written off',
    desc: 'Assets written off shall include Stores written off, Assets written off - Fixed Assets, Stores written off - Evaporation loss, Investments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['17_4_1', '17_4_2', '17_4_3', '17_4_4'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '17_4_1',
    name: 'Stores written off',
    desc: '',
  },
  {
    cfCode: '17_4_2',
    name: 'Assets written off - Fixed Assets',
    desc: '',
  },
  {
    cfCode: '17_4_3',
    name: 'Stores written off - Evaporation loss',
    desc: '',
  },
  {
    cfCode: '17_4_4',
    name: 'Investments',
    desc: '',
  },
  {
    cfCode: '17_5',
    name: 'Miscellaneous Expenses writtem off',
    desc: '',
  },
  {
    cfCode: '18',
    name: 'Miscellaneous Expenses',
    desc: 'Miscellaneous Expenses shall include Loss on disposal of Assets, Loss on disposal of investments, Decline in value of investments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['18_1', '18_2', '18_3'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '18_1',
    name: 'Loss on disposal of Assets',
    desc: 'Loss on disposal of Assets shall include Loss on sale of assets.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['18_1_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '18_1_1',
    name: 'Loss on sale of assets',
    desc: '',
  },
  {
    cfCode: '18_2',
    name: 'Loss on disposal of investments',
    desc: 'Loss on disposal of investments shall include Loss on sale of investments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['18_2_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '18_2_1',
    name: 'Loss on sale of investments',
    desc: '',
  },
  {
    cfCode: '18_3',
    name: 'Decline in value of investments',
    desc: '',
  },
  {
    cfCode: '19',
    name: 'Depreciation',
    desc: 'Depreciation shall include Buildings, Depreciation - Roads & Bridges, Sewerage and Drainage, Waterways, Public Lighting, Plant & Machinery, Vehicles, & Other Equipments, Furniture, Fixture, Fittings and Electrical Appliances, Other Fixed Assets.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_1', '19_2', '19_3', '19_4', '19_5', '19_6', '19_7', '19_8', '19_9', '19_20'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_1',
    name: 'Buildings',
    desc: 'Buildings shall include Depreciation - Buildings.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_1_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_1_1',
    name: 'Depreciation - Buildings',
    desc: '',
  },
  {
    cfCode: '19_2',
    name: 'Depreciation - Roads & Bridges',
    desc: 'Depreciation - Roads & Bridges shall include Roads & Bridges.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_2_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_2_1',
    name: 'Roads & Bridges',
    desc: '',
  },
  {
    cfCode: '19_3',
    name: 'Sewerage and Drainage',
    desc: 'Sewerage and Drainage shall include Depreciation - Sewerage and Drainage.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_3_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_3_1',
    name: 'Depreciation - Sewerage and Drainage',
    desc: '',
  },
  {
    cfCode: '19_4',
    name: 'Waterways',
    desc: 'Waterways shall include Depreciation - Waterways.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_4_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_4_1',
    name: 'Depreciation - Waterways',
    desc: '',
  },
  {
    cfCode: '19_5',
    name: 'Public Lighting',
    desc: 'Public Lighting shall include Depreciation - Public Lighting.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_5_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_5_1',
    name: 'Depreciation - Public Lighting',
    desc: '',
  },
  {
    cfCode: '19_6',
    name: 'Plant & Machinery',
    desc: 'Plant & Machinery shall include Depreciation - Plant & Machinery.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_6_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_6_1',
    name: 'Depreciation - Plant & Machinery',
    desc: '',
  },
  {
    cfCode: '19_7',
    name: 'Vehicles',
    desc: 'Vehicles shall include Depreciation - Vehicles.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_7_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_7_1',
    name: 'Depreciation - Vehicles',
    desc: '',
  },
  {
    cfCode: '19_8',
    name: '& Other Equipments',
    desc: '& Other Equipments shall include Depreciation - Office & Other Equipments.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_8_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_8_1',
    name: 'Depreciation - Office & Other Equipments',
    desc: '',
  },
  {
    cfCode: '19_9',
    name: 'Furniture, Fixture, Fittings and Electrical Appliances',
    desc: 'Furniture, Fixture, Fittings and Electrical Appliances shall include Depreciation - Furniture, Fixtures, Fittings and Electrical Appliances.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_9_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_9_1',
    name: 'Depreciation - Furniture, Fixtures, Fittings and Electrical Appliances',
    desc: '',
  },
  {
    cfCode: '19_20',
    name: 'Other Fixed Assets',
    desc: 'Other Fixed Assets shall include Depreciation - Other Fixed Assets.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['19_20_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '19_20_1',
    name: 'Depreciation - Other Fixed Assets',
    desc: '',
  },
  {
    cfCode: '20',
    name: 'Prior Period Item',
    desc: 'Prior Period Item shall include Taxes, Other - Revenues, Recovery of revenues written off, Other Income, Refund of Taxes, Refund of other - revenues, Other Expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['20_1', '20_2', '20_3', '20_4', '20_5', '20_6', '20_7'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '20_1',
    name: 'Taxes',
    desc: '',
  },
  {
    cfCode: '20_2',
    name: 'Other - Revenues',
    desc: '',
  },
  {
    cfCode: '20_3',
    name: 'Recovery of revenues written off',
    desc: '',
  },
  {
    cfCode: '20_4',
    name: 'Other Income',
    desc: 'Other Income shall include Prior year Income.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['20_4_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '20_4_1',
    name: 'Prior year Income',
    desc: '',
  },
  {
    cfCode: '20_5',
    name: 'Refund of Taxes',
    desc: '',
  },
  {
    cfCode: '20_6',
    name: 'Refund of other - revenues',
    desc: '',
  },
  {
    cfCode: '20_7',
    name: 'Other Expenses',
    desc: 'Other Expenses shall include Prior year Expenses.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['20_7_1'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
  {
    cfCode: '20_7_1',
    name: 'Prior year Expenses',
    desc: '',
  },
  {
    cfCode: '21',
    name: 'TOTAL EXPENDITURE  (sum of 11 to 20)',
    desc: '',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'],
      },
      {
        type: 'comparison',
        operator: '>',
        value: 10,
      },
      {
        type: 'comparison',
        operator: '<',
        value: 1_000_000,
      },
    ],
  },
] as const;

// Sample data - payload from State.
export const apiPayload = {
  ulb_id: '5dd24729437ba31f7eb42eee', // AP001
  year: '606aafb14dff55e6c075d3ae', // 2022-23
  lineItems: {
    '1': 150,
    '1_1': 10,
    '1_2': 10,
    '1_3': 10,
    '1_4': 10,
    '1_5': 10,
    '1_6': 10,
    '1_7': 10,
    '1_8': 10,
    '1_9': 10,
    '1_10': 10,
    '1_11': 10,
    '1_12': 10,
    '1_13': 10,
    '1_14': 10,
    '1_15': 10,
  },
};
