export const PROTOCOL_VERSION=7;
export const API_PREFIX=`/api/v${PROTOCOL_VERSION}`;
export const assetURL=(path:string)=>`${path}?v=${PROTOCOL_VERSION}`;
