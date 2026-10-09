export type AssetGroup = 'auth' | 'setup' | 'iframe' | 'native' | 'headless' | 'counts' | 'content';
export const assetManifest: {
  readonly version: 1;
  readonly groups: Readonly<Record<AssetGroup, readonly string[]>>;
  readonly files: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>>;
};
export function copyAssets(destination: string | URL, groups?: readonly AssetGroup[]): Promise<string[]>;
