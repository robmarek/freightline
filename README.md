# Freightline · Port Meridian

A logistics strategy game built for Synergy Network. Claim shipments on the shared exchange, route your truck across the city, and deliver before the deadline. The fleet with the highest practice SNRG balance after ten rounds wins.

## Run the browser game

From this directory, start a static server and open [localhost:8765](http://localhost:8765/).

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Choose **Play solo** to compete against the Meridian Freight computer fleet, or choose **Two players** to share a device. Each fleet starts at its own depot with 150 practice SNRG and gets three actions per shift. Claim one contract at a time, load it at the origin, and unload it at the destination. Roads use fuel. The Fuel Saver lowers per-road fuel costs, and the Route Permit can save one travel action per shift. Both fleets use the same posted jobs, deadlines, and move rules. The browser saves the match and mode on the current device.

## Verify the rules

```sh
node --test test/*.test.mjs
```

[The SynQ contract and local runtime checks](chain/README.md) document how to reproduce the AIVM build and test the same core game rules with authenticated seats. The contract artifacts target Synergy Testnet v3, chain 1266. The browser makes a read-only network check. Practice SNRG stays in the game. Public general-purpose SynQ deployment is pending a verified Testnet v3 execution path. [Synergy Forge runtime status](https://forge.synergy-network.io/build/aivm/overview)

The city background is an original generated aerial illustration of an industrial port, with warehouses, rail yards, and a riverside foundry.
