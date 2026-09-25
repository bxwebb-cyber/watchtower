"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const webhook_1 = require("./routes/webhook");
const auth_1 = require("./routes/auth");
const invoices_1 = require("./routes/invoices");
const reports_1 = require("./routes/reports");
const inbound_1 = require("./routes/inbound");
const app = (0, express_1.default)();
// Webhook route needs the RAW body for Stripe signature verification,
// so it gets its own express.raw() instance BEFORE the json parser.
app.use('/webhooks/stripe', express_1.default.raw({ type: 'application/json' }), webhook_1.webhookRouter);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'watchtower' });
});
app.use('/auth', auth_1.authRouter);
app.use('/invoices', invoices_1.invoicesRouter);
app.use('/reports', reports_1.reportsRouter);
// Inbound email (Resend): client replies to reminders land here.
app.use('/webhooks/resend/inbound', inbound_1.inboundRouter);
// The invoice creator form (static, no build step).
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
    console.log(`[watchtower] listening on :${port}`);
});
//# sourceMappingURL=index.js.map