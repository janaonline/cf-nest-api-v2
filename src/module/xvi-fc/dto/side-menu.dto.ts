export interface SideMenuItemDto {
  label: string;
  icon?: string;
  separator?: boolean;
  expanded?: boolean;
  routerLink?: string[];
  featureKey?: string;
  /** External URL for an item that opens outside the app (e.g. Submit Feedback) instead of a
   *  `routerLink`. */
  url?: string;
  target?: '_blank' | '_self';
  items?: SideMenuItemDto[];
}

export interface SideMenuResponseDto {
  topModel: SideMenuItemDto[];
  bottomModel: SideMenuItemDto[];
}