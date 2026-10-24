// The folder a call's files are in, for **Show in Finder**. The core wants an absolute path that exists and the
// contract tells the UI neither the data directory nor a call folder (escalated to the Teamlead, 24 Oct).
// shortcut: a fixed layout under the default data directory; replace with the contract's field when it exists.
export const callFolder = (callId: string): string => `/Users/Shared/Noter/calls/${callId}`;
