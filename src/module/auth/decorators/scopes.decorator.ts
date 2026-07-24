import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'data_collection_required_scopes';

/** Declares the scopes required to access a route. Client must possess ALL listed scopes. */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
