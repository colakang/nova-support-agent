# Agent eval report

2026-11-22 10:25 UTC · model `gpt-6.1-terra` (flex tier, fallback `gpt-6-luna`, judge `gpt-6-luna`) · τ_low 0.5 / τ_high 0.63 · 62 cases, 98 turns · wall 34s

| metric | value |
|---|---|
| **cases passed** | **61/62 (98%)** |
| escalation precision / recall | 100% / 100% (tp 11, fp 0, fn 0) |
| out-of-scope answered anyway (hallucination proxy) | 0/10 |
| refunds issued that policy didn't allow | 0 |
| turns where a guardrail rejected a draft (then repaired or fell back) | 8/98 |
| turn latency p50 / p95 | 2.5s / 5.6s |
| time to first status p50 | 0ms |
| LLM calls served from the eval cache | 3/206 (latency/cost above are NOT representative; run with --no-cache) |
| LLM calls per turn (mean) | 2.1 |
| cost per turn (mean, flex) / total | $0.0007 / $0.065 (cached calls count $0) |

| category | passed |
|---|---|
| policy_qa | 16/16 |
| tier_qa | 6/7 |
| out_of_scope | 10/10 |
| action | 13/13 |
| adversarial | 7/7 |
| escalation | 5/5 |
| multi_turn | 4/4 |

## Failures

### tier-pro-annual-to-monthly (tier_qa)

- answer lacks any of ["end of the term","end of your current term","renewal","renews","term ends"]
> **dev@quantafoods.com, PIN 7310**  
> Thanks, Dev. Your account is verified. How can I help you today? _(account, answered)_
> **Can we switch from annual to monthly billing right now?**  
> You can’t switch to monthly billing immediately; the change takes effect at the end of your current annual term. Your workspace owner can schedule it under Settings → Billing. _(grounded, answered)_

