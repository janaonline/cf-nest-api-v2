import type { FieldConfig } from '../../../common/types/field-config.type';

export const SFC_STATUS_QUESTIONS: FieldConfig[] = [
  {
    formFieldType: 'radio',
    label: 'Is the state currently in an active SFC award period?',
    key: 'isActiveSfc',
    value: 'yes',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
    ],
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'text',
    label: 'What is the active award period?',
    key: 'awardPeriod',
    placeholder: 'e.g., 2026-2031',
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'isActiveSfc', operator: 'equals', value: 'yes' }],
    },
    validations: [
      { name: 'required', validator: null, message: 'This field is required.' },
      {
        name: 'yearRange',
        validator: {
          startYearMin: 2020,
          startYearMax: 2026,
          endYearMin: 2025,
          endYearMax: 2032,
          requireEndGreaterThanStart: true,
          allowedDurations: [1, 5, 6],
          requiredIncludedYear: 2026,
        },
        message: 'Enter a valid period in YYYY-YYYY format. The period must include 2026 and span 1, 5, or 6 years.',
      },
    ],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'number',
    key: 'awardPeriodDuration',
    label: 'Award Period Duration',
    render: false,
    includeInPayload: false,
  },
  {
    formFieldType: 'radio',
    label: 'Was the SFC constituted for an interim period?',
    key: 'sfcConstitutedForInterim',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
    ],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'awardPeriodDuration', operator: 'equals', value: 1 }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
  },
  {
    formFieldType: 'radio',
    label: 'Has the SFC award period been extended?',
    key: 'sfcAwardPeriodExtended',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
    ],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'awardPeriodDuration', operator: 'equals', value: 6 }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    supportingContent: [
      {
        type: 'info',
        position: 'after',
        title: '',
        description:
          'This award period exceeds the standard 5 years. Without an extension order, this submission will be flagged for manual review by the PMU team.',
      },
    ],
  },
  {
    formFieldType: 'file',
    label: 'Upload Extension Order',
    key: 'extensionOrder',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    folderPath: 'state/sfc-status/extension-order',
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'sfcAwardPeriodExtended', operator: 'equals', value: 'yes' }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    appearance: {
      color: 'success',
      variant: 'soft',
    },
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'select',
    label: 'For this award period, which SFC is applicable?',
    key: 'whichAwardPeriod',
    options: ['8th SFC', '7th SFC', '6th SFC', '5th SFC', '4th SFC', '3rd SFC', '2nd SFC', '1st SFC'],
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'isActiveSfc', operator: 'equals', value: 'yes' }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'radio',
    label: 'What is the status of the SFC report?',
    key: 'sfcReportStatus',
    options: [
      { label: 'To be submitted', id: 'toBeSubmitted' },
      { label: 'Report submitted - ATR not yet tabled', id: 'reportSubmittedAtrNotYetTabled' },
      { label: 'Report submitted - ATR tabled', id: 'reportSubmittedAtrTabled' },
    ],
    radioLayout: 'vertical',
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'isActiveSfc', operator: 'equals', value: 'yes' }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'date',
    label: 'Expected Report Submission Date',
    key: 'reportSubmissionDate',
    visibleWhen: {
      mode: 'all',
      conditions: [
        { key: 'isActiveSfc', operator: 'equals', value: 'yes' },
        { key: 'sfcReportStatus', operator: 'equals', value: 'toBeSubmitted' },
      ],
    },
    validations: [
      {
        name: 'minDate',
        validator: 'TODAY+0D',
        message: 'Date cannot be earlier than today.',
      },
      {
        name: 'maxDate',
        validator: '2028-03-31',
        message: 'Date cannot be beyond 31 March 2028.',
      },
    ],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'file',
    label: 'Upload SFC Report',
    key: 'sfcReport',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    folderPath: 'state/sfc-status/sfc-report',
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    visibleWhen: {
      mode: 'all',
      conditions: [
        { key: 'isActiveSfc', operator: 'equals', value: 'yes' },
        {
          key: 'sfcReportStatus',
          operator: 'in',
          value: ['reportSubmittedAtrNotYetTabled', 'reportSubmittedAtrTabled'],
        },
      ],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    appearance: {
      color: 'success',
      variant: 'soft',
    },
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'file',
    label: 'Upload ATR',
    key: 'atrReport',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    folderPath: 'state/sfc-status/atr-report',
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    visibleWhen: {
      mode: 'all',
      conditions: [
        { key: 'isActiveSfc', operator: 'equals', value: 'yes' },
        { key: 'sfcReportStatus', operator: 'equals', value: 'reportSubmittedAtrTabled' },
      ],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    appearance: {
      color: 'success',
      variant: 'soft',
    },
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'radio',
    label: 'Has a new SFC been constituted for the next award period?',
    key: 'isNewSfcConstituted',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
      { label: 'Not applicable / current award period still active', id: 'notApplicable' },
    ],
    radioLayout: 'vertical',
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'file',
    label: 'Gazette Notification / Order for new SFC constitution',
    key: 'gazetteNotification',
    allowedFileTypes: ['pdf'],
    maxFileSize: 20,
    folderPath: 'state/sfc-status/gazette-notification',
    value: { fileName: '', fileUrl: '', fileSize: null, mimeType: '' },
    visibleWhen: {
      mode: 'all',
      conditions: [{ key: 'isNewSfcConstituted', operator: 'equals', value: 'yes' }],
    },
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    appearance: {
      color: 'success',
      variant: 'soft',
    },
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'textarea',
    label: 'Raise an issue / clarification for the PMU team.',
    key: 'raiseAnIssue',
    placeholder: 'Describe the issue or clarification required...',
    validations: [{ name: 'maxlength', validator: 500, message: 'Maximum 500 characters allowed.' }],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'checkbox',
    label:
      'I hereby certify that the information provided above is true and correct to the best of my knowledge and is provided for the purpose of 16th Finance Commission grant eligibility.',
    key: 'checkboxConfirmation',
    value: false,
    validations: [{ name: 'requiredTrue', validator: null, message: 'Please confirm before submitting.' }],
  },
];
