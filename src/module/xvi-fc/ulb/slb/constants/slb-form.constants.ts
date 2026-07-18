import type { SlbTypedFieldConfig } from '../helpers/slb-form-json.helpers';

/**
 * Bundled default SLB question set — 28 Service Level Benchmark indicators (Actual/Target)
 * grouped by sector, plus the self-declaration fields. Used as the fallback when no
 * admin-configured FormJson document exists yet for type 'SLB' (see SlbFormJsonConfigService.loadFields).
 * Admins can override any of this via the generic /form-json CRUD endpoints
 * (create a document with type: 'SLB', formId: 32) without a code change — once that
 * document exists, it takes over and this bundled default is no longer consulted.
 */
export const DEFAULT_SLB_FIELDS: SlbTypedFieldConfig[] = [
  {
    key: 'perCapitaWaterSupply',
    label: 'Per capita supply of water',
    position: 1,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: 'lpcd',
    },
    placeholder: '0-999',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 999,
        message: 'Value cannot exceed 999 lpcd.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 1,
      unit: 'lpcd',
    },
  },
  {
    key: 'waterMeteringExtent',
    label: 'Extent of metering of water connections',
    position: 2,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 2,
      unit: '%',
    },
  },
  {
    key: 'waterComplaintRedressal',
    label: 'Efficiency in redressal of customer complaints (Water Supply)',
    position: 3,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 3,
      unit: '%',
    },
  },
  {
    key: 'waterQuality',
    label: 'Quality of water supplied',
    position: 4,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 4,
      unit: '%',
    },
  },
  {
    key: 'waterCostRecovery',
    label: 'Cost recovery in water supply services',
    position: 5,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 5,
      unit: '%',
    },
  },
  {
    key: 'waterSupplyCoverage',
    label: 'Coverage of water supply connections',
    position: 6,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 6,
      unit: '%',
    },
  },
  {
    key: 'nonRevenueWater',
    label: 'Extent of non-revenue water (NRW)',
    position: 7,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 7,
      unit: '%',
    },
  },
  {
    key: 'waterSupplyContinuity',
    label: 'Continuity of water supply',
    position: 8,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: 'Hours/day',
    },
    placeholder: '0-24',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 24,
        message: 'Value cannot exceed 24 Hours/day.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 8,
      unit: 'Hours/day',
    },
  },
  {
    key: 'waterChargeCollection',
    label: 'Efficiency in collection of water supply-related charges',
    position: 9,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Water Supply',
      indicatorNumber: 9,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterTreatmentCapacity',
    label: 'Adequacy of waste water treatment capacity',
    position: 10,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 10,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterTreatmentQuality',
    label: 'Quality of waste water treatment',
    position: 11,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 11,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterComplaintRedressal',
    label: 'Efficiency in redressal of customer complaints (Waste Water)',
    position: 12,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'Both actual and target values for indicator 12 are required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 12,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterCollectionEfficiency',
    label: 'Collection efficiency of waste water network',
    position: 13,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 13,
      unit: '%',
    },
  },
  {
    key: 'toiletCoverage',
    label: 'Coverage of toilets',
    position: 14,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 14,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterNetworkCoverage',
    label: 'Coverage of waste water network services',
    position: 15,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 15,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterReuseExtent',
    label: 'Extent of reuse and recycling of waste water',
    position: 16,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 16,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterCostRecovery',
    label: 'Extent of cost recovery in waste water',
    position: 17,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 17,
      unit: '%',
    },
  },
  {
    key: 'wasteWaterChargeCollection',
    label: 'Efficiency in collection of waste water charges',
    position: 18,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Sewerage & Waste Water',
      indicatorNumber: 18,
      unit: '%',
    },
  },
  {
    key: 'swmCostRecovery',
    label: 'Extent of cost recovery in SWM services',
    position: 19,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 19,
      unit: '%',
    },
  },
  {
    key: 'swmComplaintRedressal',
    label: 'Efficiency in redressal of customer complaints (SWM)',
    position: 20,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 20,
      unit: '%',
    },
  },
  {
    key: 'swmChargeCollection',
    label: 'Efficiency in collection of SWM related user charges',
    position: 21,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 21,
      unit: '%',
    },
  },
  {
    key: 'mswCollectionEfficiency',
    label: 'Efficiency of collection of municipal solid waste',
    position: 22,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 22,
      unit: '%',
    },
  },
  {
    key: 'mswSegregationExtent',
    label: 'Extent of segregation of municipal solid waste',
    position: 23,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 23,
      unit: '%',
    },
  },
  {
    key: 'mswRecoveryExtent',
    label: 'Extent of municipal solid waste recovered',
    position: 24,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 24,
      unit: '%',
    },
  },
  {
    key: 'mswScientificDisposal',
    label: 'Extent of scientific disposal of municipal solid waste',
    position: 25,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 25,
      unit: '%',
    },
  },
  {
    key: 'swmHouseholdCoverage',
    label: 'Household level coverage of solid waste management services',
    position: 26,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Solid Waste Management',
      indicatorNumber: 26,
      unit: '%',
    },
  },
  {
    key: 'stormWaterDrainageCoverage',
    label: 'Coverage of storm water drainage network',
    position: 27,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: '%',
    },
    placeholder: '0-100',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 100,
        message: 'Value cannot exceed 100%.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Storm Water Drainage',
      indicatorNumber: 27,
      unit: '%',
    },
  },
  {
    key: 'waterLoggingIncidence',
    label: 'Incidence of water logging',
    position: 28,
    formFieldType: 'actualTarget',
    required: true,
    decimal: 2,
    inputCardConfig: {
      suffixText: 'Nos./Year',
    },
    placeholder: '0-9999',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 0,
        message: 'Value cannot be negative.',
      },
      {
        name: 'max',
        validator: 9999,
        message: 'Value cannot exceed 9999 Nos./Year.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    meta: {
      sector: 'Storm Water Drainage',
      indicatorNumber: 28,
      unit: 'Nos./Year',
    },
  },
  {
    key: 'declarantName',
    label: 'Name',
    formFieldType: 'text',
    required: true,
    placeholder: 'Full name',
    maxLength: 100,
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'Name is required.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
  },
  {
    key: 'declarantDesignation',
    label: 'Designation',
    formFieldType: 'text',
    required: true,
    placeholder: 'e.g. Municipal Engineer',
    maxLength: 100,
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'Designation is required.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
  },
  {
    key: 'supportingDocument',
    label: 'Supporting Document',
    formFieldType: 'file',
    required: true,
    folderPathKey: 'slb/supporting-document',
    allowedFileTypes: ['pdf', 'jpg', 'jpeg', 'png'],
    maxFileSize: 20971520,
    fileViewType: 'button',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'A supporting document is required.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
  },
  {
    key: 'checkboxConfirmation',
    label: 'I certify that the information above is complete and accurate to the best of my knowledge.',
    formFieldType: 'checkbox',
    required: true,
    validations: [
      {
        name: 'requiredTrue',
        validator: null,
        message: 'You must confirm this declaration before submitting.',
      },
    ],
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
  },
];
