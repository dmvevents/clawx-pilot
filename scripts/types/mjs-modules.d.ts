// Scripts-project ambient declaration (CLWX-98): gateway plugins and their
// helpers (extensions/**/*.mjs) are untyped JS by design, and tsx already
// treats these imports as `any` at runtime. Without this, every script that
// imports a plugin fails TS7016 and would end up excluded from typechecking
// entirely — losing coverage of all its OTHER types.
declare module '*.mjs';
