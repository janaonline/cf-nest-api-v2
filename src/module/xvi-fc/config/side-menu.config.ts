/* eslint-disable prettier/prettier */
import { SideMenuResponseDto } from '../dto/side-menu.dto';

export type MenuRole = 'ULB' | 'STATE' | 'MOHUA' | 'DOE' | 'ADMIN';

export const SIDE_MENU_CONFIG: Record<MenuRole, (yearId: string) => SideMenuResponseDto> = {
  ULB: (yearId) => ({
    topModel: [
      {
        label: 'XVI Financial Commission',
        icon: 'bi bi-bank',
        routerLink: ['/xvifc'],
      },
      { label: '_', separator: true },
      {
        label: 'Overview',
        icon: 'bi bi-speedometer2',
        featureKey: 'overview',
      },
      {
        label: 'Teams & Roles',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'unified view',
            icon: 'bi bi-people-fill',
            featureKey: 'roles-teams-unified-view',
          },
        ],
      },
      {
        label: 'Entry Conditions',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'FY ' + yearId + ' Conditions',
            icon: 'bi bi-ui-checks',
            featureKey: 'ulb-forms',
          },
        ],
      },
      {
        label: 'Support',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'Support Hours',
            icon: 'bi bi-headset',
            featureKey: 'support-hours',
          },
        ],
      },
    ],
    bottomModel: [
      //      {
      //     label: 'Review',
      //     icon: 'bi bi-clipboard-data',
      //     items: [
      //       {
      //         label: 'ULB Submissions',
      //         icon: 'bi bi-upload',
      //         featureKey: 'ulb-submissions',
      //       },
      //       {
      //         label: 'Insights',
      //         icon: 'bi bi-bar-chart-line',
      //         featureKey: 'insights',
      //       },
      //     ],
      //   },
    ],
  }),

  STATE: (yearId) => ({
    topModel: [
      {
        label: 'XVI Financial Commission',
        icon: 'bi bi-bank',
        routerLink: ['/xvifc'],
      },
      { label: '_', separator: true },
      {
        label: 'Overview',
        icon: 'bi bi-speedometer2',
        featureKey: 'overview',
      },
      {
        label: 'Teams & Roles',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'unified view',
            icon: 'bi bi-people-fill',
            featureKey: 'roles-teams-unified-view',
          },
        ],
      },
      {
        label: 'Support',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'Support Hours',
            icon: 'bi bi-headset',
            featureKey: 'support-hours',
          },
        ],
      },
      {
        label: 'Review',
        icon: 'bi bi-clipboard-data',
        items: [
          {
            label: 'ULB Submissions',
            icon: 'bi bi-upload',
            featureKey: 'ulb-submissions',
          },
          {
            label: 'Insights',
            icon: 'bi bi-bar-chart-line',
            featureKey: 'insights',
          },
        ],
      },
      {
        label: 'State level conditions',
        icon: 'bi bi-diagram-3',
        items: [
          {
            label: 'Requirements',
            icon: 'bi bi-list-check',
            featureKey: 'requirements',
          },
          {
            label: 'SFC Status',
            icon: 'bi bi-building',
            featureKey: 'sfc-status',
          },
          {
            label: 'Elected Body Status',
            icon: 'bi bi-person-badge',
            featureKey: 'elected-body-status',
          },
          {
            label: 'Devolution Formula',
            icon: 'bi bi-calculator',
            featureKey: 'devolution-formula',
          },
        ],
      },
    ],
    bottomModel: [
      //   {
      //     label: 'Give feedback',
      //     icon: 'bi bi-chat-square-text',
      //     featureKey: 'feedback',
      //   },
    ],
  }),

  MOHUA: (yearId) => ({
    topModel: [
      {
        label: 'XVI Financial Commission',
        icon: 'bi bi-bank',
        routerLink: ['/xvifc'],
      },
      { label: '_', separator: true },
      {
        label: 'Workspace',
        icon: 'bi bi-building-gear',
        featureKey: '',
      },
    ],
    bottomModel: [],
  }),

  DOE: (yearId) => ({
    topModel: [
      {
        label: 'XVI Financial Commission',
        icon: 'bi bi-bank',
        routerLink: ['/xvifc'],
      },
      { label: '_', separator: true },
      {
        label: 'Workspace',
        icon: 'bi bi-building-gear',
        featureKey: '',
      },
    ],
    bottomModel: [],
  }),
  ADMIN: (yearId) => ({
    topModel: [
      {
        label: 'XVI Financial Commission',
        icon: 'bi bi-bank',
        routerLink: ['/xvifc'],
      },
      { label: '_', separator: true },
      {
        label: 'Overview',
        icon: 'bi bi-speedometer2',
        featureKey: 'overview',
      },
      // {
      //   label: 'Teams & Roles',
      //   icon: 'bi bi-clipboard-data',
      //   items: [
      //     {
      //       label: 'unified view',
      //       icon: 'bi bi-people-fill',
      //       featureKey: 'roles-teams-unified-view',
      //     },
      //   ],
      // },
      {
        label: 'Automated',
        icon: 'bi bi-clock-fill',
        items: [
          {
            label: 'Scheduled Reminders',
            icon: 'bi bi-clock-fill',
            featureKey: 'scheduled-reminders',
          },
        ],
      },
    ],
    bottomModel: [
      //      {
      //     label: 'Review',
      //     icon: 'bi bi-clipboard-data',
      //     items: [
      //       {
      //         label: 'ULB Submissions',
      //         icon: 'bi bi-upload',
      //         featureKey: 'ulb-submissions',
      //       },
      //       {
      //         label: 'Insights',
      //         icon: 'bi bi-bar-chart-line',
      //         featureKey: 'insights',
      //       },
      //     ],
      //   },
    ],
  }),
};
