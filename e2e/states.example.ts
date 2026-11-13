// Copy this file to e2e/states.ts. A state is a page after the learner does something:
// opens a dialog, submits a bad form, or empties a list. The audit checks it like a route.
import type { Page } from "@playwright/test";

export type PageState = { name: string; path: string; prepare: (page: Page) => Promise<void> };

export const states: PageState[] = [
  // {
  //   name: "booking form with an error",
  //   path: "/book",
  //   prepare: async (page) => {
  //     await page.getByRole("button", { name: "Book this trip" }).click();
  //   },
  // },
];
