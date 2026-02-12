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

type Rule = FormulaRule | ComparisonRule;

type LineItems = {
  cfCode: string;
  nmamCode?: string;
  name: string;
  desc: string;
  rules?: Rule[];
};

// Sample template - data from DB?
export const lineItems: LineItems[] = [
  {
    cfCode: '1',
    nmamCode: '110',
    name: 'Tax Revenue',
    desc: 'Tax revenue shall include property, water, drainage, sewerage, professional, entertainment and advertisement tax and all other tax revenues.',
    rules: [
      {
        type: 'formula',
        operation: 'sum',
        operands: [
          '1.1',
          '1.2',
          '1.3',
          '1.4',
          '1.5',
          '1.6',
          '1.7',
          '1.8',
          '1.9',
          '1.10',
          '1.11',
          '1.12',
          '1.13',
          '1.14',
          '1.15',
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
    cfCode: '1.1',
    nmamCode: '11001',
    name: 'Property Tax',
    desc: '',
  },
  {
    cfCode: '1.1.1',
    name: 'General Tax',
    desc: '',
  },
  {
    cfCode: '1.1.1.1',
    name: 'Residential',
    desc: '',
  },
  {
    cfCode: '1.1.1.2',
    name: 'Non Residential',
    desc: '',
  },
  {
    cfCode: '1.1.1.3',
    name: 'Commercial Tax',
    desc: '',
  },
  {
    cfCode: '1.1.2',
    name: 'Vacant Land Tax',
    desc: '',
  },
  {
    cfCode: '1.1.3',
    name: 'Industrial Tax',
    desc: '',
  },
  {
    cfCode: '1.1.4',
    name: 'State Government Properties',
    desc: '',
  },
  {
    cfCode: '1.1.5',
    name: 'Central Government Properties',
    desc: '',
  },
  {
    cfCode: '1.1.6',
    name: 'Service Charges in Lieu of property tax from Central Government Properties',
    desc: '',
  },
  {
    cfCode: '1.1.7',
    name: 'Service Charges in Lieu of property tax from Railway authorities',
    desc: '',
  },
  {
    cfCode: '1.1.8',
    name: 'Tax on Agriculture Lands',
    desc: '',
  },
  {
    cfCode: '1.1.9',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.2',
    name: 'Water tax',
    desc: '',
  },
  {
    cfCode: '1.2.1',
    name: 'Water Supply Tax from Residential',
    desc: '',
  },
  {
    cfCode: '1.2.2',
    name: 'Water Supply Tax from Non Residential',
    desc: '',
  },
  {
    cfCode: '1.2.3',
    name: 'Water Supply Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1.2.4',
    name: 'Water Supply Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1.2.5',
    name: 'Water Supply Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1.2.6',
    name: 'Water Supply Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.2.7',
    name: 'Water Supply Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.2.8',
    name: 'Water Supply Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1.2.9',
    name: 'Water Supply Tax from others',
    desc: '',
  },
  {
    cfCode: '1.3',
    name: 'Drainage tax',
    desc: '',
  },
  {
    cfCode: '1.3.1',
    name: 'Drainage  from Residential',
    desc: '',
  },
  {
    cfCode: '1.3.2',
    name: 'Drainage  from Non Residential',
    desc: '',
  },
  {
    cfCode: '1.3.3',
    name: 'Drainage Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1.3.4',
    name: 'Drainage Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1.3.5',
    name: 'Drainage Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1.3.6',
    name: 'Drainage Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.3.7',
    name: 'Drainage Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.3.8',
    name: 'Drainage Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1.3.9',
    name: 'Drainage Tax from others',
    desc: '',
  },
  {
    cfCode: '1.4',
    name: 'Sewerage tax',
    desc: '',
  },
  {
    cfCode: '1.4.1',
    name: 'Sewerage  from Residential',
    desc: '',
  },
  {
    cfCode: '1.4.2',
    name: 'Sewerage  from Non Residential',
    desc: '',
  },
  {
    cfCode: '1.4.3',
    name: 'Sewerage Tax from Commercial',
    desc: '',
  },
  {
    cfCode: '1.4.4',
    name: 'Sewerage Tax from Vacant',
    desc: '',
  },
  {
    cfCode: '1.4.5',
    name: 'Sewerage Tax from Industries',
    desc: '',
  },
  {
    cfCode: '1.4.6',
    name: 'Sewerage Tax from State Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.4.7',
    name: 'Sewerage Tax from Central Governement Properties',
    desc: '',
  },
  {
    cfCode: '1.4.8',
    name: 'Sewerage Tax from Agricultural Lands',
    desc: '',
  },
  {
    cfCode: '1.4.9',
    name: 'Sewerage Tax from others',
    desc: '',
  },
  {
    cfCode: '1.5',
    name: 'Professional tax',
    desc: '',
  },
  {
    cfCode: '1.6',
    name: 'Entertainment tax',
    desc: '',
  },
  {
    cfCode: '1.7',
    name: 'Advertisement tax',
    desc: '',
  },
  {
    cfCode: '1.7.1',
    name: 'Tax on Digital Hoadings',
    desc: '',
  },
  {
    cfCode: '1.7.2',
    name: 'Tax on Normal Hoadings',
    desc: '',
  },
  {
    cfCode: '1.7.3',
    name: 'Cinema Houses',
    desc: '',
  },
  {
    cfCode: '1.7.4',
    name: 'Hoardings on Vehicles',
    desc: '',
  },
  {
    cfCode: '1.7.5',
    name: 'Public Screens',
    desc: '',
  },
  {
    cfCode: '1.7.6',
    name: 'Cable Operators',
    desc: '',
  },
  {
    cfCode: '1.7.7',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.8',
    name: 'Education Tax',
    desc: '',
  },
  {
    cfCode: '1.9',
    name: 'Vehicle Tax',
    desc: '',
  },
  {
    cfCode: '1.9.1',
    name: 'Tax on Carriage',
    desc: '',
  },
  {
    cfCode: '1.9.2',
    name: 'Tax on Carts',
    desc: '',
  },
  {
    cfCode: '1.9.3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.10',
    name: 'Tax on Animals',
    desc: '',
  },
  {
    cfCode: '1.11',
    name: 'Pilgrimage Tax',
    desc: '',
  },
  {
    cfCode: '1.12',
    name: 'Octroi and Toll Tax',
    desc: '',
  },
  {
    cfCode: '1.12.1',
    name: 'Octroi and Toll',
    desc: '',
  },
  {
    cfCode: '1.12.2',
    name: 'Entry Fees',
    desc: '',
  },
  {
    cfCode: '1.12.3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.13',
    name: 'Cess',
    desc: '',
  },
  {
    cfCode: '1.13.1',
    name: 'Stamp Duty',
    desc: '',
  },
  {
    cfCode: '1.13.2',
    name: 'Cess',
    desc: '',
  },
  {
    cfCode: '1.13.3',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.14',
    name: 'Tax Remission & Refund',
    desc: '',
  },
  {
    cfCode: '1.14.1',
    name: 'Vacancy Remission',
    desc: '',
  },
  {
    cfCode: '1.14.2',
    name: 'Tax Remission',
    desc: '',
  },
  {
    cfCode: '1.14.3',
    name: 'Tax Refunds',
    desc: '',
  },
  {
    cfCode: '1.14.4',
    name: 'Early Payment Rebate',
    desc: '',
  },
  {
    cfCode: '1.14.5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '1.15',
    name: 'All other tax revenues (combined)',
    desc: '',
  },
  {
    cfCode: '2',
    name: 'Fees & User charges',
    desc: '',
  },
  {
    cfCode: '2.1',
    name: 'Empanelment & Registration Charges',
    desc: '',
  },
  {
    cfCode: '2.1.1',
    name: 'Contractors',
    desc: '',
  },
  {
    cfCode: '2.1.2',
    name: 'Suppliers',
    desc: '',
  },
  {
    cfCode: '2.1.3',
    name: 'Licensed Surveyors',
    desc: '',
  },
  {
    cfCode: '2.1.4',
    name: 'Plumbers',
    desc: '',
  },
  {
    cfCode: '2.1.5',
    name: 'Others(Carts, Patience, PW contractors, Cess registrations)',
    desc: '',
  },
  {
    cfCode: '2.2',
    name: 'Liciensing Fees',
    desc: '',
  },
  {
    cfCode: '2.2.1',
    name: 'Trade Licence Fees',
    desc: '',
  },
  {
    cfCode: '2.2.2',
    name: 'Licence Fees under Prevention of Food Alteration (PFA) Act',
    desc: '',
  },
  {
    cfCode: '2.2.3',
    name: 'Building Licence Fees',
    desc: '',
  },
  {
    cfCode: '2.2.4',
    name: 'Fees for Slaughter Houses',
    desc: '',
  },
  {
    cfCode: '2.2.5',
    name: 'Cattle pounding',
    desc: '',
  },
  {
    cfCode: '2.2.6',
    name: 'Butchers & traders of Meat ',
    desc: '',
  },
  {
    cfCode: '2.2.8',
    name: 'Licensing of animals ',
    desc: '',
  },
  {
    cfCode: '2.2.9',
    name: 'Others ',
    desc: '',
  },
  {
    cfCode: '2.3',
    name: 'Fees for Grant of Permit',
    desc: '',
  },
  {
    cfCode: '2.3.1',
    name: 'Fees for Fishery Rights',
    desc: '',
  },
  {
    cfCode: '2.3.2',
    name: 'Fees under Place of Public Resorts Act',
    desc: '',
  },
  {
    cfCode: '2.3.3',
    name: 'Licensing fee from bazaar & shops',
    desc: '',
  },
  {
    cfCode: '2.3.4',
    name: 'Building Permit/License Fee',
    desc: '',
  },
  {
    cfCode: '2.3.5',
    name: 'Fees for permit of Digging Well/ Borewell',
    desc: '',
  },
  {
    cfCode: '2.3.6',
    name: 'Fee for Film Shooting in Parks',
    desc: '',
  },
  {
    cfCode: '2.3.7',
    name: 'Fee for installing Machinery',
    desc: '',
  },
  {
    cfCode: '2.3.8',
    name: 'Fee for Festivals and Fairs',
    desc: '',
  },
  {
    cfCode: '2.3.9',
    name: 'Fee for Private Markets',
    desc: '',
  },
  {
    cfCode: '2.3.10',
    name: 'Fee for Public Markets',
    desc: '',
  },
  {
    cfCode: '2.3.11',
    name: 'Animal Slaughtering Fee',
    desc: '',
  },
  {
    cfCode: '2.3.12',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '2.4',
    name: 'Fees for Certificate or Extract',
    desc: '',
  },
  {
    cfCode: '2.4.1',
    name: 'Copy Application Fees',
    desc: '',
  },
  {
    cfCode: '2.4.2',
    name: 'Birth or Death Certificates Fees',
    desc: '',
  },
  {
    cfCode: '2.4.3',
    name: 'Other Certificate Fees',
    desc: '',
  },
  {
    cfCode: '2.5',
    name: 'Development Charges',
    desc: '',
  },
  {
    cfCode: '2.5.1',
    name: 'Road Formation Charges',
    desc: '',
  },
  {
    cfCode: '2.5.2',
    name: 'Building Development Charges',
    desc: '',
  },
  {
    cfCode: '2.5.3',
    name: 'Betterment Charges',
    desc: '',
  },
  {
    cfCode: '2.5.4',
    name: 'Special Development Contribution',
    desc: '',
  },
  {
    cfCode: '2.5.5',
    name: 'Layout subdivision fee',
    desc: '',
  },
  {
    cfCode: '2.5.6',
    name: 'Impact Fee',
    desc: '',
  },
  {
    cfCode: '2.5.7',
    name: 'Unapproved Layout - Development charges',
    desc: '',
  },
  {
    cfCode: '2.5.8',
    name: 'Un-Authorised Colony Improvement Contribution',
    desc: '',
  },
  {
    cfCode: '2.5.9',
    name: 'Centage charges',
    desc: '',
  },
  {
    cfCode: '2.5.10',
    name: 'Open Space Contribution',
    desc: '',
  },
  {
    cfCode: '2.5.11',
    name: 'Parking Contribution',
    desc: '',
  },
  {
    cfCode: '2.5.12',
    name: 'Postage & Advertisement Charges',
    desc: '',
  },
  {
    cfCode: '2.5.13',
    name: 'Other Town Planning Receipts',
    desc: '',
  },
  {
    cfCode: '2.5.14',
    name: 'Other Development Charges',
    desc: '',
  },
  {
    cfCode: '2.6',
    name: 'Regularisation Fees',
    desc: '',
  },
  {
    cfCode: '2.6.1',
    name: 'Building Regularization ',
    desc: '',
  },
  {
    cfCode: '2.6.2',
    name: 'Encroachment Fee',
    desc: '',
  },
  {
    cfCode: '2.6.3',
    name: 'Demolition Charges',
    desc: '',
  },
  {
    cfCode: '2.6.4',
    name: 'Building Service Charges',
    desc: '',
  },
  {
    cfCode: '2.6.5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '2.7',
    name: 'Penalties and Fines',
    desc: '',
  },
  {
    cfCode: '2.7.1',
    name: 'Penalty and Bank Charges for Dishonoured Cheques',
    desc: '',
  },
  {
    cfCode: '2.7.2',
    name: 'Magisterial Fines',
    desc: '',
  },
  {
    cfCode: '2.7.3',
    name: 'Penalty on Unauthorized Water Connections',
    desc: '',
  },
  {
    cfCode: '2.7.4',
    name: 'Spot fines ',
    desc: '',
  },
  {
    cfCode: '2.7.5',
    name: 'Penalty on Unauthorized Sewerage Connections',
    desc: '',
  },
  {
    cfCode: '2.7.6',
    name: 'Other Penalties',
    desc: '',
  },
  {
    cfCode: '2.8',
    name: 'Other Fees',
    desc: '',
  },
  {
    cfCode: '2.8.1',
    name: 'Advertisement fees',
    desc: '',
  },
  {
    cfCode: '2.8.2',
    name: 'Survey Fees',
    desc: '',
  },
  {
    cfCode: '2.8.3',
    name: 'Income from fairs and festivals',
    desc: '',
  },
  {
    cfCode: '2.8.4',
    name: 'library fees ',
    desc: '',
  },
  {
    cfCode: '2.8.5',
    name: 'sports fee',
    desc: '',
  },
  {
    cfCode: '2.8.6',
    name: 'admission fees ',
    desc: '',
  },
  {
    cfCode: '2.8.7',
    name: 'notice fees ',
    desc: '',
  },
  {
    cfCode: '2.8.8',
    name: 'warrant & distraint fees ',
    desc: '',
  },
  {
    cfCode: '2.8.9',
    name: 'Property transfer charges ',
    desc: '',
  },
  {
    cfCode: '2.8.10',
    name: 'Mutation fees',
    desc: '',
  },
  {
    cfCode: '2.8.11',
    name: 'Connection/Disconnection charges (Water Supply)',
    desc: '',
  },
  {
    cfCode: '2.8.12',
    name: 'Connection/Disconnection charges (Sewerage)',
    desc: '',
  },
  {
    cfCode: '2.8.13',
    name: 'Other Fees',
    desc: '',
  },
  {
    cfCode: '2.9',
    name: 'User Charges',
    desc: '',
  },
  {
    cfCode: '2.9.1',
    name: 'Receipts from Hospital and Dispensaries',
    desc: '',
  },
  {
    cfCode: '2.9.2',
    name: 'Under ground drainage Montly Charges',
    desc: '',
  },
  {
    cfCode: '2.9.3',
    name: 'Drainage Fees from Building/ Flat promoters',
    desc: '',
  },
  {
    cfCode: '2.9.4',
    name: 'Metered/ Tao Rate Water Chargers',
    desc: '',
  },
  {
    cfCode: '2.9.5',
    name: 'Charges for Water Supply through Tankers/lorries',
    desc: '',
  },
  {
    cfCode: '2.9.6',
    name: 'Septic Tank Cleaning Charges',
    desc: '',
  },
  {
    cfCode: '2.9.7',
    name: 'Burning/Burial Ground Charges',
    desc: '',
  },
  {
    cfCode: '2.9.8',
    name: 'Garbage/Debris Collection',
    desc: '',
  },
  {
    cfCode: '2.9.9',
    name: 'Sewerage Charges',
    desc: '',
  },
  {
    cfCode: '2.9.10',
    name: 'Other User Charges',
    desc: '',
  },
  {
    cfCode: '2.10',
    name: 'Entry Fees',
    desc: '',
  },
  {
    cfCode: '2.10.1',
    name: 'Garden/Parks Receipts',
    desc: '',
  },
  {
    cfCode: '2.10.2',
    name: 'Amusement Fees',
    desc: '',
  },
  {
    cfCode: '2.10.3',
    name: 'Swimming Pool Receipts',
    desc: '',
  },
  {
    cfCode: '2.10.4',
    name: 'Library Receipts',
    desc: '',
  },
  {
    cfCode: '2.10.5',
    name: 'Sport Complex Fees',
    desc: '',
  },
  {
    cfCode: '2.10.6',
    name: 'Other Entry Fees',
    desc: '',
  },
  {
    cfCode: '2.11',
    name: 'Service/ Administrative Charges',
    desc: '',
  },
  {
    cfCode: '2.11.1',
    name: 'Road cut/Restoration charges',
    desc: '',
  },
  {
    cfCode: '2.11.2',
    name: 'Initial amount for new water supply connections',
    desc: '',
  },
  {
    cfCode: '2.11.3',
    name: 'Initial amount for Drainage connections',
    desc: '',
  },
  {
    cfCode: '2.11.4',
    name: 'Initial amount for Sewerageconnections',
    desc: '',
  },
  {
    cfCode: '2.11.5',
    name: 'Water Supply connection charges',
    desc: '',
  },
  {
    cfCode: '2.11.6',
    name: 'Sewerage connection charges',
    desc: '',
  },
  {
    cfCode: '2.11.7',
    name: 'Water Supply disconnection charges',
    desc: '',
  },
  {
    cfCode: '2.11.8',
    name: 'Sewerage disconnection charges',
    desc: '',
  },
  {
    cfCode: '2.11.9',
    name: 'Income from Road Margins',
    desc: '',
  },
  {
    cfCode: '2.11.10',
    name: 'Cartage Charges',
    desc: '',
  },
  {
    cfCode: '2.11.11',
    name: 'Other service/administrative charges',
    desc: '',
  },
  {
    cfCode: '2.12',
    name: 'Other Charges',
    desc: '',
  },
  {
    cfCode: '2.12.1',
    name: 'Law charges and court cost recoveries',
    desc: '',
  },
  {
    cfCode: '2.12.2',
    name: 'Pension and leave salary contributions',
    desc: '',
  },
  {
    cfCode: '2.12.3',
    name: 'Miscellaneous Recoveries',
    desc: '',
  },
  {
    cfCode: '2.13',
    name: 'Fees Remission and Refund',
    desc: '',
  },
  {
    cfCode: '2.13.1',
    name: 'Remission Fees',
    desc: '',
  },
  {
    cfCode: '2.13.2',
    name: 'Refund Fees',
    desc: '',
  },
  {
    cfCode: '3',
    name: 'Rental Income from Municipal Properties',
    desc: '',
  },
  {
    cfCode: '3.1',
    name: 'Rent from Civic Amenities',
    desc: '',
  },
  {
    cfCode: '3.1.1',
    name: 'Rent from shopping complex/ markets, Auditorium, art galleries, playgrounds, nurseries, marriage halls',
    desc: '',
  },
  {
    cfCode: '3.1.2',
    name: 'Rent from Community Hall',
    desc: '',
  },
  {
    cfCode: '3.1.3',
    name: 'Market fees- Daily market',
    desc: '',
  },
  {
    cfCode: '3.1.4',
    name: 'Market fees- weekly market',
    desc: '',
  },
  {
    cfCode: '3.1.5',
    name: 'Private market fees',
    desc: '',
  },
  {
    cfCode: '3.1.6',
    name: 'Fees for Bays in Bus Stand',
    desc: '',
  },
  {
    cfCode: '3.1.7',
    name: 'Cart Stand/Lorry Stand/Taxi Stand/ Cycle stand fees',
    desc: '',
  },
  {
    cfCode: '3.1.8',
    name: 'Avenue Receipts',
    desc: '',
  },
  {
    cfCode: '3.2',
    name: 'Rent from Office Buildings',
    desc: '',
  },
  {
    cfCode: '3.3',
    name: 'Rent from Guest Houses',
    desc: '',
  },
  {
    cfCode: '3.4',
    name: 'Rent from lease of Lands',
    desc: '',
  },
  {
    cfCode: '3.5',
    name: 'Other Rents',
    desc: '',
  },
  {
    cfCode: '3.5.1',
    name: 'Rent on Bunk Stalls',
    desc: '',
  },
  {
    cfCode: '3.5.2',
    name: 'Cable TV rent',
    desc: '',
  },
  {
    cfCode: '3.5.3',
    name: 'Parking fees',
    desc: '',
  },
  {
    cfCode: '3.5.4',
    name: 'Income from Ferries',
    desc: '',
  },
  {
    cfCode: '3.5.5',
    name: 'Fees for pay and use Toilets',
    desc: '',
  },
  {
    cfCode: '3.5.6',
    name: 'Cinema Theatre -Income',
    desc: '',
  },
  {
    cfCode: '3.5.7',
    name: 'Track Rent',
    desc: '',
  },
  {
    cfCode: '3.6',
    name: 'Rent remission and refund',
    desc: '',
  },
  {
    cfCode: '4',
    name: 'Assigned Revenues & Compensation',
    desc: '',
  },
  {
    cfCode: '4.1',
    name: 'Taxes and duties collected by others',
    desc: '',
  },
  {
    cfCode: '4.1.1',
    name: 'Duty on transfer of property',
    desc: '',
  },
  {
    cfCode: '4.1.2',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '4.2',
    name: 'Compesation in lieu of taxes/duties',
    desc: '',
  },
  {
    cfCode: '4.2.1',
    name: 'Compensation for toll ',
    desc: '',
  },
  {
    cfCode: '4.2.2',
    name: 'Compensation in lieu of Octroi',
    desc: '',
  },
  {
    cfCode: '4.2.3',
    name: 'Octroi in lieu of Electricity ',
    desc: '',
  },
  {
    cfCode: '4.2.4',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '4.3',
    name: 'Compensation in lieu of Conscessions',
    desc: '',
  },
  {
    cfCode: '4.3.1',
    name: 'property tax compensations due to concessions certain set of tax payers ',
    desc: '',
  },
  {
    cfCode: '5',
    name: 'Revenue Grants, Contributions & Subsidies',
    desc: '',
  },
  {
    cfCode: '5.1',
    name: 'Revenue Grant',
    desc: '',
  },
  {
    cfCode: '5.1.1',
    name: 'Specific Maintenance Grant-Contribution for water supply and Drainage',
    desc: '',
  },
  {
    cfCode: '5.1.2',
    name: 'Grant for natural calamities ',
    desc: '',
  },
  {
    cfCode: '5.1.3',
    name: 'Grants from State Government ',
    desc: '',
  },
  {
    cfCode: '5.1.4',
    name: 'Devolution Fund (including State Finance Commission Fund)',
    desc: '',
  },
  {
    cfCode: '5.1.5',
    name: 'M.P. Fund',
    desc: '',
  },
  {
    cfCode: '5.1.6',
    name: 'M.L.A. Fund',
    desc: '',
  },
  {
    cfCode: '5.1.7',
    name: 'Grants in kind',
    desc: '',
  },
  {
    cfCode: '5.1.8',
    name: 'Grants from Central Government ',
    desc: '',
  },
  {
    cfCode: '5.1.8.1',
    name: '14th Finance Commssion',
    desc: '',
  },
  {
    cfCode: '5.1.8.2',
    name: '15th Finance Commssion',
    desc: '',
  },
  {
    cfCode: '5.1.9',
    name: 'Central Schemes Grant',
    desc: '',
  },
  {
    cfCode: '5.1.9.1',
    name: 'Amrut',
    desc: '',
  },
  {
    cfCode: '5.1.9.2',
    name: 'Solid Waste Management',
    desc: '',
  },
  {
    cfCode: '5.1.9.3',
    name: 'NULM',
    desc: '',
  },
  {
    cfCode: '5.1.9.4',
    name: 'PMAY',
    desc: '',
  },
  {
    cfCode: '5.1.9.5',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '5.2',
    name: 'Re-imbursement of expenses ',
    desc: '',
  },
  {
    cfCode: '5.2.1',
    name: 'Election expenses ',
    desc: '',
  },
  {
    cfCode: '5.2.2',
    name: 'External aided projects ',
    desc: '',
  },
  {
    cfCode: '5.2.3',
    name: 'Family Planning Centre Expenses ',
    desc: '',
  },
  {
    cfCode: '5.2.4',
    name: 'Family planning incentives ',
    desc: '',
  },
  {
    cfCode: '5.2.5',
    name: 'Anti-malaria expenses ',
    desc: '',
  },
  {
    cfCode: '5.3',
    name: 'Contribution towards schemes',
    desc: '',
  },
  {
    cfCode: '5.3.1',
    name: 'Swarna Jayanthi Shari Rojgar Yojana',
    desc: '',
  },
  {
    cfCode: '5.3.2',
    name: 'National Slum Development Project',
    desc: '',
  },
  {
    cfCode: '5.3.3',
    name: 'Integrated Development of Small and Medium Towns ',
    desc: '',
  },
  {
    cfCode: '5.3.4',
    name: 'Integrated Low Cost Saitatiion ',
    desc: '',
  },
  {
    cfCode: '5.3.5',
    name: 'Water Supply - Donation ',
    desc: '',
  },
  {
    cfCode: '5.3.6',
    name: 'Sewerage Donation ',
    desc: '',
  },
  {
    cfCode: '5.3.7',
    name: 'Scheme Grants',
    desc: '',
  },
  {
    cfCode: '6',
    nmamCode: '150',
    name: 'Sales & Hire Charges ',
    desc: '',
  },
  {
    cfCode: '6.1',
    name: 'Sale of Products',
    desc: '',
  },
  {
    cfCode: '6.1.1',
    name: 'Sale of Rubbish/ Debris/ Silt',
    desc: '',
  },
  {
    cfCode: '6.1.2',
    name: 'Sale of Compost/Manure/Grass/Unsufructs',
    desc: '',
  },
  {
    cfCode: '6.2',
    name: 'Sale of Forms and Publications ',
    desc: '',
  },
  {
    cfCode: '6.2.1',
    name: 'Sale of tender forms /other publications',
    desc: '',
  },
  {
    cfCode: '6.3',
    name: 'Sale of stores & scrap',
    desc: '',
  },
  {
    cfCode: '6.3.1',
    name: 'Sale of Stock & stores',
    desc: '',
  },
  {
    cfCode: '6.3.2',
    name: 'Sale of Scrap',
    desc: '',
  },
  {
    cfCode: '6.4',
    name: 'Sale of others',
    desc: '',
  },
  {
    cfCode: '6.5',
    name: 'Hire charges for vehicles',
    desc: '',
  },
  {
    cfCode: '6.6',
    name: 'Hire Charges for equipments ',
    desc: '',
  },
  {
    cfCode: '7',
    name: 'Income from investment ',
    desc: '',
  },
  {
    cfCode: '7.1',
    name: 'Interest on Investment/Fixed Deposits',
    desc: '',
  },
  {
    cfCode: '7.2',
    name: 'Dividend on Shares ',
    desc: '',
  },
  {
    cfCode: '7.3',
    name: 'Income from projects taken up on commercial basis',
    desc: '',
  },
  {
    cfCode: '7.4',
    name: 'Profit in Sale of Investments',
    desc: '',
  },
  {
    cfCode: '7.5',
    name: 'Municipal Bonds',
    desc: '',
  },
  {
    cfCode: '7.6',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '8',
    name: 'Interest Earned',
    desc: '',
  },
  {
    cfCode: '8.1',
    name: 'Interest from Bank Accounts ',
    desc: '',
  },
  {
    cfCode: '8.2',
    name: 'Interest on Loans and advances to Employees ',
    desc: '',
  },
  {
    cfCode: '8.3',
    name: 'Interest on loans to others ',
    desc: '',
  },
  {
    cfCode: '8.4',
    name: 'Other Interest ',
    desc: '',
  },
  {
    cfCode: '9',
    name: 'Other Income',
    desc: '',
  },
  {
    cfCode: '9.1',
    name: 'Deposits Forfeited',
    desc: '',
  },
  {
    cfCode: '9.2',
    name: 'Lapsed Deposits',
    desc: '',
  },
  {
    cfCode: '9.3',
    name: 'Insurance Claim Recovery',
    desc: '',
  },
  {
    cfCode: '9.4',
    name: 'Profit on Disposal of Fixed Assets',
    desc: '',
  },
  {
    cfCode: '9.4.1',
    name: 'Profit on Sales of Assets',
    desc: '',
  },
  {
    cfCode: '9.4.2',
    name: 'Others',
    desc: '',
  },
  {
    cfCode: '9.5',
    name: 'Recovery from employees ',
    desc: '',
  },
  {
    cfCode: '9.6',
    name: 'Uncliamed Refund Payable/Liabilities Written Back',
    desc: '',
  },
  {
    cfCode: '9.6.1',
    name: 'Sale Cheques',
    desc: '',
  },
  {
    cfCode: '9.7',
    name: 'Excess Provisions written back ',
    desc: '',
  },
  {
    cfCode: '9.7.1',
    name: 'Excess Provisions written back - Property tax',
    desc: '',
  },
  {
    cfCode: '9.7.2',
    name: 'Excess Provisions written back - Others(Octroi cess, water supply, advertisement tax, rent)',
    desc: '',
  },
  {
    cfCode: '9.8',
    name: 'Miscellaneous Income ',
    desc: '',
  },
  {
    cfCode: '10',
    name: 'TOTAL INCOME  (sum of 1 to 9)',
    desc: '',
  },
] as const;

// Sample data - payload from State.
export const apiPayload = {
  ulb_id: '5dd24729437ba31f7eb42eee', // AP001
  year: '606aafb14dff55e6c075d3ae', // 2022-23
  lineItems: {
    '1': 150,
    '1.1': 10,
    '1.2': 10,
    '1.3': 10,
    '1.4': 10,
    '1.5': 10,
    '1.6': 10,
    '1.7': 10,
    '1.8': 10,
    '1.9': 10,
    '1.10': 10,
    '1.11': 10,
    '1.12': 10,
    '1.13': 10,
    '1.14': 10,
    '1.15': 10,
  },
};
