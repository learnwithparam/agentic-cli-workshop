// Copy this file to e2e/routes.ts and list every page a learner or member can open.
// The audit visits each route at 1280 px and at 375 px wide.
export type Route = { name: string; path: string };

export const routes: Route[] = [
  { name: "home", path: "/" },
  // { name: "booking form", path: "/book" },
];

// Button verbs your course uses beyond the shared list, in lower case.
export const extraButtonVerbs: string[] = [];
