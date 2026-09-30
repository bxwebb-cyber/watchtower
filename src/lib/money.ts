// "$1,500.00" — how every amount reads in emails, alerts and the dashboard.
// (CSV exports keep plain numbers so spreadsheets can add them up.)
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const usd = (cents: number): string => fmt.format(cents / 100);
export const usdDollars = (dollars: number): string => fmt.format(dollars);
