export interface SideMenuItemDto {
  label: string;
  icon?: string;
  separator?: boolean;
  expanded?: boolean;
  routerLink?: string[];
  featureKey?: string;
  items?: SideMenuItemDto[];
}

export interface SideMenuResponseDto {
  topModel: SideMenuItemDto[];
  bottomModel: SideMenuItemDto[];
}