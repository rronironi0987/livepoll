# LivePoll

LivePoll is a Stellar testnet polling dapp with a React frontend and a Soroban smart contract backend.

## Project Structure

- `src/` contains the frontend app
- `poll_contract/` contains the Soroban smart contract
- `scripts/` contains deployment helpers

## Docs

- Frontend guide: [FRONTEND.md](./FRONTEND.md)
- Contract guide: [poll_contract/README.md](./poll_contract/README.md)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Build the contract:

```bash
npm run contract:build
```

3. Start the frontend:

```bash
npm run dev
```

## Scripts

- `npm run dev` starts the Vite frontend
- `npm run build` creates a production frontend build
- `npm run lint` runs ESLint
- `npm run contract:build` builds the Soroban contract
- `npm run contract:deploy` uploads and deploys the contract
