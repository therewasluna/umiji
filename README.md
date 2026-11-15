<div align="center">
  <img src="assets/logo.svg" alt="Umiji" width="96" height="96">

  <h1>Umiji</h1>

  <p><b>海路</b> · <i>umiji</i>, "sea route"</p>

  <p>A proxy management panel built on Xray-core, made for running a VPN business with resellers.</p>
</div>

## What it does

- **Users, nodes and hosts**: one panel manages every Xray node, user and subscription.
- **Brokers**: reseller accounts that sign in to the same panel but only see their own users, inside a traffic quota,
  a users limit and an expiry date that you set.
- **Telegram store bots**: each broker can connect a bot that sells plans, takes card-to-card or crypto payments with
  receipt review, and delivers subscription links.
- **Branded subscription pages**: every broker gets its own page. Edits show up right away, with no restarts.
- **English and Persian** throughout the panel, the broker panel and the bots.

## Repositories

| Repository | What it is |
| --- | --- |
| [umiji-backend](https://github.com/therewasluna/umiji-backend) | API, workers and scheduler. Also holds the deploy kit and the guides. |
| [umiji-frontend](https://github.com/therewasluna/umiji-frontend) | The web panel. |
| [umiji-subscription-page](https://github.com/therewasluna/umiji-subscription-page) | The page users open from their subscription link. |
| [umiji-node](https://github.com/therewasluna/umiji-node) | Runs Xray-core on each server. |
| umiji (this one) | Overview, logo, help articles and templates the panel loads, and the wiki in `docs/` ([umiji.wiki](https://umiji.wiki), in English and Persian). |

## Get started

Follow [DEPLOY.md](https://github.com/therewasluna/umiji-backend/blob/main/DEPLOY.md). It takes you from an empty
server to a working panel and subscription page.

## A fork of Remnawave

Umiji is a fork of [Remnawave](https://github.com/remnawave/panel), the open-source proxy panel by the Remnawave team.
Most of what Umiji can do started there. Umiji adds brokers, their Telegram store bots, live subscription page
updates and the Persian translation, and goes its own way from here. Thank you to everyone who built Remnawave.

## License

AGPL-3.0, see [LICENCE](LICENCE). Like Remnawave, every part of Umiji is free software: if you run a modified version
for others, you have to share its source.
