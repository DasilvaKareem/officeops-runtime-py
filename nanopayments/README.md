# OfficeOps Circle Nanopayments

This sidecar adds real Circle Gateway x402 nanopayments in front of the existing
Python runtime endpoint.

## What this does

- Runs a paid endpoint: `GET /orchestrate?prompt=...`
- Uses `@circle-fin/x402-batching/server` middleware for payment enforcement
- Forwards paid requests to `POST {RUNTIME_BASE_URL}/api/orchestrate`
- Uses `GatewayClient` scripts for deposit, balance, and paid client requests

## Setup

1. Install dependencies:

```bash
cd nanopayments
npm install
```

2. Create env:

```bash
cp .env.example .env
```

3. Generate keys (optional):

```bash
npm run setup
```

4. Fund the client wallet with Arc testnet USDC and deposit:

```bash
npm run deposit -- 1
```

5. Run servers:

```bash
# terminal 1
cd officeops-runtime-py
./venv/bin/python -m uvicorn officeops_runtime.server.main:app --host 0.0.0.0 --port 3002

# terminal 2
cd officeops-runtime-py/nanopayments
npm run server
```

6. Execute paid call:

```bash
npm run client -- "write a short release note for today"
```

## Notes

- `CHAIN` defaults to `arcTestnet`.
- `NANOPAYMENT_PRICE` defaults to `$0.01`.
- This sidecar is intentionally separate from frontend UI until wallet UX is wired in-app.
