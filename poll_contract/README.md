# Poll Contract

## Overview

This folder contains the Soroban smart contract used by LivePoll for storing polls, votes, and poll status on Stellar testnet.

## Main Files

- `src/lib.rs` contains the contract logic
- `Cargo.toml` defines the Rust package and Soroban dependency

## Network Details

- Network: `Stellar Testnet`
- Contract address: `CBSQPHRXSCC7ZHYP3VRDMGM3J3YLDXOZPLPLFVQTN5XKBT4NJWDCY772`
- Contract explorer: https://stellar.expert/explorer/testnet/contract/CBSQPHRXSCC7ZHYP3VRDMGM3J3YLDXOZPLPLFVQTN5XKBT4NJWDCY772
- Sample contract call tx hash: `842cfc9bc29f79898735966c9fe2080c1a439461ac20254d83a335a7eab8359e`
- Sample call explorer: https://stellar.expert/explorer/testnet/tx/842cfc9bc29f79898735966c9fe2080c1a439461ac20254d83a335a7eab8359e

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

These values were generated on April 30, 2026 during testnet deployment:

- WASM upload tx: `2d00b0cd1bb3e3d842e6dc1a6a87bb76aef084a5fdb68c83f9b81c8d23e8520c`
- Contract deploy tx: `d4cc2649ae9e523205aeb5ef620e7ff9f51ace8204461925c39c08b3b072f350`
- Sample create poll tx: `842cfc9bc29f79898735966c9fe2080c1a439461ac20254d83a335a7eab8359e`
