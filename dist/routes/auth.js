"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const stripe_1 = __importDefault(require("stripe"));
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
// One-glance confirmation after connect: shows the business name we'll send
// emails as, with a single "looks right" tap back into the invoice form. This
// is trust-critical (emailing clients under the wrong name), but must stay a
// glance, not a data-entry task — so a wrong name is fixed in Stripe, not here.
function confirmationPage(businessName) {
    const name = businessName.trim();
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connected — Watchtower</title>
<style>
  body { margin:0; font-family: Georgia, 'Times New Roman', serif; background:#faf6ee; color:#1f1a16; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fffdf7; border:1px solid #e4dac8; border-radius:12px; padding:32px 28px; max-width:420px; text-align:center; }
  h1 { font-size:24px; margin:0 0 4px; }
  p  { color:#5c5248; line-height:1.5; margin:8px 0 20px; }
  .name { font-weight:bold; color:#1f1a16; }
  a.btn { display:inline-block; background:#e25822; color:#fff; text-decoration:none; padding:14px 22px; border-radius:10px; font-weight:bold; box-shadow:0 2px 0 #b8400e; }
  a.btn:hover { background:#b8400e; }
  a.link { color:#b8400e; }
</style></head>
<body>
  <div class="card">
    <h1>You're connected.</h1>
    <p>We'll send reminders as <span class="name">${esc(name || 'your business')}</span>.</p>
    ${name ? `<p style="font-size:14px;">Doesn't look right? Update your business name in <a class="link" href="https://dashboard.stripe.com/settings/public" target="_blank" rel="noopener">Stripe</a>.</p>` : ''}
    <a class="btn" href="/">Looks right — create an invoice</a>
  </div>
</body></html>`;
}
exports.authRouter = (0, express_1.Router)();
// Step 1 — send the user to Stripe to authorize our app on their account.
exports.authRouter.get('/stripe/start', (_req, res) => {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.STRIPE_CLIENT_ID,
        scope: 'read_write',
        redirect_uri: process.env.STRIPE_REDIRECT_URI,
    });
    res.redirect(`https://connect.stripe.com/oauth/authorize?${params}`);
});
// Step 2 — Stripe redirects back with a code; exchange it for tokens.
exports.authRouter.get('/stripe/callback', async (req, res) => {
    const code = req.query.code;
    if (!code)
        return res.status(400).send('Missing code');
    try {
        const token = await stripe.oauth.token({ grant_type: 'authorization_code', code });
        const accountId = token.stripe_user_id;
        // Fetch the account to get the business name/email
        const acct = await stripe.accounts.retrieve(accountId);
        // Store the connection (single-user v1: upsert on the account)
        const { PrismaClient } = await Promise.resolve().then(() => __importStar(require('@prisma/client')));
        const prisma = new PrismaClient();
        await prisma.account.upsert({
            where: { stripeAccountId: accountId },
            update: {
                email: (acct.email ?? ''),
                businessName: (acct.business_profile?.name ?? ''),
            },
            create: {
                stripeAccountId: accountId,
                email: (acct.email ?? ''),
                businessName: (acct.business_profile?.name ?? ''),
            },
        });
        const businessName = (acct.business_profile?.name ?? '');
        res.send(confirmationPage(businessName));
    }
    catch (err) {
        console.error('[auth] oauth callback failed', err);
        res.status(500).send(`Connection failed: ${err.message}`);
    }
});
//# sourceMappingURL=auth.js.map