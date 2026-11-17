// How a Person page returns to People after the person is deleted: the main window sets it (the call page's `slots` pattern).
export const leave: { toPeople: (() => void) | null } = { toPeople: null };
