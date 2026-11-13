// Every page a member can open. The CMS is one page, checked after `bun run world reset`.
export type Route = { name: string; path: string };

export const routes: Route[] = [{ name: "newsroom board", path: "/" }];

export const extraButtonVerbs: string[] = [];
