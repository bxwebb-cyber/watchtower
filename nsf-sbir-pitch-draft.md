# NSF SBIR Project Pitch — Dunn (Invoice Cash Flow AI)
**Applicant:** Defiance Media LLC  
**Working name:** Dunn (formerly Watchtower)  
**Project period:** Phase I, 12 months  
**Requested funding:** $305,000

---

## 1. The Technology Innovation (3500 char max)

Small businesses lose an estimated $39,000 per year per company to late invoice payments. 59% of US small businesses now carry invoices overdue by 30+ days, averaging $17,700 in unpaid balances. The problem is structural: cash flow is unpredictable, and existing tools (QuickBooks, Wave, FreshBooks) are purely reactive — they send reminders on fixed schedules but cannot predict which invoices will be late or quantify cash flow risk.

Dunn is an existing, shipped SaaS for automated invoice reminders, late-fee enforcement, and recurring invoice management (48 passing tests, Stripe-connected, handling real payment workflows). The proposed R&D is a **novel transfer-learning prediction engine** that forecasts invoice payment timing from sparse client data.

The core technical challenge: most small business clients have fewer than 5 invoices on record, which is insufficient data for standard ML models to make useful predictions. We will research and develop a multi-task learning architecture that:

1. Learns aggregate payment behavior patterns across all Dunn tenant businesses (invoice amount distributions, seasonal effects, day-of-week and month effects, payment term effects) using a shared encoder.
2. Combines these aggregate priors with each client's sparse individual history using a probabilistic few-shot regression model (a hierarchical Bayesian or neural process approach).
3. Outputs per-invoice predictions: probability of late payment, expected days late, and a cash-flow-at-risk confidence interval.

This is fundamentally different from existing approaches. Current accounting tools use static rules ("send reminder at day -3"). No commercial invoicing product attempts to predict payment timing from limited client history using transfer learning. The R&D risk is significant: can the shared encoder extract useful cross-client patterns that generalize to new clients with no history? Can the model maintain accuracy as client populations and economic conditions drift over time?

Phase I will: (a) collect and curate a training dataset from existing Dunn invoice histories, (b) design and implement the transfer-learning architecture, (c) train and evaluate against baseline models (logistic regression, gradient boosting), (d) develop an interpretable output layer that surfaces prediction rationale to non-technical business owners, and (e) conduct a pilot study with 20-30 small business beta testers to measure prediction accuracy and user trust.

---

## 2. Market Opportunity (1750 char max)

The global billing and invoicing software market was valued at $6.57 billion in 2026 and is projected to reach $20.04 billion by 2035 (CAGR 15.23%). The US small business accounting software market alone is $7.7 billion and growing at 6.92% CAGR.

The specific pain point Dunn addresses — cash flow unpredictability from late payments — touches 59% of all US small businesses (approximately 20 million firms). Those businesses carry $17,700 average in unpaid invoices, and 49% say payment delays create critical cash flow gaps even after payment is received. 59% of owners paid extra fees (overdrafts, credit card interest, factoring) to access money they already earned.

Currently, no existing solution provides predictive payment timing for small business owners. QuickBooks, Xero, Wave, and FreshBooks all offer invoicing and reminders but operate on fixed schedules. The market is ripe for a product that not only automates the process but forecasts cash flow — turning accounts receivable from a historical record into a forward-looking planning tool.

Dunn's existing user base provides a wedge: businesses already using automated reminders and late fees. The prediction engine becomes the upgrade that increases stickiness, reduces churn, and justifies premium pricing.

---

## 3. Competitive Advantage (1750 char max)

Dunn's competitive advantage is built on three layers:

**Data moat.** Dunn's multi-tenant invoice database spans accounts, clients, invoices, payment events, and fee outcomes across thousands of transactions. This dataset — payment timing per client, per amount band, per season — is the training ground for the prediction model. QuickBooks and Xero have larger datasets, but no competitor has built a prediction layer on top of them, and none has demonstrated the ability to do so with the sparse-data constraints inherent in small business invoicing.

**Technical defensibility.** The transfer-learning architecture for sparse-data payment prediction is novel. Key IP:
- The shared encoder + few-shot regressor architecture for multi-tenant payment prediction
- The interpretable output layer that translates model confidence into plain-English cash flow guidance for non-technical owners
- The drift-detection mechanism that flags when aggregate patterns have shifted (economic conditions, industry trends) and retrains accordingly

Patents are possible on the architecture and on the specific application of few-shot learning to invoice payment prediction. The proprietary trained model itself is a trade secret.

**Product integration.** The prediction engine is not a standalone tool; it is embedded in a working invoicing platform that already handles reminders, late-fee management, recurring invoices, and payment reconciliation. The prediction layer enhances every existing screen: the dashboard shows cash flow forecasts, the invoice list flags high-risk clients, the report shows expected vs actual payment timelines. Integration creates switching costs.

---

## 4. Company and Team (1750 char max)

Defiance Media LLC is a single-member LLC registered in New York, SBC-eligible, with prior SBIR/STTR compliance infrastructure (SAM.gov registration, eRA Commons account, biosketch, budget templates from a previous NIH SBIR Phase I submission).

The team consists of:

**Bashira Webb, Founder & PI.** A.A.S. Computer Information Systems, Monroe College. Full-stack developer with shipped products across iOS (PillPair — personalized medication reminders for Alzheimer's caregivers, beta-tested), web (Dunn — invoice automation SaaS, fully built and tested), and design (receipts, Saudade, Flipp). Self-taught in ML fundamentals with applied data analysis experience in trading strategy backtesting and pattern identification. Primary employment will be with Defiance Media LLC at 51%+ full-time equivalent during the Phase I period.

**Technical gaps and plan.** The team currently lacks a dedicated ML researcher with academic publishing experience. Phase I budget includes 0.5 FTE for a part-time ML research contractor or academic collaborator (funded through a consulting arrangement) with experience in time-series prediction, Bayesian methods, and/or neural process architectures. We will also participate in the NSF I-Corps program to validate customer discovery around predictive cash flow features.

Advisors: [TO BE CONFIRMED — potential candidates include ML researchers from local NYC universities with relevant time-series/forecasting experience.]

---

## Budget Estimate (Phase I)

| Category | Amount |
|----------|--------|
| PI salary + fringe (0.5 FTE x 12 mo) | $75,000 |
| ML research contractor (0.5 FTE x 12 mo) | $85,000 |
| Cloud compute (AWS/GCP training + inference) | $30,000 |
| Data storage + pipeline infrastructure | $15,000 |
| Beta tester incentives (30 businesses x $500) | $15,000 |
| I-Corps program participation costs | $5,000 |
| Materials, software licenses | $10,000 |
| Subtotal direct costs | $235,000 |
| Indirect costs (De minimis 10%) | $23,500 |
| Small business fee (7% of direct) | $16,450 |
| **Total** | **$274,950** |

(Budget under the $305K Phase I cap. Excess can be allocated to additional contractor hours or equipment.)