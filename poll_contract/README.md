# Poll Contract

## Overview

This folder contains the Soroban smart contract used by LivePoll for storing polls, votes, and poll status on Stellar testnet.

## Main Files

- `src/lib.rs` contains the contract logic
- `Cargo.toml` defines the Rust package and Soroban dependency

## Network Details

- Network: `Stellar Testnet`
- Contract address: `CBGJGJOFFSY5KK7DHFENNBGASXROVG5GEW2MISGJ2N2F7VLHCCUJ42UA`
- Contract explorer: https://stellar.expert/explorer/testnet/contract/CBGJGJOFFSY5KK7DHFENNBGASXROVG5GEW2MISGJ2N2F7VLHCCUJ42UA
- Sample contract call tx hash: `282d8793c1968e02b32d6d23d688b930a01c316056c908acfd6b685b8089f67e`
- Sample call explorer: https://stellar.expert/explorer/testnet/tx/282d8793c1968e02b32d6d23d688b930a01c316056c908acfd6b685b8089f67e

## Build

From the project root:

```bash
npm run contract:build
```

Or directly with Cargo:

```bash
cargo build --manifest-path poll_contract/Cargo.toml --target wasm32v1-none --release
```

## Deploy

From the project root:

```bash
npm run contract:deploy
```

The deploy script:

- funds a temporary deployer account on testnet when `STELLAR_DEPLOYER_SECRET` is not provided
- uploads the compiled contract WASM
- deploys the contract
- submits a sample `create_poll` contract call
- prints the contract id and transaction hashes as JSON

## Deployment Record

These values were generated on April 27, 2026 during testnet deployment:

- WASM upload tx: `6c6781692a1c69e58231105680b7285f6c77d431fd66645e1df2e55c45a18547`
- Contract deploy tx: `3a83a32bb31421fce9b501b5720f535baf59a52a667eda8b63b16172ae23217c`
- Sample create poll tx: `282d8793c1968e02b32d6d23d688b930a01c316056c908acfd6b685b8089f67e`
