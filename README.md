# LivePoll

LivePoll is a mini end-to-end Stellar + Soroban dApp: a multi-wallet polling app backed by a deployed Soroban smart contract on Stellar Testnet, with real-time contract event sync, transaction progress feedback, basic caching, and a small automated test suite.

## Level 3 Submission Checklist (fill before submitting)

- Live demo link: https://livepoll-five.vercel.app/
- Demo video (1 minute) link: https://drive.google.com/file/d/1QPVIvcFsOatJ4D3Uj8UgDZ2ArIPf48I5/view?usp=sharing
- Test output screenshot (3+ passing tests): ✅ (see below)
- Public GitHub repo link: `https://github.com/rronironi0987/livepoll.git`
- 3+ meaningful commits for Level 3: ✅

## Test Output (Screenshot)

![Test output showing 3+ passing tests](./public/tests-passing.svg)

## Submission Overview

This project demonstrates:

- Multi-wallet integration with `StellarWalletsKit`
- Smart contract deployment on Stellar Testnet
- Contract reads and writes from the frontend
- Real-time event polling and state synchronization
- Visible transaction lifecycle feedback
- Wallet error handling for missing wallet, rejected request, and insufficient balance
- Loading states and progress indicators during reads/writes
- Basic caching of recently loaded poll data in `localStorage`
- Automated tests for core helper logic

## Key Features

- Connect with supported Stellar wallets including Freighter, xBull, Albedo, Rabet, Lobstr, Hana, Hot Wallet, and Klever
- Create, vote on, close, and delete polls through frontend contract calls
- Browse contract data in read-only mode even without a connected wallet
- See transaction phases in the UI: `preparing`, `awaiting-signature`, `pending`, `success`, and `error`
- Refresh poll state automatically from recent on-chain contract events

## Screenshot

Website preview:

<img width="1901" height="870" alt="Screenshot 2026-04-30 190440" src="https://github.com/user-attachments/assets/584d4683-176b-4855-9304-9e48ac8ab31c" />


Wallet options available:

<img width="1898" height="868" alt="Screenshot 2026-04-30 191011" src="https://github.com/user-attachments/assets/900a0e91-73c4-46bf-8ab0-7a292e429c00" />


## Deployed Contract

- Network: `Stellar Testnet`
- Contract address: `CBSQPHRXSCC7ZHYP3VRDMGM3J3YLDXOZPLPLFVQTN5XKBT4NJWDCY772`
- Contract explorer: https://stellar.expert/explorer/testnet/contract/CBSQPHRXSCC7ZHYP3VRDMGM3J3YLDXOZPLPLFVQTN5XKBT4NJWDCY772

## Verifiable Contract Call

- Transaction hash: `842cfc9bc29f79898735966c9fe2080c1a439461ac20254d83a335a7eab8359e`
- Stellar Expert link: https://stellar.expert/explorer/testnet/tx/842cfc9bc29f79898735966c9fe2080c1a439461ac20254d83a335a7eab8359e

## Live Demo

https://drive.google.com/file/d/1QPVIvcFsOatJ4D3Uj8UgDZ2ArIPf48I5/view?usp=sharing

## Setup

Run all commands from the `live-poll` project directory.

1. Install dependencies:

```bash
npm install
```

2. Build the Soroban contract:

```bash
npm run contract:build
```

3. Sync the compiled contract WASM into the frontend (used to load the contract spec/ABI at runtime):

```bash
npm run wasm:sync
```

4. Optionally create a local env file:

```powershell
Copy-Item .env.example .env.local
```

5. Start the frontend:

```bash
npm run dev
```

6. Build for production:

```bash
npm run build
```

## Tests

Run the automated tests:

```bash
npm test
```

For submission, include a screenshot of the terminal output showing **3+ tests passing**.

## Environment Variables

```env
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_STELLAR_CONTRACT_ID=CBSQPHRXSCC7ZHYP3VRDMGM3J3YLDXOZPLPLFVQTN5XKBT4NJWDCY772
VITE_STELLAR_READ_ACCOUNT=
VITE_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet
VITE_POLL_CONTRACT_WASM_URL=/contracts/poll_contract.wasm
```

## Testnet Notes

- A connected wallet must be funded on Stellar Testnet before it can send contract transactions
- If a wallet has not been created on Testnet yet, fund it with Friendbot first and then retry
- The app can still read poll data without a funded wallet by using a temporary read account

## Scripts

- `npm run dev` starts the frontend
- `npm run build` creates a production build
- `npm run lint` runs ESLint
- `npm test` runs the Node.js test suite
- `npm run contract:build` builds the Soroban contract
- `npm run wasm:sync` copies the compiled WASM into `public/contracts/` for the frontend to load the contract spec
- `npm run contract:deploy` uploads and deploys the contract to testnet

## Deploy (Vercel / Netlify)

This is a standard Vite build.

- Node.js: use Node `^20.19.0` or `>=22.12.0` (required by Vite 8)
- Build command: `npm run build`
- Output directory: `dist`
- Set the env vars from the section above (at minimum `VITE_STELLAR_CONTRACT_ID` if you deploy a new contract)

## Demo Video (1 minute)

Suggested recording flow:

1. Open the deployed site and show the “Read from contract” panel updating.
2. Connect a wallet (Freighter or any supported wallet).
3. Create a poll (show “awaiting-signature” → “pending” → “success”).
4. Vote on the poll and show the event feed / vote count updating.
5. Open the contract/tx on Stellar Expert via the links in the UI.

## Project Structure

- `src/` contains the React frontend
- `src/lib/stellar.js` contains wallet, RPC, contract, and event helpers
- `src/lib/pollCache.js` contains the basic poll cache helpers
- `src/lib/pollLogic.js` contains pure helper functions used by the UI
- `poll_contract/` contains the Soroban contract
- `scripts/` contains deployment helpers
- `tests/` contains the automated test suite

## Additional Docs

- Frontend guide: [FRONTEND.md](./FRONTEND.md)
- Contract guide: [poll_contract/README.md](./poll_contract/README.md)

## Submission Notes

- GitHub repository: `https://github.com/rronironi0987/livepoll.git`
- The project includes multiple meaningful commits in git history
- The contract is deployed on testnet and called from the frontend
- Real-time event integration and visible transaction status are implemented
- Before final submission, update the checklist at the top with your live demo link, demo video link, and test screenshot
