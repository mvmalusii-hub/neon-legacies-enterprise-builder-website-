# Neon Legacies agents — Onboard and Legis

Two raw-API agents, one call path, no framework: a **prompt** and a **schema**
per agent, a **provider adapter** that speaks to DeepSeek or Qwen, a
**validator** that refuses bad output, and **GitHub Actions** to run them and
keep the results as artifacts.

```
neon_agents/
├── agents/            onboard_prompt.txt · onboard_schema.json
│                      legis_prompt.txt   · legis_schema.json
│                      neon_industries.json        <- the 26-industry table
├── provider.py        call_agent(): retries, tool-call/JSON fallback, logs
├── validate.py        zero-dependency shape + table + arithmetic checks
├── cli.py             onboard | legis | validate | selftest
├── fake.py            deterministic provider used by tests and --offline
├── logging_config.py  one JSON line per event, never a secret
└── tests/             34 unit tests, no network, no API key
```

## Run it

```bash
# Offline: exercises both agents, the validator and the retry paths
python3 -m neon_agents.cli selftest

# The 10 sample client descriptions, faked provider
python3 -m neon_agents.cli onboard \
  --input neon_agents/tests/samples/onboard_samples.json \
  --out /tmp/results.json --offline

# Live (needs DEEPSEEK_API_KEY or QWEN_API_KEY in the environment)
export DEEPSEEK_API_KEY=sk-...
python3 -m neon_agents.cli onboard --input neon_agents/tests/samples/onboard_samples.json \
  --out results_onboard.json --provider deepseek
python3 -m neon_agents.cli legis --industry Construction --context "residential renovations" \
  --out result_legis.json

# Validate anything already produced
python3 -m neon_agents.cli validate --agent legis --file result_legis.json
```

`openai>=1.40` is the only dependency, and only for live calls – the tests and
`selftest` run on the standard library alone, which is why CI can verify the
wiring without secrets.

## What the validator enforces

| Layer | Rule | Example it catches |
|---|---|---|
| shape | required keys, no extras, types, enums | `confidence: "pretty sure"` |
| table | industry exists; `roadmap_size` equals the published number | Legis returning 70 for Healthcare (92) |
| arithmetic | Legis category counts sum to `roadmap_size` | 84 split into counts totalling 86 |
| hygiene | exactly 3 documents, no repeats; exactly 5 critical-path entries | a 4-item `first_three_documents` |
| triage | `Unclassified` ⇒ size 0; unknown industry ⇒ a `notes` explanation | silent misclassification |

A violation is not just logged: the errors are quoted back to the model once as
a correction, and only then does the call fail.

## GitHub Actions

The three workflow files live here as `workflows/*.yml` because GitHub only runs
workflows from `.github/workflows/`, and this repository's automation token is
not allowed to write that path. Install them once, either way:

- **Web UI (no tooling):** Add file → Create new file → name it
  `.github/workflows/agent-tests.yml` → paste the contents of
  `neon_agents/workflows/agent-tests.yml` → Commit. Repeat for `onboard.yml` and
  `legis.yml`.
- **Command line with your own credentials:**
  ```bash
  mkdir -p .github/workflows
  cp neon_agents/workflows/*.yml .github/workflows/
  git add .github/workflows && git commit -m "Add agent workflows" && git push
  ```

| Workflow | Trigger | Secrets needed |
|---|---|---|
| `agent-tests.yml` | push/PR touching `neon_agents/**` | none (faked provider) |
| `onboard.yml` | manual dispatch, or a change to the Onboard prompt/schema | `DEEPSEEK_API_KEY` / `QWEN_API_KEY` |
| `legis.yml` | manual dispatch with an industry | same |

Inputs are passed as environment variables and CLI flags – never interpolated
into a `python -c` string – so a workflow input cannot become executable code.
Results are uploaded as artifacts, so the repository stays clean.

## Two things to check before trusting a live run

1. `finish_reason` in the logs – `length` means the answer was truncated
   (Onboard is capped at 320 tokens, Legis at 1400).
2. `valid: false` rows – the log line carries the validator's exact complaints.
