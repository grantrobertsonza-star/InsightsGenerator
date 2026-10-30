// R5story: the brand tracking dashboard's pages in menu order, by the ids they are registered under on the server
// (trackerDashboardCards.ts registerDashboardPage). Client-safe: the dashboard screen names its page with these;
// dashboardStory.test.ts keeps the two lists equal.
export const DASHBOARD_PAGE_IDS = ["overview", "moments", "associations", "advertising", "audience", "category"] as const;
export type DashboardPageId = (typeof DASHBOARD_PAGE_IDS)[number];
