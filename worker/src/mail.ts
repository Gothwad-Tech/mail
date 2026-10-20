// =============================================================================
// Mail domain logic: one entry point, three focused files.
//
//   mail-types.ts  types, limits, validation, row -> API mapping
//   mail-read.ts   list / detail / ETag (the read path)
//   mail-write.ts  patch / delete / drafts / Sent copy / daily send count
//
// Callers (the Worker routes, tests) keep importing from './mail'; the split is
// only so no file grows past a few hundred lines.
//
// Rule for every function: `username` comes from the VERIFIED session and goes
// in the WHERE clause. Sent mail is stored with to_username = sender, so the
// same rule covers Inbox, Sent, Drafts and Trash.
// =============================================================================

export * from './mail-types';
export * from './mail-read';
export * from './mail-write';
