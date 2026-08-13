import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import {
  ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES,
  MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB,
  IFSC_REGEX,
} from '../dto/submit-xvi-fc-bank-account.dto';

/** formId for the bank-account (PFMS) formJson document — see CLAUDE.md's formId registry
 *  (22 SFC, 23 EULB, 24 Devolution, 25 FC Unspent, 26 Claim Letter, 30/31 Annual Account, 32 SLB). */
export const BANK_ACCOUNT_FORM_ID = 33;

/**
 * Field list for the bank-account form, config-driven the same way SLB's `DEFAULT_SLB_FIELDS`
 * is (see `ulb/slb/constants/slb-form.constants.ts`) — seeded into the `formjsons` collection by
 * `scripts/seed-bank-account-form-json.ts`, not consumed directly by any service yet.
 *
 * `ifscCode`'s `lookup.populates` mapping is verified against `BankAccountService.lookupIfsc()`'s
 * real response shape (`{ifscCode, bankDetails: {name, branch, address, city, state, micr}}`),
 * not guessed. `bankDetails.*` fields are `disabled` — they're only ever autofilled by that
 * lookup, never hand-typed. `accountNumber`/`confirmAccountNumber`'s named validation entries
 * (`hasSpaces`/`hasAlphabets`/`hasSpecialChars`/`tooShort`/`tooLong`/`matchesField`) are matched
 * against `digitsOnlyValidator`'s/`matchesFieldValidator`'s error keys by the frontend's generic
 * validation-message display — see `DynamicFormService.toFormGroup()`.
 */
export const DEFAULT_BANK_ACCOUNT_FIELDS: FieldConfig[] = [
  {
    key: 'ifscCode',
    label: 'IFSC Code',
    formFieldType: 'text',
    required: true,
    placeholder: 'e.g. SBIN0001234',
    validations: [
      { name: 'required', validator: null, message: 'IFSC code is required.' },
      { name: 'pattern', validator: IFSC_REGEX.source, message: 'Enter a valid Indian IFSC code.' },
      { name: 'api', validator: null, message: '' },
    ],
    lookup: {
      endpoint: 'xvi-fc/bank-account/ifsc/:value',
      populates: {
        'bankDetails.name': 'bankDetails.name',
        'bankDetails.branch': 'bankDetails.branch',
        'bankDetails.address': 'bankDetails.address',
        'bankDetails.city': 'bankDetails.city',
        'bankDetails.state': 'bankDetails.state',
        'bankDetails.micr': 'bankDetails.micr',
      },
    },
  },
  {
    key: 'bankDetails.name',
    label: 'Bank Name',
    formFieldType: 'text',
    required: true,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
    validations: [{ name: 'required', validator: null, message: 'Bank name is required.' }],
  },
  {
    key: 'bankDetails.branch',
    label: 'Branch',
    formFieldType: 'text',
    required: true,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
    validations: [{ name: 'required', validator: null, message: 'Branch is required.' }],
  },
  {
    key: 'bankDetails.address',
    label: 'Branch Address',
    formFieldType: 'text',
    required: true,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
    validations: [{ name: 'required', validator: null, message: 'Branch address is required.' }],
  },
  {
    key: 'bankDetails.city',
    label: 'City',
    formFieldType: 'text',
    required: true,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
    validations: [{ name: 'required', validator: null, message: 'City is required.' }],
  },
  {
    key: 'bankDetails.state',
    label: 'State',
    formFieldType: 'text',
    required: false,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
  },
  {
    key: 'bankDetails.micr',
    label: 'MICR Code',
    formFieldType: 'text',
    required: false,
    disabled: true,
    disabledReason: 'Auto-filled from the IFSC code.',
  },
  {
    key: 'accountNumber',
    label: 'Account Number',
    formFieldType: 'text',
    required: true,
    digitsOnly: true,
    validations: [
      { name: 'required', validator: null, message: 'Account number is required.' },
      { name: 'minlength', validator: 9, message: 'Minimum 9 digits required.' },
      { name: 'maxlength', validator: 18, message: 'Maximum 18 digits allowed.' },
      { name: 'hasSpaces', validator: null, message: 'No spaces allowed.' },
      { name: 'hasAlphabets', validator: null, message: 'No alphabets allowed. Digits only (0-9).' },
      { name: 'hasSpecialChars', validator: null, message: 'No special characters allowed. Digits only (0-9).' },
      { name: 'tooShort', validator: null, message: 'Minimum 9 digits required.' },
      { name: 'tooLong', validator: null, message: 'Maximum 18 digits allowed.' },
      { name: 'api', validator: null, message: '' },
    ],
  },
  {
    key: 'confirmAccountNumber',
    label: 'Confirm Account Number',
    formFieldType: 'text',
    required: true,
    matchesField: 'accountNumber',
    digitsOnly: true,
    validations: [
      { name: 'required', validator: null, message: 'Please confirm the account number.' },
      { name: 'hasSpaces', validator: null, message: 'No spaces allowed.' },
      { name: 'hasAlphabets', validator: null, message: 'No alphabets allowed. Digits only (0-9).' },
      { name: 'hasSpecialChars', validator: null, message: 'No special characters allowed. Digits only (0-9).' },
      { name: 'tooShort', validator: null, message: 'Minimum 9 digits required.' },
      { name: 'tooLong', validator: null, message: 'Maximum 18 digits allowed.' },
      { name: 'matchesField', validator: null, message: 'Account numbers do not match.' },
      { name: 'api', validator: null, message: '' },
    ],
  },
  {
    key: 'proofFile',
    label: 'Bank Proof Document',
    formFieldType: 'file',
    required: true,
    allowedFileTypes: [...ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES],
    maxFileSize: MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB,
    labelHint: 'Cancelled cheque or bank passbook first page. PDF, JPG, or PNG.',
    validations: [{ name: 'required', validator: null, message: 'A bank proof document is required.' }],
  },
];
