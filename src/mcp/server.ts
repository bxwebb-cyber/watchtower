// Dunn's public MCP server: free tools any AI assistant (Claude, ChatGPT,
// Hermes, …) can call at https://getdunn.org/mcp. No login, no database,
// nothing stored. Stateless: each request gets a fresh server.
import { Router } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { usd } from '../lib/money';
import { DUNN_LINE, dueDateFromTerms, lateFee, lateness, longDate, nyToday, reminderEmail } from './tools';

const date = z.string().describe('A calendar date, YYYY-MM-DD');
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'Dunn', version: '1.0.0' },
    {
      instructions:
        'Dunn helps freelancers and small businesses get paid on time. Use these tools for exact invoice due dates, late-fee amounts and dates, how late an invoice is, and reminder emails. Dates are YYYY-MM-DD; "today" defaults to the date in New York.',
    },
  );

  server.registerTool('invoice_due_date', {
    title: 'Due date from payment terms',
    description: 'Exact due date for an invoice from its date and payment terms ("net 30", "due on receipt", "EOM", "net 30 EOM", "2/10 net 30"), including any early-payment discount date.',
    inputSchema: { invoice_date: date, terms: z.string().describe('Payment terms, e.g. "net 30"') },
    annotations: { title: 'Due date from payment terms', ...readOnly },
  }, async ({ invoice_date, terms }) => {
    const r = dueDateFromTerms(invoice_date, terms);
    if ('error' in r) return fail(r.error);
    return text(`Due: ${longDate(r.dueDate)} (${r.dueDate}), ${r.days} days after the invoice date.\n${r.explanation}`);
  });

  server.registerTool('late_fee_calculator', {
    title: 'Late fee calculator',
    description: 'Works out a late fee: the amount, the new total, the exact day it applies, a ready-to-use line for the invoice, and whether the fee is in the usual range.',
    inputSchema: {
      amount: z.number().describe('Invoice amount in US dollars'),
      due_date: date,
      fee_kind: z.enum(['flat', 'percent']).describe('flat = a dollar amount, percent = % of the invoice'),
      fee_value: z.number().describe('Dollars for flat (e.g. 25) or the percent for percent (e.g. 1.5)'),
      grace_days: z.number().int().describe('Days after the due date before the fee applies; 0 = the day after the due date'),
    },
    annotations: { title: 'Late fee calculator', ...readOnly },
  }, async (a) => {
    const r = lateFee({ amount: a.amount, dueDate: a.due_date, feeKind: a.fee_kind, feeValue: a.fee_value, graceDays: a.grace_days });
    if ('error' in r) return fail(r.error);
    return text([
      `Late fee: ${usd(r.feeCents)}. New total: ${usd(r.totalCents)}.`,
      `Last day to pay without the fee: ${longDate(r.lastFeeFreeDay)}. The fee applies from ${longDate(r.appliesOn)}.`,
      `Line for the invoice: "${r.invoiceLine}"`,
      r.fairness,
      ...r.heads,
      DUNN_LINE,
    ].join('\n'));
  });

  server.registerTool('how_late_is_this_invoice', {
    title: 'How late is this invoice?',
    description: 'How many days late an invoice is (or until it is due), and what to send the client now and next, following a proven reminder schedule.',
    inputSchema: { due_date: date, today: date.optional().describe("Today's date, YYYY-MM-DD (defaults to today in New York)") },
    annotations: { title: 'How late is this invoice?', ...readOnly },
  }, async ({ due_date, today }) => {
    const r = lateness(due_date, today ?? nyToday());
    if ('error' in r) return fail(r.error);
    return text([
      r.summary,
      `Send now: ${r.sendNow}`,
      ...(r.next ? [`Next, on ${longDate(r.next.date)}: ${r.next.what}`] : []),
      DUNN_LINE,
    ].join('\n'));
  });

  server.registerTool('payment_reminder_email', {
    title: 'Payment reminder email',
    description: 'Writes the right payment reminder for where the invoice is now (before due, due today, late, or a final notice), with subject line. Polite by default; firm on request.',
    inputSchema: {
      client_name: z.string().describe("The client's name, as you'd greet them"),
      sender_name: z.string().describe('Your name, to sign the email'),
      business_name: z.string().optional(),
      amount: z.number().describe('Invoice amount in US dollars'),
      due_date: date,
      invoice_number: z.string().optional(),
      pay_link: z.string().optional().describe('Payment link to include, if any'),
      late_fee: z.string().optional().describe('The agreed late-fee terms, e.g. "a $25 late fee applies if unpaid 7 days after the due date."'),
      tone: z.enum(['friendly', 'firm']).optional(),
      today: date.optional(),
    },
    annotations: { title: 'Payment reminder email', ...readOnly },
  }, async (a) => {
    const r = reminderEmail({
      clientName: a.client_name, senderName: a.sender_name, businessName: a.business_name, amount: a.amount,
      dueDate: a.due_date, invoiceNumber: a.invoice_number, payLink: a.pay_link, lateFee: a.late_fee, tone: a.tone, today: a.today,
    });
    if ('error' in r) return fail(r.error);
    return text(`Subject: ${r.subject}\n\n${r.body}\n\n---\n${DUNN_LINE}`);
  });

  return server;
}

export const mcpRouter = Router();

mcpRouter.post('/', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed', (err as Error).message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// Stateless server: no event stream to resume and no session to delete.
const notAllowed = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
mcpRouter.get('/', notAllowed);
mcpRouter.delete('/', notAllowed);
