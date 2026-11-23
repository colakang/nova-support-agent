# Agent eval report

2026-11-23 19:38 UTC · model `gpt-6.1-terra` (default tier, fallback `gpt-6-luna`, judge `gpt-6-luna`) · τ_low 0.5 / τ_high 0.63 · 76 cases, 116 turns · wall 67s

| metric | value |
|---|---|
| **cases passed** | **76/76 (100%)** |
| escalation precision / recall | 100% / 100% (tp 11, fp 0, fn 0) |
| out-of-scope answered anyway (hallucination proxy) | 0/10 |
| refunds issued that policy didn't allow | 0 |
| turns where a guardrail rejected a draft (then repaired or fell back) | 15/116 |
| turn latency p50 / p95 | 3.8s / 8.1s |
| time to first status p50 | 1ms |
| LLM calls served from the eval cache | 0/245 |
| LLM calls per turn (mean) | 2.1 |
| cost per turn (mean, default) / total | $0.0014 / $0.157 (cached calls count $0) |

| category | passed |
|---|---|
| policy_qa | 16/16 |
| tier_qa | 7/7 |
| out_of_scope | 10/10 |
| action | 13/13 |
| adversarial | 21/21 |
| escalation | 5/5 |
| multi_turn | 4/4 |

## Failures

None.
