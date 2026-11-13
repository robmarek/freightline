# Freightline on SynQ

Freightline implements a deterministic two-seat match in one city. The player who starts the local contract takes seat 1. A second account joins as seat 2. The match gives each seat 150 whole practice SNRG, three actions per shift, and ten rounds.

The contract mirrors the browser's twelve roads and twelve scheduled jobs. Players claim any open job remotely, collect it at its origin, follow connected roads while paying fuel, and deliver the cargo for the posted reward. Claims are exclusive. At the end of a job's deadline round, unfinished jobs expire and loaded cargo is cleared. The Fuel Saver and Route Permit change travel costs under the browser's rules. The final practice SNRG balance decides the winner. Equal balances share the result.

Browser matches use local saves. The contract checks caller identity against the active seat and emits events for match activity. Its numeric district IDs are West 1, East 2, Rail 3, Market 4, Heights 5, Junction 6, Port 7, and Foundry 8. Job IDs 1 through 12 correspond to browser IDs `j1` through `j12`. Job status values are 0 unreleased or unknown, 1 available, 2 claimed, 3 loaded, 4 delivered, and 5 expired. Once the second player joins, a turn value of 0 indicates a finished match. A winning seat of 0 indicates a tie in a finished match.

## Build and verify locally

Use Node.js, Rust 1.93.0, and adjacent Synergy checkouts of `synq-language` at `01125b6470c6b49c586b7a28fe054a62e1c913c6` and `synergy-aivm` at `1533d76ec84165c567f5d36e6bdd7e283e1a96a1`. From this directory run:

```sh
node local-aivm.mjs build /path/to/synergy-checkouts
node local-aivm.mjs test /path/to/synergy-checkouts
```

The build produces SynQ stateful IR v2, its ABI, and a manifest targeting Synergy Testnet v3, chain 1266. The AIVM tests invoke the contract directly with synthetic callers and in-memory state. They cover claim conflicts, turn permissions, valid roads, fuel costs, pickup and delivery, both upgrades, low-balance spending limits, deadline expiry, ten-round scoring, ties, and native value rejection with state rollback. The browser replay was cross-checked against the same delivery fixture for matching action counts, claims, balances, and upgrades.

## Network status

Practice SNRG is the game's nonredeemable balance unit. The contract rejects attached native SNRG and emits no transfers. The browser game uses its own local engine. Synergy Forge reports that public Testnet v3 still needs a verified general SynQ transaction admission path and canonical execution receipts. [Forge runtime status](https://forge.synergy-network.io/build/aivm/overview)
