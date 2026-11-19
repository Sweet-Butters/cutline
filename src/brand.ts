// package.json displayName is the single source of the visible product name.
// Stable command ids and cache paths deliberately survive a display-name change.
export const BRAND: string = require('../package.json').displayName;
