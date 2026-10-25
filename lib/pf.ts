// Typed boundary around the ported engine/parser modules. They are plain JS with
// @ts-nocheck (kept byte-identical to the tested prototype), so the rest of the app
// sees them as `any` rather than relying on inferred, partly wrong types.
import * as engine from './engine/engine';
import * as chat from './parse/chat';

export const PF: any = engine;
export const C: any = chat;
