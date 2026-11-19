/** OM field keys: the inline boxes MoHUA fills on the letter. */
export const OM_FIELD = { NUMBER: 'omNumber', DATE: 'omDate' } as const;

export const OM_NUMBER_MAX_LENGTH = 100;

/** Field configs in the shape the portal's inline letter boxes read (same as the claim letter's letter details). */
export const OM_FIELDS = [
  {
    key: OM_FIELD.NUMBER,
    label: 'OM No.',
    formFieldType: 'text',
    required: true,
    placeholder: 'No.',
    hintText: 'The e-Office file number of this OM',
    validations: [{ name: 'maxlength', validator: OM_NUMBER_MAX_LENGTH, message: `At most ${OM_NUMBER_MAX_LENGTH} characters.` }],
  },
  {
    key: OM_FIELD.DATE,
    label: 'Dated',
    formFieldType: 'date',
    required: false,
    placeholder: 'Dated',
    hintText: "Today's date unless you change it",
  },
] as const;

/** Signed OM copy back from e-Office. */
export const OM_SIGNED_FILE_MAX_SIZE_KB = 5 * 1024;

export const OM_TITLE = 'OFFICE MEMORANDUM';

/** Printed after the ULB lists. */
export const OM_ULB_LISTS_FOOTNOTE =
  'The table below lists eligible ULBs included in the current claim batch. Other eligible ULBs may be included in ' +
  'subsequent claims.';

export const OM_LETTERHEAD = [
  'Government of India',
  'Ministry of Housing and Urban Affairs',
  'Department of Urban Development',
  'Finance Commission Cell',
  '*****',
];

export const OM_OFFICE_ADDRESS = ['Sankalp Bhawan, (GPOA-II)', 'KG Marg, New Delhi'];

export const OM_COMPLIANCE_HEADERS = [
  'S. No.',
  'Type of condition for BASIC Grant as per Operational Guidelines',
  'Status of Compliance as furnished by the State',
];

export const OM_RECOMMENDATION_HEADERS = [
  'State',
  '16th FC allocation for the Financial Year',
  "MoHUA's recommendation in r/o basic grants (both tied and untied) for the Financial Year",
];

/** The officer who signs the OM in e-Office; printed under the letter and in the endorsement request. */
export const OM_SIGNATORY = {
  name: 'P.K. Dhyani',
  designation: 'Under Secretary to the Govt. of India',
  contact: '8826181716',
  email: 'pk.dhyani-upsc@gov.in',
};

export const OM_ADDRESSEE = [
  'To,',
  'The Joint Director (FCD)',
  'Department of Expenditure',
  'Ministry of Finance',
  'Room No. 10012, Ground Floor',
  'Kartavya Bhawan - 01',
  'New Delhi - 110001.',
];

/** The status the claim letter must be at to get an OM: verified by the SO (UNDER_REVIEW_BY_MOHUA, treated as final). */
export const OM_SOURCE_CLAIM_LETTER_STATUS = 5;

export const OM_REVIEWER_FORBIDDEN_MESSAGE = 'Only MoHUA or admin users may issue an Office Memorandum.';
