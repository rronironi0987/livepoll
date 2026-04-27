# Frontend Guide

## Overview

The frontend is a React + Vite app that connects to Stellar wallets, reads poll data from Soroban, and submits on-chain poll actions.

## Main Files

- `src/App.jsx` handles the UI, polling flows, and wallet interactions
- `src/lib/stellar.js` contains Soroban RPC, wallet, and contract helpers
- `src/App.css` and `src/index.css` define the app styles
- `src/polyfills.js` provides browser polyfills used by wallet libraries

## Features

- Multi-wallet connection with `StellarWalletsKit`
- Freighter-compatible wallet connect flow
- Read-only browsing when no wallet is connected
- Poll creation, voting, and closing through Soroban contract calls
- Recent contract event feed and live refresh behavior
- Transaction lifecycle states for wallet signing and network confirmation

## Environment Variables

```env
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_STELLAR_CONTRACT_ID=CBGJGJOFFSY5KK7DHFENNBGASXROVG5GEW2MISGJ2N2F7VLHCCUJ42UA
VITE_STELLAR_READ_ACCOUNT=
VITE_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet
```

## Local Frontend Setup

1. Install dependencies:

```bash
npm install
```

2. Optionally copy the env template:

```powershell
Copy-Item .env.example .env.local
```

3. Start the dev server:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

## Wallet Notes

- The app supports `xBull`, `Freighter`, `Albedo`, `Rabet`, `Lobstr`, `Hana`, `Hot Wallet`, and `Klever`
- If no wallet is connected, the app creates a temporary read account for contract reads
- Freighter uses a direct access request flow during connection

## Preview

![Wallet options preview](./public/wallet-options-preview.svg)
